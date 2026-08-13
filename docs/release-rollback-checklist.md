# AI-Manju Release And Rollback Checklist

## Scope

This checklist is for the AI-Manju `0.3.0-beta.0` iteration release. It assumes the current Docker Compose topology: Postgres, Redis, API, asset-export worker, media worker, and web.

## Pre-Release Checks

- Confirm the release branch/worktree contains the expected version changes and `CHANGELOG.md`.
- Confirm required environment variables are set before `docker compose up`: database credentials, `APP_SECRET`, `FRONTEND_URLS`, admin bootstrap values, `NEXT_PUBLIC_API_URL`, and public signup settings.
- Confirm `NEXT_PUBLIC_API_URL` is browser-reachable. For local preview on default ports, use `http://127.0.0.1:3101`.
- Run backend validation from `apps/api`: `go build ./...`, `go vet ./...`, `go test ./...`.
- Run frontend validation from `apps/web`: `pnpm tsc --noEmit`, `pnpm build`.
- Run worker validation from `apps/worker`: `python -m unittest discover -s tests`.
- Run local Agent validation from the repository root: `pnpm --filter @basketikun/canvas-agent build` and `pnpm --filter @basketikun/canvas-agent test`.
- Run full mock E2E from the repository root: `node scripts/e2e-compose.mjs --ci`.

## Compose Startup Order

- Start Postgres and Redis first; both must report healthy.
- Start API after Postgres and Redis are healthy. API health is `GET /health` on port `3101`.
- Start media workers after Postgres and Redis are healthy. Worker health is `GET /health` on port `8101`.
- Start `asset-export-worker` after Postgres is healthy so queued ZIP exports can resume after restarts.
- Start web after API and `asset-export-worker` are healthy. Web health is `GET /` on port `3100`.
- The checked-in Compose file already encodes these health-gated dependencies; prefer `docker compose up -d --build` over manual container starts.

## Database And Assets

- Current GORM startup applies the schema required by the API models when `STORAGE_DRIVER=postgres`.
- Migrations/schema setup should be treated as idempotent: rerunning the same app version must not destroy existing rows or assets.
- Keep the asset volume mounted at `/app/data/assets` for API and worker. New worker images run as a non-root user, so fresh named volumes are preferred for new environments.
- Before release, confirm existing environments have writable asset storage for the worker user if reusing an old volume created by a root-running worker image.

## Release Steps

1. Pull or check out the release revision.
2. Export the target environment variables or provide a matching `.env`.
3. Run `docker compose config` and inspect the rendered ports, volumes, and public API URL.
4. Run `docker compose up -d --build`.
5. Wait for all services to become healthy: Postgres, Redis, API, asset-export-worker, worker, and web.
6. Smoke-test login, canvas project open, one mock/real generation path appropriate for the environment, and asset rendering.
7. Record image tags or source revision used for the release.

## Rollback Steps

1. Stop traffic or put the instance in maintenance mode if available.
2. Check out the previous known-good source revision or set Compose image tags back to the previous known-good images.
3. Run `docker compose up -d --build` or `docker compose up -d` if using already-built tagged images.
4. Confirm `GET /health` on API and worker, then confirm the web entry page returns 200.
5. Smoke-test login and a previously created canvas project.
6. If rollback still fails, keep Postgres and asset volumes intact, collect logs with `docker compose logs api worker web`, and escalate before deleting any volume.

## Do Not Do During Rollback

- Do not delete the Postgres volume unless a separate data recovery decision has been made.
- Do not delete the asset volume unless generated/uploaded assets have been backed up or explicitly declared disposable.
- Do not change auth cookie or `APP_SECRET` during rollback unless the goal is to invalidate sessions intentionally.
