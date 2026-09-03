# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

from datetime import date
from unittest.mock import MagicMock, patch

import pytest
from rest_framework import status

from plane.db.models import FileAsset, Page, Project, ProjectMember, ProjectPage, User, WorkspaceMember


@pytest.fixture
def project(workspace, create_user):
    project = Project.objects.create(name="PDF project", identifier="PDF", workspace=workspace)
    ProjectMember.objects.create(project=project, member=create_user, role=20, is_active=True)
    return project


def add_project_user(project, *, role=15, email="pdf-member@plane.so"):
    user = User.objects.create_user(email=email, username=email)
    WorkspaceMember.objects.create(workspace=project.workspace, member=user, role=role, is_active=True)
    ProjectMember.objects.create(project=project, member=user, role=role, is_active=True)
    return user


def create_page(project, owner, *, access=Page.PUBLIC_ACCESS, archived=False, locked=False):
    page = Page.objects.create(
        workspace=project.workspace,
        owned_by=owner,
        name="PDF page",
        access=access,
        archived_at=date.today() if archived else None,
        is_locked=locked,
    )
    ProjectPage.objects.create(workspace=project.workspace, project=project, page=page)
    return page


def project_asset_url(project, asset_id=None):
    base = f"/api/assets/v2/workspaces/{project.workspace.slug}/projects/{project.id}/"
    return f"{base}{asset_id}/" if asset_id else base


def project_download_url(project, asset_id):
    return f"/api/assets/v2/workspaces/{project.workspace.slug}/projects/{project.id}/download/{asset_id}/"


def workspace_asset_url(project, asset_id):
    return f"/api/assets/v2/workspaces/{project.workspace.slug}/{asset_id}/"


def workspace_download_url(project, asset_id):
    return f"/api/assets/v2/workspaces/{project.workspace.slug}/download/{asset_id}/"


def pdf_payload(page, **overrides):
    return {
        "entity_identifier": str(page.id),
        "entity_type": FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
        "name": "specification.pdf",
        "size": 50 * 1024 * 1024,
        "type": "application/pdf",
        **overrides,
    }


@pytest.mark.contract
@pytest.mark.django_db
class TestPagePdfAssetAPI:
    @patch("plane.app.views.asset.v2.S3Storage")
    def test_accepts_pdf_at_50_mb_and_rejects_larger_file(self, mock_storage, session_client, project, create_user):
        mock_storage.return_value.generate_presigned_post.return_value = {"url": "http://minio/upload", "fields": {}}
        page = create_page(project, create_user)

        accepted = session_client.post(project_asset_url(project), pdf_payload(page), format="json")
        assert accepted.status_code == status.HTTP_200_OK
        asset = FileAsset.objects.get(id=accepted.json()["asset_id"])
        assert asset.page_id == page.id
        assert asset.size == 50 * 1024 * 1024

        too_large = session_client.post(
            project_asset_url(project),
            pdf_payload(page, size=50 * 1024 * 1024 + 1),
            format="json",
        )
        assert too_large.status_code == status.HTTP_413_REQUEST_ENTITY_TOO_LARGE

    @patch("plane.app.views.asset.v2.S3Storage")
    def test_validates_pdf_extension_mime_and_entity(self, mock_storage, session_client, project, create_user):
        mock_storage.return_value.generate_presigned_post.return_value = {"url": "http://minio/upload", "fields": {}}
        page = create_page(project, create_user)

        wrong_mime = session_client.post(
            project_asset_url(project), pdf_payload(page, type="application/octet-stream"), format="json"
        )
        assert wrong_mime.status_code == status.HTTP_400_BAD_REQUEST

        wrong_extension = session_client.post(
            project_asset_url(project), pdf_payload(page, name="specification.bin"), format="json"
        )
        assert wrong_extension.status_code == status.HTTP_400_BAD_REQUEST

        wrong_entity = session_client.post(
            project_asset_url(project),
            pdf_payload(page, entity_type=FileAsset.EntityTypeContext.ISSUE_DESCRIPTION),
            format="json",
        )
        assert wrong_entity.status_code == status.HTTP_400_BAD_REQUEST

    @patch("plane.app.views.asset.v2.S3Storage")
    def test_upload_is_isolated_and_obeys_page_state(self, mock_storage, session_client, project, create_user):
        mock_storage.return_value.generate_presigned_post.return_value = {"url": "http://minio/upload", "fields": {}}
        other_project = Project.objects.create(name="Other", identifier="OTHER-PDF", workspace=project.workspace)
        ProjectMember.objects.create(project=other_project, member=create_user, role=20, is_active=True)
        other_page = create_page(other_project, create_user)
        assert (
            session_client.post(project_asset_url(project), pdf_payload(other_page), format="json").status_code
            == status.HTTP_404_NOT_FOUND
        )

        locked_page = create_page(project, create_user, locked=True)
        archived_page = create_page(project, create_user, archived=True)
        assert (
            session_client.post(project_asset_url(project), pdf_payload(locked_page), format="json").status_code
            == status.HTTP_400_BAD_REQUEST
        )
        assert (
            session_client.post(project_asset_url(project), pdf_payload(archived_page), format="json").status_code
            == status.HTTP_400_BAD_REQUEST
        )

    @patch("plane.app.views.asset.v2.S3Storage")
    def test_guest_member_admin_and_private_page_permissions(self, mock_storage, session_client, project, create_user):
        mock_storage.return_value.generate_presigned_post.return_value = {"url": "http://minio/upload", "fields": {}}
        public_page = create_page(project, create_user)
        private_page = create_page(project, create_user, access=Page.PRIVATE_ACCESS)
        member = add_project_user(project)
        guest = add_project_user(project, role=5, email="pdf-guest@plane.so")

        session_client.force_authenticate(user=guest)
        assert (
            session_client.post(project_asset_url(project), pdf_payload(public_page), format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )

        session_client.force_authenticate(user=member)
        assert (
            session_client.post(project_asset_url(project), pdf_payload(public_page), format="json").status_code
            == status.HTTP_200_OK
        )
        assert (
            session_client.post(project_asset_url(project), pdf_payload(private_page), format="json").status_code
            == status.HTTP_403_FORBIDDEN
        )

        session_client.force_authenticate(user=create_user)
        assert (
            session_client.post(project_asset_url(project), pdf_payload(private_page), format="json").status_code
            == status.HTTP_200_OK
        )

    @patch("plane.app.views.asset.v2.S3Storage")
    def test_private_page_inline_and_download_are_owner_only(self, mock_storage, session_client, project, create_user):
        storage = MagicMock()
        storage.generate_presigned_url.return_value = "http://minio/signed"
        mock_storage.return_value = storage
        private_page = create_page(project, create_user, access=Page.PRIVATE_ACCESS)
        asset = FileAsset.objects.create(
            workspace=project.workspace,
            project=project,
            page=private_page,
            created_by=create_user,
            entity_type=FileAsset.EntityTypeContext.PAGE_DESCRIPTION,
            attributes={"name": "private.pdf", "size": 1024, "type": "application/pdf"},
            asset="private.pdf",
            size=1024,
            is_uploaded=True,
        )
        member = add_project_user(project, email="pdf-reader@plane.so")

        session_client.force_authenticate(user=member)
        assert session_client.get(project_asset_url(project, asset.id)).status_code == status.HTTP_403_FORBIDDEN
        assert session_client.get(project_download_url(project, asset.id)).status_code == status.HTTP_403_FORBIDDEN
        assert session_client.get(workspace_asset_url(project, asset.id)).status_code == status.HTTP_403_FORBIDDEN
        assert session_client.get(workspace_download_url(project, asset.id)).status_code == status.HTTP_403_FORBIDDEN

        session_client.force_authenticate(user=create_user)
        assert session_client.get(project_asset_url(project, asset.id)).status_code == status.HTTP_302_FOUND
        storage.generate_presigned_url.assert_called_with(
            object_name=asset.asset.name,
            disposition="inline",
            filename="private.pdf",
        )
        assert session_client.get(project_download_url(project, asset.id)).status_code == status.HTTP_302_FOUND
        assert storage.generate_presigned_url.call_args.kwargs["disposition"] == "attachment"
        assert session_client.get(workspace_asset_url(project, asset.id)).status_code == status.HTTP_302_FOUND
        assert session_client.get(workspace_download_url(project, asset.id)).status_code == status.HTTP_302_FOUND
