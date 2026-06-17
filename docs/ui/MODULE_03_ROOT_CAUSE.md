# MODULE_03_ROOT_CAUSE

## Root Cause Summary

- The shell rebuild was treated as a page replacement instead of a compositional container around the existing app.
- `src/app/page.tsx` now mounts `WorkbenchShell` directly, so the real `StudioApp` entry is no longer the visible homepage surface.
- `WorkbenchShell` keeps its own tool, login, and viewport state, which duplicates the existing product state instead of reusing it.
- The first render depends on JavaScript viewport detection, which makes the initial desktop/mobile frame unstable and screenshot timing unreliable.
- The shell was rebuilt with hardcoded card layers, borders, colors, and radii instead of staying inside the token system.
- The current structure reintroduced nested panels and card-like blocks, so the border hierarchy became heavier again.
- The `AI 图片编辑器` path exists in the product logic but was not carried forward as an explicit navigation entry, so it looks missing even though the underlying capability is still present.
- Screenshot capture happened before the layout had a stable hydrated frame, so the evidence does not reliably reflect the final visual state.
- Validation focused on build success, not on feature preservation, breakpoint behavior, or route-level correctness.

## Business Entry Points

- Home: `src/components/studio-app.tsx`
- Login: `src/app/login/page.tsx` and `src/components/customer-login.tsx`
- Admin providers: `src/app/admin/providers/page.tsx` and `src/components/admin-providers-client.tsx`
- Server capabilities: `src/lib/server/provider-call.ts`, `src/lib/server/providers.ts`, `src/lib/server/admin-auth.ts`

## Reuse Findings

- Reuse business flow, tool switching, provider fetching, generation, job refresh, and library logic from `StudioApp`.
- Reuse `BrandLogo`, `CustomerLogin`, `AdminProvidersClient`, and server helpers as existing product surfaces.
- Reuse the current route structure and account/login entry points.
- Treat the shell as layout only; keep business behavior in the current app layer.

## Wrong Implementations To Replace

- Static shell replacement of the real homepage entry.
- Local fake login state and duplicate tool state.
- JS-driven viewport mode as the source of truth for layout.
- Dense card-stack shell styling that ignores the design token system.
- Implicit omission of `AI 图片编辑器` as a first-class tool entry.

## Recovery Direction

- Recompose the page as `ApplicationContainer -> WorkbenchShell -> slots`.
- Let the shell receive real tool content and preview content through slots or adapters.
- Keep all business state in one place.
- Make responsive behavior depend on CSS breakpoints and tokens first.
- Keep screenshot evidence tied to stable hydrated layout frames.

## Scope Guard

- No `src/**` edits in this phase.
- No new fake data.
- No new login model.
- No new API or route shape.
- No module 4 work.
