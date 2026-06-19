# BP-06 Security Release Baseline

Date: 2026-06-19

Branch: `feature/backend-production-06-security-release`

Base: `integration/auth-newapi` at `2154cbfa5471d0a10f421055139e8b9526c97d78`

Status: Implementation ready for PR validation.

## Scope

BP-06 hardens the backend release baseline without enabling production payment or modifying A-side pages.

Included:

- dependency audit remediation for safely upgradeable findings;
- backend release preflight checks for production configuration;
- backend health response with no secrets, URLs, or internal paths;
- npm audit, secret scan, tracked runtime file scan, Docker compose exposure scan, bundle scan, migration script, backup script, and restore script checks;
- CI workflow for the backend security release gate;
- smoke coverage for auth, quota, billing, task billing, and admin backend paths through existing test scripts.

Excluded:

- A-side workbench layout changes;
- formal admin UI;
- real merchant integration;
- production payment enablement;
- PR #17 merge into `develop`.

## Dependency Audit Result

Before BP-06, `npm audit --json` reported:

- total: 12
- high: 4
- moderate: 7
- low: 1
- critical: 0

BP-06 updates safely upgradeable dependencies:

- `next`: `16.2.1` -> `16.2.9`
- `eslint-config-next`: `16.2.1` -> `16.2.9`
- transitive packages updated by `npm audit fix`, including Babel, Hono, fast-uri, path-to-regexp, qs, js-yaml, ip-address, express-rate-limit, brace-expansion, nanoid, and PostCSS.
- `overrides.postcss=8.5.15` keeps transitive PostCSS on the patched line.

After remediation, `npm audit` reports:

- total: 0
- high: 0
- critical: 0

Verification command:

```bash
npm audit --json
```

## Release Checks

New command:

```bash
npm run security:release-check
```

The command fails on:

- high or critical npm audit findings;
- tracked runtime files such as `.env`, `.next`, `data/`, JSON runtime stores, or database files;
- common private-key, GitHub token, AWS key, and OpenAI-style secret patterns;
- PostgreSQL or Redis host port exposure in `infra/new-api/docker-compose.yml`;
- New API binding other than `127.0.0.1` in the isolated test deployment;
- missing backup, restore, rollback, migration, or auth migration scripts;
- production release config that lacks Session Secret, PostgreSQL identity, persistence modes, New API production config, or payment fail-closed guarantees.

New command:

```bash
npm run test:security-release
```

It verifies:

- production config fails closed when required settings are absent;
- explicit backend production config passes without leaking secrets in the report;
- production payment remains fail closed when env flags are set but no real provider is registered;
- backend health output does not include API tokens, database URLs, upstream URLs, or internal paths.

## Local Verification

Completed on 2026-06-19:

- `npm run test:security-release` passed 4 tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed on Next `16.2.9`.
- `node scripts/database/bundle-scan.mjs` passed after production build.
- `npm run security:release-check` passed with npm audit total/high/critical all `0`, server secret scan clean, tracked runtime file scan clean, and client bundle scan enabled.
- `node scripts/test-auth-session.mjs` passed 17 tests.
- `node scripts/test-quota-usage.mjs` passed 22 tests and skipped 2 PostgreSQL integration tests because this workstation has no PostgreSQL test URL.
- `node scripts/test-billing-sandbox.mjs` passed 21 tests and skipped 2 PostgreSQL integration tests because this workstation has no PostgreSQL test URL.
- `node scripts/test-admin-api.mjs` passed 9 tests.
- `node scripts/test-new-api-bff.mjs` passed 31 tests.
- `node scripts/test-provider-display-names.mjs` passed 3 tests.
- `npm run database:boundary` passed.
- `npm run test:auth-persistence` passed 5 tests and skipped 6 PostgreSQL integration tests because this workstation has no PostgreSQL test URL.

Local constraints:

- Docker is not available on this workstation, so `npm run security:release-check` used the static Docker Compose exposure fallback locally. GitHub Actions must run the workflow on an environment with Docker available before release approval.
- `npm run migrate:status` correctly failed closed locally with `APP_DATABASE_URL is required`; real migration, backup, and restore execution requires the configured PostgreSQL release environment.

## Health Endpoint

New endpoint:

```text
GET /api/health/backend
```

Response fields:

- `ok`
- `requestId`
- `service`
- `generatedAt`
- `checks.newApi.enabled`
- `checks.newApi.environment`
- `checks.productionPayment.enabled`

The response intentionally does not include:

- New API base URL;
- New API admin access token;
- database URL;
- payment webhook secret;
- session secret;
- internal filesystem paths.

## Production Configuration Policy

Production release must explicitly configure:

- `AUTH_SESSION_SECRET` or `SESSION_SECRET`;
- `APP_DATABASE_URL`;
- `APP_DATABASE_EXPECTED_NAME`;
- `APP_AUTH_PERSISTENCE_MODE=postgres`;
- `APP_BILLING_PERSISTENCE_MODE=postgres`;
- `APP_TASK_BILLING_PERSISTENCE_MODE=postgres`;
- `NEW_API_ENABLED=true`;
- `NEW_API_ENVIRONMENT=production`;
- `NEW_API_BASE_URL`;
- `NEW_API_ADMIN_USER_ID`;
- `NEW_API_ADMIN_ACCESS_TOKEN`.

Production payment remains disabled unless all are true:

- `PAYMENT_PRODUCTION_ENABLED=true`;
- non-empty production webhook secret;
- a real production payment provider is registered in server code;
- a separate production payment launch task approves merchant credentials and reconciliation policy.

BP-06 does not register a real provider and does not enable production payment.

## Remaining Production Risks

- PostgreSQL and Redis images in `infra/new-api/docker-compose.yml` are still tag-pinned, not digest-pinned.
- Real production deployment still needs an approved environment file, TLS reverse proxy configuration, backup encryption/retention policy, and operational runbook rehearsal.
- New API production credentials must be created, stored, rotated, and audited outside Git.
- GitHub Actions PR validation must complete on the pushed BP-06 branch before merge.
- A/B merge to `develop` remains controlled by PR #17 review and is not performed by BP-06.

## Conclusion

BP-06 conclusion: `READY_FOR_SECURITY_RELEASE_PR_REVIEW`

This does not mean `READY_FOR_PRODUCTION`; production release still requires environment approval, infrastructure hardening, and manual review.
