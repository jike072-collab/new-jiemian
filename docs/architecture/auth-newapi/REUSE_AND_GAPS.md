# Reuse And Gaps

## Reusable Current Logic

| Candidate | File path | Function or component | Why reusable | Required changes before account use | Later module owner |
| --- | --- | --- | --- | --- | --- |
| Local admin gate | `src/lib/server/admin-auth.ts` | `isLoopback`, `requireAdmin` | Captures the existing local-admin intent and loopback handling | Replace or wrap with real admin identity; never put long-lived admin secret in browser for customer admin | B09/B12 |
| Provider config store | `src/lib/server/providers.ts` | `readProviders`, `readPublicProviders`, `updateProviders`, `readEnabledProviders`, `providerById` | Existing source for model/provider configuration and key masking | Keep secrets server-only; define BFF boundary and avoid exposing raw keys | B07 |
| Provider admin UI | `src/components/admin-providers-client.tsx` | `AdminProvidersClient` | Real provider configuration workflow already calls admin API | Visual ownership remains main line A; do not extend into customer admin in B02 | B07/main line A |
| Generation functions | `src/lib/server/provider-call.ts` | `generateImage`, `submitVideo`, `refreshVideoJob` | Real provider calls and job parsing already exist | Add auth, owner, quota/debit, and usage logging before/around calls | B10 |
| Local upscale functions | `src/lib/server/local-upscale.ts` | `upscaleImage`, `submitVideoUpscale`, `readUpscaleStatus` | Real local CLI readiness and job handling exist | Add auth, owner, quota/debit, and usage logging | B10 |
| Library/job storage | `src/lib/server/library.ts` | `LibraryItem`, `JobRecord`, read/add/update/delete helpers | Existing artifact/job lifecycle | Add user ownership, access checks, and usage linkage; likely not final account DB | B10/B12 |
| File serving | `src/app/api/files/[name]/route.ts` | `GET` | Existing media response handling | Add owner/access authorization for non-local use | B10/B12 |
| Login route | `src/app/login/page.tsx` | `LoginPage` | Stable route entry exists | Replace placeholder form behavior with real backend contract later; visual remains main line A | B09/main line A |

## Gaps By Requirement

| Required capability | Current finding | Evidence | Later module owner |
| --- | --- | --- | --- |
| Real user database | Missing | No schema/ORM/migration/user model; only local JSON provider/library/job files | B04/B09 |
| Real login | Missing | `CustomerLogin` posts to `/`; no API/Server Action | B09 |
| Registration creates user | Missing | No `/register` route or user creation function | B09 |
| Logout | Missing | No `/logout` route/API and no session to clear | B09 |
| HttpOnly Cookie session | Missing | No cookie/session code in `src` | B09 |
| JWT/token lifecycle | Missing | No JWT/session dependency or code | B09 |
| Password hashing/storage | Missing | No customer password persistence | B09 |
| Admin role | Missing | `requireAdmin` only checks loopback or one password header | B04/B09 |
| User unique ID | Missing | Artifact/job UUIDs are not user IDs | B04/B09 |
| Points/balance/quota | Missing | UI text only, no ledger | B04/B10 |
| AI task debit | Missing | Generation/upscale APIs do not call quota or ledger logic | B10 |
| Usage records | Partial but insufficient | Jobs/library are global artifact records, not user usage logs | B10 |
| Customer management | Missing | `/admin/providers` is provider management only | B11/B12 or later scoped module |
| Admin point adjustment | Missing | No customer/points admin route | B10/B11 |
| Route protection | Missing | Workbench and generation APIs are open | B09/B10/B12 |

## Build And Runtime Notes

- `/login` source is present and imports `CustomerLogin`.
- Existing docs note a historical missing `CustomerLogin` blocker that is now resolved.
- `/register` is absent, so there is no register build path to validate.
- No auth dependency exists in `package.json`; B02 does not add one.

## Main Line A Dependencies

The following UI remains main line A owned and must not be implemented by line B in this module:

- Official login/register visual design.
- Workbench header/sidebar/account entry.
- Public route shell and responsive layout.
- Admin visual surfaces.
- Shared UI components and design tokens.

Line B should provide backend contracts and security boundaries for these surfaces in later modules.

## B02 Conclusion

The current project is a local-first generator with provider admin and local artifact storage. It does not yet have a real account system. Later modules must introduce one session truth source, one account/user mapping strategy, and one quota/balance truth source before login, registration, charging, or customer admin can be treated as real.
