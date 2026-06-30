# Production Operations

This project has two local service lanes.

- `3106` is production and uses `data` plus `uploads` in the production worktree.
- `3107` is staging and uses `data-staging` plus `uploads-staging` in the staging worktree.

Do not commit `.env.local`, API keys, admin passwords, `data`, `uploads`, staging data, logs, PID files, runtime state, or backups.

## Environment Loading

Runtime environment is loaded by `scripts/ops/load-runtime-env.mjs`.

Priority:

1. Service invariants enforced by the operation script.
2. Current process environment.
3. Service environment files in the current service worktree.
4. Code defaults.

Production reads only the production worktree:

- `.env.local`
- `.runtime/production.env`

Staging reads only the staging worktree:

- `.env.local`
- `.runtime/staging.env`

The operations scripts force:

- `NODE_ENV=production`
- `PORT=3106` for production, `PORT=3107` for staging
- production `DATA_DIR=<production>/data`
- production `UPLOADS_DIR=<production>/uploads`
- staging `DATA_DIR=<staging>/data-staging`
- staging `UPLOADS_DIR=<staging>/uploads-staging`

Logs and status output show only `configured`, `missing`, or `masked`. Secret values must not appear in logs.

## Commands

Status:

```powershell
npm run service:status
```

Health check:

```powershell
npm run service:health
```

Start staging:

```powershell
npm run service:start:staging
```

Start production:

```powershell
npm run service:start:production
```

Stop staging:

```powershell
npm run service:stop:staging
```

Stop production:

```powershell
npm run service:stop:production
```

Deploy staging:

```powershell
npm run deploy:staging
```

Deploy production:

```powershell
npm run deploy:production -- --target <origin-main-merge-commit>
```

The deployment script checks the worktree, fetches target code, records current PID and commit, creates backups and checksums, runs `npm ci`, automated tests, build, release preflight, then verifies service process identity before stopping the old process and starting the new one. If deployment validation fails after the old process is stopped, it attempts full rollback from the verified backup.

All changes must be deployed and verified on `3107` before `3106` is considered. Do not directly restart or overwrite `3106` while testing a branch.

## Health Checks

Health checks call only safe endpoints:

- `/`
- `/login`
- `/admin/providers`
- `/api/health/backend`
- `/api/library`

They do not call image generation, video generation, upscale, or NewAPI-consuming endpoints.

## Logs

Production log:

- `.runtime/3106-production.log`

Staging log:

- `.runtime/3107-staging.log`

The start script rotates logs when they exceed the configured size. Logs are ignored by Git.

## Backups And Rollback

Deployment rollback backups are written under:

```text
../_rollback_backups
```

Each deployment backup includes a manifest, runtime metadata, `data`, `uploads`, selected local config files, database backup metadata, and checksums. PostgreSQL backups use `pg_dump` custom format and are verified with `pg_restore --list`.

If a service has PostgreSQL configured, backup failure blocks deployment for both staging and production. Staging may skip database backup only when no database is explicitly configured.

Rollback supports two explicit modes:

- `code-only`: restore code and restart the service without restoring data.
- `full`: restore code, verified `data`, verified `uploads`, and database backup artifacts before restart.

Full rollback validates the manifest, service name, commit, checksums, PostgreSQL database fingerprint, and prepared rollback code before stopping the service. It must not restore a staging backup into production or a production backup into staging.

For PostgreSQL, full restore requires a deployment-scoped, in-memory rollback authorization created by the deploy session that made the backup. The authorization binds the service, backup directory, manifest hash, source commit, target commit, database fingerprint, purpose, and expiry time, and it is consumed once. A normal CLI rollback command must not restore a PostgreSQL database without that authorization.

Rollback code is prepared in a temporary Git worktree before stopping the live service. The candidate commit must complete dependency install, lint, typecheck, build, startup preflight, and isolated smoke testing first. After the service is stopped, rollback must not run `npm ci`, `npm install`, or `npm run build`; it may only activate the already prepared code artifacts, restore verified data, and start the service.

`data` and `uploads` are restored through a temporary directory first. The copied files are checked against `checksums.json` by relative path, file size, and SHA-256 before replacing the live directories. Previous live directories are kept until the service passes health checks, then cleaned up.

Daily 60GB server backups use a separate short-term policy documented in
`docs/SERVER_BACKUP_AND_RESTORE.md`. Those backups include PostgreSQL and
necessary `data` metadata, but intentionally exclude 24-hour generated media in
`uploads`, temporary uploads, caches, and ordinary logs. Local backup retention
is intentionally small and should be paired with off-host storage, cloud disk
snapshots, or another machine.

Commands:

```powershell
npm run ops:backup:dry-run
npm run ops:backup:apply
npm run ops:backup:prune:dry-run
npm run ops:backup:prune:apply
npm run ops:restore:verify -- --backup <server-backup-dir>
```

Restore apply is not automatic. It requires explicit confirmation that writes
are stopped and, for production, explicit production restore approval. Code
rollback and data restore are separate operations; a Git rollback must not
overwrite user data.

## Release Reliability Checks

CI must include Linux and Windows jobs. Linux runs the isolated rollback drill against a PostgreSQL service container. Windows runs the same operations checks without a real database service, so Windows path and process behavior are covered without touching production resources.

Local release validation must include:

```powershell
npm run lint
npm run typecheck
npm run test:runtime-isolation
npm run check:runtime-paths
npm run test:security-release
npm run test:ops
npm run test:rollback-drill
npm run build
npm run check
```

## Process Recovery

The repository includes `scripts/ops/register-service-task.mjs` for Windows Task Scheduler registration.

Task names:

- `AohuangAI-3106-production-watchdog`
- `AohuangAI-3107-staging-watchdog`

Register tasks only after this operations code has been deployed into the real service worktrees:

- production: `E:\codex工作台\p003\new-jiemian`
- staging: `E:\codex工作台\p003\new-jiemian-3107`

If the current Windows session lacks permission to create system tasks, do not report system-level recovery as completed. Use the repository start, stop, status, health, and deploy commands until task registration can be verified.

No PM2 or NSSM dependency is required.

The task scheduler entry runs once per minute as a health watchdog. It runs `scripts/ops/watchdog-service.mjs`, not `start-service` directly. The watchdog first verifies process identity and health. A healthy service exits with code 0 and is not restarted. A stopped service is started only after confirming the port is free. An owned but unhealthy service is restarted only after repeated health failures. Foreign or ambiguous port owners are never killed.

## Operator Responsibility

The user does not need to run technical tests manually. Codex must run the automated checks, real 3107 validation, real 3106 safe deployment, and rollback validation when doing releases.
