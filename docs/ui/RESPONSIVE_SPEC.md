# RESPONSIVE_SPEC

## Baseline Layout

- Desktop reference is a three-column workspace: left navigation, middle controls, right preview/help area.
- Mobile reference collapses into one vertical flow with a fixed bottom tab bar on the main workspace surface.
- The design should stay dense and task-first, not marketing-first.

## Reference Measurements

### Desktop, observed

- Left rail: about `288-304px` wide depending on page.
- Middle control column: about `356px` wide on the measured pages.
- Right guidance/preview rail: about `677px` wide on the video page, with strong visual weight.
- Main content starts after the fixed left rail and top bar, with about `80px` top offset.

### Mobile, observed

- Viewport: `390x844`.
- Bottom nav: about `56-60px` tall with safe-area padding.
- Main cards: about `350-360px` wide.
- Standard controls: about `42-50px` tall.

## Breakpoints

| Range | Behavior |
| --- | --- |
| `>= 1180px` | Three-column workspace with visible left rail |
| `980px-1179px` | Compact three-column or compressed desktop layout |
| `<= 979px` | Single-column stack; nav collapses into bottom tabs on the main workspace |

## Layout Rules

- Do not center the whole app inside a narrow marketing container.
- Keep main workspace content full-height on desktop.
- Let the middle panel control the flow; the right rail should absorb leftover width.
- On mobile, keep controls vertically stacked and preserve a visible generation CTA.

## Ratio Selector Rules

- Desktop: five equal chips in one row.
- Mobile image page: the selector still renders as one row of fixed boxes, about `59-60px` wide and `96px` tall in the measured capture.
- Video page controls use the same compact chip language for `480P` and `5s` buttons.
- Selected state uses pink fill or a strong pink border.

## Responsive Intent

- Desktop should feel like a serious studio workspace.
- Mobile should keep the same task order, only compressed.
- The right rail may switch from guidance-heavy to preview-heavy, but the control order should not change.
