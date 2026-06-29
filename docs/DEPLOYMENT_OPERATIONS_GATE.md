# Deployment Operations Gate

This checklist is the review gate before any server deployment. It is evidence-only until a separate release approval authorizes a real deploy.

## Scope

- Production lane `3106`: `E:\codex工作台\p003\new-jiemian`, read-only during staging audits.
- Staging lane `3107`: `E:\codex工作台\p003\new-jiemian-3107`, deployment rehearsal and validation lane.
- No real deployment, migration, restore, data cleanup, provider call, or NewAPI generation call is implied by this gate.
- Do not commit or push release evidence, `.env*`, runtime state, backups, logs, screenshots, videos, generated media, `data`, `uploads`, `data-staging`, or `uploads-staging`.

## Production Env Evidence

Record only `configured`, `missing`, `masked`, file presence, and source class. Never paste secret values or full DSNs.

Required runtime groups:

- Runtime invariants: `NODE_ENV`, `PORT`, `DATA_DIR`, `UPLOADS_DIR`.
- Auth secret: `AUTH_SESSION_SECRET` or `SESSION_SECRET`.
- Application database: `APP_DATABASE_URL`, `APP_DATABASE_EXPECTED_NAME`.
- Persistence modes: `APP_AUTH_PERSISTENCE_MODE`, `APP_BILLING_PERSISTENCE_MODE`, `APP_TASK_BILLING_PERSISTENCE_MODE`.
- NewAPI server config: `NEW_API_ENABLED`, `NEW_API_BASE_URL`, `NEW_API_ENVIRONMENT`, `NEW_API_ADMIN_USER_ID`, `NEW_API_ADMIN_ACCESS_TOKEN`.
- Payment launch state: `PAYMENT_PRODUCTION_ENABLED`, `PAYMENT_PRODUCTION_WEBHOOK_SECRET`, provider registration state.

Safe evidence commands:

```powershell
node scripts/ops/load-runtime-env.mjs production --json --root E:\codex工作台\p003\new-jiemian
npm run release:preflight
npm run test:security-release
```

Production release is blocked when required env groups are missing, persistence is not PostgreSQL, NewAPI production config is incomplete, production payment is partially enabled, or the report contains unmasked secrets.

## Preflight And Artifact Gate

Before a target can be considered deployable, the following checks must pass in the candidate worktree or be reported with an explicit failure reason:

```powershell
npm run test:runtime-isolation
npm run check:runtime-paths
npm run test:security-release
npm run test:release-artifact-cleanliness
npm run check:release-test-artifact-isolation
npm run test:ops
npm run test:rollback-drill
npm run build
```

`npm start` must run `release:preflight` before `next start`. `deploy:production` must require an explicit `--target`, verify the target equals `origin/main`, reject dirty worktrees, validate the candidate before stopping the live process, and create a clean immutable release artifact.

Release artifacts must not contain:

- `.env`, `.env.local`, `.runtime`, logs, PID files, rollback authorization files, dumps, SQLite files, local databases, `dist`, `artifacts`, backups, `data`, `uploads`, `data-staging`, or `uploads-staging`.
- Symlinks from `.next/node_modules` to paths outside the artifact.

## Database Migration And Backup Gate

Migration evidence must stay separate from deployment evidence.

Required review commands:

```powershell
npm run db:migration:rehearsal
npm run db:import:dry-run
npm run db:consistency:check
npm run db:rollback:check
```

Database migration or restore is blocked unless:

- the target database identity matches the explicit expected name;
- the target name is clearly test-only for rehearsal commands;
- destructive migration tokens have been reviewed and separately authorized;
- a verified backup manifest and checksums exist;
- PostgreSQL backup material was produced by `pg_dump` and validated with `pg_restore --list`;
- production `3106` and staging `3107` data paths are confirmed separate.

No production migration is allowed from this gate alone.

## Rollback Gate

Rollback must be ready before production deploy approval.

Required evidence:

- selected backup directory, service name, source commit, target rollback commit, manifest hash, and checksum status;
- `data` and `uploads` snapshot summaries before and after backup validation;
- database type and restore authorization requirement;
- rollback mode: `code-only` or `full`;
- rollback script path and dry/static validation result;
- confirmation that rollback code prepares dependencies, build output, startup preflight, and smoke checks before the live service is stopped;
- confirmation that no `npm ci`, `npm install`, or `npm run build` runs while the live service is stopped.

Safe drill command:

```powershell
npm run test:rollback-drill
```

## Repository Secret And Artifact Gate

Before approval, confirm:

- Git status is reviewed and unrelated user changes are not reverted.
- No `.env*` secrets, runtime files, database files, backups, generated media, screenshots, videos, test reports, logs, or PID files are tracked.
- CI runs release artifact cleanliness, release test artifact isolation, ops tests, and rollback drill on Linux and Windows where applicable.
- Release reports and logs include only masked secret state, not secret values, Authorization headers, cookies, full DSNs, prompts, base64 payloads, or upstream raw bodies.

## Review Output Template

```text
Deployment operations gate:
- repo / branch:
- production lane touched: no
- staging lane touched:
- env evidence:
- preflight result:
- migration/backup result:
- rollback result:
- repository secret/artifact result:
- tests run:
- blockers:
- remaining risk:
```
