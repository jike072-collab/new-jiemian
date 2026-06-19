# Mainline Integration Requirements

## Purpose

This document tells main line A how to consume line B without reintroducing fake login, duplicate sessions, duplicate balances, or production payment risk.

## Required Integration Order

1. Merge or review the final draft PR from `integration/auth-newapi` to `develop`.
2. Keep main line A UI files as the visual owner.
3. Wire login/register UI to B09 APIs.
4. Wire account and quota views to B10 APIs.
5. Wire sandbox recharge UI to B11 APIs only when clearly labeled as test payment.
6. Wire Workbench task routes to B10 quota precheck and usage settlement in a separate task.
7. Add production payment only after `PRODUCTION_PAYMENT_CHECKLIST.md` is completed.

## Protected Main Line Ownership

Line B must not directly own or rewrite:

- `src/app/page.tsx`
- `src/components/workbench-shell*`
- `src/components/studio-app*`
- public header/sidebar
- workbench root layout
- public formal navigation
- `styles/tokens.css`
- `src/app/globals.css`
- shared UI components
- module 3 screenshots and visual files

B12 merged latest `origin/develop` into the handoff branch so the final draft PR does not show these files as line B regressions.

## Auth Integration

The login/register UI must:

- call `GET /api/auth/csrf` before state-changing auth calls;
- send `X-CSRF-Token` and the CSRF cookie;
- call `POST /api/auth/register` and `POST /api/auth/login`;
- call `POST /api/auth/logout` for logout;
- call `GET /api/auth/session` on app start and protected routes;
- call `PATCH /api/auth/session` only for reviewed refresh behavior;
- read `uiState`, `code`, `mappingStatus`, and `user`;
- not parse raw New API errors;
- not store long-lived sensitive tokens in `localStorage`;
- not use fake login or static logged-in state.

## Session Integration

The only browser session is the project HttpOnly session cookie `aohuang_session`.

Rules:

- New API admin/user credentials must remain server-only.
- New API cookies must not become the project session.
- A successful login regenerates the session.
- Logout revokes the server session.
- Session expiry must surface as `session_expired`.
- Admin sessions must be distinguishable by local project `role`, not by New API UI state.

## Account And Mapping Integration

The UI may allow local login when New API is unavailable or mapping is not active, but billable cloud actions must be blocked unless `mappingStatus` is `active`.

Mapping UI states:

- `pending`: account exists, sync still waiting.
- `active`: cloud features may proceed after quota checks.
- `failed`: retryable sync failed; show wait or support path.
- `disabled`: block cloud features and show disabled state.
- `orphaned`: block cloud features and require support.
- `repair_required`: block cloud features and require manual repair.

## Quota And Usage Integration

Use:

- `GET /api/quota` for current quota.
- `POST /api/quota/precheck` before billable cloud task submission.
- `GET /api/usage` for usage pages.

Rules:

- Display unit is `credits` until product conversion is reviewed.
- New API quota is the only cloud quota ledger.
- The local usage file is an audit log, not balance authority.
- Cache is display-only and short-lived.
- Cache failures must not allow high-cost tasks.
- `quota_unavailable` and `usage_unavailable` must show clear degraded states.

## Billing Integration

Use:

- `GET /api/billing/config`
- `POST /api/billing/orders`
- `GET /api/billing/orders/[id]`

Rules:

- UI must render channels, names, colors, amounts, discounts, currency, enabled state, and sort order from backend config.
- Do not hard-code payment channels.
- Do not expose webhook secret.
- Do not show real-money language unless production payment is approved later.
- `review` is a first-class order state and must not be hidden.
- Current B11 has no order-list endpoint; account recharge history needs a follow-up API before a full history page.

## Workbench Billing Integration

The following routes still need a future billing integration task:

- `src/app/api/generate/image/route.ts`
- `src/app/api/generate/video/route.ts`
- `src/app/api/upscale/image/route.ts`
- `src/app/api/upscale/video/route.ts`
- `src/app/api/jobs/[id]/route.ts`

Required flow:

1. Resolve current project session.
2. Confirm mapping is `active`.
3. Call quota precheck with stable task ID and idempotency key.
4. Submit the upstream task only after precheck succeeds.
5. Record task ID and estimated usage.
6. Confirm actual consumption from New API logs or final task callback.
7. On failure/cancel/retry, record audit state and trigger reconciliation or compensation where needed.

Local image/video HD work that does not call New API or another upstream cloud provider remains non-billable against New API quota.

## Feature Flags

Recommended flags before mainline UI ships:

| Flag | Default | Meaning |
| --- | --- | --- |
| `auth.enabled` | off until reviewed | Show real login/register UI. |
| `account.enabled` | off until reviewed | Show account center and quota. |
| `billing.sandbox.enabled` | off until reviewed | Show sandbox recharge UI. |
| `billing.production.enabled` | off | Production payment must remain disabled. |
| `workbench.billing.enabled` | off | Gate Workbench quota precheck and settlement. |

## Production Blockers Before Public Launch

- Resolve or consciously accept the dependency audit findings, especially current `next` high-severity advisories.
- Add a hard server-only guard for New API/admin credential modules, or keep CI bundle leak checks mandatory until that exists.
- Decide whether New API runtime logs are encrypted, redacted, excluded, or retained inside backups.
- Set strong `AUTH_SESSION_SECRET`, `SESSION_SECRET`, `PAYMENT_SANDBOX_WEBHOOK_SECRET`, New API admin credentials, database passwords, and Redis passwords in environment-specific secret storage.
- Pin PostgreSQL and Redis images by digest if the deployment standard requires immutable images.
- Do not enable production payment until webhook provider verification, refund policy, chargeback policy, reconciliation, and finance sign-off are complete.
