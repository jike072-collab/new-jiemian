# New API Security Review

## Scope

This review focuses on the official New API backend, not on this project's future implementation.

## Key Findings

| Area | Evidence | Security conclusion |
| --- | --- | --- |
| Default bootstrap | `POST /api/setup` in `router/api-router.go`; `controller/setup.go`; `model/main.go` | The system exposes a public initialization path. On first init it creates the root account through the setup flow. |
| Session cookie | `main.go` | Session cookie is `HttpOnly`, `SameSiteStrictMode`, `MaxAge=30d`, and `Secure=false`. TLS must therefore be handled correctly upstream. |
| Session secret | `common/init.go`, `docs/installation/BT.md` | `SESSION_SECRET` is required and the default placeholder `random_string` is rejected. |
| Access token auth | `middleware/auth.go`, `model/token.go` | Tokens are accepted via `Authorization` and are tied to a user id and role. |
| Role gates | `middleware/auth.go`, `router/api-router.go` | Admin and root routes are protected server-side, not just in UI code. |
| Webhook secret gating | `controller/payment_webhook_availability.go`, `controller/topup_*.go` | Empty secrets/config disable payment paths rather than silently allowing unauthenticated charging. |
| Log leakage | `controller/topup.go`, `controller/topup_creem.go`, `controller/topup_waffo_pancake.go`, `controller/topup_stripe.go` | Payment callbacks log rich request context, including signatures, request bodies, IPs, and order metadata. |
| Public exposure | `docker-compose.yml`, docs install pages | The default app port is `3000`; DB and Redis should not be exposed directly to the public Internet. |
| TLS / proxy | `main.go`, `common/init.go`, docs install pages | The app does not enforce TLS itself. Upstream TLS termination is the safe deployment pattern. |
| Security advisories | [Official GitHub security advisories](https://github.com/QuantumNous/new-api/security/advisories) | Official advisories exist and must be checked before upgrades. |

## Default Bootstrap Risk

- `GET /api/setup` and `POST /api/setup` are public.
- `controller/setup.go` creates the root account during first setup.
- `model/main.go` also contains a root-account fallback helper, but the important operational fact is that bootstrap is real and public.
- Production setup must be completed on a private network path or behind temporary access control, then verified before public exposure.

## Session And Token Details

- Session store: `cookie.NewStore([]byte(common.SessionSecret))`
- Cookie flags: `HttpOnly=true`, `Secure=false`, `SameSiteStrictMode`
- Session lifetime: 30 days
- Access-token auth: `Authorization: Bearer ...` or `sk-...`
- User id binding: `New-Api-User` header must match the authenticated user

## Empty Secret Behavior

| Control | Empty value behavior |
| --- | --- |
| `StripeWebhookSecret` | Payment/top-up paths disable |
| `CreemWebhookSecret` | Webhook payment path disables |
| `WaffoPancakeMerchantID` / `WaffoPancakePrivateKey` / `WaffoPancakeProductID` | Waffo Pancake top-up and webhook disable |
| `Epay` settings | Missing pay address / id / key disables Epay top-up |

This is good as a fail-closed pattern, but only if operators do not bypass it with public callbacks or misconfigured proxies.

## Log Leakage Details

- Stripe, Creem, and Waffo Pancake webhook handlers log callback context aggressively.
- This is useful for debugging, but it increases the blast radius of log access.
- A production deployment should treat payment logs as sensitive operational data.

## Network Exposure Notes

- The default compose file exposes the application on `3000`.
- The sample compose file ships with placeholder passwords for DB/Redis.
- Public DB or Redis exposure would be an operator mistake, not an intended product feature.
- Public deployments should terminate TLS at a reverse proxy or load balancer and keep app, database, and Redis ports private.
- The global `TLS_INSECURE_SKIP_VERIFY` setting exists and defaults to false; it should not be enabled in production without a documented exception.

## Official Advisory Note

The official GitHub security advisories page should be checked before production upgrades. A previously reported webhook issue was tracked as `GHSA-xff3-5c9p-2mr4`; do not assume the current release line is free of future advisories.

## B-line Safety Notes

- Do not store New API admin credentials in the browser.
- Do not forward raw New API session cookies or access tokens to this project's frontend.
- Do not expose provider keys through the BFF.
- Do not treat New API payment success as final until webhook verification and local order reconciliation are both complete.
