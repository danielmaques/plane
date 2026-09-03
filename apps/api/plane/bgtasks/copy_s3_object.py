# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
import uuid
import base64
import re
import requests
from bs4 import BeautifulSoup

# Django imports
from django.conf import settings

# Module imports
from plane.db.models import FileAsset, Page, Issue
from plane.utils.exception_logger import log_exception
from plane.settings.storage import S3Storage
from celery import shared_task
from plane.utils.url import normalize_url_path


def get_entity_id_field(entity_type, entity_id):
    entity_mapping = {
        FileAsset.EntityTypeContext.WORKSPACE_LOGO: {"workspace_id": entity_id},
        FileAsset.EntityTypeContext.PROJECT_COVER: {"project_id": entity_id},
        FileAsset.EntityTypeContext.USER_AVATAR: {"user_id": entity_id},
        FileAsset.EntityTypeContext.USER_COVER: {"user_id": entity_id},
        FileAsset.EntityTypeContext.ISSUE_ATTACHMENT: {"issue_id": entity_id},
        FileAsset.EntityTypeContext.ISSUE_DESCRIPTION: {"issue_id": entity_id},
        FileAsset.EntityTypeContext.PAGE_DESCRIPTION: {"page_id": entity_id},
        FileAsset.EntityTypeContext.COMMENT_DESCRIPTION: {"comment_id": entity_id},
        FileAsset.EntityTypeContext.DRAFT_ISSUE_DESCRIPTION: {"draft_issue_id": entity_id},
    }
    return entity_mapping.get(entity_type, {})


def extract_asset_ids(html, tag):
    try:
        soup = BeautifulSoup(html, "html.parser")
        return [tag.get("src") for tag in soup.find_all(tag) if tag.get("src")]
    except Exception as e:
        log_exception(e)
        return []


def extract_pdf_asset_ids(html):
    try:
        soup = BeautifulSoup(html, "html.parser")
        asset_ids = []
        for link in soup.select("a.plane-pdf-attachment[href]"):
            match = re.search(r"/download/([0-9a-f-]+)/?(?:#.*)?$", link.get("href", ""), re.IGNORECASE)
            if match:
                asset_ids.append(match.group(1))
        return asset_ids
    except Exception as e:
        log_exception(e)
        return []


def replace_asset_ids(html, tag, duplicated_assets):
    try:
        soup = BeautifulSoup(html, "html.parser")
        for mention_tag in soup.find_all(tag):
            for asset in duplicated_assets:
                if mention_tag.get("src") == asset["old_asset_id"]:
                    mention_tag["src"] = asset["new_asset_id"]
        return str(soup)
    except Exception as e:
        log_exception(e)
        return html


def replace_pdf_asset_ids(html, duplicated_assets):
    try:
        soup = BeautifulSoup(html, "html.parser")
        asset_map = {asset["old_asset_id"]: asset["new_asset_id"] for asset in duplicated_assets}
        for link in soup.select("a.plane-pdf-attachment[href]"):
            href = link.get("href", "")
            match = re.search(r"/download/([0-9a-f-]+)/?(?:#.*)?$", href, re.IGNORECASE)
            if match and match.group(1) in asset_map:
                link["href"] = href.replace(match.group(1), asset_map[match.group(1)])
        return str(soup)
    except Exception as e:
        log_exception(e)
        return html


def update_description(entity, duplicated_assets, tag):
    updated_html = replace_asset_ids(entity.description_html, tag, duplicated_assets)
    entity.description_html = updated_html
    entity.save()
    return updated_html


# Get the description binary and description from the live server
def sync_with_external_service(entity_name, description_html):
    try:
        data = {
            "description_html": description_html,
            "variant": "rich" if entity_name == "PAGE" else "document",
        }

        live_url = settings.LIVE_URL
        if not live_url:
            return {}

        url = normalize_url_path(f"{live_url}/convert-document/")

        response = requests.post(url, json=data, headers=None)
        if response.status_code == 200:
            return response.json()
    except requests.RequestException as e:
        log_exception(e)
    return {}


def copy_assets(entity, entity_identifier, project_id, asset_ids, user_id):
    duplicated_assets = []
    workspace = entity.workspace
    storage = S3Storage()
    original_assets = FileAsset.objects.filter(workspace=workspace, project_id=project_id, id__in=asset_ids)

    for original_asset in original_assets:
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
            created_by_id=user_id,
            entity_type=original_asset.entity_type,
            project_id=project_id,
            storage_metadata=original_asset.storage_metadata,
            **get_entity_id_field(original_asset.entity_type, entity_identifier),
        )
        storage.copy_object(original_asset.asset, destination_key)
        duplicated_assets.append(
            {
                "new_asset_id": str(duplicated_asset.id),
                "old_asset_id": str(original_asset.id),
            }
        )
    if duplicated_assets:
        FileAsset.objects.filter(pk__in=[item["new_asset_id"] for item in duplicated_assets]).update(is_uploaded=True)

    return duplicated_assets


@shared_task
def copy_s3_objects_of_description_and_assets(entity_name, entity_identifier, project_id, slug, user_id):
    """
    Step 1: Extract asset ids from the description_html of the entity
    Step 2: Duplicate the assets
    Step 3: Update the description_html of the entity with the new asset ids (change the src of img tag)
    Step 4: Request the live server to generate the description_binary and description for the entity

    """
    try:
        model_class = {"PAGE": Page, "ISSUE": Issue}.get(entity_name)
        if not model_class:
            raise ValueError(f"Unsupported entity_name: {entity_name}")

        entity = model_class.objects.get(id=entity_identifier)
        asset_ids = list(
            dict.fromkeys(
                extract_asset_ids(entity.description_html, "image-component")
                + extract_pdf_asset_ids(entity.description_html)
            )
        )

        duplicated_assets = copy_assets(entity, entity_identifier, project_id, asset_ids, user_id)

        updated_html = replace_asset_ids(entity.description_html, "image-component", duplicated_assets)
        updated_html = replace_pdf_asset_ids(updated_html, duplicated_assets)
        entity.description_html = updated_html
        entity.save()

        external_data = sync_with_external_service(entity_name, updated_html)

        if external_data:
            description_json = external_data.get("description_json")
            description_binary = external_data.get("description_binary")
            if description_json is not None:
                entity.description_json = description_json
            if description_binary is not None:
                entity.description_binary = base64.b64decode(description_binary)
            entity.save()

        return
    except Exception as e:
        log_exception(e)
        return []
