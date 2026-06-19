# Current Auth Flow

## Public Login Flow

```text
GET /login
  -> src/app/login/page.tsx LoginPage
  -> src/components/customer-login.tsx CustomerLogin
  -> browser form action="/"
  -> GET /
```

| Step | File path | Function or component | Call direction | Real runtime behavior | Database connection | Placeholder status | Reusable | Later module owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Login route render | `src/app/login/page.tsx` | `LoginPage` | Route -> component | Yes | No | Route entry only | Keep route | B09/main line A |
| Login form display | `src/components/customer-login.tsx` | `CustomerLogin` | Component renders static form | Yes | No | Yes, no auth submission | Visual only | B09 contract/main line A visual |
| Submit | `src/components/customer-login.tsx` | `<form action="/">` | Browser native form -> `/` | Yes | No | Yes, navigation only | Not reusable as auth flow | B09 |

There is no login API, no Server Action, no password verification, no cookie write, no session creation, and no user lookup.

## Admin Provider Flow

```text
GET /admin/providers
  -> src/app/admin/providers/page.tsx AdminProvidersPage
  -> AdminProvidersClient
  -> GET /api/admin/providers with optional x-admin-password
  -> requireAdmin(request)
  -> readPublicProviders()
  -> data/providers.json or defaults

PUT /api/admin/providers
  -> requireAdmin(request)
  -> updateProviders()
  -> data/providers.json
```

| Step | File path | Function or component | Call direction | Real runtime behavior | Database connection | Placeholder status | Reusable | Later module owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Admin page render | `src/app/admin/providers/page.tsx` | `AdminProvidersPage` | Route -> component | Yes | No direct DB | Real provider-admin page | Keep for provider config | Existing admin/B07 |
| Admin client password header | `src/components/admin-providers-client.tsx` | `headers` | Client state -> request headers | Yes | No | Real minimal provider admin gate | Do not reuse as user auth | B09 security |
| Admin load | `src/components/admin-providers-client.tsx` | `load` | Client -> `GET /api/admin/providers` | Yes | Local JSON through API | Real provider config read | Reusable for provider config | B07 |
| Admin save | `src/components/admin-providers-client.tsx` | `save` | Client -> `PUT /api/admin/providers` | Yes | Local JSON through API | Real provider config write | Reusable for provider config | B07 |
| API protection | `src/lib/server/admin-auth.ts` | `requireAdmin` | API route -> helper | Yes | No | Minimal gate only | Loopback logic may inform local ops | B09/B12 |
| Provider read/write | `src/lib/server/providers.ts` | `readPublicProviders`, `updateProviders` | API -> local JSON | Yes | Local JSON, no DB | Real provider config | BFF config boundary | B07 |

## Generation Flow Without Auth

```text
StudioApp
  -> /api/providers/enabled
  -> /api/library
  -> /api/generate/image or /api/generate/video
  -> provider-call.ts
  -> provider API
  -> library.ts local JSON and uploads/
```

Generation and upscale APIs do not call any auth/session helper. They validate input and provider readiness, then write global library/job records.

| API | File path | Function | Auth call? | Charge call? | User ownership? | Later module owner |
| --- | --- | --- | --- | --- | --- | --- |
| Image generation | `src/app/api/generate/image/route.ts` | `POST` -> `generateImage` | No | No | No | B10 |
| Video generation | `src/app/api/generate/video/route.ts` | `POST` -> `submitVideo` | No | No | No | B10 |
| Image upscale | `src/app/api/upscale/image/route.ts` | `POST` -> `upscaleImage` | No | No | No | B10 |
| Video upscale | `src/app/api/upscale/video/route.ts` | `POST` -> `submitVideoUpscale` | No | No | No | B10 |
| Job polling | `src/app/api/jobs/[id]/route.ts` | `GET` -> `refreshVideoJob` | No | No | No | B10 |
| Library read/delete | `src/app/api/library/route.ts` | `GET`, `DELETE` | No | No | No | B10/B12 |
| File serving | `src/app/api/files/[name]/route.ts` | `GET` -> `readStoredFile` | No | No | No | B10/B12 |

## Missing Flow Inventory

- `/register`: no route or API.
- `/logout`: no route or API.
- `/account`: no route or API.
- Customer dashboard: no route.
- Backend customer management: no route.
- Point adjustment: no route.
- Usage records by user: no route.
- Route protection for workbench: none.
- HttpOnly cookie session: none.
- JWT/session token lifecycle: none.

## Flow Risks

- Current login copy can look like a real account screen, but it only navigates to the app.
- Admin provider password is a browser-supplied header, not a durable admin identity.
- Generated artifacts and jobs are global local records, so any later account system must add owner checks before multi-user use.
- Points labels are visible in UI, but no debit happens in the flow.
