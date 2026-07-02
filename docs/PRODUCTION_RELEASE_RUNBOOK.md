# Production Release Runbook

This is the current high-level release runbook for the Ubuntu 3106 server.
Older Windows-local release notes were archived under
[archive/windows-local-environment/PRODUCTION_RELEASE_RUNBOOK.md](archive/windows-local-environment/PRODUCTION_RELEASE_RUNBOOK.md).

## Release Flow

```text
module branch development -> local 3107 tests -> push GitHub -> code review -> merge main -> manual server deploy to 3106
```

Codex must not automatically merge `main`, deploy the server, restart 3106, or
operate server systemd/Nginx unless a later task explicitly authorizes an
execution phase.

## Preconditions

Before a production release:

1. The reviewed change is merged to `main`.
2. The target commit is explicit.
3. Local 3107 acceptance has passed on the development computer.
4. `npm run check:docs`, `npm run lint`, `npm run typecheck`, and `npm run build`
   pass on the release code.
5. Production environment checks pass with placeholder-free private server
   values and no secret output.
6. Backup and restore verification exists for PostgreSQL and required `data`
   metadata.
7. Disk status is below the configured protection thresholds.
8. The media cleanup timer and Nginx upload limit match the application limits.

## Production Invariants

- `NODE_ENV=production`.
- `PORT=3106`.
- `APP_BIND_HOST=127.0.0.1`.
- One 3106 instance only.
- Nginx proxies public HTTPS traffic to `127.0.0.1:3106`.
- 3107 is not present on the server.
- `DATA_DIR`, `UPLOADS_DIR`, and `RUNTIME_DIR` are persistent Linux paths under
  the approved data layout.

## Uploads, Retention, And Disk Protection

- Image upload default: 10MiB.
- Video upload default: 200MiB.
- Upload hard cap: 256MiB.
- Nginx `client_max_body_size` should be slightly above 200MiB and below the
  application hard-cap design.
- Generated media retention default: 24 hours.
- The hourly media cleanup timer calls the retention script; it does not delete
  all media every hour.
- Disk thresholds default to 70 percent warning, 80 percent critical warning,
  85 percent video-write block, 90 percent all-media-write block, and 95 percent
  emergency read/cleanup-only mode.

## Safe Acceptance

Post-release smoke checks must stay provider-safe:

- load `/`, `/login`, `/admin/providers`, `/api/health/backend`, and
  `/api/library`;
- verify static assets and expected auth redirects;
- avoid generation, upscale, New API generation, uploads, billing order
  creation, migrations, cleanup apply, and library deletion.

Rollback verification is documented in [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md).
