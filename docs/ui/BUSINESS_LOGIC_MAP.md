# BUSINESS_LOGIC_MAP

## Frontend Flow

- `src/components/studio-app.tsx` owns the main tool workspace.
- It fetches enabled providers and the library, switches between image/video/upscale/library views, and renders the output panel.
- The home page simply mounts `StudioApp`.

## Login Flow

- `/login` mounts `CustomerLogin` in the current worktree.
- Earlier missing-component failure is archived in `KNOWN_BASELINE_FAILURES.md` as historical evidence.

## Admin Flow

- `/admin/providers` mounts `AdminProvidersClient`.
- The client reads and saves provider config through `/api/admin/providers`.
- `requireAdmin` allows local access without a password and otherwise checks `x-admin-password`.

## Server Logic

- `provider-call.ts` handles remote image/video generation and video job refresh.
- `local-upscale.ts` handles local Upscayl and Video2X work.
- `library.ts` owns persistent library and job records.
- `providers.ts` owns provider config read/sanitize/update behavior.

## No Change In Module 1

- API parameters.
- Data structures.
- Business rules.
- Route shapes.
