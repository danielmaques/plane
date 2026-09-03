# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from django.db.models import Q

from rest_framework import status
from rest_framework.response import Response

from plane.app.permissions import ROLE, allow_permission
from plane.app.serializers import PageFolderSerializer
from plane.db.models import Page, PageFolder, Project, ProjectMember, WorkspaceMember

from ..base import BaseViewSet


class PageFolderViewSet(BaseViewSet):
    serializer_class = PageFolderSerializer
    model = PageFolder

    def _get_project(self, slug, project_id):
        return Project.objects.get(pk=project_id, workspace__slug=slug, archived_at__isnull=True)

    def _get_folder(self, slug, project_id, folder_id):
        return PageFolder.objects.get(
            pk=folder_id,
            workspace__slug=slug,
            project_id=project_id,
        )

    def _is_admin(self, request, slug, project_id):
        is_project_admin = ProjectMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            project_id=project_id,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
        is_workspace_admin = WorkspaceMember.objects.filter(
            member=request.user,
            workspace__slug=slug,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
        return is_project_admin or is_workspace_admin

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def list(self, request, slug, project_id):
        self._get_project(slug, project_id)
        folders = PageFolder.objects.filter(
            workspace__slug=slug,
            project_id=project_id,
        ).filter(Q(access=PageFolder.PUBLIC_ACCESS) | Q(owned_by=request.user))
        return Response(PageFolderSerializer(folders, many=True).data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def create(self, request, slug, project_id):
        project = self._get_project(slug, project_id)
        serializer = PageFolderSerializer(
            data=request.data,
            context={
                "project_id": project_id,
                "workspace_id": project.workspace_id,
                "owned_by_id": request.user.id,
            },
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_201_CREATED)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def partial_update(self, request, slug, project_id, folder_id):
        folder = self._get_folder(slug, project_id, folder_id)
        if folder.owned_by_id != request.user.id and not self._is_admin(request, slug, project_id):
            return Response(
                {"error": "Only the folder owner or an administrator can rename it."},
                status=status.HTTP_403_FORBIDDEN,
            )

        serializer = PageFolderSerializer(
            folder,
            data=request.data,
            partial=True,
            context={
                "project_id": project_id,
                "workspace_id": folder.workspace_id,
                "owned_by_id": folder.owned_by_id,
            },
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(serializer.data, status=status.HTTP_200_OK)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER])
    def destroy(self, request, slug, project_id, folder_id):
        folder = self._get_folder(slug, project_id, folder_id)
        if folder.owned_by_id != request.user.id and not self._is_admin(request, slug, project_id):
            return Response(
                {"error": "Only the folder owner or an administrator can delete it."},
                status=status.HTTP_403_FORBIDDEN,
            )
        if Page.objects.filter(folder=folder).exists():
            return Response(
                {"error": "Move or delete all pages in this folder before deleting it."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        folder.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
