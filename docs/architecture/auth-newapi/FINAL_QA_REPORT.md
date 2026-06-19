# Final QA Report

Date: 2026-06-19

Branch: `test/final-qa`

Base: `origin/develop`

Develop SHA at branch creation: `3d8ad9cb010727d08231f07930e2d3ddb8c29ff2`

PR #35 merge commit: `3d8ad9cb010727d08231f07930e2d3ddb8c29ff2`

Conclusion: `READY_FOR_RELEASE_CANDIDATE_REVIEW`

This report records the first final QA pass after AB-I02 was merged into
`develop`. It does not enable production payment and does not approve production
deployment without environment review.

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

Database migration and schema checks are expected to run in GitHub Actions on the
Draft PR because this workstation does not expose `APP_DATABASE_URL`.

## Not Fully Exercised Locally

- Real third-party image/video provider calls were not executed with production
  credentials.
- Real New API container health and BFF checks are expected in remote CI.
- PostgreSQL migration, backup, restore, and readiness require the CI database
  environment or approved release infrastructure.
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

Final QA first pass is ready for remote CI and human review.

`READY_FOR_RELEASE_CANDIDATE_REVIEW` is not the same as
`READY_FOR_PRODUCTION`; production release still requires approved environment
configuration, database credentials, New API runtime, backup/restore evidence,
and final operator sign-off.
