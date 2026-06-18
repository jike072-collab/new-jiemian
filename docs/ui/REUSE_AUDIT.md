# REUSE_AUDIT

## A / B / C / D

### A

- `src/components/studio-app.tsx`
  - Current use: main product orchestration and data flow.
  - Reuse: yes, as-is for logic only.
- `src/components/brand-logo.tsx`
  - Current use: shared brand mark.
  - Reuse: yes, as-is.
- `src/components/admin-providers-client.tsx`
  - Current use: admin provider editor.
  - Reuse: yes, logic kept.

### B

- `src/components/ui/button.tsx`
  - Current use: shared button primitive.
  - Reuse: likely style-level only in later UI work.
  - Current reference: not directly used by current pages.

### C

- `src/app/login/page.tsx`
  - Current use: route entry that renders the worktree login surface.
  - Reuse: keep the route and render the shared auth page in login mode.
- `src/app/register/page.tsx`
  - Current use: route entry that renders the worktree registration surface.
  - Reuse: share `AuthPages` with `/login`.
- `src/components/auth-pages.tsx`
  - Current use: ordinary user login/register form surface.
  - Reuse: keep for the `/login` and `/register` routes until a real account backend is connected.
- `src/lib/server/provider-call.ts`
  - Current use: business logic plus network calls.
  - Reuse: keep logic, later UI work may wrap presentation separately.

### D

- The previous placeholder login component was replaced by the shared `AuthPages` surface in the auth-pages task.
- Any unused legacy surface should be tagged legacy before removal in later modules.

## Reuse Notes

- No existing shared Header, Sidebar, AppShell, or ToolPanel is clearly present beyond the route-local auth surface in the current worktree.
- The current product is centered on `StudioApp`, `AdminProvidersClient`, server helpers, and a small logo component.
- `StudioApp` should not be treated as a new layout skeleton until visual comparison proves it fits the target.
