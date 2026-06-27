# Production Release Runbook

This runbook covers the local production lane after Stage 5.5.

## Lanes

- `3106` is production. It uses `DATA_DIR=<production-root>/data` and `UPLOADS_DIR=<production-root>/uploads`.
- `3107` is staging. It uses `DATA_DIR=<staging-root>/data-staging` and `UPLOADS_DIR=<staging-root>/uploads-staging`.
- Staging data must never be copied into production.
- Production data must never be copied into staging unless a separate approved data-seeding task says so.

Current production root:

```text
E:\codex工作台\p003\new-jiemian
```

Current staging root:

```text
E:\codex工作台\p003\new-jiemian-3107
```

## Release Preconditions

Before a production release:

1. Confirm the PR has been merged to `main`.
2. Confirm `origin/main` is the intended release commit.
3. Confirm the target commit is explicit, not implicit.
4. Confirm the production worktree is clean.
5. Confirm `.env`, `.env.local`, `data`, `uploads`, `.runtime`, logs, PID files, backups, screenshots, videos, and test artifacts are not tracked by Git.
6. Confirm `3107` has already run the target code and passed the acceptance checks.
7. Record production PID, commit, command line, `data` snapshot, and `uploads` snapshot.
8. Record staging PID, commit, `data-staging` snapshot, and `uploads-staging` snapshot.

Use a stable directory snapshot for data checks:

- sorted file list
- relative file path
- file content SHA-256
- file size
- no directory mtime in the hash

## Protected Production Deploy

Production deploys must use the protected script:

```powershell
npm run deploy:production -- --target <origin-main-merge-commit>
```

The script must:

- require an explicit `--target`
- fetch `origin`
- resolve the target commit
- reject production deploy when target does not match `origin/main`
- reject a dirty worktree
- run production validation before stopping the old process
- create a backup
- verify the backup manifest and checksums
- write rollback material
- activate the immutable release artifact
- restart only `3106`
- run service preflight and health checks
- avoid image generation, image edit, video generation, upscale, and NewAPI generation calls

Do not deploy production with:

```powershell
npm run deploy:production
```

## Automated Checks

The release gate should include:

```powershell
npm ci
npm run lint
npm run typecheck
npm run test:runtime-isolation
npm run check:runtime-paths
npm run test:security-release
npm run test:staging-smoke
npm run test:stage2-ui-acceptance
npm run test:stage3-studio-regression
npm run check:studio-api-contracts
npm run test:stage4-provider-health
npm run test:release-artifact-cleanliness
npm run test:stage5-error-diagnostics
npm run test:ops
npm run check:release-test-artifact-isolation
npm run build
npm run check
git diff --check
```

`npm run check` must include `check:release-test-artifact-isolation`.

CI must run the release test artifact isolation check in both `quality` and `windows-quality`.

## HTTP Acceptance

After deploying only the intended target service, verify:

- `/` returns `200`
- `/login` returns `200`
- `/admin/providers` returns the current unauthenticated access design, normally a redirect or auth failure
- `/api/health/backend` returns `200`
- `/api/library` returns `200`
- `/api/admin/provider-health` is protected when unauthenticated
- all Studio preview/tool routes return `200`
- watchdog returns `action=none`, `identity=owned`, and `ok=true`
- health reports `newApiCalled=false`

These checks must not call generation endpoints or NewAPI generation endpoints.

## Data And Upload Acceptance

After release:

1. Recompute the production `data` snapshot.
2. Recompute the production `uploads` snapshot.
3. Confirm the snapshots match the pre-release baseline unless the release explicitly included an approved data migration.
4. Confirm `3107` `data-staging` and `uploads-staging` are unchanged.
5. Confirm `data/auth-store.json` was not created by release tests in production.

Stage 5.5 baseline:

```text
data sha256: aa788abb2067d9cab1a6996c00e58b172865a589a9a608c0b5ab963d5e69ac1c
uploads sha256: db55e210ea69bfeb4a0a0685f80b46ee134c0be6739f03dc6cfdda39c907924e
```

## Test Artifact Isolation

Tests that need runtime persistence must use temporary `DATA_DIR` and `UPLOADS_DIR`.

Required safeguards:

- `test:stage4-provider-health` uses a temporary runtime root.
- `test:stage5-error-diagnostics` uses a temporary runtime root.
- ops tests use temporary project roots.
- release preflight writes compile output under the system temp directory.
- temporary roots are deleted at the end of each script.
- production `data/auth-store.json` is treated as a test artifact unless an approved data task says otherwise.

Run:

```powershell
npm run check:release-test-artifact-isolation
```

## Logs And Cost Safety

Log review must confirm no:

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
- real generation task trigger

Safe health, watchdog, staging smoke, and stage tests must not call generation APIs.

## When To Roll Back Immediately

Prepare rollback before doing any business fix when:

- production health fails after deploy
- production watchdog is not `owned`
- production data or uploads checksum changes unexpectedly
- a secret appears in logs or user-facing diagnostics
- a generation endpoint or NewAPI generation endpoint is called by a release check
- `3107` data is copied into `3106`
- `3106` data is copied into `3107`
- the active release commit is not the intended target

Rollback verification is documented in `docs/ROLLBACK_RUNBOOK.md`.

## Operator Responsibility

The user does not need to run technical tests. The release operator must run and report automated checks, 3107 validation, production release checks, and rollback material validation.

Do not use user-run technical testing as a release gate or blocker.
