# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date

import pytest
from rest_framework import status

from plane.db.models import Page, PageFolder, Project, ProjectMember, ProjectPage, User, Workspace, WorkspaceMember


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(
        name="Pages project",
        identifier="PAGES",
        workspace=workspace,
    )
    ProjectMember.objects.create(
        project=project,
        workspace=workspace,
        member=create_user,
        role=20,
        is_active=True,
    )
    return project


def add_project_user(project, role=15, email="member@plane.so"):
    user = User.objects.create_user(email=email, username=email)
    WorkspaceMember.objects.create(
        workspace=project.workspace,
        member=user,
        role=role,
        is_active=True,
    )
    ProjectMember.objects.create(
        workspace=project.workspace,
        project=project,
        member=user,
        role=role,
        is_active=True,
    )
    return user


def create_page(project, owner, *, access=Page.PUBLIC_ACCESS, folder=None, archived=False):
    page = Page.objects.create(
        workspace=project.workspace,
        owned_by=owner,
        name="Existing page",
        access=access,
        folder=folder,
        archived_at=date.today() if archived else None,
    )
    ProjectPage.objects.create(
        workspace=project.workspace,
        project=project,
        page=page,
    )
    return page


def folder_url(project, folder_id=None):
    base = f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/page-folders/"
    return f"{base}{folder_id}/" if folder_id else base


def page_url(project, page):
    return f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/pages/{page.id}/"


@pytest.mark.contract
@pytest.mark.django_db
class TestPageFolderAPI:
    def test_crud_and_case_insensitive_duplicate_names(self, session_client, project, create_user):
        response = session_client.post(folder_url(project), {"name": " Product ", "access": 0}, format="json")
        assert response.status_code == status.HTTP_201_CREATED
        folder_id = response.json()["id"]
        assert response.json()["name"] == "Product"
        assert response.json()["owned_by"] == str(create_user.id)

        duplicate = session_client.post(folder_url(project), {"name": "product", "access": 0}, format="json")
        assert duplicate.status_code == status.HTTP_400_BAD_REQUEST

        renamed = session_client.patch(folder_url(project, folder_id), {"name": "Roadmap"}, format="json")
        assert renamed.status_code == status.HTTP_200_OK
        assert renamed.json()["name"] == "Roadmap"

        deleted = session_client.delete(folder_url(project, folder_id))
        assert deleted.status_code == status.HTTP_204_NO_CONTENT
        assert not PageFolder.objects.filter(pk=folder_id).exists()

    def test_private_folders_are_visible_only_to_their_owner(self, session_client, project, create_user):
        own_private = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Private owner folder",
            access=PageFolder.PRIVATE_ACCESS,
        )
        member = add_project_user(project)
        member_private = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=member,
            name="Private member folder",
            access=PageFolder.PRIVATE_ACCESS,
        )
        public = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Public folder",
            access=PageFolder.PUBLIC_ACCESS,
        )

        session_client.force_authenticate(user=member)
        response = session_client.get(folder_url(project))
        assert response.status_code == status.HTTP_200_OK
        assert {item["id"] for item in response.json()} == {str(member_private.id), str(public.id)}
        assert str(own_private.id) not in {item["id"] for item in response.json()}

        forbidden = session_client.patch(folder_url(project, public.id), {"name": "No"}, format="json")
        assert forbidden.status_code == status.HTTP_403_FORBIDDEN

        same_name_for_other_owner = session_client.post(
            folder_url(project),
            {"name": own_private.name, "access": PageFolder.PRIVATE_ACCESS},
            format="json",
        )
        assert same_name_for_other_owner.status_code == status.HTTP_201_CREATED
        duplicate_for_same_owner = session_client.post(
            folder_url(project),
            {"name": own_private.name.upper(), "access": PageFolder.PRIVATE_ACCESS},
            format="json",
        )
        assert duplicate_for_same_owner.status_code == status.HTTP_400_BAD_REQUEST

    def test_guest_can_list_but_cannot_mutate_folders(self, session_client, project, create_user):
        folder = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Visible to guests",
        )
        guest = add_project_user(project, role=5, email="guest@plane.so")
        session_client.force_authenticate(user=guest)

        assert session_client.get(folder_url(project)).status_code == status.HTTP_200_OK
        assert (
            session_client.post(folder_url(project), {"name": "Forbidden", "access": 0}, format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert (
            session_client.patch(folder_url(project, folder.id), {"name": "Forbidden"}, format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )
        assert session_client.delete(folder_url(project, folder.id)).status_code == status.HTTP_403_FORBIDDEN

    def test_admin_can_manage_a_folder_owned_by_a_member(self, session_client, project):
        member = add_project_user(project)
        folder = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=member,
            name="Member folder",
        )

        response = session_client.patch(folder_url(project, folder.id), {"name": "Admin renamed"}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["name"] == "Admin renamed"

    def test_folder_access_is_immutable(self, session_client, project):
        created = session_client.post(folder_url(project), {"name": "Public", "access": 0}, format="json")
        response = session_client.patch(
            folder_url(project, created.json()["id"]),
            {"access": 1},
            format="json",
        )
        assert response.status_code == status.HTTP_400_BAD_REQUEST

    def test_folder_is_isolated_by_project_and_workspace(self, session_client, project, create_user):
        other_workspace = Workspace.objects.create(name="Other", slug="other", owner=create_user)
        other_project = Project.objects.create(name="Other", identifier="OTHER", workspace=other_workspace)
        folder = PageFolder.objects.create(
            workspace=other_workspace,
            project=other_project,
            owned_by=create_user,
            name="Other project folder",
        )
        page = create_page(project, create_user)

        response = session_client.patch(page_url(project, page), {"folder_id": str(folder.id)}, format="json")
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        page.refresh_from_db()
        assert page.folder_id is None

    def test_move_requires_owner_or_admin_and_compatible_access(self, session_client, project, create_user):
        public_folder = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Public",
            access=PageFolder.PUBLIC_ACCESS,
        )
        private_folder = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Private",
            access=PageFolder.PRIVATE_ACCESS,
        )
        page = create_page(project, create_user)

        moved = session_client.patch(page_url(project, page), {"folder_id": str(public_folder.id)}, format="json")
        assert moved.status_code == status.HTTP_200_OK
        assert moved.json()["folder_id"] == str(public_folder.id)

        incompatible = session_client.patch(
            page_url(project, page),
            {"folder_id": str(private_folder.id)},
            format="json",
        )
        assert incompatible.status_code == status.HTTP_400_BAD_REQUEST

        member = add_project_user(project)
        session_client.force_authenticate(user=member)
        forbidden = session_client.patch(page_url(project, page), {"folder_id": None}, format="json")
        assert forbidden.status_code == status.HTTP_403_FORBIDDEN

    def test_access_change_moves_page_to_root(self, session_client, project, create_user):
        folder = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Public",
            access=PageFolder.PUBLIC_ACCESS,
        )
        page = create_page(project, create_user, folder=folder)

        response = session_client.patch(page_url(project, page), {"access": Page.PRIVATE_ACCESS}, format="json")
        assert response.status_code == status.HTTP_200_OK
        assert response.json()["folder_id"] is None

    def test_non_empty_folder_cannot_be_deleted_even_when_page_is_archived(self, session_client, project, create_user):
        folder = PageFolder.objects.create(
            workspace=project.workspace,
            project=project,
            owned_by=create_user,
            name="Archive",
        )
        page = create_page(project, create_user, folder=folder, archived=True)

        response = session_client.delete(folder_url(project, folder.id))
        assert response.status_code == status.HTTP_400_BAD_REQUEST
        page.refresh_from_db()
        assert page.folder_id == folder.id

    def test_existing_pages_remain_at_root(self, session_client, project, create_user):
        page = create_page(project, create_user)

        response = session_client.get(f"/api/workspaces/{project.workspace.slug}/projects/{project.id}/pages/")
        assert response.status_code == status.HTTP_200_OK
        returned = next(item for item in response.json() if item["id"] == str(page.id))
        assert returned["folder_id"] is None
