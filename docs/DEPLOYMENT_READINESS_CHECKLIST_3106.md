# 3106 Deployment Readiness Checklist

This checklist is for server deployment preparation only. It does not authorize
operating 3106, restarting services, publishing, connecting to production or
staging databases, running migrations, touching real uploads, calling NewAPI or
providers, merging PRs, or printing secrets.

## Static Repo Baseline

- Repository: `jike072-collab/new-jiemian`
- Documentation branch base: `origin/main`
- Existing local lane convention:
  - 3106 is the production lane.
  - 3107 is the staging/test lane.
  - 3106 uses production `data` and `uploads`.
  - 3107 uses isolated `data-staging` and `uploads-staging`.
- Existing safe health script calls only:
  - `/`
  - `/login`
  - `/admin/providers`
  - `/api/health/backend`
  - `/api/library`
- Existing repo docs to cross-check before execution:
  - `docs/PRODUCTION_RELEASE_RUNBOOK.md`
  - `docs/PRODUCTION_OPERATIONS.md`
  - `docs/ROLLBACK_RUNBOOK.md`
  - `docs/DATABASE_BACKUP_RESTORE_RUNBOOK.md`
  - `docs/STUDIO_REGRESSION_GUARDS.md`
  - `docs/PRODUCTION_READINESS_AUDIT.md`

## Nginx Gate

- [ ] Actual Nginx config path is known.
- [ ] Active `server_name` values match the approved domain list.
- [ ] Public traffic terminates at HTTPS and proxies to the approved app port.
- [ ] `proxy_set_header Host`, `X-Forwarded-Host`, `X-Forwarded-For`, and
  `X-Forwarded-Proto` are present.
- [ ] App upstream is loopback or a private host, not a wildcard public bind.
- [ ] Upload body limit is explicitly sized for the product. It must be at
  least the app video upload limit from `src/lib/upload-limits.ts` (`200m` by
  default) and must not silently undercut the app-level validation.
- [ ] Long request timeouts are reviewed, but smoke tests still avoid generation
  and provider paths.
- [ ] Static asset caching does not cache `/api/health/backend` or auth/session
  responses.
- [ ] Nginx access and error logs have known paths and logrotate.
- [ ] Nginx reload/restart is not performed by Codex in this preparation phase.

## HTTPS And Certificate Gate

- [ ] Certificate source is known.
- [ ] Certificate full-chain and key paths are known to the human operator.
- [ ] Certificate expiry date is checked by the human operator.
- [ ] Renewal mechanism is known.
- [ ] Renewal logs or timer status are known.
- [ ] HTTP to HTTPS redirect behavior is reviewed.
- [ ] HSTS is not enabled or changed unless rollback impact is explicitly
  approved.
- [ ] Private keys are never pasted into Codex or committed.

## DNS Gate

- [ ] Production domain list is approved.
- [ ] DNS provider and account owner are known.
- [ ] Current A/AAAA/CNAME records are confirmed by a human operator.
- [ ] TTL is reviewed before release.
- [ ] CDN, WAF, proxy, or tunnel involvement is explicitly documented.
- [ ] Raw 3106, NewAPI, PostgreSQL, and provider ports are not public entrypoints.

## Env Gate

- [ ] Production env location and file permissions are known.
- [ ] `.env.local` and `.runtime/production.env` handling is understood.
- [ ] Env review reports only variable names and configured/missing state.
- [ ] No secret, password, full DSN, token, cookie, Authorization header, or API
  key value is printed.
- [ ] `NODE_ENV=production` is set for the running service.
- [ ] `PORT=3106` is the production port.
- [ ] `DATA_DIR` and `UPLOADS_DIR` point to approved production paths.
- [ ] Production and staging storage paths do not overlap.
- [ ] `APP_DATABASE_URL` and `APP_DATABASE_EXPECTED_NAME` are either both
  production-approved or database-backed mode is not enabled.
- [ ] `APP_AUTH_PERSISTENCE_MODE`, `APP_BILLING_PERSISTENCE_MODE`, and
  `APP_TASK_BILLING_PERSISTENCE_MODE` are understood before release.
- [ ] `NEW_API_ENABLED`, `NEW_API_BASE_URL`, `NEW_API_ADMIN_USER_ID`, and
  `NEW_API_ADMIN_ACCESS_TOKEN` are reviewed without printing values.
- [ ] Provider env names are reviewed without printing values.

## Process Manager Gate

- [ ] The server uses exactly one primary service manager path.
- [ ] If systemd is used, the unit file path, user, working directory,
  environment file, restart policy, and journal/log policy are known.
- [ ] If PM2 is used, the ecosystem file, app name, interpreter, env file,
  startup integration, and log paths are known.
- [ ] systemd and PM2 do not both independently restart the same Node process.
- [ ] The actual 3106 command line is known to the human operator.
- [ ] No service restart is performed during this documentation phase.

## Logs And Rotation Gate

- [ ] App log path is known.
- [ ] Existing repo local production log path is `.runtime/3106-production.log`.
- [ ] Nginx access log path is known.
- [ ] Nginx error log path is known.
- [ ] PM2 or systemd journal retention is known.
- [ ] logrotate covers Nginx logs and app logs when file-based logs are used.
- [ ] Logs are checked for classes of sensitive findings only; do not paste
  secret values.
- [ ] Logs do not contain API keys, Authorization headers, cookies, prompts,
  base64 media, full DSNs, or upstream raw response bodies.

## Backup Gate

- [ ] Backup root is known and outside Git.
- [ ] Backup retention policy is known.
- [ ] Backup encryption or storage access policy is known.
- [ ] Backup job owner and schedule are known.
- [ ] Cron or timer config is reviewed by a human operator.
- [ ] Backup success/failure alerting is known.
- [ ] Restore owner is known.
- [ ] Restore rehearsal evidence exists or release is stopped.

## Database Backup Gate

- [ ] Codex does not connect to production DB.
- [ ] Codex does not connect to staging DB without later explicit authorization.
- [ ] Production DB identity is confirmed by a human operator without exposing
  the full DSN.
- [ ] Latest production DB backup timestamp is known.
- [ ] Latest production DB backup location is known to the operator.
- [ ] Backup checksum or manifest is recorded.
- [ ] `pg_restore --list` or equivalent readability verification is confirmed by
  the operator.
- [ ] Migration risk is reviewed and manually approved before any release that
  could change schema or persistence mode.
- [ ] Any need to run `npm run migrate`, `migrate:*`, `db:*`, or production DB
  scripts returns to total-control approval first.

## Uploads Backup Gate

- [ ] Codex does not read, import, move, or delete real uploads.
- [ ] Production uploads root is known to the operator.
- [ ] Latest uploads backup timestamp is known.
- [ ] Latest uploads backup location is known.
- [ ] File count and total size are known from an operator-owned check.
- [ ] Restore owner is known.
- [ ] DB backup and uploads backup are paired when DB rows reference file
  objects.
- [ ] Release stops if DB backup exists but matching uploads backup is missing.

## Disk And Inode Gate

- [ ] Root filesystem free space is above the approved threshold.
- [ ] Data filesystem free space is above the approved threshold.
- [ ] Uploads filesystem free space is above the approved threshold.
- [ ] Backup filesystem free space is above the approved threshold.
- [ ] inode usage is below the approved threshold.
- [ ] Growth rate for uploads, logs, and backups is understood.
- [ ] Alerting exists for low disk and inode exhaustion.

## Health Endpoint Gate

- [ ] `/api/health/backend` exists.
- [ ] Liveness semantics are documented.
- [ ] Readiness semantics are documented if used.
- [ ] Health output does not expose secrets, internal paths, full DSNs, or
  provider tokens.
- [ ] Health checks must not call generation, NewAPI generation, real provider
  submit, real uploads import, or paid paths.

## Provider-Safe Smoke Gate

- [ ] Smoke test allows only page loads, static assets, `/api/health/backend`,
  `/api/library`, and expected auth/admin redirects.
- [ ] Smoke test does not submit prompts.
- [ ] Smoke test does not upload files.
- [ ] Smoke test does not call NewAPI/provider/model endpoints.
- [ ] Smoke test does not call billing order creation or quota precheck.
- [ ] Smoke test does not delete library items.
- [ ] Smoke test does not read arbitrary real files from uploads.

## Rollback Gate

- [ ] Rollback owner is known.
- [ ] Rollback decision point is known.
- [ ] Rollback commit or package is explicit.
- [ ] Rollback backup set is explicit.
- [ ] Code-only versus full rollback decision rules are explicit.
- [ ] Full rollback includes matching DB, data, and uploads backup sets.
- [ ] Rollback verification uses provider-safe health and page checks only.
- [ ] Rollback does not run build/install while the live service is stopped.

## Stop Conditions

Stop and return to total-control approval if any item is true:

- 3106 current state, commit, or running mode is unclear.
- Latest production DB backup is not confirmed successful.
- Latest uploads backup is not confirmed successful.
- Rollback owner, path, or verification method is missing.
- Env is missing or contains unexplained variables.
- Nginx, HTTPS, or DNS is uncertain.
- Disk space or inode usage is below the approved threshold.
- Log rotation is missing.
- Health endpoint does not exist or has unclear semantics.
- Smoke test would trigger provider, NewAPI, cost, DB write, real upload import,
  or generation.
- Migration risk is not manually approved.
- Production or staging DB access is needed but not explicitly authorized.
- Someone asks Codex to operate 3106, restart, publish, merge PRs, print secrets,
  or perform server writes.
- Total-control approval has not explicitly moved the work from preparation to
  execution.
