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

## Module 3 Implementation Matrix

| Item | Current file | Current problem | Reuse | Planned change | Business impact | Verification |
| --- | --- | --- | --- | --- | --- | --- |
| `page.tsx` | `src/app/page.tsx` | Direct shell mount bypasses the real business container | Yes | Mount `ApplicationContainer` instead of the demo shell | High | home route keeps real tools visible |
| `StudioApp` | `src/components/studio-app.tsx` | Still owns both business flow and old shell structure | Yes | Keep business truth, expose it through slots/controller props | High | image/video/upscale/library still work |
| `WorkbenchShell` | `src/components/workbench-shell.tsx` | Contains fake login, fake viewport, and nested demo cards | Partial | Reduce to layout-only shell with registry-driven regions | High | no duplicate auth/tool state |
| Header | `src/components/workbench-shell.tsx` | Fake header state and redundant account behavior | Partial | Keep real login link and authenticated menu placeholder only | Medium | login link, no fake login toggle |
| Tool registry | `src/lib/workspace-registry.ts` | No shared registry for tool ids, labels, groups, and routes | No | Add one registry used by navigation and shell containers | Medium | route mapping and nav inspection |
| Left navigation | `src/components/workbench-shell.tsx` | Card-heavy rows and duplicated desktop/mobile definitions | Yes | Render from registry with compact dense list styling | Medium | desktop/mobile nav screenshots |
| ToolPanel | `src/components/studio-app.tsx` | Business controls are nested inside the old shell layout | Yes | Keep the active tool form, but expose it through a slot | High | active forms still submit |
| Preview | `src/components/studio-app.tsx` | Placeholder stage cards still imply a second shell | Yes | Host real guide/result/empty preview content in a slot | High | output and empty states remain correct |
| Mobile Drawer | `src/components/workbench-shell.tsx` | Uses shell-local viewport state and demo behavior | Partial | Keep drawer open/close, escape, focus, and body lock only | Medium | drawer closes, scroll locks |
| Params / Tabs | `src/components/workbench-shell.tsx` | Tabs are tied to the old shell demo state | Partial | Keep CSS-driven mobile tabs without duplicating tool state | Medium | parameter/preview switching works |
| Account entry | `src/components/workbench-shell.tsx` | Fake logged-in state and fake user name are still present | Partial | Only show login link without real auth, keep menu for later | Medium | no fake login, `/login` link exists |
| Responsive | `src/components/workbench-shell.tsx` / `styles/tokens.css` | JS viewport detection drives the first layout frame | Yes | Move breakpoint ownership to CSS tokens and classes | High | stable desktop/tablet/mobile frames |
| Token usage | `styles/tokens.css`, `src/app/globals.css` | Shell hardcodes colors and radii outside the token source | Yes | Use token values and stop adding new theme colors | Medium | `#` scan and visual inspection |
| Screenshot script | `docs/design-references/module-03-shell/README.md` | Evidence is not separated into real captured recovery frames | Partial | Keep filtered evidence only and add stable capture notes later | Medium | filename and viewport match |
| New API extension | `docs/architecture/NEW_API_INTEGRATION.md` | No documented boundary for account/payment expansion | No | Add planning only, no front-end secrets or payment wiring | Low | doc review only |

## Final Repair Result

- `src/app/page.tsx` now renders `ApplicationContainer`, and the visible homepage is the real `StudioApp` business surface.
- `StudioApp` uses one active workspace entry state: `activeWorkspaceToolId`.
- Business tool id, image mode, video mode, title, description, navigation highlight, and permission metadata are derived from `workspace-registry`.
- `AI 图像生成器` maps to `image + text-to-image`; `AI 图片编辑器` maps to `image + image-to-image`.
- The image form is shared between generation and editing, and switching those entries no longer remounts the form or clears prompt, upload, ratio, model, or quality state.
- Mobile bottom actions call the same submit functions used by the desktop form buttons.
- The mobile action labels are `生成图片`, `开始编辑`, `生成视频`, and `开始增强`; the library view hides the mobile action slot.
- Header and drawer login entries are real `/login` links when no authenticated session exists.
- The drawer has `role="dialog"`, `aria-modal`, focus return, escape close, backdrop close, body scroll lock restoration, and focus trapping.
- The library now uses the parameter column for filtering/sorting and the main workspace for browsing and detail preview.
- Developer-facing copy was removed from the running shell and tool surfaces.

## Final Verification Notes

- Final browser verification and screenshot evidence are recorded in `docs/design-references/module-03-shell/README.md`.
- `npm run lint`, `npm run typecheck`, and `npm run build` passed on the final revision.
- PR #3 remains the only PR for module 3 and targets `develop`.
- Module 4 remains blocked until manual approval.
