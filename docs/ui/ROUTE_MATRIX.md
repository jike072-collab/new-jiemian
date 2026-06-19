# ROUTE_MATRIX

## App Routes

| Route | Type | Current state | Notes |
| --- | --- | --- | --- |
| `/` | page | Present | Renders `StudioApp` on the home page. |
| `/login` | page | Present | Renders the ordinary user login form. Historical blocker details are recorded separately in `KNOWN_BASELINE_FAILURES.md`. |
| `/register` | page | Present | Renders the ordinary user registration form. |
| `/admin/providers` | page | Present | Renders provider management UI. |
| `/api/generate/image` | API | Present | Image generation entry. |
| `/api/generate/video` | API | Present | Video generation entry. |
| `/api/upscale/image` | API | Present | Local image upscale entry. |
| `/api/upscale/video` | API | Present | Local video upscale entry. |
| `/api/upscale/status` | API | Present | Local tool readiness check. |
| `/api/library` | API | Present | Library read/delete entry. |
| `/api/jobs/[id]` | API | Present | Video job refresh entry. |
| `/api/files/[name]` | API | Present | Stored media fetch entry. |
| `/api/providers/enabled` | API | Present | Enabled provider list for front-end tools. |
| `/api/admin/providers` | API | Present | Admin provider read/write entry. |

## Missing But Mentioned

- Ordinary user auth API routes are not present in the current codebase: `/api/auth/login`, `/api/auth/register`, `/api/auth/me`, and `/api/auth/logout` remain integration blockers.
- No separate admin overview route is present in current code.
- No separate customer dashboard route is present in current code.

## Evidence

- Home page: `src/app/page.tsx`
- Login page: `src/app/login/page.tsx`
- Register page: `src/app/register/page.tsx`
- Admin providers: `src/app/admin/providers/page.tsx`
- API routes: `src/app/api/**/route.ts`
