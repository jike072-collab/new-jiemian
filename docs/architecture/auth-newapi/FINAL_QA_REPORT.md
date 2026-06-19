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

Latest report update: 2026-06-19.

Commit under test: `47b5b0022a90257474a6a77a9431331a5ac470fe`.

Remote infrastructure validation:

- `Application Database Migration` run `27820892552`: success.
- `Auth New API Final Gate` run `27820059999`: success.
- `Backend Security Release Gate` run `27820059992`: success.
- `New API Ops` run `27821058866`: success.

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

- `.env` is not present in this worktree; only `.env.example` exists.
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

Local runtime smoke against `next dev` on `127.0.0.1:3206`:

- Desktop `/` opened successfully.
- Desktop `/login` opened successfully.
- Mobile viewport `/` opened successfully.
- Login entry, image tool, and video tool were visible without layout crash.
- `GET /api/auth/csrf` returned a CSRF token and CSRF cookie.
- A browser-independent request without the CSRF cookie was rejected with `403`,
  confirming CSRF protection.
- A cookie-jar request registered a user and verified session plus session
  refresh.
- The same local runtime returned `mappingStatus=repair_required` for the new
  user because no application-level test New API binding was configured.
- `GET /api/quota` returned `409 mapping_pending` for that user because the
  New API mapping was not active.

Provider and billing smoke result:

- Real image Provider call: `BLOCKED`.
- Real video Provider call: `BLOCKED`.
- Successful task debit-once verification through the live API: `BLOCKED`.
- Duplicate generation request/provider dispatch verification through the live
  API: `BLOCKED`.

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

## Not Fully Exercised Locally

- Real third-party or approved test image/video Provider calls were not executed
  because no test Provider credentials are configured.
- Real New API container health, BFF checks, PostgreSQL migration, backup, and
  restore were executed in remote CI and New API Ops, not in this local runtime.
- Application readiness against both PostgreSQL and New API requires an approved
  test or release environment with `APP_DATABASE_URL` and `NEW_API_*` configured.
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

`BLOCKED` is caused by missing approved test Provider credentials and missing
application-level PostgreSQL/New API runtime configuration in this worktree. The
backend CI and infrastructure workflows are green, but the live provider,
readiness, and debit-once smoke requirements cannot be honestly marked as passed
without that environment.

`BLOCKED` is not a code regression finding by itself. It is a release evidence
gap that must be closed by running this same QA pass with:

- test PostgreSQL configured through `APP_DATABASE_URL`;
- test New API configured through `NEW_API_ENABLED=true`, `NEW_API_BASE_URL`,
  `NEW_API_ADMIN_USER_ID`, and `NEW_API_ADMIN_ACCESS_TOKEN`;
- approved test image and video Provider credentials;
- production payment still disabled unless a separate payment launch task
  explicitly approves it.
