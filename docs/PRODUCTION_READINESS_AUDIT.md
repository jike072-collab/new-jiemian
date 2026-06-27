# Production Readiness Audit

Stage 7 is a read-only production release audit for the 3106 lane. It does not
publish, stop, restart, or modify 3106. It records evidence, compares the current
production commit with the intended `main` commit, checks rollback material, and
audits the protected production deploy path before any release authorization.

## Lane Roles

- 3106 is production. It must keep using the production root, `data`, and
  `uploads`.
- 3107 is staging. It must keep using the staging root, `data-staging`, and
  `uploads-staging`.
- Stage 7 may add audit scripts and documentation, but it must not change
  business behavior, API contracts, request fields, response shapes, schema, or
  runtime storage layout.

## Why This Stage Does Not Release 3106

The production service is still running the pre-release baseline while `main`
contains release hardening changes. Before any production rollout, the operator
must prove the target is known, staging has passed, rollback material exists,
data and uploads are stable, and the deploy script has the expected protections.
That evidence is produced without touching the 3106 process or data.

## Required Pre-Release State

- `origin/main` must equal the intended release commit.
- 3106 must still run the recorded baseline commit.
- 3107 must run the intended release commit before production release approval.
- 3106 and 3107 roots, data directories, and uploads directories must be
  separated.
- Health, library, login, admin protection, and provider-health protection must
  respond without 500s.
- Recent logs must not show exception loops, secret leaks, generation calls, or
  NewAPI generation calls.

## Diff Audit

The audit compares the current 3106 commit with the intended `main` commit using:

```powershell
git log --oneline <3106-commit>..<main-commit>
git diff --stat <3106-commit>..<main-commit>
git diff --name-status <3106-commit>..<main-commit>
```

The report classifies files into Stage 3 regression guards, Stage 4 provider
health, release artifact cleanliness, Stage 5 diagnostics, ops tests, release
test artifact isolation, Stage 6 release hardening, documentation, and other
changes. Business API, request/response, database, data/uploads, provider config,
startup/deploy/rollback, and generation-path changes are called out separately.

Database schema changes or generation-path changes are production blockers until
they receive explicit release approval and a migration or rollback plan.

## Rollback Material

Rollback material is usable only when all of these are true:

- backup directory is readable
- `backup-manifest.json` exists
- `checksums.json` exists
- rollback script exists
- checksum verification passes
- manifest service is production
- source commit and data/uploads snapshots match the intended rollback point

The preferred rollback material should be used for planning. Non-preferred
material can be recorded for audit, but it must not silently replace the
preferred rollback point.

## Deploy Command Protection

The protected production command is:

```powershell
npm run deploy:production -- --target <origin-main-merge-commit>
```

The audit checks the source path only. It must confirm that production deploys:

- require an explicit `--target`
- reject targets that do not match `origin/main`
- reject a dirty worktree
- record PID and commit before release
- validate the target before stopping the old process
- create and verify backups
- run release preflight
- provide rollback recovery
- use scratch data/uploads for candidate validation
- prevent staging data from entering production

The audit must not run a real production deploy.

## NewAPI And Generation Safety

Stage 7 safe checks use only GET requests for page, health, library, provider
health protection, and preview routes. The audit refuses generation-like routes:

- `/api/generate/*`
- `/api/upscale/image`
- `/api/upscale/video`
- `/api/prompts/optimize`
- `/api/quota/precheck`
- NewAPI generation endpoints

The report states whether any generation endpoint, NewAPI generation endpoint,
or cost-producing request was called.

## Data And Upload Evidence

Directory snapshots use the same stable algorithm as release backups:

- sorted files
- relative file path
- file content SHA-256
- file size
- no directory mtime

The audit records count, total size, and SHA-256 for production `data` and
`uploads`, plus staging `data-staging` and `uploads-staging`. A release must not
proceed if these values change unexpectedly.

## Blockers

Do not release 3106 when any of these is true:

- 3106 PID, commit, data, or uploads changed during the audit
- 3106 process identity is not owned
- `origin/main` is not the intended commit
- rollback material is missing or invalid
- deploy source protections are missing
- tracked files include environment files, secrets, runtime state, data/uploads,
  logs, PID files, dumps, or test artifacts
- recent production logs indicate secret leakage, generation calls, or NewAPI
  generation calls
- the diff includes unplanned database schema, data/uploads, or generation-path
  changes
- any safe HTTP route returns 500 or clear runtime error markup

## Requires Explicit User Authorization

Even when Stage 7 passes, publishing 3106 still requires explicit user
authorization. Approval is also required before creating production backups,
restarting 3106, restoring rollback material, applying migrations, or performing
any production data operation.

## Command

Run the read-only audit with:

```powershell
npm run audit:production-readiness
```

By default the script audits `origin/main` against the currently running 3106
runtime commit. To pin an audit to an explicit release target or baseline:

```powershell
node scripts/audit-production-readiness.mjs --target origin/main --production-baseline <3106-commit>
```

For machine-readable output:

```powershell
node scripts/audit-production-readiness.mjs --json
```

The JSON output is masked and must not include secret values.
