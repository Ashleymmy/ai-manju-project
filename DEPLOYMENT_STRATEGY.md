# Deployment Strategy

This project uses timestamped release directories and explicit operator
approval for any runtime switch. Do not overwrite or delete the currently
running release while preparing a new build.

## Release Flow

1. Build a new timestamped release directory, for example
   `releases/20260629-153000`.
2. Copy the verified source bundle, `.env`, and deployment files into the new
   release directory.
3. Run verification before switching traffic:
   - `cd apps/api && go test ./...`
   - `cd apps/api && go build ./cmd/server`
   - `cd apps/web && corepack pnpm build`
   - `docker compose --env-file .env config --quiet`
4. Verify persistent runtime settings before startup:
   - `REQUIRE_PERSISTENT_STORAGE=true`
   - `COOKIE_SECURE=true` for HTTPS production
   - `ALLOW_PUBLIC_SIGNUP=false` unless the beta explicitly opts in
   - `ASSET_STORAGE_DIR=/app/data/assets`
   - `MAX_ASSET_UPLOAD_BYTES` is not greater than the proxy body limit
5. Confirm Compose keeps both persistent volumes:
   - `ai-manju-postgres-data`
   - `ai-manju-assets`
6. Get explicit approval before any start, restart, container recreation,
   proxy reload, or traffic switch.

## Runtime Checks

After an approved switch, verify:

- `/health` reports database and storage healthy.
- A test member can create a canvas project.
- Uploading or generating an image stores a `server:image:<assetId>` key.
- Refreshing the browser reloads the image.
- A second browser session under the same user can load the same server-backed
  asset.

## Rollback

Rollback should switch traffic back to the previous known-good release. Keep
the failed release directory and logs for inspection; do not delete them during
the incident.
