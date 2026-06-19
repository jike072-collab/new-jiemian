# Final QA Report

Date: 2026-06-19

Branch: `test/final-qa`

Base: `origin/develop`

Develop SHA at branch creation: `3d8ad9cb010727d08231f07930e2d3ddb8c29ff2`

PR #35 merge commit: `3d8ad9cb010727d08231f07930e2d3ddb8c29ff2`

Conclusion: `BLOCKED`

This report records the final QA passes after AB-I02 was merged into `develop`.
It does not enable production payment and does not approve production deployment
without environment review.

## Scope

- Real registration, login, logout, session refresh, and current user API.
- Real account data contracts for quota, usage, billing config, order list, and
  order detail.
- Image and video generation billing lifecycle, including server-side precheck,
  provider dispatch guard, settlement, failed/cancelled handling, and duplicate
  request protection.
- Sandbox billing order creation, webhook verification, idempotent credit, and
  reconciliation paths.
- Admin user, mapping, order, quota adjustment, task billing, and reconciliation
  API contracts.
- Database migration, server-only database boundary, backend readiness/liveness,
  release preflight, and client bundle database scan.
- Desktop and mobile HTTP page availability for `/` and `/login`.

## Automated Checks

Passed locally:

- `npm run typecheck`
- `npm run lint`
- `npm run build`
- `node scripts/test-auth-session.mjs`
- `node scripts/test-quota-usage.mjs`
- `node scripts/test-billing-sandbox.mjs`
- `node scripts/test-admin-api.mjs`
- `node scripts/test-new-api-bff.mjs`
- `node scripts/test-security-release.mjs`
- `node scripts/test-prompt-optimizer.mjs`
- `node scripts/test-provider-display-names.mjs`
- `node scripts/database/bundle-scan.mjs`
- `npm run database:boundary`
- `npm audit --audit-level=high`

The local build completed successfully with the existing Turbopack NFT warning
from `src/lib/server/local-upscale.ts`.

`npm audit --audit-level=high` reported `0` vulnerabilities.

## Runtime Smoke

Passed locally against `next dev` on `127.0.0.1` with JSON test persistence and
production payment disabled:

- Desktop HTTP GET `/`.
- Desktop HTTP GET `/login`.
- Mobile User-Agent HTTP GET `/`.
- Mobile User-Agent HTTP GET `/login`.
- `GET /api/auth/csrf`.
- `POST /api/auth/register`.
- `GET /api/auth/session`.
- `PATCH /api/auth/session`.
- `POST /api/auth/logout`.
- `GET /api/auth/session` returns `401` after logout.

## Covered Flows

Registration, login, logout, and session refresh are covered by both route-level
runtime smoke and auth service tests.

Quota, usage, insufficient quota handling, duplicate task callbacks, concurrent
settlement, failed task handling, cancelled task handling, provider adjustment
recovery, and reconciliation-required states are covered by quota tests.

Sandbox order creation, repeated create-order idempotency, same-amount new
operation creation, webhook signature and timestamp validation, duplicate and
concurrent webhook idempotency, tampering review, out-of-order review, credit
failure reconciliation, refund callback idempotency, order ownership checks,
pagination, and status filtering are covered by billing tests.

Admin user, order, mapping, quota adjustment, task billing, and reconciliation
query contracts are covered by admin API tests.

Database migration and schema checks ran in GitHub Actions on the Draft PR
because this workstation does not expose `APP_DATABASE_URL`.

## Final Provider And UI Smoke Validation

Latest report update: 2026-06-19, final production readiness attempt.

Commit under test before this report update:
`e223e6e816cd314583f3eaea45498af04e35dad8`.

Remote infrastructure validation:

- `Application Database Migration` run `27821976204`: success.
- `Auth New API Final Gate` run `27821889333`: success.
- `Backend Security Release Gate` run `27821889334`: success.
- `New API Ops` run `27821986939`: success.
- `CI` run `27821889379`: success.

The database migration run covered PostgreSQL schema, migrations `001` through
`004`, webhook status upgrade, schema and transaction tests, auth PostgreSQL
persistence, billing PostgreSQL persistence, database health, server-only
database boundary, typecheck, lint, build, client bundle database scan, secret
pattern scan, pull request diff scan, direct New API database access scan, and
the npm audit record.

The New API Ops run covered preflight, stack startup, healthcheck, test
administrator initialization and login, backup, upgrade check, rollback dry-run,
restore, bad backup rejection, and log redaction.

Local environment availability check:

- Root `.env` is not present in this worktree.
- Root `.env.local` is not present in this worktree.
- `infra/new-api/.env` exists for the isolated New API stack, but it is not an
  application runtime Provider or production configuration source.
- `APP_DATABASE_URL` is not present.
- `APP_DATABASE_EXPECTED_NAME` is not present.
- `NEW_API_ENABLED` is not present.
- `NEW_API_BASE_URL` is not present.
- `NEW_API_ADMIN_USER_ID` is not present.
- `NEW_API_ADMIN_ACCESS_TOKEN` is not present.
- `IMAGE_MODEL_API_KEY` is not present.
- `VIDEO_MODEL_API_KEY` is not present.
- `PAYMENT_PRODUCTION_ENABLED` is not present.
- `PAYMENT_PRODUCTION_WEBHOOK_SECRET` is not present.

Local checks rerun on 2026-06-19:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed with the existing Turbopack NFT warning from
  `src/lib/server/local-upscale.ts`.
- `node scripts/test-auth-session.mjs`: passed, 17 tests.
- `node scripts/test-quota-usage.mjs`: passed, 28 tests and 2 PostgreSQL-mode
  skips because this workstation has no application database DSN.
- `node scripts/test-billing-sandbox.mjs`: passed, 22 tests and 2
  PostgreSQL-mode skips because this workstation has no application database
  DSN.
- `node scripts/test-admin-api.mjs`: passed, 9 tests.
- `node scripts/test-new-api-bff.mjs`: passed, 31 tests.
- `node scripts/test-security-release.mjs`: passed, 9 tests.
- `node scripts/test-prompt-optimizer.mjs`: passed, 5 tests.
- `node scripts/test-provider-display-names.mjs`: passed, 3 tests.
- `node scripts/database/bundle-scan.mjs`: passed.
- `npm run database:boundary`: passed after stopping the temporary local dev
  server that was holding `.next/dev/types`.
- `npm audit --audit-level=high`: passed, `0` vulnerabilities.

Local runtime smoke against `next dev` on `127.0.0.1:3206`:

- Desktop `/` opened successfully.
- Desktop `/login` opened successfully.
- Mobile User-Agent HTTP GET `/` returned `200`.
- Mobile User-Agent HTTP GET `/login` returned `200`.
- Browser mobile viewport `/` opened successfully.
- Browser mobile viewport `/login` opened successfully.
- Login entry, image tool, video tool, account entry, order/use surfaces, and
  provider/admin links rendered without route crash.
- `GET /api/auth/csrf` returned a CSRF token and CSRF cookie.
- A browser-independent request without the CSRF cookie was rejected with `403`,
  confirming CSRF protection.
- A cookie-jar request registered a user and verified session plus session
  refresh.
- The same local runtime returned `mappingStatus=repair_required` for the new
  user because no application-level test New API binding was configured.
- `GET /api/quota` returned `409 mapping_pending` for that user because the
  New API mapping was not active.
- `GET /api/health/backend?mode=liveness` returned `200`.
- `GET /api/health/backend?mode=readiness` returned `503`, which is the
  expected fail-closed result for this missing application PostgreSQL and New
  API runtime configuration.

Provider and billing smoke result:

- Real image Provider call: `BLOCKED`.
- Real video Provider call: `BLOCKED`.
- Successful task debit-once verification through the live API: `BLOCKED`.
- Duplicate generation request/provider dispatch verification through the live
  API: `BLOCKED`.
- Failed live Provider task no-charge verification through the live API:
  `BLOCKED`.

Reason: this worktree has no configured test image Provider, test video
Provider, application PostgreSQL DSN, or application-level New API credentials.
The repository test suite covers the dispatch, settlement, concurrency, and
idempotency behavior, but this requested live smoke cannot be marked as passed
without a real or approved test Provider and active New API user mapping.

Application readiness result:

- Liveness and readiness behavior is covered by `Backend Security Release Gate`.
- Full application readiness against both PostgreSQL and New API is `BLOCKED`
  locally because `APP_DATABASE_URL` and `NEW_API_*` test configuration are not
  present in this worktree.
- The current missing-environment state is not a production readiness pass.

## Final Real Environment Validation Attempt

Attempt date: 2026-06-19.

Commit under test before this report update:
`ff7880a57fbcc77e69d67080147e048473bbb239`.

Remote validation already green on that commit:

- `Auth New API Final Gate` run `27829132979`: success.
- `Backend Security Release Gate` run `27829132906`: success.
- `CI` run `27829132934`: success.

Environment configuration probe:

- `APP_DATABASE_URL`: not provided.
- `APP_DATABASE_EXPECTED_NAME`: not provided.
- `APP_AUTH_PERSISTENCE_MODE`: not provided.
- `APP_BILLING_PERSISTENCE_MODE`: not provided.
- `TASK_BILLING_PERSISTENCE_MODE`: not provided.
- `NEW_API_ENABLED`: not provided.
- `NEW_API_BASE_URL`: not provided.
- `NEW_API_ADMIN_USER_ID`: not provided.
- `NEW_API_ADMIN_ACCESS_TOKEN`: not provided.
- `IMAGE_API_URL`: not provided.
- `IMAGE_MODEL`: not provided.
- `IMAGE_MODEL_API_KEY`: not provided.
- `VIDEO_API_URL`: not provided.
- `VIDEO_MODEL`: not provided.
- `VIDEO_MODEL_API_KEY`: not provided.
- `PAYMENT_PRODUCTION_ENABLED`: not provided.

Local Docker availability:

- `docker --version`: unavailable in this shell.
- `docker compose version`: unavailable in this shell.
- Because Docker is unavailable, this workstation cannot start an isolated local
  PostgreSQL/New API stack for this final validation attempt.

Result:

- Test PostgreSQL could not be configured from approved environment variables.
- Test New API could not be configured from approved environment variables.
- Test user mapping could not be activated against a real New API runtime.
- Test image Provider could not be configured from approved environment
  variables.
- Test video Provider could not be configured from approved environment
  variables.
- Real image generation: `BLOCKED`.
- Real video generation: `BLOCKED`.
- Live debit-once and duplicate-request Provider verification: `BLOCKED`.
- Live failed-task no-charge verification: `BLOCKED`.
- Application readiness passing both PostgreSQL and New API: `BLOCKED`.

This is an environment evidence gap, not a new code change. The report remains
blocked because the requested production readiness result requires approved test
runtime configuration and Provider credentials supplied through environment
variables.

## Provider Key Follow-Up Validation

Attempt date: 2026-06-19.

Commit under test before this report update:
`cf23b8f5a4d165807f0f4ec96407e920539d2516`.

The user reported that the model keys were configured on local port `3106`.
That instance was checked without printing secrets.

3106 findings:

- `/` returned `200`.
- `/login` returned `200`.
- `/api/providers/enabled` returned configured image and video providers.
- `/api/auth/csrf` returned `404`.
- `/api/auth/session` returned `404`.
- `/api/quota` returned `404`.
- `/api/billing/config` returned `404`.
- `/api/health/backend?mode=liveness` returned `404`.
- `/api/health/backend?mode=readiness` returned `404`.

Conclusion: port `3106` is not running the current Final QA backend surface, so
it cannot be used as the PR #37 release candidate for auth, quota, billing,
health, readiness, or production validation.

The local provider configuration used by port `3106` was found in another
worktree under `data/providers.json`. That ignored local runtime file was copied
into this worktree's ignored `data/providers.json` only for local validation and
was not committed.

Current PR #37 runtime on `127.0.0.1:3206` after copying the ignored provider
configuration:

- `/api/providers/enabled` returned configured image and video providers.
- The public provider response contained only frontend-safe fields: `id`,
  `model`, `displayName`, `capabilities`, and `enabled`.
- `/api/auth/csrf` returned `200`.
- `/api/health/backend?mode=liveness` returned `200`.
- `/api/health/backend?mode=readiness` returned `503`.
- Readiness failure details were safe and indicated `NEW_API_DISABLED` plus
  application database configuration failure.

Registration and quota probe on the current PR #37 runtime:

- `POST /api/auth/register` returned `202`.
- The new test user session was created.
- The user mapping status was `repair_required`.
- `GET /api/quota` returned `409 mapping_pending`.
- `POST /api/quota/precheck` did not produce an accepted quota precheck.

Result:

- Image/video Provider keys are now visible to the current PR #37 runtime via an
  ignored local runtime file.
- The release candidate is still blocked because application-level New API
  administration, active user mapping, and application PostgreSQL readiness are
  not configured for the current runtime.
- Real image generation remains `BLOCKED`.
- Real video generation remains `BLOCKED`.
- Debit-once and duplicate-request live Provider validation remain `BLOCKED`.
- The final conclusion remains `BLOCKED`.

## Strict PR #37 Environment Validation Attempt

Attempt date: 2026-06-19.

Commit under test before this report update:
`c0a2556da5c5c78699d69cbba6f2cb6fc3ac7ce3`.

Scope of this attempt:

- Use only the current PR #37 runtime, not the older `127.0.0.1:3106` instance.
- Configure test PostgreSQL, test New API, application persistence modes, and
  Provider keys only through uncommitted runtime configuration.
- Do not directly edit the New API database or local mapping tables.
- Use existing admin/session/mapping repair APIs only.

Environment probe:

- `NEW_API_ENABLED`: not provided.
- `NEW_API_ENVIRONMENT`: not provided.
- `NEW_API_BASE_URL`: not provided.
- `NEW_API_ADMIN_USER_ID`: not provided.
- `NEW_API_ADMIN_ACCESS_TOKEN`: not provided.
- `APP_DATABASE_URL`: not provided.
- `APP_DATABASE_EXPECTED_NAME`: not provided.
- `APP_AUTH_PERSISTENCE_MODE`: not provided.
- `APP_BILLING_PERSISTENCE_MODE`: not provided.
- `TASK_BILLING_PERSISTENCE_MODE`: not provided.
- `IMAGE_MODEL_API_KEY`: not provided through the process environment.
- `VIDEO_MODEL_API_KEY`: not provided through the process environment.
- `PAYMENT_PRODUCTION_ENABLED`: not provided.

Local runtime tooling probe:

- `docker`: not found in PATH.
- `docker.exe`: not found under the standard Docker Desktop install path.
- `docker compose`: unavailable.
- `psql.exe`: not found under standard PostgreSQL 14/15/16 install paths.
- Active checked listener: `127.0.0.1:3106`, explicitly rejected for this
  attempt because it is not the current Final QA backend surface.

Result:

- Step 1, start test PostgreSQL and New API: `BLOCKED`.
- Step 2, run application database migrations against test PostgreSQL:
  `BLOCKED`.
- Step 3, start current PR #37 app with release-like runtime configuration:
  `BLOCKED`.
- Step 4, readiness `200` for both PostgreSQL and New API: `BLOCKED`.
- Step 5-10, register or use a test user, repair mapping through admin API, and
  obtain active mapping plus quota precheck: `BLOCKED`.
- Final real image/video generation and debit idempotency validation:
  `BLOCKED`.

Failure stage: local runtime prerequisites for test PostgreSQL/New API are not
available to this shell, and the required application environment variables are
not provided. The previously configured Provider keys alone are not sufficient
for production readiness because current PR #37 requires an active local user to
New API mapping and successful quota precheck before provider dispatch.

## Mapped Provider Validation

Attempt date: 2026-06-19.

Commits under test:

- `65357df6527447d17681f0476ad8669a61d9527b`
- `ed9bcc79373174fae18de638eaa093207393f8d8`

Local uncommitted runtime configuration was used only for validation:

- Test PostgreSQL application database on localhost.
- Test New API runtime on localhost.
- `NEW_API_ENABLED=true`.
- Auth, billing, and task billing persistence modes set to PostgreSQL.
- Production payment disabled.
- Provider credentials loaded only from ignored local runtime files.

No token, database password, Provider key, or generated media URL is recorded in
this report.

Readiness and mapping:

- `GET /api/health/backend?mode=liveness`: `200`.
- `GET /api/health/backend?mode=readiness`: `200`.
- Readiness verified both application PostgreSQL and New API.
- Test user session returned `mappingStatus=active`.
- Test user's New API mapping resolved to an active New API user.
- `GET /api/quota`: `200`.
- `POST /api/quota/precheck`: accepted for video and image task attempts.

Fixes made during this validation:

- Production build PostgreSQL repository loading no longer depends on runtime
  relative `require()` paths.
- Default quota service uses PostgreSQL mapping and usage repositories in
  PostgreSQL task billing mode.
- Video job polling now derives `GET /v1/videos/{task_id}` for Grok-style
  asynchronous video endpoints as well as the previous
  `/v1/videos/generations` shape.
- New API quota adjustment now uses the real management endpoint
  `POST /api/user/manage` with `action=add_quota`, `mode=override`, and
  `value`, because this New API build returns success for the previous
  `PUT /api/user/` payload without changing quota.

Grok video validation:

- Provider: `grok-video-1.0` through the approved test Provider key.
- Request mode: text-to-video.
- Precheck estimated quota: `120`.
- Generation submit: success, asynchronous task accepted.
- Duplicate submit with the same local `taskId`: rejected before another
  Provider dispatch.
- Polling result: task reached `done`.
- Task billing state: `settled`.
- Usage state: `succeeded`.
- Actual quota units: `120`.
- New API quota before settlement: `1000`.
- New API quota after settlement: `880`.
- Result: video generation, duplicate-request protection, and debit-once
  validation passed.

Image validation:

- Original configured image endpoint returned Provider HTTP `524`.
- The test Provider key was then checked against
  `https://api.manxiaobai.online/v1/models`; it only returned
  `grok-video-1.0` and `grok-video-1.5`.
- A real image attempt against `gpt-image-2` returned
  `This token has no access to model gpt-image-2`.
- Duplicate image submit with the same local `taskId` was rejected before
  another Provider dispatch.
- Failed image usage was recorded with `actual_quota_units=0`.
- New API quota stayed at `880` after the failed image task.
- Result: image generation remains `BLOCKED` because the approved test key does
  not have an image model entitlement.

Local checks rerun after the fixes:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run build`: passed with the existing Turbopack NFT warning from
  `src/lib/server/local-upscale.ts`.
- `node scripts/test-new-api-bff.mjs`: passed, including the new
  `/api/user/manage` quota endpoint assertion.
- `node scripts/test-quota-usage.mjs`: passed.
- `node scripts/test-auth-session.mjs`: passed.
- `node scripts/test-billing-sandbox.mjs`: passed.
- `node scripts/test-admin-api.mjs`: passed.
- `node scripts/test-security-release.mjs`: passed.

Remote CI for `ed9bcc79373174fae18de638eaa093207393f8d8` started
automatically on PR #37:

- `Application Database Migration` run `27837120154`: in progress at report
  update time.
- `CI` run `27837120159`: in progress at report update time.
- `Backend Security Release Gate` run `27837120162`: in progress at report
  update time.
- `Auth New API Final Gate` run `27837120161`: queued/in progress at report
  update time.

Current conclusion after mapped Provider validation: `BLOCKED`.

Blocking item: an approved image Provider credential with access to an image
model is still required before production readiness can be honestly marked as
passed.

## Not Fully Exercised Locally

- Real approved video Provider execution was completed with Grok. Real approved
  image Provider execution remains blocked because the current test key has no
  image model entitlement.
- Real New API container health, BFF checks, PostgreSQL migration, backup, and
  restore were executed in remote CI and New API Ops, not in this local runtime.
- Application readiness against both PostgreSQL and New API passed in the local
  mapped validation runtime.
- Visual pixel QA was not performed; this pass only confirmed desktop/mobile
  core pages build and respond.

## Safety

- Production payment remains disabled.
- No real merchant keys were used.
- No production PostgreSQL write path was enabled locally.
- No secrets, `.env`, runtime data, uploads, build output, database files, or
  logs are committed by this report.
- The client bundle database scan passed.

## Release Status

Final QA remains blocked for production release.

`BLOCKED` is caused by the remaining image Provider entitlement gap. The local
mapped runtime now verifies PostgreSQL readiness, New API readiness, active user
mapping, Grok video execution, duplicate dispatch protection, and real New API
debit-once behavior. However, production readiness still requires one successful
approved image Provider call, and the current test key only exposes Grok video
models.

`BLOCKED` is not a code regression finding by itself. It is a release evidence
gap that must be closed by running this same QA pass with:

- test PostgreSQL configured through `APP_DATABASE_URL`;
- test New API configured through `NEW_API_ENABLED=true`, `NEW_API_BASE_URL`,
  `NEW_API_ADMIN_USER_ID`, and `NEW_API_ADMIN_ACCESS_TOKEN`;
- approved test image Provider credentials with access to an image model;
- production payment still disabled unless a separate payment launch task
  explicitly approves it.
