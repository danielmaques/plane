# Page folders: safe Coolify deployment

This runbook deploys the Community/AGPL page-folder extension without replacing Plane's data services or persistent volumes. Complete every staging check before changing production.

## Release artifacts

Build the branch `codex/feat-page-folders-v1.3.0`, which is based on the official `v1.3.0` tag. Run the `Publish Page Folders images` workflow with tag `v1.3.0-folders.1`. It publishes:

- `ghcr.io/<owner>/plane-frontend:v1.3.0-folders.1`
- `ghcr.io/<owner>/plane-backend:v1.3.0-folders.1`

After the first workflow run, make both GHCR packages public in the fork's package settings. If they remain private, configure a read-only GHCR credential in Coolify instead. Never put registry tokens in Compose.

The frontend image is used only by `web`. The backend image is shared by `api`, `worker`, `beat-worker`, and `migrator`. Keep the official `proxy`, `admin`, `space`, and `live` images at `v1.3.0`.

## Production inventory captured before deployment

The current Coolify application uses these official images:

| Services                                   | Current image                     |
| ------------------------------------------ | --------------------------------- |
| `web`                                      | `makeplane/plane-frontend:v1.3.0` |
| `api`, `worker`, `beat-worker`, `migrator` | `makeplane/plane-backend:v1.3.0`  |

Preserve PostgreSQL 15.7, Redis, RabbitMQ, MinIO, proxy, admin, space, and live unchanged. The production data mounts currently include:

| Data          | Named volume                       | Container path             |
| ------------- | ---------------------------------- | -------------------------- |
| PostgreSQL    | `jpihygm2gggmkcg5jgzdxron_pgdata`  | `/var/lib/postgresql/data` |
| MinIO uploads | `jpihygm2gggmkcg5jgzdxron_uploads` | `/export`                  |

Reconfirm this inventory immediately before deployment and record the resolved digest for every current image. Coolify currently reports unapplied Compose changes and no scheduled backups; resolve both conditions before creating staging or changing production.

## Back up production

1. Export the current Coolify Compose and environment configuration. Store secrets in the existing secret manager, not in the repository.
2. Record running containers, image tags, image digests, named volumes, health status, and the current application revision.
3. Create a consistent PostgreSQL custom-format dump with `pg_dump`. Verify it with `pg_restore --list` and copy it outside the Coolify host.
4. Copy the complete MinIO bucket/volume to independent object storage. Compare object counts and sizes after the copy.
5. Configure recurring database and object-storage backups, retention, and an off-host destination. Perform a test restore. A scheduled job without a verified restore is not sufficient.

Do not continue if either backup is missing, stored only on the same host, or cannot be restored.

## Restored staging

Create a separate Coolify application with its own hostname, network, PostgreSQL database, MinIO bucket, Redis, RabbitMQ, and newly named volumes. Never mount the production volumes in staging.

1. Restore the PostgreSQL dump and MinIO backup into staging.
2. Start staging on the official `v1.3.0` images first and verify login, existing pages, attachments, and collaborative editing.
3. Change only the five image references described above to the versioned GHCR images.
4. Run `migrator` once and require a successful exit before starting or restarting the other backend services.
5. Confirm the migration creates `page_folders` and the nullable `pages_page.folder_id` relation without modifying existing page content.
6. Test public, private, and archived pages as member, guest, folder owner, project admin, and workspace admin on desktop and mobile.
7. Test create, rename, navigate, search, move, archive, restore, and delete-empty-folder behavior. Confirm deletion of a folder containing an active or archived page is rejected.
8. Switch staging back to the official `v1.3.0` images without reversing the migration. Confirm all existing pages appear as a flat root list and their content and attachments remain intact.
9. Reapply the custom images and repeat the smoke tests. Record screenshots, logs, container health, and image digests for approval.

## Production rollout

Proceed only after staging approval and a fresh backup:

1. Confirm the production Compose still points to the existing named volumes.
2. Replace `web` with the versioned frontend image.
3. Replace `api`, `worker`, `beat-worker`, and `migrator` with the same versioned backend image.
4. Leave every other service, variable, network, and volume unchanged.
5. Run the migrator and require a successful exit. Then start the API and workers, followed by web.
6. Verify health checks, migrations, login, existing pages, attachments, collaborative editing, and page folders.

## Rollback

Restore these image tags immediately if the release fails:

- `web`: `makeplane/plane-frontend:v1.3.0`
- `api`, `worker`, `beat-worker`, `migrator`: `makeplane/plane-backend:v1.3.0`

Do not remove the nullable column or the `page_folders` table during an incident. The additive schema is ignored by the official application, which displays pages in its original flat list. Database restoration is reserved for confirmed data corruption and must use the verified PostgreSQL and MinIO backups from this runbook.
