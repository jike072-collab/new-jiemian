# New API Capability Map

## Scope

This map is read-only and based on the official New API repository, the public documentation, and the generated OpenAPI spec shipped with the official source tree. It does not deploy anything and does not decide this project's own account architecture.

## Verified Capability Map

| Area | Official evidence | Conclusion | Later owner |
| --- | --- | --- | --- |
| Roles and permissions | Docs: [feature guide](https://docs.newapi.pro/zh/docs/guide/feature-guide); code: `common/constants.go`, `middleware/auth.go` | The official product exposes `Guest / Common / Admin / Root` style roles, with route guards for user, admin, and root access. | B04 / B09 |
| Login and registration | Docs: [auth guide](https://docs.newapi.pro/zh/docs/guide/feature-guide/user/auth); API: `/api/user/login`, `/api/user/register`, `/api/user/logout` | Account/password login, registration, logout, OAuth login, passkey login, and password reset are part of the official surface. | B09 |
| User create/query/disable | API: `/api/user`, `/api/user/:id`, `/api/user/manage`; code: `controller/user.go` | Admin user CRUD and status control are real server-side features, not just UI labels. | B09 |
| Usage, quota, and logs | Docs: quota/top-up/log/dashboard guides; API: `/api/log`, `/api/data`, `/api/usage/token` | Quota and usage are first-class platform features, with user, admin, and token-level views. | B10 |
| Tokens | Docs: token guide; API: `/api/token`, `/api/usage/token`, `/api/log/token` | User-owned access tokens are a core API credential and have their own quota, expiry, IP, and model-limit controls. | B09 / B10 |
| Channels and models | Docs: channel/model guides; API: `/api/channel`, `/api/models`, `/api/deployments` | Provider channels, model metadata, and deployment records are managed in the official backend. | B07 |
| Tasks | Docs: task guide; API: `/api/task` | Async tasks are an official part of the product, especially for image/video workflows. | B10 |
| System settings | Docs: system-setting guides; API: `/api/option`, `/api/performance`, `/api/custom-oauth-provider` | Root-level system settings, custom OAuth, and performance controls are official backend capabilities. | B12 |
| Recharge and payment | Docs: payment settings and top-up guides; API: `/api/user/topup`, `/api/user/epay/notify`, `/api/stripe/webhook`, `/api/creem/webhook`, `/api/waffo/webhook`, `/api/waffo-pancake/webhook/:env` | Payment, recharge, webhooks, and order state handling are real backend functions. | B11 |
| Deployment | Docs: Docker Compose install, env vars, system update, cluster deployment; files: `docker-compose.yml`, `model/main.go`, `common/init.go` | The official deployment story supports Docker Compose, environment variables, SQLite/MySQL/PostgreSQL, Redis, initialization, and upgrade flow. | B05 / B06 |

## Account And Permission Details

- Common users can register, log in, manage their own tokens, view self usage, recharge, and use supported API routes.
- Admin users can manage users, channels, models, logs, redemptions, data statistics, groups, and tasks.
- Root users can access system settings, custom OAuth provider management, performance controls, ratio sync, and the most sensitive channel operations.
- User records include `id`, `username`, `password`, `display_name`, `role`, `status`, `email`, OAuth ids, `quota`, `used_quota`, `request_count`, group, invite fields, access token, settings, Stripe customer id, and timestamps.
- Passwords are hashed with bcrypt in the official backend before storage.

## Quota And Usage Details

- User wallet quota is stored on the user record.
- Token quota is stored on token records with `remain_quota`, `used_quota`, `unlimited_quota`, expiry, model limits, and IP allowlist.
- Usage logs track model, channel, token, user, quota, token counts, and request metadata.
- AI relay paths perform pre-consume and post-consume settlement; async tasks also reserve or refund quota.
- Admin user management can add, subtract, or override user quota.

## Payment And Recharge Details

- Payment methods visible in official code include Epay, Stripe, Creem, Waffo, and Waffo Pancake.
- Recharge configuration includes minimum top-up, unit price, payment method list, per-amount discounts, top-up link, and provider-specific credentials.
- Fixed recharge choices are exposed as configurable amount options in the UI/settings layer, while the backend also accepts amount-based requests subject to minimum and discount rules.
- Discounts are represented as an amount-to-multiplier map.
- Orders are created as `TopUp` records with `trade_no`, `payment_method`, `payment_provider`, amount, money, timestamps, and status.
- Recharge records are available to users and admins through top-up APIs.
- Webhook handlers complete pending orders only after provider-specific verification and status checks.
- Order status paths include pending, success, failed, and expired depending on provider and event.

## Deployment Details

- Docker Compose is the primary official deployment path.
- The default compose file starts New API, Redis, and PostgreSQL; a MySQL alternative is shown as commented configuration.
- New API persists `/data` and `/app/logs`; PostgreSQL persists `pg_data`.
- The sample Redis service does not define a data volume, so Redis should be treated as cache/session support, not the durable account ledger.
- SQLite is the default when `SQL_DSN` is empty; MySQL and PostgreSQL are selected by DSN.
- `REDIS_CONN_STRING` enables Redis.
- First-time setup is exposed through `/api/setup`.
- Startup migration is automatic on the master node.

## Confirmed Public Surfaces

- `GET /api/status`, `GET /api/about`, `GET /api/pricing`, `GET /api/rankings`
- `POST /api/user/login`, `POST /api/user/register`, `GET /api/user/logout`
- `GET /api/user/self`, `GET /api/user/topup/self`, `POST /api/user/topup`
- `GET /api/channel`, `GET /api/models`, `GET /api/token`, `GET /api/log`
- `POST /api/setup`

## Confirmed Source Types

- Official docs pages
- Official GitHub repository
- Generated OpenAPI spec in the official repo
- Runtime route and middleware code in the official repo

## Notes

- The official docs and the official code agree that New API is not only a gateway; it also includes account, quota, billing, logging, and admin control planes.
- The capability map is broad enough to support a full backend, but this project still needs its own truth-source decision in B04.
