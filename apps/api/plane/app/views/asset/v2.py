# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid

# Django imports
from django.conf import settings
from django.http import HttpResponseRedirect
from django.utils import timezone
from django.db import IntegrityError

# Third party imports
from rest_framework import status
from rest_framework.response import Response
from rest_framework.permissions import AllowAny

# Module imports
from ..base import BaseAPIView
from plane.db.models import FileAsset, Page, Project, ProjectMember, User, Workspace, WorkspaceMember
from plane.settings.storage import S3Storage
from plane.app.permissions import allow_permission, ROLE
from plane.utils.cache import invalidate_cache_directly
from plane.bgtasks.storage_metadata_task import get_asset_object_metadata
from plane.throttles.asset import AssetRateThrottle


PAGE_IMAGE_MIME_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/jpg",
    "image/gif",
]


def _get_page(slug, project_id, page_id):
    return (
        Page.objects.filter(
            id=page_id,
            workspace__slug=slug,
            projects__id=project_id,
            project_pages__deleted_at__isnull=True,
        )
        .distinct()
        .first()
    )


def _get_asset_page(asset, slug, project_id):
    if asset.entity_type != FileAsset.EntityTypeContext.PAGE_DESCRIPTION or not asset.page_id:
        return None
    return _get_page(slug=slug, project_id=project_id, page_id=asset.page_id)


def _is_project_member(user, slug, project_id):
    return ProjectMember.objects.filter(
        member=user,
        workspace__slug=slug,
        project_id=project_id,
        is_active=True,
    ).exists()


def _can_edit_page(user, page, slug, project_id):
    if page.owned_by_id == user.id:
        return True
    if page.access == Page.PRIVATE_ACCESS:
        return False

    if ProjectMember.objects.filter(
        member=user,
        workspace__slug=slug,
        project_id=project_id,
        role__in=[ROLE.ADMIN.value, ROLE.MEMBER.value],
        is_active=True,
    ).exists():
        return True

    return (
        _is_project_member(user, slug, project_id)
        and WorkspaceMember.objects.filter(
            member=user,
            workspace__slug=slug,
            role=ROLE.ADMIN.value,
            is_active=True,
        ).exists()
    )


def _page_asset_permission_response(request, asset, slug, project_id, *, edit=False):
    page = _get_asset_page(asset=asset, slug=slug, project_id=project_id)
    if page is None:
        return Response({"error": "Page not found."}, status=status.HTTP_404_NOT_FOUND)

    if page.access == Page.PRIVATE_ACCESS and page.owned_by_id != request.user.id:
        return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

    if not _is_project_member(request.user, slug, project_id):
        return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

    if edit:
        if page.is_locked:
            return Response({"error": "Page is locked."}, status=status.HTTP_400_BAD_REQUEST)
        if page.archived_at is not None:
            return Response({"error": "Page is archived."}, status=status.HTTP_400_BAD_REQUEST)
        if not _can_edit_page(request.user, page, slug, project_id):
            return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

    return None


def _page_asset_workspace_permission_response(request, asset, slug, *, edit=False):
    if asset.project_id:
        project_ids = [asset.project_id]
    else:
        project_ids = list(
            Project.objects.filter(
                workspace__slug=slug,
                project_pages__page_id=asset.page_id,
                project_pages__deleted_at__isnull=True,
            ).values_list("id", flat=True)
        )

    if not project_ids:
        return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)

    fallback_response = None
    for project_id in project_ids:
        permission_response = _page_asset_permission_response(
            request=request,
            asset=asset,
            slug=slug,
            project_id=project_id,
            edit=edit,
        )
        if permission_response is None:
            return None
        if permission_response.status_code != status.HTTP_403_FORBIDDEN:
            fallback_response = permission_response

    return fallback_response or Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)


class UserAssetsV2Endpoint(BaseAPIView):
    """This endpoint is used to upload user profile images."""

    def asset_delete(self, asset_id):
        asset = FileAsset.objects.filter(id=asset_id).first()
        if asset is None:
            return
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return

    def entity_asset_save(self, asset_id, entity_type, asset, request):
        # User Avatar
        if entity_type == FileAsset.EntityTypeContext.USER_AVATAR:
            user = User.objects.get(id=asset.user_id)
            user.avatar = ""
            # Delete the previous avatar
            if user.avatar_asset_id:
                self.asset_delete(user.avatar_asset_id)
            # Save the new avatar
            user.avatar_asset_id = asset_id
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        # User Cover
        if entity_type == FileAsset.EntityTypeContext.USER_COVER:
            user = User.objects.get(id=asset.user_id)
            user.cover_image = None
            # Delete the previous cover image
            if user.cover_image_asset_id:
                self.asset_delete(user.cover_image_asset_id)
            # Save the new cover image
            user.cover_image_asset_id = asset_id
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        return

    def entity_asset_delete(self, entity_type, asset, request):
        # User Avatar
        if entity_type == FileAsset.EntityTypeContext.USER_AVATAR:
            user = User.objects.get(id=asset.user_id)
            user.avatar_asset_id = None
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        # User Cover
        if entity_type == FileAsset.EntityTypeContext.USER_COVER:
            user = User.objects.get(id=asset.user_id)
            user.cover_image_asset_id = None
            user.save()
            invalidate_cache_directly(path="/api/users/me/", url_params=False, user=True, request=request)
            invalidate_cache_directly(
                path="/api/users/me/settings/",
                url_params=False,
                user=True,
                request=request,
            )
            return
        return

    def post(self, request):
        # get the asset key
        name = request.data.get("name")
        type = request.data.get("type", "image/jpeg")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        entity_type = request.data.get("entity_type", False)

        # Check if the file size is within the limit
        size_limit = min(size, settings.FILE_SIZE_LIMIT)

        #  Check if the entity type is allowed
        if not entity_type or entity_type not in ["USER_AVATAR", "USER_COVER"]:
            return Response(
                {"error": "Invalid entity type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if the file type is allowed
        allowed_types = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/jpg",
            "image/gif",
        ]
        if type not in allowed_types:
            return Response(
                {
                    "error": "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
                    "status": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # asset key
        asset_key = f"{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            user=request.user,
            created_by=request.user,
            entity_type=entity_type,
        )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, asset_id):
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(asset_id))
        # get the entity and save the asset id for the request field
        self.entity_asset_save(
            asset_id=asset_id,
            entity_type=asset.entity_type,
            asset=asset,
            request=request,
        )
        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, asset_id):
        asset = FileAsset.objects.get(id=asset_id, user_id=request.user.id)
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # get the entity and save the asset id for the request field
        self.entity_asset_delete(entity_type=asset.entity_type, asset=asset, request=request)
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class WorkspaceFileAssetEndpoint(BaseAPIView):
    """This endpoint is used to upload cover images/logos etc for workspace, projects and users."""

    def get_entity_id_field(self, entity_type, entity_id):
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            return {"workspace_id": entity_id}

        # Project Cover
        if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            return {"project_id": entity_id}

        # User Avatar and Cover
        if entity_type in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
        ]:
            return {"user_id": entity_id}

        # Issue Attachment and Description
        if entity_type in [
            FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        ]:
            return {"issue_id": entity_id}

        # Page Description
        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            return {"page_id": entity_id}

        # Comment Description
        if entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            return {"comment_id": entity_id}
        return {}

    def asset_delete(self, asset_id):
        asset = FileAsset.objects.filter(id=asset_id).first()
        # Check if the asset exists
        if asset is None:
            return
        # Mark the asset as deleted
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return

    def entity_asset_save(self, asset_id, entity_type, asset, request):
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            workspace = Workspace.objects.filter(id=asset.workspace_id).first()
            if workspace is None:
                return
            # Delete the previous logo
            if workspace.logo_asset_id:
                self.asset_delete(workspace.logo_asset_id)
            # Save the new logo
            workspace.logo = ""
            workspace.logo_asset_id = asset_id
            workspace.save()
            invalidate_cache_directly(path="/api/workspaces/", url_params=False, user=False, request=request)
            invalidate_cache_directly(
                path="/api/users/me/workspaces/",
                url_params=False,
                user=True,
                request=request,
            )
            invalidate_cache_directly(path="/api/instances/", url_params=False, user=False, request=request)
            return

        # Project Cover
        elif entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            project = Project.objects.filter(id=asset.project_id).first()
            if project is None:
                return
            # Delete the previous cover image
            if project.cover_image_asset_id:
                self.asset_delete(project.cover_image_asset_id)
            # Save the new cover image
            project.cover_image = ""
            project.cover_image_asset_id = asset_id
            project.save()
            return
        else:
            return

    def entity_asset_delete(self, entity_type, asset, request):
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            workspace = Workspace.objects.get(id=asset.workspace_id)
            if workspace is None:
                return
            workspace.logo_asset_id = None
            workspace.save()
            invalidate_cache_directly(path="/api/workspaces/", url_params=False, user=False, request=request)
            invalidate_cache_directly(
                path="/api/users/me/workspaces/",
                url_params=False,
                user=True,
                request=request,
            )
            invalidate_cache_directly(path="/api/instances/", url_params=False, user=False, request=request)
            return
        # Project Cover
        elif entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            project = Project.objects.filter(id=asset.project_id).first()
            if project is None:
                return
            project.cover_image_asset_id = None
            project.save()
            return
        else:
            return

    def post(self, request, slug):
        name = request.data.get("name")
        type = request.data.get("type", "image/jpeg")
        size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        entity_type = request.data.get("entity_type")
        entity_identifier = request.data.get("entity_identifier", False)

        # Check if the entity type is allowed
        if entity_type not in FileAsset.EntityTypeContext.values:
            return Response(
                {"error": "Invalid entity type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Check if the file type is allowed
        allowed_types = [
            "image/jpeg",
            "image/png",
            "image/webp",
            "image/jpg",
            "image/gif",
        ]
        if type not in allowed_types:
            return Response(
                {
                    "error": "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
                    "status": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the size limit
        size_limit = min(settings.FILE_SIZE_LIMIT, size)

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace=workspace,
            created_by=request.user,
            entity_type=entity_type,
            **self.get_entity_id_field(entity_type=entity_type, entity_id=entity_identifier),
        )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    def patch(self, request, slug, asset_id):
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_workspace_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                edit=True,
            )
            if permission_response:
                return permission_response
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(asset_id))
        # get the entity and save the asset id for the request field
        self.entity_asset_save(
            asset_id=asset_id,
            entity_type=asset.entity_type,
            asset=asset,
            request=request,
        )
        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request, slug, asset_id):
        asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_workspace_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                edit=True,
            )
            if permission_response:
                return permission_response
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # get the entity and save the asset id for the request field
        self.entity_asset_delete(entity_type=asset.entity_type, asset=asset, request=request)
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    def get(self, request, slug, asset_id):
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id, workspace__slug=slug)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_workspace_permission_response(
                request=request,
                asset=asset,
                slug=slug,
            )
            if permission_response:
                return permission_response

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name"),
        )
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)


class StaticFileAssetEndpoint(BaseAPIView):
    """This endpoint is used to get the signed URL for a static asset."""

    permission_classes = [AllowAny]

    def get(self, request, asset_id):
        # get the asset id
        asset = FileAsset.objects.get(id=asset_id)

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if the entity type is allowed
        if asset.entity_type not in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
            FileAsset.EntityTypeContext.WORKSPACE_LOGO,
            FileAsset.EntityTypeContext.PROJECT_COVER,
        ]:
            return Response(
                {"error": "Invalid entity type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(object_name=asset.asset.name)
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)


class AssetRestoreEndpoint(BaseAPIView):
    """Endpoint to restore a deleted assets."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, asset_id):
        asset = FileAsset.all_objects.get(id=asset_id, workspace__slug=slug)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            if not asset.project_id:
                return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
            permission_response = _page_asset_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                project_id=asset.project_id,
                edit=True,
            )
            if permission_response:
                return permission_response
        asset.is_deleted = False
        asset.deleted_at = None
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)


class ProjectAssetEndpoint(BaseAPIView):
    """This endpoint is used to upload cover images/logos etc for workspace, projects and users."""

    def get_entity_id_field(self, entity_type, entity_id):
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            return {"workspace_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            return {"project_id": entity_id}

        if entity_type in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
        ]:
            return {"user_id": entity_id}

        if entity_type in [
            FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        ]:
            return {"issue_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            return {"page_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            return {"comment_id": entity_id}

        if entity_type == FileAsset.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION:
            return {"draft_issue_id": entity_id}
        return {}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id):
        name = request.data.get("name")
        type = request.data.get("type", "image/jpeg")
        try:
            size = int(request.data.get("size", settings.FILE_SIZE_LIMIT))
        except (TypeError, ValueError):
            return Response({"error": "Invalid file size."}, status=status.HTTP_400_BAD_REQUEST)
        if size <= 0:
            return Response({"error": "Invalid file size."}, status=status.HTTP_400_BAD_REQUEST)
        entity_type = request.data.get("entity_type", "")
        entity_identifier = request.data.get("entity_identifier")

        # Check if the entity type is allowed
        if entity_type not in FileAsset.EntityTypeContext.values:
            return Response(
                {"error": "Invalid entity type.", "status": False},
                status=status.HTTP_400_BAD_REQUEST,
            )

        page = None
        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            page = _get_page(slug=slug, project_id=project_id, page_id=entity_identifier)
            if page is None:
                return Response({"error": "Page not found."}, status=status.HTTP_404_NOT_FOUND)
            if page.is_locked:
                return Response({"error": "Page is locked."}, status=status.HTTP_400_BAD_REQUEST)
            if page.archived_at is not None:
                return Response({"error": "Page is archived."}, status=status.HTTP_400_BAD_REQUEST)
            if not _can_edit_page(request.user, page, slug, project_id):
                return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        is_pdf = type == "application/pdf" or str(name or "").lower().endswith(".pdf")
        if is_pdf:
            if (
                entity_type != FileAsset.EntityTypeContext.PAGE_DESCRIPTION
                or type != "application/pdf"
                or not str(name or "").lower().endswith(".pdf")
            ):
                return Response(
                    {"error": "PDF files are only allowed in page descriptions."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if size > settings.PAGE_PDF_SIZE_LIMIT:
                return Response(
                    {"error": "PDF file exceeds the configured size limit."},
                    status=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                )
            size_limit = size
        elif type not in PAGE_IMAGE_MIME_TYPES:
            return Response(
                {
                    "error": "Invalid file type. Only JPEG, PNG, WebP, JPG and GIF files are allowed.",
                    "status": False,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        else:
            size_limit = min(settings.FILE_SIZE_LIMIT, size)

        # Get the workspace
        workspace = Workspace.objects.get(slug=slug)

        # asset key
        asset_key = f"{workspace.id}/{uuid.uuid4().hex}-{name}"

        # Create a File Asset
        asset = FileAsset.objects.create(
            attributes={"name": name, "type": type, "size": size_limit},
            asset=asset_key,
            size=size_limit,
            workspace=workspace,
            created_by=request.user,
            entity_type=entity_type,
            project_id=project_id,
            **self.get_entity_id_field(entity_type, entity_identifier),
        )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        presigned_url = storage.generate_presigned_post(object_name=asset_key, file_type=type, file_size=size_limit)
        # Return the presigned URL
        return Response(
            {
                "upload_data": presigned_url,
                "asset_id": str(asset.id),
                "asset_url": asset.asset_url,
            },
            status=status.HTTP_200_OK,
        )

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def patch(self, request, slug, project_id, pk):
        # get the asset id
        asset = FileAsset.objects.get(id=pk, workspace__slug=slug, project_id=project_id)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                project_id=project_id,
                edit=True,
            )
            if permission_response:
                return permission_response
        # get the storage metadata
        asset.is_uploaded = True
        # get the storage metadata
        if not asset.storage_metadata:
            get_asset_object_metadata.delay(asset_id=str(pk))

        # update the attributes
        asset.attributes = request.data.get("attributes", asset.attributes)
        # save the asset
        asset.save(update_fields=["is_uploaded", "attributes"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def delete(self, request, slug, project_id, pk):
        # Get the asset
        asset = FileAsset.objects.get(id=pk, workspace__slug=slug, project_id=project_id)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                project_id=project_id,
                edit=True,
            )
            if permission_response:
                return permission_response
        # Check deleted assets
        asset.is_deleted = True
        asset.deleted_at = timezone.now()
        # Save the asset
        asset.save(update_fields=["is_deleted", "deleted_at"])
        return Response(status=status.HTTP_204_NO_CONTENT)

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def get(self, request, slug, project_id, pk):
        # get the asset id
        asset = FileAsset.objects.get(workspace__slug=slug, project_id=project_id, pk=pk)
        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                project_id=project_id,
            )
            if permission_response:
                return permission_response

        # Check if the asset is uploaded
        if not asset.is_uploaded:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Get the presigned URL
        storage = S3Storage(request=request)
        # Generate a presigned URL to share an S3 object
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="inline",
            filename=asset.attributes.get("name"),
        )
        # Redirect to the signed URL
        return HttpResponseRedirect(signed_url)


class ProjectBulkAssetEndpoint(BaseAPIView):
    def save_project_cover(self, asset, project_id):
        project = Project.objects.get(id=project_id)
        project.cover_image_asset_id = asset.id
        project.save()

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST])
    def post(self, request, slug, project_id, entity_id):
        asset_ids = request.data.get("asset_ids", [])

        # Check if the asset ids are provided
        if not asset_ids:
            return Response({"error": "No asset ids provided."}, status=status.HTTP_400_BAD_REQUEST)

        # get the asset id
        assets = FileAsset.objects.filter(
            id__in=asset_ids,
            workspace__slug=slug,
            project_id=project_id,
        )

        # Get the first asset
        asset = assets.first()

        if not asset:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        # Check if the asset is uploaded
        if asset.entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            assets.update(project_id=project_id)
            [self.save_project_cover(asset, project_id) for asset in assets]

        if asset.entity_type == FileAsset.EntityTypeContext.ISSUE_DESCRIPTION:
            # For some cases, the bulk api is called after the issue is deleted creating
            # an integrity error
            try:
                assets.update(issue_id=entity_id, project_id=project_id)
            except IntegrityError:
                pass

        if asset.entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            # For some cases, the bulk api is called after the comment is deleted
            # creating an integrity error
            try:
                assets.update(comment_id=entity_id)
            except IntegrityError:
                pass

        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            page = _get_page(slug=slug, project_id=project_id, page_id=entity_id)
            if page is None:
                return Response({"error": "Page not found."}, status=status.HTTP_404_NOT_FOUND)
            if page.is_locked:
                return Response({"error": "Page is locked."}, status=status.HTTP_400_BAD_REQUEST)
            if page.archived_at is not None:
                return Response({"error": "Page is archived."}, status=status.HTTP_400_BAD_REQUEST)
            if not _can_edit_page(request.user, page, slug, project_id):
                return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)
            assets.update(page_id=entity_id)

        if asset.entity_type == FileAsset.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION:
            # For some cases, the bulk api is called after the draft issue is deleted
            # creating an integrity error
            try:
                assets.update(draft_issue_id=entity_id)
            except IntegrityError:
                pass

        return Response(status=status.HTTP_204_NO_CONTENT)


class AssetCheckEndpoint(BaseAPIView):
    """Endpoint to check if an asset exists."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, asset_id):
        asset = FileAsset.all_objects.filter(id=asset_id, workspace__slug=slug, deleted_at__isnull=True).first()
        if asset and asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            if not asset.project_id:
                asset = None
            else:
                permission_response = _page_asset_permission_response(
                    request=request,
                    asset=asset,
                    slug=slug,
                    project_id=asset.project_id,
                )
                if permission_response:
                    asset = None
        return Response({"exists": asset is not None}, status=status.HTTP_200_OK)


class DuplicateAssetEndpoint(BaseAPIView):
    throttle_classes = [AssetRateThrottle]

    def get_entity_id_field(self, entity_type, entity_id):
        # Workspace Logo
        if entity_type == FileAsset.EntityTypeContext.WORKSPACE_LOGO:
            return {"workspace_id": entity_id}

        # Project Cover
        if entity_type == FileAsset.EntityTypeContext.PROJECT_COVER:
            return {"project_id": entity_id}

        # User Avatar and Cover
        if entity_type in [
            FileAsset.EntityTypeContext.USER_AVATAR,
            FileAsset.EntityTypeContext.USER_COVER,
        ]:
            return {"user_id": entity_id}

        # Issue Attachment and Description
        if entity_type in [
            FileAsset.EntityTypeContext.ISSUE_ATTACHMENT,
            FileAsset.EntityTypeContext.ISSUE_DESCRIPTION,
        ]:
            return {"issue_id": entity_id}

        # Page Description
        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            return {"page_id": entity_id}

        # Comment Description
        if entity_type == FileAsset.EntityTypeContext.COMMENT_DESCRIPTION:
            return {"comment_id": entity_id}

        return {}

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def post(self, request, slug, asset_id):
        project_id = request.data.get("project_id", None)
        entity_id = request.data.get("entity_id", None)
        entity_type = request.data.get("entity_type", None)

        if not entity_type or entity_type not in FileAsset.EntityTypeContext.values:
            return Response(
                {"error": "Invalid entity type or entity id"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        workspace = Workspace.objects.get(slug=slug)
        if project_id:
            # check if project exists in the workspace
            if not Project.objects.filter(id=project_id, workspace=workspace).exists():
                return Response({"error": "Project not found"}, status=status.HTTP_404_NOT_FOUND)

        storage = S3Storage(request=request)
        original_asset = FileAsset.objects.filter(id=asset_id, workspace=workspace, is_uploaded=True).first()

        if not original_asset:
            return Response({"error": "Asset not found"}, status=status.HTTP_404_NOT_FOUND)

        if original_asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            if not original_asset.project_id:
                return Response({"error": "Project not found."}, status=status.HTTP_404_NOT_FOUND)
            permission_response = _page_asset_permission_response(
                request=request,
                asset=original_asset,
                slug=slug,
                project_id=original_asset.project_id,
            )
            if permission_response:
                return permission_response

        if entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            target_page = _get_page(slug=slug, project_id=project_id, page_id=entity_id)
            if target_page is None:
                return Response({"error": "Page not found."}, status=status.HTTP_404_NOT_FOUND)
            if target_page.is_locked:
                return Response({"error": "Page is locked."}, status=status.HTTP_400_BAD_REQUEST)
            if target_page.archived_at is not None:
                return Response({"error": "Page is archived."}, status=status.HTTP_400_BAD_REQUEST)
            if not _can_edit_page(request.user, target_page, slug, project_id):
                return Response({"error": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        destination_key = f"{workspace.id}/{uuid.uuid4().hex}-{original_asset.attributes.get('name')}"
        duplicated_asset = FileAsset.objects.create(
            attributes={
                "name": original_asset.attributes.get("name"),
                "type": original_asset.attributes.get("type"),
                "size": original_asset.attributes.get("size"),
            },
            asset=destination_key,
            size=original_asset.size,
            workspace=workspace,
            created_by_id=request.user.id,
            entity_type=entity_type,
            project_id=project_id if project_id else None,
            storage_metadata=original_asset.storage_metadata,
            **self.get_entity_id_field(entity_type=entity_type, entity_id=entity_id),
        )
        storage.copy_object(original_asset.asset, destination_key)
        # Update the is_uploaded field for all newly created assets
        FileAsset.objects.filter(id=duplicated_asset.id).update(is_uploaded=True)

        return Response({"asset_id": str(duplicated_asset.id)}, status=status.HTTP_200_OK)


class WorkspaceAssetDownloadEndpoint(BaseAPIView):
    """Endpoint to generate a download link for an asset with content-disposition=attachment."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="WORKSPACE")
    def get(self, request, slug, asset_id):
        try:
            asset = FileAsset.objects.get(
                id=asset_id,
                workspace__slug=slug,
                is_uploaded=True,
            )
        except FileAsset.DoesNotExist:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_workspace_permission_response(
                request=request,
                asset=asset,
                slug=slug,
            )
            if permission_response:
                return permission_response

        storage = S3Storage(request=request)
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name", uuid.uuid4().hex),
        )

        return HttpResponseRedirect(signed_url)


class ProjectAssetDownloadEndpoint(BaseAPIView):
    """Endpoint to generate a download link for an asset with content-disposition=attachment."""

    @allow_permission([ROLE.ADMIN, ROLE.MEMBER, ROLE.GUEST], level="PROJECT")
    def get(self, request, slug, project_id, asset_id):
        try:
            asset = FileAsset.objects.get(
                id=asset_id,
                workspace__slug=slug,
                project_id=project_id,
                is_uploaded=True,
            )
        except FileAsset.DoesNotExist:
            return Response(
                {"error": "The requested asset could not be found."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if asset.entity_type == FileAsset.EntityTypeContext.PAGE_DESCRIPTION:
            permission_response = _page_asset_permission_response(
                request=request,
                asset=asset,
                slug=slug,
                project_id=project_id,
            )
            if permission_response:
                return permission_response

        storage = S3Storage(request=request)
        signed_url = storage.generate_presigned_url(
            object_name=asset.asset.name,
            disposition="attachment",
            filename=asset.attributes.get("name", uuid.uuid4().hex),
        )

        return HttpResponseRedirect(signed_url)
