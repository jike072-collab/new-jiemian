# Protected 3106 Deploy Runbook Draft

This runbook is a preparation artifact. It is not release authorization. Codex
must not operate 3106, restart services, deploy, connect to production or
staging databases, run migrations, touch real uploads, call NewAPI or providers,
produce cost, merge PRs, print secrets, or perform server writes unless the user
later grants explicit authorization for a separate execution phase.

## Phase 1: Total-Control Intake

Purpose:

- Confirm that the release is still in preparation mode and that 3106 is
  no-touch.

Pre-gate:

- Repo branch and commit are known.
- Worktree is clean.
- Target release commit is explicit.
- Total-control owner is named.

Allowed to continue:

- The task remains documentation, static repo review, and checklist preparation.

Stop if:

- The request asks Codex to restart 3106, deploy, run migrations, connect to DB,
  call provider/NewAPI, print secrets, merge PRs, or write server config.

Rollback point:

- No runtime rollback is needed because no server state has changed.

## Phase 2: Static Repo Evidence Review

Purpose:

- Confirm repository deployment, health, data, provider, and rollback evidence
  without touching server resources.

Pre-gate:

- Worktree is clean.
- `.env.local`, `data`, `uploads`, logs, dumps, and backups are not read for
  content.

Allowed to continue:

- Existing docs and scripts are identified:
  - `docs/PRODUCTION_RELEASE_RUNBOOK.md`
  - `docs/PRODUCTION_OPERATIONS.md`
  - `docs/ROLLBACK_RUNBOOK.md`
  - `docs/DATABASE_BACKUP_RESTORE_RUNBOOK.md`
  - `docs/STUDIO_REGRESSION_GUARDS.md`
  - `scripts/ops/health-check.mjs`
  - `scripts/ops/service-config.mjs`

Stop if:

- Static review requires live DB credentials, production HTTP calls, real uploads
  inspection, or provider calls.

Rollback point:

- Revert only documentation changes if the doc branch is wrong.

## Phase 3: Human Server Confirmation

Purpose:

- Collect server facts that Codex must not infer or verify by operating the
  server.

Pre-gate:

- Human operator owns all server checks.
- Secret values are not pasted into Codex.

Allowed to continue when the operator confirms:

- 3106 deployment directory.
- Running user.
- Running port.
- Current commit or package.
- Current process manager.
- Nginx active config path.
- Certificate path and renewal method.
- Current DNS records and TTL.
- Production env path and permissions.
- DB latest backup time, location, checksum, and restore owner.
- uploads latest backup time, location, size tier, and restore owner.
- Disk and inode status.
- Release window.
- Rollback owner.
- Total-control approver.

Stop if:

- Any of the above is unknown or contradicted by another source.

Rollback point:

- No runtime rollback is needed. Keep the release in preparation mode.

## Phase 4: Nginx, HTTPS, And DNS Review

Purpose:

- Ensure public traffic enters through the approved reverse proxy and HTTPS
  boundary.

Pre-gate:

- Human operator provides config paths and masked domain list.
- Codex does not run Nginx test, reload, or restart on the server.

Allowed to continue:

- Nginx maps approved hostnames to the app upstream.
- TLS cert is valid and renewable.
- DNS target is approved.
- Raw app, NewAPI, PostgreSQL, and provider ports are not public entrypoints.

Stop if:

- Cert expiry is near without renewal proof.
- DNS target is ambiguous.
- Reverse proxy bypasses auth or exposes internal ports.
- Upload limits, proxy headers, or timeouts are absent and cannot be reviewed.

Rollback point:

- Keep previous Nginx/DNS/cert configuration unchanged until execution is
  explicitly approved.

## Phase 5: Env And Secret Review

Purpose:

- Confirm required env names and secret storage without exposing values.

Pre-gate:

- Env is reviewed as configured/missing only.
- No full DSN, token, key, password, cookie, or Authorization value is printed.

Allowed to continue:

- Required env names are accounted for.
- Production env file permissions are known.
- `PORT=3106`, production `DATA_DIR`, and production `UPLOADS_DIR` are approved.
- Database and NewAPI/provider settings are understood without showing values.

Stop if:

- Missing or unexplained env variables remain.
- A secret appears in chat, logs, docs, or a PR.
- Staging env is confused with production env.

Rollback point:

- Restore previous env file only under separate operator-controlled execution.

## Phase 6: Backup And Restore Gate

Purpose:

- Prove release can be reversed before any production execution.

Pre-gate:

- Codex does not connect to production or staging DB.
- Codex does not read or move real uploads.

Allowed to continue:

- Latest DB backup is confirmed by timestamp, location, checksum or manifest,
  and restore owner.
- Latest uploads backup is confirmed by timestamp, location, file count or size
  tier, and restore owner.
- Backup retention and encryption/access policy are known.
- Restore rehearsal or equivalent verification is confirmed.

Stop if:

- DB backup and uploads backup are not a matching set.
- `pg_restore --list` or equivalent readability proof is missing.
- Restore owner is missing.
- Backup requires Codex to connect to production/staging DB.

Rollback point:

- No runtime rollback. Release remains blocked.

## Phase 7: Disk, Logs, And Monitoring Gate

Purpose:

- Prevent failure from log growth, uploads growth, backups growth, or missing
  operational visibility.

Pre-gate:

- Human operator provides masked status, not raw sensitive log contents.

Allowed to continue:

- Disk and inode thresholds pass.
- App, Nginx, systemd journal, and backup logs have rotation.
- Alert owner and alert path are known.

Stop if:

- Disk or inode usage is near threshold.
- logrotate is absent.
- Logs show secret leakage, exception loops, DB errors, provider errors, or
  generation calls during safe checks.

Rollback point:

- Keep release in preparation mode.

## Phase 8: Provider-Safe Smoke Plan

Purpose:

- Define post-release checks that prove availability without cost or writes.

Pre-gate:

- Total-control approval confirms smoke test paths.
- No production/staging curl is run in this preparation phase.

Allowed candidate checks after a separately authorized release:

- `GET /`
- `GET /login`
- `GET /api/health/backend`
- `GET /api/library`
- `GET /admin/providers` with expected unauthenticated redirect or auth failure
- Static assets loaded by those pages

Stop if:

- The smoke plan includes POST generation, POST upscale, prompt optimization,
  quota precheck, billing order creation, library delete, file download from real
  uploads, provider health connectivity/model calls, or any NewAPI/provider
  endpoint.

Rollback point:

- Use the prepared rollback decision rules. Do not improvise business fixes
  during an incident.

## Phase 9: Execution Authorization Gate

Purpose:

- Prevent accidental transition from preparation to production operation.

Pre-gate:

- All checklist items pass.
- Total-control approver explicitly says execution may begin.

Allowed to continue:

- Only a future, separately authorized execution run may operate 3106.

Stop if:

- Approval is implicit, stale, or ambiguous.
- Any hard prohibition remains in force.

Rollback point:

- Stay in documentation mode.

## Phase 10: Rollback Decision Rules

Purpose:

- Decide when release must be stopped or rolled back.

Pre-gate:

- Rollback owner, backup set, commit/package, and verification method are known.

Immediate stop or rollback conditions:

- 3106 runs the wrong commit or package.
- Health fails.
- Nginx returns 5xx for safe pages.
- DB backup is invalid or unavailable.
- uploads backup is invalid or unavailable.
- Env changed unexpectedly.
- Disk or inode threshold fails.
- Logs expose secrets.
- Smoke test triggers provider, NewAPI, DB writes, real upload import, or cost.
- Data/uploads checksums change unexpectedly.
- Migration runs without explicit approval.
- Rollback material cannot be verified.

Rollback point:

- Prefer code-only rollback for code-only incidents.
- Use full rollback only when data, uploads, or DB state is part of the incident
  and the matching verified backup set is available.
