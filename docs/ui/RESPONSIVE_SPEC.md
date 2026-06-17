# RESPONSIVE_SPEC

## Baseline Layout

- Desktop reference is a three-column workspace: left navigation, middle controls, right preview/help area.
- Reference observed: mobile reference collapses into one vertical flow with a fixed bottom tab bar on the main workspace surface.
- The design should stay dense and task-first, not marketing-first.

## Reference Measurements

### Desktop, observed

- Left rail: about `288-304px` wide depending on page.
- Middle control column: about `356px` wide on the measured pages.
- Right guidance or preview rail: about `677px` wide on the video page, with strong visual weight.
- Main content starts after the fixed left rail and top bar, with about `80px` top offset.
- Project target:
  - Top bar: `60-64px`
  - Left navigation: `232-248px`
  - Middle parameter column: `380-400px`
  - Right rail: fill remaining width
  - Page gap: `12-16px`
  - No centered `max-width`

### Mobile, observed

- Viewport: `390x844`.
- Bottom nav: about `56-60px` tall with safe-area padding.
- Main cards: about `350-360px` wide.
- Standard controls: about `42-50px` tall.
- Project target:
  - Top brand plus account entry
  - Tool navigation in a drawer or collapsible menu
  - Parameters and preview in tabs
  - Single-column layout
  - Generate button fixed to bottom with safe-area spacing
  - Page-level left and right padding uses `16px`
  - Ratio selector uses horizontal scrolling
  - No page-level horizontal scrolling

## Breakpoints

| Range | Behavior |
| --- | --- |
| `>= 1180px` | Three-column workspace with visible left rail |
| `980px-1179px` | Compact three-column or compressed desktop layout |
| `<= 979px` | Single-column stack; nav collapses into drawer or tabs, not a fixed final conclusion from the reference site |

## Layout Rules

- Do not center the whole app inside a narrow marketing container.
- Keep main workspace content full-height on desktop.
- Let the middle panel control the flow; the right rail should absorb leftover width.
- On mobile, keep controls vertically stacked and preserve a visible generation CTA.
- Treat fixed bottom navigation as a reference-site observation only, not a final project decision.

## Ratio Selector Rules

- Reference observed: the image page shows five options in a single row.
- Project target: each option is a ratio graphic with a label underneath, not a chip row.
- The control should have no outer card, no large colored background, and no consistent box-shape assumption across all options.
- Mobile target: one horizontal scrolling row; do not compress the graphics.
- Default: white outline and white text.
- Hover: outline turns pink.
- Selected: only the ratio graphic and label turn pink.
- Template-related UI stays audit-dependent; do not infer a project component from the reference site alone.

## Responsive Intent

- Desktop should feel like a serious studio workspace.
- Mobile should keep the same task order, only compressed.
- The right rail may switch from guidance-heavy to preview-heavy, but the control order should not change.
