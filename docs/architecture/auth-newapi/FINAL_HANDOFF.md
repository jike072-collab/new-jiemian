# Final Handoff

## Scope

Parallel line B delivers the backend foundation for project accounts, secure sessions, New API mapping, quota/usage reads, sandbox recharge orders, and operational New API test infrastructure.

This handoff does not deliver final login/register UI, account center UI, admin visual pages, Workbench billing integration, production payment, or a merge into `develop`.

## Current Integration State

| Area | Status | Notes |
| --- | --- | --- |
| Git line B | Ready for final draft review | B01 through B11 are merged into `integration/auth-newapi`; B12 adds final handoff and validation. |
| New API test stack | Validated remotely, blocked locally by missing Docker | Remote Docker workflows validated startup, health, backup, restore, login, BFF real calls, and bundle leak checks. |
| BFF client | Implemented | Server-only client, timeout, retry, JSON guards, response size limit, redaction, admin/user/health contexts. |
| User mapping | Implemented | Local account maps to New API user; mapping states are `pending`, `active`, `failed`, `disabled`, `orphaned`, `repair_required`. |
| Auth backend | Implemented | Real local accounts, password hashing, HttpOnly session, CSRF, logout, refresh, rate limit, audit redaction. |
| Quota and usage | Implemented | New API quota is the only cloud quota ledger; local usage records are audit records only. |
| Billing sandbox | Implemented | Sandbox-only orders, HMAC webhook, replay check, idempotent New API quota credit, review and reconciliation. |
| Final UI | Not implemented | Main line A owns visual pages and shared UI. |
| Production payment | Not enabled | B11 and B12 keep payment sandbox-only. |

## Truth Sources

| Domain | Truth source |
| --- | --- |
| User identity | Project local account store. |
| Session | Project HttpOnly session store. |
| User unique ID | `local_user_id`. |
| New API linkage | `local_user_id` to `new_api_user_id` mapping. |
| Cloud quota | New API user quota and used quota. |
| Usage logs | Local audit log for product tasks plus read-only New API logs. |
| Payment orders | Project billing order store. |
| Admin permission | Future project admin role from B09 account model, not New API browser session. |

There must not be a second mutable balance ledger or a second session truth source.

## API Surface

| Area | Routes |
| --- | --- |
| Auth | `GET /api/auth/csrf`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/session`, `PATCH /api/auth/session` |
| Quota | `GET /api/quota`, `POST /api/quota/precheck` |
| Usage | `GET /api/usage` |
| Billing sandbox | `GET /api/billing/config`, `POST /api/billing/orders`, `GET /api/billing/orders/[id]`, `POST /api/billing/webhooks/sandbox` |

Future pages must use the documented stable UI states and error codes. They must not parse raw New API responses.

## Security Summary

- Browser never receives New API admin token, webhook secret, provider key, password hash, or long-lived server token.
- Session cookie is HttpOnly; production uses Secure; SameSite and Path are explicit.
- CSRF is required for auth, session refresh, quota precheck, and order creation.
- Webhook secret must be non-empty before sandbox webhook accepts callbacks.
- New API database and Redis are not mapped to host ports in the compose file.
- New API image is pinned by tag and digest; `latest` is not used.
- Runtime `.env`, backups, database files, and `data/` are ignored by Git.
- B12 local secret scan found only placeholders, tests, or redaction code; no real credential value was identified.

## Verification Summary

Local B12 verification:

- `npm ci` completed; existing audit result remains 12 vulnerabilities.
- `node scripts/test-new-api-bff.mjs` passed 31 tests.
- `node scripts/test-auth-session.mjs` passed 17 tests.
- `node scripts/test-quota-usage.mjs` passed 10 tests.
- `node scripts/test-billing-sandbox.mjs` passed 12 tests.
- `node scripts/reconcile-billing-sandbox.mjs --dry-run --json` passed.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- `.next/static` scan did not find server secrets or New API admin configuration.
- Protected main line files are absent from the final `origin/develop..HEAD` diff after B12 synced `origin/develop`.

Remote evidence already present:

- New API Ops workflow validated Docker startup, healthcheck, backup, restore, login after restore, bad backup rejection, and log redaction.
- New API BFF workflow validated real New API startup, test admin setup, token generation, real BFF calls, and static bundle leak scan.
- Auth, quota, and billing workflows passed on their module PRs.

Local Docker remains unavailable on this Windows host, so B12 did not rerun real container startup locally.

B12-FG final gate:

- PR #19 (`fix/auth-newapi-final-validation` -> `integration/auth-newapi`) is
  Open and Draft.
- PR #19 run `27744908374` passed all eight `Auth New API Final Gate` jobs on
  `aaf258db7d1dc55c6290b6390e297454bad51f29`.
- The final gate includes typecheck/lint/build, auth/session, BFF/mapping,
  quota/usage, billing/webhook/reconciliation, real New API Docker health and
  BFF validation, backup/restore/bad-backup rejection, and secret/bundle/diff
  scanning.
- The real Docker job initialized the test admin, logged in, generated a masked
  management token, ran real BFF calls, created and activated a real New API
  user mapping, checked log redaction, and cleaned up containers.
- The security job completed server secret scanning, pull request diff scanning,
  and client static bundle scanning with no reported secret leak.
- `npm audit` remains `{"info":0,"low":1,"moderate":7,"high":4,"critical":0,"total":12}`;
  this is recorded as a production dependency blocker.
- PR #17 remains Open and Draft; it was not merged.

## Open Items

| Item | Owner | Blocking for final UI? |
| --- | --- | --- |
| Final login/register visual pages | Main line A | Yes |
| Account center and recharge UI | Main line A plus backend follow-up for order list | Yes |
| Admin user/mapping/quota/order review UI | Main line A plus backend admin API follow-up | Yes |
| Workbench generation/upscale quota precheck and final usage settlement | Future workbench integration module | Yes for paid cloud task gating |
| Production payment provider | Future payment launch task | No for login UI; yes for real money |
| Formal database schema/migration | Future persistence hardening | No for sandbox demo; yes for production |
| Dependency audit remediation | Shared platform task | Recommended before production |
| Hard `server-only` import guard for server integration modules | Shared platform/backend task | Recommended before production |
| Backup policy for runtime logs | Ops task | Recommended before production |
| Digest pinning for PostgreSQL and Redis images | Ops task | Recommended before production |

## Production Readiness Risks

These items do not indicate a real secret leak and do not block the B12 handoff, but they should be handled before production:

- `npm audit` reports 12 existing vulnerabilities, including 4 high. `next@16.2.1` has high-severity advisories and should be upgraded in a separate dependency remediation PR with full regression testing.
- New API backups include `.runtime/new-api/logs` inside `runtime.tar.gz`. `.env` is redacted and backup directories are permissioned, but operators should either redact logs before packaging or define a retention/encryption policy for backups.
- New API server integrations currently rely on `src/lib/server/**` ownership and bundle leak tests. Add a hard `server-only` import guard when the project dependency policy allows it.
- Non-production auth secret fallback is useful for local tests, but staging/test environments exposed beyond localhost must set `AUTH_SESSION_SECRET` or `SESSION_SECRET`.
- PostgreSQL and Redis images are pinned by tag, not digest. New API itself is pinned by tag and digest.

## Final Review Status

Conclusion: `READY_FOR_MAINLINE_REVIEW`

This conclusion means the backend foundation, final gate workflow, and handoff
documents are ready for reviewer attention. It does not approve production
release while the dependency audit and production hardening risks above remain
open.

## Stop Rules

Do not start these from this handoff:

- final login/register UI;
- account center UI;
- WorkbenchShell edits;
- token/design-system edits;
- production admin pages;
- production payment;
- merge to `develop`.
