# Deployment And Data Plan

This is the current deployment and data summary. Older Windows-local deployment
notes were archived under
[archive/windows-local-environment/DEPLOYMENT_AND_DATA_PLAN.md](archive/windows-local-environment/DEPLOYMENT_AND_DATA_PLAN.md).

## Current Boundaries

- Local 3107 runs only on the development computer for optimization, automated
  tests, and manual acceptance.
- 3107 is not deployed to the server.
- The Ubuntu server runs only the 3106 production instance.
- Production is a single Next.js process on `127.0.0.1:3106` behind Nginx.
- The current rate-limit and workload guards are in-memory and fit a single
  instance. Do not run multiple 3106 instances until those counters move to a
  shared store.

## Server Runtime

The supported server template is:

- Ubuntu 22.04 LTS.
- Node.js 24.
- systemd for the one application process.
- Nginx for public HTTP/HTTPS.
- Public ports limited to 22, 80, and 443.
- Application bind address `127.0.0.1`.
- Application port `3106`.
- Persistent data, uploads, runtime, and backups under `/var/lib/aohuang-ai`.

Deployment templates and read-only checks live in
[deploy/linux/README.md](../deploy/linux/README.md).

## Data And Media

- `DATA_DIR` contains runtime JSON metadata and fallback stores.
- `UPLOADS_DIR` contains local media files.
- PostgreSQL is required for production auth, billing, task billing, and related
  business data when production persistence modes are enabled.
- Library and generation-job storage default to JSON/file-system mode:
  `LIBRARY_STORAGE_BACKEND=json`, `GENERATION_JOBS_BACKEND=existing`,
  `DATABASE_LIBRARY_DUAL_WRITE=false`, `DATABASE_LIBRARY_READ_ENABLED=false`,
  and `DATABASE_JOBS_WRITE_ENABLED=false`.
- PostgreSQL library/job paths are guarded by explicit flags and runtime checks.
- No object storage adapter or multi-instance worker system is implemented in
  the current production shape.

## Operational Limits

- Image upload default: 10MiB.
- Video upload default: 200MiB.
- Upload hard cap: 256MiB.
- Generated media retention default: 24 hours.
- Media cleanup timer: hourly systemd timer that calls
  `npm run ops:cleanup-media:apply`.
- Disk protection thresholds: 70 percent warning, 80 percent critical warning,
  85 percent video-write block, 90 percent all-media-write block, 95 percent
  emergency read/cleanup-only mode.

## Backup Policy

Short-term local backups for a 60GB single server are documented in
[SERVER_BACKUP_AND_RESTORE.md](SERVER_BACKUP_AND_RESTORE.md). Daily server
backups include PostgreSQL and necessary `data` metadata. They do not treat
24-hour generated media, temporary uploads, caches, or ordinary logs as
long-term backup material.
