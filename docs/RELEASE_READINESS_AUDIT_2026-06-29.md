# Release Readiness Audit - 2026-06-29

This record covers the 3107 short-test hardening, P0/P1 release gates, review
evidence, and 3106 integration performed before server/domain work.

## Scope

- Formal lane: `new-jiemian` in the local `p003` workspace.
- Formal branch: `docs/protected-deploy-runbook-3106`
- 3106 integration head before the final gate commit:
  `fa9d2e3de965e169a21f56dff5bb3a2ced651165`
- Staging lane: `new-jiemian-3107` in the local `p003` workspace.
- Staging branch: `codex/stage9e-s1-library-dual-write-observation`
- Staging head used as source:
  `bac2de2a07da32ad686e0e91ce70252be63c036a`

No real server deployment, production migration, domain setup, SSL setup, Nginx
change, or live provider generation call was performed in this audit.

## Integrated Changes

The following 3107 commits were cherry-picked into the 3106 formal branch:

- `18e573b` - Stage 9E-S1 library dual-write observation record.
- `343e4cd` - 3107 tunneltest security baseline.
- `43b00d1` - generation, upscale, provider, and quota hardening.
- `bac2de2` - deployment operations gate documentation and ops test coverage.

An additional local gate commit was prepared after review:

- Add `test:admin-api`, `test:quota-usage`, and `test:billing-sandbox`.
- Include those checks in `npm run check` so admin RBAC, quota settlement,
  refund/idempotency, and billing boundary tests are part of the release gate.

## Old Assessment Cross-check

The old DOCX assessment listed these P0 items. Current status after integration:

| Item | Status | Evidence |
| --- | --- | --- |
| Admin role gate | Covered by code and tests | `/admin/providers` checks `role === "admin"`; `/api/admin/*` routes use `adminResponse`; `npm run test:admin-api` passed. |
| 3106/3107 storage isolation | Covered | `npm run test:runtime-isolation` and `npm run check:release-test-artifact-isolation` passed. |
| User ownership for works/files | Covered | `npm run test:library-ownership` and database library integration tests passed. |
| Server-side generation validation | Covered for current release scope | `npm run check:studio-api-contracts`, `npm run test:quota-usage`, and generation/upscale route tests passed. |
| File path traversal | Covered | runtime path checks and library ownership tests passed. |
| Secret exposure in logs/bundles/responses | Covered for gate scope | `npm run test:log-redaction`, `npm run test:security-release`, provider health tests, and artifact cleanliness checks passed. |
| Failed generation quota handling | Covered for task billing scope | `npm run test:quota-usage` covers failure-before-settlement, refund-after-settlement, duplicate callbacks, and reconciliation states. |

P1 items handled in this pass where low risk:

- Provider diagnostics and error-code surfaces.
- Upscale provider readiness and fail-closed behavior.
- Short-test feedback copy block with request id, error code, and timestamp.
- Deployment preflight, artifact cleanliness, rollback drill, and ops gate.
- Admin, quota, and billing tests are now part of the aggregate release check.
- P1 minimal deploy-hardening now includes static abuse-guard contracts and a
  stale runtime `.tmp` cleanup dry-run/test. This is an audit and operations
  safety layer only: it does not change HTTP API request or response shapes,
  does not add Redis, a queue, or a global limiter, and does not modify the
  provider/NewAPI call chain.

P1/P2 items intentionally deferred because they require production infrastructure
or larger product design:

- Large distributed queue/Redis architecture.
- Full production monitoring/alerting stack.
- Provider secret encryption-at-rest migration.
- API key rotation workflow.
- Admin audit-log UI.
- Team sharing, mobile optimization, WebSocket progress, resumable uploads.

## Validation Run

All of the following passed on `docs/protected-deploy-runbook-3106` after
integration:

- `npm run test:library-ownership`
- `npm run test:upscale-auth-csrf`
- `npm run test:log-redaction`
- `npm run test:stage5-error-diagnostics`
- `npm run test:provider-health`
- `npm run check:studio-api-contracts`
- `npm run lint`
- `npm run typecheck`
- `npm run test:runtime-isolation`
- `npm run test:security-release`
- `npm run test:ops`
- `npm run test:rollback-drill`
- `npm run build`
- `npm run test:admin-api`
- `npm run test:quota-usage`
- `npm run test:billing-sandbox`
- `npm run check`
- `npm run release:preflight`

Known non-blocking noise:

- Node printed `DEP0190` warnings from existing child-process test paths.
- `test:ops` can print a non-fatal temporary-path module error while testing
  Windows paths with spaces and Chinese characters; the ops suites still exit 0.

## Production Readiness Audit Result

`npm run audit:production-readiness` is intentionally stricter than local tests.
It failed closed because the candidate branch is not `origin/main` yet and the
diff includes database/generation path changes that require protected release
approval. This is expected at this stage and is not a unit-test failure.

The audit also requires the currently running 3106/3107 services and target ref
to match the final release target. That final pass belongs after the candidate
is merged to the protected target and before a real server rollout.

## Repository Safety

Before the final commit/push:

- `git ls-files -o --exclude-standard` returned no untracked release artifacts.
- `git diff --check` passed.
- No `.env*`, runtime data, uploads, database files, rollback backups, logs,
  PID files, screenshots, videos, or generated media were intentionally added.
- Release artifact cleanliness and release test artifact isolation passed.

## Server/Domain Stage Gate

The project is allowed to proceed to the server/domain planning stage after this
branch is pushed, with these hard gates still required before public production:

- Merge or promote the approved release candidate to the protected production
  target expected by deploy scripts.
- Configure production env groups on the server and run `npm run release:preflight`.
- Produce a fresh verified backup for production `data`, `uploads`, and database.
- Run the final `npm run audit:production-readiness` against the exact target.
- Configure domain, SSL, and Nginx/reverse proxy.
- Run a small live smoke test for register/login/session, admin protection,
  provider config, generation/upscale failure diagnostics, and rollback readiness.
- The 3106 runtime, production env, HTTPS/Nginx, production database, and
  production uploads backup checks remain real deployment gates and were not
  completed or simulated by the P1 abuse-guard/temp-cleanup PR.
