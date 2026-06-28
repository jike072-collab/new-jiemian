# Stage 9G-6 3107 Manual Regression Script

Stage 9G-6 is a planning-only manual regression script for safe human verification on `3107`.

This stage does not enable formal Batch C implementation, does not enable dual-write, does not switch the DB read path, does not change feature flags, does not run migration, does not write business DB state, does not call a real provider, does not call NewAPI, does not trigger real generation, does not read or import real uploads, and does not touch 3106.

## Hard Boundary

The following are not authorized by this script:

- no formal Batch C implementation
- no dual-write enablement
- no DB read-path switch
- no feature-flag change
- no rollback execution
- no migration
- no provider call
- no NewAPI call
- no generation submit
- no upscale submit
- no quota-consuming smoke test
- no library delete unless separately authorized
- no 3106 operation

This document defines a safe manual-check sequence only.

## Goal

The goal of Stage 9G-6 is to give the user a compact, repeatable `3107` manual regression script that:

1. verifies core safe routes and protected-route behavior
2. confirms the service remains healthy
3. confirms `newApiCalled=false`
4. confirms no real generation path was touched
5. marks which actions require separate authorization before they may be tested

## Preconditions

Before running any manual regression step:

1. target must be `3107`, not `3106`
2. staging service must already be running and healthy
3. current worktree and runtime commit should be recorded
4. no production DB signal may be present
5. no provider test, no generation submit, and no real upload import may be mixed into this checklist

Recommended preflight commands:

```bash
npm run service:status
npm run service:health -- staging --repeat 1
```

Expected safe baseline:

- service is listening on `3107`
- `/api/health/backend` returns `200`
- `/` returns a non-500 status
- `/login` returns a non-500 status
- `/api/library` returns `200`
- `/admin/providers` returns the current protected-route status pattern
- `newApiCalled=false`

## Safe Regression Scope

This script covers only safe, no-provider, no-generation checks.

### Included

- home page reachability
- login page reachability
- session probe behavior
- library page and library API read behavior
- protected admin route behavior
- files route access-boundary spot checks
- health and watchdog read-only checks
- invalid-parameter and forbidden-path assertions that stop before provider dispatch

### Excluded

- real generation
- real upscale
- prompt optimization calls
- billing mutation
- feature flag change
- rollback execution
- provider configuration mutation
- library deletion

## Test Accounts And Access Levels

The script distinguishes between three access levels.

### Level A: Anonymous Safe Checks

May run without any user account:

- `/`
- `/login`
- `/api/health/backend`
- `/api/library`
- `/admin/providers` protected-route behavior only
- `service:status`
- `service:health -- staging`

### Level B: Authenticated Non-Admin Checks

Require a reviewed test account and session:

- `GET /api/auth/session`
- login flow verification
- post-login app shell/session presence
- non-admin behavior around protected admin route redirect or denial

### Level C: Admin-Session Protected Checks

Require separate authorization and a reviewed admin session:

- positive-path `/admin/providers` behavior
- protected read-only admin diagnostics such as `/api/admin/provider-health`

These checks must still stay read-only and must not mutate provider config.

## Step 1: Record Service And Runtime Baseline

Collect before doing page checks:

```bash
npm run service:status
npm run service:health -- staging --repeat 1
```

Record:

- current branch
- worktree commit
- runtime commit
- service PID
- port
- health result
- `newApiCalled=false`

Stop immediately if:

- service is unhealthy
- port is not `3107`
- runtime root is not the expected `new-jiemian-3107` workspace
- `newApiCalled` is not false

## Step 2: Anonymous Route Baseline

Open and verify these safe paths manually in the browser:

1. `/`
2. `/login`
3. `/api/health/backend`
4. `/api/library`
5. `/admin/providers`

Expected outcomes:

- `/` renders and does not return 500
- `/login` renders and does not return 500
- `/api/health/backend` returns `200`
- `/api/library` returns `200`
- `/admin/providers` returns the current unauthenticated protected-route behavior, usually redirect or auth failure, but not an unexpected 500

Supporting repo evidence:

- `scripts/ops/health-check.mjs`
- `scripts/test-stage2-ui-acceptance.mjs`
- `scripts/test-stage3-studio-regression.mjs`
- `docs/STUDIO_REGRESSION_GUARDS.md`

## Step 3: Login Flow Check

Use a staging-safe test account only.

### Manual Path

1. open `/login`
2. submit valid reviewed staging credentials
3. confirm the app reaches the post-login experience without a 500
4. confirm session-dependent UI appears as expected

### API Path

Optional safe confirmation:

- `GET /api/auth/session`

Expected outcomes:

- login succeeds for valid test credentials
- session probe resolves without leaking secrets
- no provider or generation call occurs

Supporting repo evidence:

- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/session/route.ts`
- `src/components/customer-login.tsx`
- `src/components/studio-app.tsx`

## Step 4: Library Read Path Check

Verify the library read path only.

Manual targets:

1. load the library surface in the app
2. confirm the library fetch succeeds
3. confirm items, empty state, or safe fallback render normally

Expected outcomes:

- `/api/library` remains readable
- no delete happens
- no provider call happens
- no `newApiCalled` signal appears

Do not perform:

- `DELETE /api/library`

That action is a real mutation and requires separate authorization.

Supporting repo evidence:

- `src/app/api/library/route.ts`
- `src/components/studio-app.tsx`
- `scripts/check-studio-api-contracts.mjs`

## Step 5: Admin Route Protection Check

This step is about protection behavior first, not admin mutation.

### Anonymous Or Non-Admin Path

Check:

- open `/admin/providers`

Expected outcomes:

- redirect
- auth failure
- or protected-route denial consistent with current design

Unexpected outcomes:

- 500
- unguarded provider configuration access

### Admin Positive Path

Only if separately authorized and a reviewed admin session is available:

- open `/admin/providers`
- confirm the page renders
- do not save provider config
- do not run any mutating admin action

Supporting repo evidence:

- `src/app/admin/providers/page.tsx`
- `src/app/api/admin/providers/route.ts`
- `scripts/test-stage2-ui-acceptance.mjs`
- `scripts/audit-production-readiness.mjs`

## Step 6: Files Access Boundary Check

This step is intentionally limited because the current repo still has ownership-guard follow-up work.

Allowed checks:

1. confirm existing library items still point to `/api/files/<storedName>` style URLs
2. confirm obviously malformed path attempts are rejected by path safety
3. confirm no arbitrary local-path read is possible through the file route

Do not attempt:

- cross-user retrieval experiments against real user files
- any real upload import
- any destructive file operation

Current caution:

- path traversal protection exists
- ownership/access guard work is still part of the broader security backlog

Supporting repo evidence:

- `src/app/api/files/[name]/route.ts`
- `src/lib/server/library.ts`
- `src/lib/server/database/library-jobs-adapter.ts`
- `docs/STAGE9F_P0_SECURITY_BASELINE_AUDIT.md`

## Step 7: Invalid Generation Parameter Guard Check

Only verify safe negative paths that stop before provider dispatch.

Examples of acceptable checks:

- missing required UI fields keep submit disabled
- unsupported route or invalid local form state shows validation error
- safe diagnostics tests pass without touching provider endpoints

Recommended supporting commands:

```bash
npm run check:studio-api-contracts
npm run test:stage3-studio-regression -- --skip-runtime
npm run test:stage5-error-diagnostics
```

Expected outcomes:

- validation blocks bad local state
- diagnostic surfaces stay consistent
- no generation endpoint is called
- `newApiCalled=false`

Do not do:

- `POST /api/generate/image`
- `POST /api/generate/video`
- `POST /api/upscale/image`
- `POST /api/upscale/video`
- `POST /api/prompts/optimize`

## Step 8: Billing Failure Mock Or No-Provider Safety Check

This step is documentation and test-assisted only.

Allowed:

- read existing diagnostics and provider-health tests
- run no-provider local checks that already prove safe routes do not dispatch

Recommended supporting commands:

```bash
npm run test:provider-health
npm run test:stage4-provider-health
npm run test:ops
```

Expected outcomes:

- provider health stays read-only
- admin diagnostics remain protected
- no generation payload is submitted
- `newApiCalled=false`

Not allowed here:

- any live provider generation smoke
- any paid or quota-consuming path

## Step 9: Health And Watchdog Read-Only Confirmation

This step stays read-only.

Recommended commands:

```bash
npm run service:status
npm run service:health -- staging --repeat 3
```

Optional read-only watchdog evidence:

- inspect the configured watchdog task or prior status evidence
- do not intentionally break health to force a watchdog restart

Important caution:

- `watchdog-service.mjs` can start or restart a service in failure cases
- because this script is intended as safe manual regression, do not run an action that is expected to mutate service state unless separately authorized

Expected outcomes:

- service remains healthy
- no restart is triggered by this script
- `newApiCalled=false`

## Step 10: 3106 Forbidden Touch Check

The operator must explicitly confirm:

- no browser step was run against `3106`
- no ops command targeted `3106`
- no runtime, data, uploads, or service metadata under `3106` was changed

This is a hard go/no-go boundary.

## Go / No-Go Table

### Go

- `3107` service healthy
- `/api/health/backend` returns `200`
- `/api/library` returns `200`
- `/admin/providers` shows expected protected behavior
- login/session checks behave as expected for the chosen access level
- file route remains within path-safety expectations
- no generation endpoint is called
- `newApiCalled=false`
- no 3106 touch

### No-Go

- any provider or NewAPI call occurs
- any generation or upscale submit occurs
- any library delete occurs
- unexpected admin write path is triggered
- unexpected 500 on safe baseline routes
- service health degrades during the regression
- any step drifts toward Batch C implementation or runtime mutation

## Separate Authorization Required

Separate user authorization is required for:

- any admin positive-path check using a real admin session
- any provider-health route access beyond the documented safe read-only scope
- any provider-config save action
- any `DELETE /api/library`
- any generation or upscale submit
- any prompt-optimization request
- any billing mutation path
- any watchdog action expected to restart or start the service
- any 3106-related verification

## Recommended Command Bundle

The following command bundle is safe to reuse as baseline evidence:

```bash
npm run service:status
npm run service:health -- staging --repeat 1
npm run check:studio-api-contracts
npm run test:stage3-studio-regression -- --skip-runtime
npm run test:stage5-error-diagnostics
npm run test:provider-health
```

This bundle is useful because it stays inside safe, no-provider, no-generation coverage.

## Evidence Checklist

Capture:

1. worktree branch and commit
2. runtime commit
3. `service:status` summary
4. `service:health` summary
5. browser outcomes for `/`, `/login`, `/api/health/backend`, `/api/library`, `/admin/providers`
6. session-check outcome if an authenticated test account is used
7. files-route boundary note
8. `newApiCalled=false`
9. explicit note that no generation/provider path was touched
10. explicit note that 3106 was untouched

## Evidence Sources

Primary repo evidence:

- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/session/route.ts`
- `src/app/api/library/route.ts`
- `src/app/api/files/[name]/route.ts`
- `src/app/admin/providers/page.tsx`
- `src/app/api/admin/providers/route.ts`
- `src/app/api/admin/provider-health/route.ts`
- `src/app/api/health/backend/route.ts`
- `src/components/customer-login.tsx`
- `src/components/studio-app.tsx`
- `src/lib/server/library.ts`
- `src/lib/server/database/library-jobs-adapter.ts`
- `scripts/ops/service-status.mjs`
- `scripts/ops/health-check.mjs`
- `scripts/ops/watchdog-service.mjs`
- `scripts/test-stage2-ui-acceptance.mjs`
- `scripts/test-stage3-studio-regression.mjs`
- `scripts/test-stage4-provider-health.mjs`
- `scripts/test-stage8a-provider-health.mjs`
- `scripts/test-stage5-error-diagnostics.mjs`
- `scripts/test-ops-service.mjs`
- `docs/STUDIO_REGRESSION_GUARDS.md`
- `docs/STAGE9F_P0_SECURITY_BASELINE_AUDIT.md`

## Outcome

Stage 9G-6 provides a safe manual regression script for `3107` that emphasizes health, protection behavior, and no-provider evidence.

It does not authorize formal Batch C implementation, does not authorize generation submissions, and does not authorize any mutation on `3106`.
