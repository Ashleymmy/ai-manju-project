# Production Deploy

This package is intended to be uploaded to a Linux production server and built with Docker Compose.

## Server Requirements

- Docker Engine and Docker Compose plugin
- Internet access during build for Node, Go, npm/pnpm, and Go module downloads
- Nginx with HTTPS certificates for `aicavans.cc` and `www.aicavans.cc`

## First Deploy

1. Upload and unzip the package.
2. Copy `.env.production.example` to `.env`.
3. Replace every `CHANGE_ME` value in `.env`.
4. Confirm these production values:
   - `FRONTEND_URLS=https://aicavans.cc,https://www.aicavans.cc`
   - `VITE_API_URL=https://aicavans.cc`
   - `COOKIE_SECURE=true`
   - `ALLOW_PUBLIC_SIGNUP=false`
   - `REQUIRE_PERSISTENT_STORAGE=true`
5. Start the stack:

```bash
docker compose --env-file .env up -d --build
```

6. Check service health:

```bash
docker compose ps
curl -f http://127.0.0.1:3101/health
```

7. Install or reload the Nginx config from `deploy/aicavans.cc.conf`.

## Important Notes

- `VITE_API_URL` is compiled into the Studio image. If you change it, rebuild the web container.
- Postgres and uploaded assets are persisted in Docker volumes:
  - `ai-manju-postgres-data`
  - `ai-manju-assets`
- Do not delete the volumes during upgrades unless you intentionally want to remove production data.
- The app containers are bound to `127.0.0.1` in the production env template, so public access should go through Nginx.
