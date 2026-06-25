# Production Operations

This project has two local service lanes.

- `3106` is production and uses `data` plus `uploads` in the production worktree.
- `3107` is staging and uses `data-staging` plus `uploads-staging` in the staging worktree.

Do not commit `.env.local`, API keys, admin passwords, `data`, `uploads`, staging data, logs, PID files, runtime state, or backups.

## Environment Loading

Runtime environment is loaded by `scripts/ops/load-runtime-env.mjs`.

Priority:

1. Service environment files in the current service worktree.
2. Current process environment.
3. Service invariants enforced by the operation script.

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

The deployment script checks the worktree, fetches target code, records current PID and commit, creates backups and checksums, runs `npm ci`, automated tests, build, release preflight, then stops the old process and starts the new one. If deployment validation fails after the old process is stopped, it attempts automatic rollback.

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

Each deployment backup includes runtime metadata, `data`, `uploads`, selected local config files, and checksums. A rollback PowerShell script is generated in the backup folder.

Rollback scripts restore the previous commit and start the corresponding service. They must not delete or recreate `data` or `uploads`.

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

The task scheduler entry runs once per minute as a watchdog. If the service is already listening, `start-service` refuses to start a duplicate process. If the service has exited, the next watchdog run starts it again. This covers normal reboot recovery and unexpected process exit without adding PM2 or NSSM.

## Operator Responsibility

The user does not need to run technical tests manually. Codex must run the automated checks, real 3107 validation, real 3106 safe deployment, and rollback validation when doing releases.
