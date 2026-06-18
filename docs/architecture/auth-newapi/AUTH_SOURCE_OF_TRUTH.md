# Auth Source Of Truth

## Decision

Line B chooses Option A:

Current project accounts are the primary accounts. New API users are mapped backend accounts used by the BFF for cloud AI, quota, usage, and recharge integration.

This project must not make New API browser sessions, cookies, UI state, or admin roles the customer-facing auth source of truth.

## Option Comparison

| Dimension | Option A: project account primary, New API mapped | Option B: New API user primary |
| --- | --- | --- |
| Current code change size | Moderate. The current app has no real user database yet, so B09 can add one local auth boundary without replacing existing real account logic. | Larger. Frontend and BFF would need to follow New API account/session semantics directly. |
| Login/register compatibility | Best fit. Main line A can own login/register visuals while B09 owns local backend contracts. | Couples this app's login/register UX to New API's account rules and error model. |
| User data ownership | Project owns customer identity, profile, product settings, and admin roles. New API owns mapped quota execution state. | New API becomes the user profile owner even for product data it does not understand. |
| Session security | Project can issue one HttpOnly session and keep New API credentials server-only. | Risk of treating New API browser session as this app's session or passing credentials through. |
| Cookie and cross-domain | Local session cookie can be scoped to this app's domain. BFF talks to New API server-to-server. | Requires careful cross-domain cookie/session alignment or proxying New API auth. |
| New API downtime impact | Existing local session login can continue; billable cloud actions degrade closed. | Login and user self views may fail if New API is down. |
| User creation consistency | Local user is created first, mapping then synchronizes with compensation states. | New API creation must succeed before this app can have a customer identity. |
| Backend/admin management | Project admin roles can match product needs; New API admin stays operational backend control. | Project admin model inherits New API roles that may not match product permissions. |
| Quota | New API remains the only cloud quota ledger; local app reads/reconciles through BFF. | Simple for cloud quota, but harder to separate local free features from cloud quota. |
| Payment | Project order is primary for product billing; successful payment applies New API quota through BFF. | New API payment order would drive product billing and refunds. |
| Refund | Local order/refund workflow can decide product policy, then adjust New API quota consistently. | Refund policy depends on New API payment records and may not match product needs. |
| Migration | Local account migration remains possible without moving all New API internals. | Migrating away from New API means extracting users, sessions, roles, quota, and billing. |
| Backup | Project auth/order backups are separate from New API operational backups. | New API database backup becomes customer identity backup. |
| Rollback | Project auth rollback can be decoupled from New API image/schema rollback. | New API rollback can affect login, session, quota, and billing together. |
| Future replacement of New API | Easier. Replace mapping/BFF integration while preserving project users. | Hard. New API is embedded as the account platform. |

## Selected Truth Sources

| Domain | Single truth source | Notes |
| --- | --- | --- |
| User identity | Project database user record | Introduced in B09. Existing repo currently has no real user database. |
| Session | Project BFF HttpOnly session | New API session cookies are not passed to the browser. |
| User unique ID | `local_user_id` | Stable internal identifier used by product data, sessions, orders, and logs. |
| Cloud quota ledger | New API user quota | Applies only to billable cloud AI/API usage through the BFF. |
| Payment order | Project billing/order table | Introduced in B11; successful order settlement applies quota to New API. |
| Usage log | Project usage log for product audit, reconciled with New API logs | New API logs are upstream settlement evidence, not the only product audit trail. |
| Management permission | Project role/permission model | New API admin/root credentials remain backend operational credentials only. |

## Boundary Rules

- The browser authenticates only to this project.
- The BFF authenticates to New API with server-side credentials.
- No New API admin key, root session, user token, or cookie is stored in the browser.
- New API may be unavailable while the local project session remains valid.
- A customer may have a local user before New API mapping is active, but cannot run billable cloud actions until the mapping is active.

## Required Downstream Implications

- B09 must create the local account/session backend before exposing real login/register.
- B08 must implement mapping state transitions and compensation.
- B10 must read/debit cloud quota through New API and write local usage logs.
- B11 must keep order lifecycle local, then apply successful top-up to New API quota.
- B12 must verify that no second session source or second cloud quota ledger has been introduced.
