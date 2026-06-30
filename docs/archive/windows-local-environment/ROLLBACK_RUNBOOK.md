> Historical Windows-local rollback note. It does not apply to the current
> Ubuntu server deployment. The server runs only 3106; 3107 is local-only.

# Rollback Runbook

This runbook covers rollback material validation and rollback decision rules for the local 3106/3107 lanes.

## Current Preferred Clean Rollback Point

The preferred clean rollback backup from Stage 5.5 is:

```text
E:\codex工作台\p003\_rollback_backups\3106-production-20260627-014440
```

Expected source commit:

```text
32f4319d9dc16ca57c6383d40779b010bd7e75af
```

Expected database type:

```text
postgres
```

This backup is preferred because it was created from the clean pre-release production state.

The automatic deploy backup below is validatable but is not the preferred rollback target:

```text
E:\codex工作台\p003\_rollback_backups\3106-production-20260627-015414
```

Reason: it contains a snapshot taken after a pre-release test artifact had created `data/auth-store.json`. That artifact was later removed and the final production `data` checksum returned to the pre-release baseline.

Do not delete either backup during validation.

## Static Backup Validation

Before rollback, validate the chosen backup without restoring it:

1. Confirm the backup directory exists.
2. Confirm `backup-manifest.json` exists.
3. Confirm `checksums.json` exists.
4. Confirm `rollback-production.ps1` exists.
5. Verify checksum entries.
6. Confirm `sourceCommit`.
7. Confirm `databaseType`.
8. Record file count and total size.
9. Confirm the backup service is `production`.
10. Confirm the backup data and uploads snapshots match the intended rollback baseline.

This validation must not overwrite current `3106`, must not restore files, and must not delete backups.

## Rollback Modes

Rollback supports two modes:

- `code-only`: restore code and restart the service without restoring `data`, `uploads`, or database content.
- `full`: restore code, verified `data`, verified `uploads`, and database backup artifacts before restart.

Use `full` only when the incident affects data or when a release explicitly changed data and must be reverted.

## Dry-Run Or Static Verification

For a no-change check, use the repository backup validation helper from code or an equivalent read-only script. The check should call `verifyBackupManifest` and inspect `checksums.json`.

Do not run a rollback command unless rollback has been selected as the active recovery action.

## Rollback Execution Rules

When rollback is required:

1. Stop only the target service.
2. Do not touch the other lane.
3. Use only the selected backup directory.
4. Use the selected rollback commit.
5. For PostgreSQL full rollback, require the deployment-scoped rollback authorization file.
6. Activate prepared code artifacts only after preflight passes.
7. Restore `data` and `uploads` through temporary directories first.
8. Verify restored directories by relative path, size, and SHA-256 before replacing live directories.
9. Start the service.
10. Run health checks.
11. Keep previous live directories until service health passes.

Rollback must not run `npm ci`, `npm install`, or `npm run build` while the live service is stopped. Rollback code is prepared before stopping the live service.

## Post-Rollback Production Acceptance

After rollback, verify `3106`:

- PID changed only because rollback restarted production
- running commit equals the rollback commit
- `/` returns `200`
- `/login` returns `200`
- `/admin/providers` returns the current unauthenticated access design
- `/api/health/backend` returns `200`
- `/api/library` returns `200`
- `/api/admin/provider-health` is protected when unauthenticated
- watchdog returns `action=none`, `identity=owned`, and `ok=true`
- health reports `newApiCalled=false`
- production `data` snapshot matches the selected backup or the expected post-rollback baseline
- production `uploads` snapshot matches the selected backup or the expected post-rollback baseline

## Post-Rollback Staging Acceptance

After rollback, verify `3107`:

- PID did not change unless staging rollback was the explicit target
- running commit did not change unless staging rollback was the explicit target
- health endpoint still returns `200`
- `data-staging` snapshot did not change
- `uploads-staging` snapshot did not change
- staging did not read production `data`
- staging did not read production `uploads`

## NewAPI And Cost Safety

Rollback validation must not call:

- image generation
- image edit submit
- video generation
- image upscale
- video upscale
- NewAPI generation

Health and watchdog checks are safe endpoints only. A valid rollback report must state that no generation call, no NewAPI generation call, and no cost-producing request occurred.

## Log Review

Review the recent target service log after rollback. Report only classes of sensitive findings; never copy a secret.

Confirm no:

- `500`
- runtime exception loop
- database error
- provider configuration error
- API key leak
- Authorization header leak
- Cookie leak
- prompt or base64 leak
- upstream raw response body leak
- stack trace leak to user responses
- NewAPI generation call

## Test Artifacts

If `data/auth-store.json` appears in production after a test run, treat it as a release test artifact until proven otherwise.

Required response:

1. Identify which test wrote it.
2. Confirm whether it contains users, sessions, or audit-only test data.
3. Compare production `data` snapshot against the baseline.
4. Clean only the explicitly identified test artifact when approved by the active release procedure.
5. Strengthen the test so future runs use temporary `DATA_DIR` and `UPLOADS_DIR`.
6. Re-run `npm run check:release-test-artifact-isolation`.

Do not hide a test artifact in the report.

## Operator Responsibility

The user does not need to run technical rollback tests. The release operator must validate the backup, run the automated checks, execute rollback if required, and report the result.

Do not use user-run technical testing as a rollback gate or blocker.
