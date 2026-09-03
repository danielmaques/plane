# Page folders and file imports: safe Coolify deployment

This runbook deploys the Community/AGPL page-folder, PDF attachment, and Markdown import extensions without replacing Plane's data services or persistent volumes. Complete every staging check before changing production.

## Release artifacts

Build the branch `codex/feat-page-file-imports-v1.3.0`, which extends the page-folders branch based on the official `v1.3.0` tag. The `Publish Page extensions images` workflow run `33765097977` completed successfully from commit `bea630599dd09e4310c409698459b3fdf55e00db` and published:

- `ghcr.io/danielmaques/plane-frontend:v1.3.0-folders.2`
- `ghcr.io/danielmaques/plane-backend:v1.3.0-folders.2`

Both packages are public and expose `linux/amd64` images. Pin the OCI index digests in staging and production:

| Image    | OCI index digest                                                          |
| -------- | ------------------------------------------------------------------------- |
| Frontend | `sha256:bae111724d9ba7b6bd171336199ff55b81888f5a9b537bb31d31aeb468946635` |
| Backend  | `sha256:dc5afd4fd04f153418b72fadb38c5d9961c817da531202679ce429375d5134af` |

The frontend image is used only by `web`. The backend image is shared by `api`, `worker`, `beat-worker`, and `migrator`. Keep the official `proxy`, `admin`, `space`, and `live` images at `v1.3.0`.

## Using the file features

On an editable, unlocked, and non-archived Page, insert a PDF by typing `/pdf`, dragging the file into the editor, or pasting a copied PDF. The 50 MiB PDF limit is independent of the existing 5 MiB image limit. Files continue to use the configured Page asset storage; a self-hosted installation with `USE_MINIO=1` stores them in its existing MinIO uploads volume. The editor card can preview the PDF, open it in a new tab, or download it. An official Plane build renders the same attachment as a regular working link.

From the public or private Pages list, select **Import Markdown**, choose a local directory, review the manifest, and start the import. Each `.md` file becomes one Page in the currently selected Plane folder and access tab. Relative JPEG, PNG, GIF, and WebP references are uploaded as Page assets; external HTTP(S) images stay external. The importer reports each file independently and removes an incomplete Page when that file fails.

## Production inventory checklist

Record the images currently used by the Coolify application before changing them:

| Services                                   | Value to record privately     |
| ------------------------------------------ | ----------------------------- |
| `web`                                      | Tag and resolved digest       |
| `api`, `worker`, `beat-worker`, `migrator` | Shared backend tag and digest |

Preserve PostgreSQL, Redis, RabbitMQ, MinIO, proxy, admin, space, and live unchanged. Record the production data mounts in a private deployment record:

| Data          | Value to record privately                               |
| ------------- | ------------------------------------------------------- |
| PostgreSQL    | Named volume, container path, size, and owner           |
| MinIO uploads | Named volume or bucket, container path, size, and owner |

Reconfirm this inventory immediately before deployment and record the resolved digest for every current image. Resolve pending Compose changes, missing backup schedules, failed backup executions, and missing off-host backup destinations before creating staging or changing production. Do not commit the private deployment record, environment values, resource UUIDs, internal hostnames, or volume names to the public fork.

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
5. Confirm the migration creates `page_folders` and the nullable `pages.folder_id` relation without modifying existing page content.
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
6. Verify health checks, migrations, login, existing pages, attachments, collaborative editing, page folders, PDF upload/preview/download, and Markdown folder import.

## Rollback

The preferred rollback for the file-import release is the previous page-folders build:

- `web`: `ghcr.io/danielmaques/plane-frontend:v1.3.0-folders.1@sha256:fa9575213dd62d000e294301bbc86c99e1c3d4646330930e2d9efd2cde366873`
- `api`, `worker`, `beat-worker`, `migrator`: `ghcr.io/danielmaques/plane-backend:v1.3.0-folders.1@sha256:96eb14e1b2390df0f60d6f6772b800a90d6b282c5165e414f177b989f46293f7`

If a full Community rollback is required, restore the official image tags:

- `web`: `makeplane/plane-frontend:v1.3.0`
- `api`, `worker`, `beat-worker`, `migrator`: `makeplane/plane-backend:v1.3.0`

Do not remove the nullable column or the `page_folders` table during an incident. The file-import release adds no database migration. Existing PDFs remain in MinIO and become regular links on the page after rollback. The additive folder schema is ignored by the official application, which displays pages in its original flat list. Database restoration is reserved for confirmed data corruption and must use the verified PostgreSQL and MinIO backups from this runbook.
