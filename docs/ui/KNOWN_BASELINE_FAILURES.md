# KNOWN_BASELINE_FAILURES

## Current verification snapshot

- Environment: Windows 11 Pro 10.0.26100 build 26100, Node v24.16.0, npm 11.13.0.
- `npm ci`: succeeded.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `GET /`, `GET /login`, and `GET /admin/providers`: all returned `200`.
- Browser Use could not open `127.0.0.1:3100`, so browser evidence was captured with local Chrome instead.

## `/login` historical route blocker

- Command: `npm run dev -p 3100`
- Dev server exit code: `0`
- Route request result: `/login` previously returned `500` before the missing component was restored.
- Error file: `dev-3100.live.err.log`
- Failing file: `src/app/login/page.tsx:1-4`
- Failing import: `import { CustomerLogin } from "@/components/customer-login";`
- Import chain: `/login` page -> `src/app/login/page.tsx:1-4` -> missing `src/components/customer-login.tsx`.
- Same-name file check: the file is now present in the workspace snapshot as `src/components/customer-login.tsx`.
- Impacted route: `/login`
- Current status: `GET /login` now returns `200` after the component was restored in the workspace.
- Suggested repair module: no longer needed for the current snapshot.

## `/admin/providers` historical route blocker

- Command: `npm run dev -p 3100`
- Dev server exit code: `0`
- Route request result: `/admin/providers` previously returned `500` on request before the current snapshot was refreshed.
- Error file: `dev-3100.live.err.log`
- Failing route: `src/app/admin/providers/page.tsx:1-4`
- Import chain: `/admin/providers` page -> `src/app/admin/providers/page.tsx:1-4` -> `AdminProvidersClient` -> server/admin provider data path.
- Same-name file check: current admin page component exists in the workspace snapshot.
- Impacted route: `/admin/providers`
- Current status: `GET /admin/providers` now returns `200`.
- Suggested repair module: no longer needed for the current snapshot.

## Dev server / browser baseline

- Command: `npm run dev -p 3100`
- Exit code: `0` for startup.
- Dev log file: `dev-3100.restart.out.log`
- HTTP check: `Invoke-WebRequest http://127.0.0.1:3100/`, `/login`, and `/admin/providers` all returned `200`.
- Browser use check: in-app browser navigation to `127.0.0.1:3100` was blocked by Browser Use URL policy, so browser-driven screenshots were captured with local Chrome instead.
- Route coverage observed during checks: `/`, `/login`, `/admin/providers`.

## Other baseline failures

- Historical `npm run lint` failure: unresolved dependency `escape-string-regexp`.
- Historical `npm run typecheck` failure: unresolved imports for `@/components/customer-login`, `class-variance-authority`, `clsx`.
- Historical `npm run build` failure: unresolved `baseline-browser-mapping`.

## Module 1 Rule

- Record failures only.
- Do not repair `src/**` in module 1.
