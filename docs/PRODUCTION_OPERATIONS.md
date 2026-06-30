# Production Operations

This is the current operations entry for the Ubuntu single-server production
shape. Older Windows-local service and watchdog notes were archived under
[archive/windows-local-environment/PRODUCTION_OPERATIONS.md](archive/windows-local-environment/PRODUCTION_OPERATIONS.md).

## Production Boundary

- The server runs only 3106.
- 3107 remains local-only on the development computer and is not a server
  staging service.
- The production app listens on `127.0.0.1:3106` and is reached through Nginx.
- The deployment model is one Next.js production process managed by systemd.
- Do not use PM2, Docker, WordPress, PHP, LNMP process management, or a Baota
  process manager for this app.

## Required Server Checks

Before a human-operated production start or release switch:

```bash
npm run env:check:production
npm run release:preflight
bash deploy/linux/deploy-preflight.sh
```

After the service is running locally on the server:

```bash
bash deploy/linux/health-check.sh
```

These checks must not print API keys, passwords, cookies, tokens, full DSNs, or
production environment values.

## Storage And Retention

- `DATA_DIR`, `UPLOADS_DIR`, and `RUNTIME_DIR` must be Linux absolute paths
  outside the release directory.
- Generated media is retained for 24 hours by default.
- The media cleanup timer runs hourly, but the cleanup script deletes only
  completed local media older than the retention window.
- Video uploads default to 200MiB and may be lowered by server configuration.
- Disk protection levels are 70/80/85/90/95 percent by default.
- Run `npm run ops:storage:check` for an internal storage status summary.

## Backups And Restore

Daily single-server backups are documented in
[SERVER_BACKUP_AND_RESTORE.md](SERVER_BACKUP_AND_RESTORE.md).

Useful commands:

```bash
npm run ops:backup:dry-run
npm run ops:backup:apply
npm run ops:backup:prune:dry-run
npm run ops:backup:prune:apply
npm run ops:restore:verify -- --backup <server-backup-dir>
```

Local backups under `/var/lib/aohuang-ai/backups` are short-term copies only and
should be synchronized to external storage, a cloud disk snapshot, or another
machine.

## Safe Health And Smoke Checks

Safe checks may load:

- `/`
- `/login`
- `/admin/providers`
- `/api/health/backend`
- `/api/library`

They must not submit prompts, upload files, trigger generation, call upscale,
call New API generation, create billing orders, or delete library items.
