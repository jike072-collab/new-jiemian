# REUSE_AUDIT

## A / B / C / D

### A

- `src/components/studio-app.tsx`
  - Current use: main product shell and tool orchestration.
  - Reuse: yes, as-is for logic.
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
  - Reuse: keep the route; module 1 does not alter the component structure.
- `src/components/customer-login.tsx`
  - Current use: dedicated login surface in the current worktree.
  - Reuse: keep for the `/login` route; later modules may restyle without changing behavior.
- `src/lib/server/provider-call.ts`
  - Current use: business logic plus network calls.
  - Reuse: keep logic, later UI work may wrap presentation separately.

### D

- No old component is deleted in module 1.
- Any unused legacy surface should be tagged legacy before removal in later modules.

## Reuse Notes

- No existing shared Header, Sidebar, AppShell, ToolPanel, or dedicated login/register component is clearly present beyond the route-local `CustomerLogin` surface in the current worktree.
- The current product is centered on `StudioApp`, `AdminProvidersClient`, server helpers, and a small logo component.
