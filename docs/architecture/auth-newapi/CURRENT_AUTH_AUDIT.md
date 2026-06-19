# Current Authentication Audit

## Scope And Evidence

This audit is read-only. It covers current route files, API routes, server helpers, client components, environment presets, and existing UI audit documents. It does not fix login, add authentication libraries, add user tables, modify schema, deploy New API, or create placeholder users.

Commands used for evidence included route listing, source search for auth/session/cookie/token/account/quota terms, dependency review in `package.json`, and direct reads of the files cited below.

## Auth And Account Surface Inventory

| Surface | File path | Function or component | Call direction | Real runtime behavior | Database connection | Placeholder status | Reusable | Later module owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login page route | `src/app/login/page.tsx` | `LoginPage` | Browser `GET /login` -> renders `CustomerLogin` | Yes, route exists and renders a component | No | Account entry surface only | Route can be retained; behavior must be replaced later | B09 backend contract, main line A visual |
| Login form UI | `src/components/customer-login.tsx` | `CustomerLogin` | `LoginPage` -> `CustomerLogin`; form submits browser navigation to `/` | Yes, but it does not authenticate | No | Yes. It states local access is open and accepts a static `local-user` value | Visual shell only; not auth logic | B09 backend contract, main line A visual |
| Registration route | none found under `src/app` | none | none | No runtime route | No | Missing, not placeholder code | No implementation to reuse | B09 |
| Logout route | none found under `src/app` or API routes | none | none | No runtime route | No | Missing | No implementation to reuse | B09 |
| Account route | none found under `src/app` | none | none | No runtime route | No | Missing | No implementation to reuse | B09/B10 |
| Admin providers page | `src/app/admin/providers/page.tsx` | `AdminProvidersPage` | Browser `GET /admin/providers` -> renders `AdminProvidersClient` | Yes, page route exists | Indirect local JSON through API only | Real provider admin UI, not customer admin | Page route reusable for provider configuration only | Existing app/admin provider surface; B07 may consume config boundary |
| Admin provider client | `src/components/admin-providers-client.tsx` | `AdminProvidersClient`, `headers`, `load`, `save`, `update` | Client -> `/api/admin/providers` with optional `x-admin-password` | Yes, reads/saves provider config | Indirect local JSON through API | Real for provider settings; not user/customer management | Provider config UI and password header pattern are reusable only for provider admin | Existing provider admin; not B09 auth |
| Admin provider API | `src/app/api/admin/providers/route.ts` | `GET`, `PUT` | Client/API caller -> `requireAdmin` -> provider read/update | Yes, API route runs on Node runtime | Local JSON `data/providers.json` through `providers.ts` | Real provider config API | `requireAdmin` pattern is simple but insufficient for account auth | B07/B09 security review |
| Admin access helper | `src/lib/server/admin-auth.ts` | `requireAdmin`, `isLocalRequest`, `isLoopback` | API route -> `requireAdmin(request)` | Yes, protects only admin providers route | No | Real minimal gate for local/provider admin, not role auth | Loopback check can inform local-only operations but not user auth | B09/B12 |
| Provider config storage | `src/lib/server/providers.ts` | `readProviders`, `updateProviders`, `readPublicProviders`, `readEnabledProviders`, `providerById` | Admin API and generation APIs -> provider config functions | Yes | Local JSON file, not database | Real provider config; not user/account data | Useful for BFF provider boundary review | B07 |
| Library storage | `src/lib/server/library.ts` | `readLibrary`, `addLibraryItem`, `addJob`, `updateJob`, `deleteLibraryItem` | Generate/upscale/job/library APIs -> local JSON library/jobs files | Yes | Local JSON files, not user database | Real artifact/job storage, global not per-user | Job/library persistence patterns can inform B10, but need user scoping | B10 |
| Image/video generation APIs | `src/app/api/generate/image/route.ts`, `src/app/api/generate/video/route.ts` | `POST` | Client form -> API route -> `generateImage`/`submitVideo` | Yes | Local JSON result/job storage and provider JSON config | Real generation calls, no auth/charge gate | Generation input validation and library writes are reusable after quota gate | B10 |
| Upscale APIs | `src/app/api/upscale/image/route.ts`, `src/app/api/upscale/video/route.ts` | `POST` | Client form -> API route -> `upscaleImage`/`submitVideoUpscale` | Yes | Local JSON result/job storage and provider JSON config | Real local CLI flow, no auth/charge gate | File validation and job model are reusable after quota gate | B10 |
| Job refresh API | `src/app/api/jobs/[id]/route.ts` | `GET` | Client polling -> `refreshVideoJob(id)` | Yes | Local JSON job and library files | Real global job lookup, no ownership check | Refresh logic reusable after adding user/job ownership | B10 |
| Files API | `src/app/api/files/[name]/route.ts` | `GET` | Browser/media -> `readStoredFile(name)` | Yes | Local upload files only | Real global file serving, no owner check | Serving logic reusable after access checks | B10/B12 |
| Enabled providers API | `src/app/api/providers/enabled/route.ts` | `GET` | Studio app -> `readEnabledProviders` | Yes | Local JSON provider config | Real public provider listing, no account context | Reusable for public model availability | B07 |

## Required Answers

### Is there a real user database?

No. There are no user/customer schema files, migrations, ORM dependencies, or database client files in the current repository. Runtime persistence is local JSON under `data/` through `src/lib/server/paths.ts`, `src/lib/server/providers.ts`, and `src/lib/server/library.ts`.

### Is current login pure frontend?

Yes. `/login` renders `CustomerLogin`; the form has `action="/"`, static default account text, and no API call, Server Action, cookie write, password verification, or database write.

### Is HttpOnly Cookie used?

No. Source search found no `cookies()`, `Set-Cookie`, `HttpOnly`, `document.cookie`, or session cookie implementation in `src`.

### Does registration create users?

No. There is no `/register` page, API route, Server Action, user table, or user creation function.

### How are passwords stored?

Customer passwords are not stored because customer login is not real. `ADMIN_PASSWORD` is read from environment at runtime by `requireAdmin`; provider API keys are stored in local `data/providers.json` when configured through the provider admin page.

### Is there an admin role?

No role model exists. Admin provider access is a binary local/password gate: no `ADMIN_PASSWORD` plus loopback request is allowed, otherwise `x-admin-password` must equal `ADMIN_PASSWORD`.

### What is the user unique ID source?

There is no user unique ID. Existing IDs are runtime artifact/job IDs generated with `randomUUID()` in `library.ts`, provider IDs from provider config, and external provider job IDs when returned by video providers. None identify a customer.

### Is there real points, balance, or quota?

No. The only current points language is UI copy in `StudioApp`, such as `积分位预留`, `1K · 4 积分`, and `2K · 8 积分`. There is no persisted points ledger, balance table, quota table, or debit logic.

### Do AI tasks charge users?

No. Image/video/upscale routes call provider or local CLI logic directly after input validation and provider availability checks. They never read a user, quota, balance, ledger, or usage account.

### Is the backend customer management page real?

No customer management page exists. `/admin/providers` is real, but it manages model provider settings only; it does not list customers, adjust credits, inspect user usage, or manage account roles.

### Are there login/register build issues?

Current source contains `/login` and `CustomerLogin`, and existing UI docs record that prior missing-component failures have been resolved. There is no `/register`, so no register build path exists. B02 did not run a full build because this module is documentation-only and the audited route absence is source-evident.

### Which logic can be reused?

Reusable with changes:

- `requireAdmin` loopback detection can inform local-only admin safety, but is not enough for user auth.
- Local JSON helpers in `paths.ts` show current persistence patterns, but are not a durable account database.
- Provider config sanitization and key masking can inform BFF/admin provider boundaries.
- Library and job models can inform usage logging, but need user ownership and quota hooks.
- Generation/upscale file validation and job polling can be wrapped by future auth/quota gates.

### Which UI must wait for main line A?

Main line A owns formal login/register visuals, public workbench shell, header/sidebar/account entry, shared UI components, and admin visual surfaces. Line B should only define backend contracts until main line A is ready to wire UI.

## Security Findings For Later Modules

- Admin password is sent in `x-admin-password` from browser memory. It is acceptable only as a minimal provider-admin gate and must not become a general account/admin model.
- No user ownership check protects library items, jobs, generated files, or generation APIs.
- Provider API keys can be saved to local JSON. They are masked when returned to the client, but later modules must keep true secrets server-only.
- Local open access is intentional for the current app, but must be replaced by a single real session truth source before customer accounts are enabled.
