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
npm run deploy:production
```

The deployment script checks the worktree, fetches target code, records current PID and commit, creates backups and checksums, runs `npm ci`, automated tests, build, release preflight, then verifies service process identity before stopping the old process and starting the new one. If deployment validation fails after the old process is stopped, it attempts full rollback from the verified backup.

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

Backups are written under:

```text
../_rollback_backups
```

Each deployment backup includes a manifest, runtime metadata, `data`, `uploads`, selected local config files, database backup metadata, and checksums. PostgreSQL backups use `pg_dump` custom format and are verified with `pg_restore --list`.

Rollback supports two explicit modes:

- `code-only`: restore code and restart the service without restoring data.
- `full`: restore code, verified `data`, verified `uploads`, and database backup artifacts before restart.

Full rollback validates the manifest, service name, commit, checksums, and prepared rollback code before stopping the service. It must not restore a staging backup into production or a production backup into staging.

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
