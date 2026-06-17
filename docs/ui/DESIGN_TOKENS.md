# DESIGN_TOKENS

## Source Of Truth

- Primary token file: `styles/tokens.css`
- Baseline origin: the current live app shell plus the measured reference-site surfaces from `aivideomaker.ai`
- Scope: shared design language only, no page implementation

## Color Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--background` | `#050507` | Global page background |
| `--foreground` | `#F7F7F8` | Primary text |
| `--panel` | `#101012` | Main panel surface |
| `--panel-2` | `#141416` | Secondary panel surface |
| `--surface` | `#151517` | Inputs and select surfaces |
| `--border-subtle` | `rgba(255,255,255,0.10)` | Thin separators |
| `--border-strong` | `rgba(255,255,255,0.18)` | Input and selected state border |
| `--muted` | `rgba(255,255,255,0.58)` | Secondary body text |
| `--muted-strong` | `rgba(255,255,255,0.74)` | Strong secondary text |
| `--primary` | `#FF0A6C` | Main accent and active state |
| `--primary-hover` | `#FF2A80` | Hover accent |
| `--primary-active` | `#E90061` | Pressed accent |
| `--primary-soft` | `rgba(255,10,108,0.14)` | Light emphasis only; do not use for ratio, clarity, duration, or other large selected blocks |
| `--success` | `#34D399` | Ready / configured state |
| `--warning` | `#FBBF24` | Missing-key / attention state |

## Typography Tokens

- English and numbers: `Inter`, `system-ui`, `Arial`
- Chinese: `PingFang SC`, `Microsoft YaHei`, `Noto Sans SC`, `sans-serif`
- Base text uses crisp, low-noise contrast; no decorative glow or shadow
- Page title: `24-28px / 600 / 1.2`
- Tool title: `20-22px / 600 / 1.25`
- Module title: `16-18px / 500-600 / 1.3`
- Form label: `14-16px / 500 / 1.35`
- Body: `14px / 400 / 1.5`
- Secondary text: `12-13px / 400 / 1.45`
- Button text: `15-16px / 600 / 1.2`
- Navigation text: `14-16px / 500 / 1.3`

## Radius Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--radius-card` | `12px` | Main panels |
| `--radius-control` | `8px` | Inputs and buttons |
| `--radius-chip` | `999px` | Pills and tags |

## Spacing Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--space-page` | `24px` | Desktop page padding |
| `--space-page-mobile` | `16px` | Mobile page padding |
| `--space-panel` | `16px` | Inner panel padding |
| `--space-stack` | `12px` | Tight vertical gap |
| `--space-block` | `20px` | Section separation |
| `--header-height` | `60px` | Desktop top bar height |
| `--sidebar-width` | `240px` | Desktop navigation width target |
| `--control-panel-width` | `392px` | Desktop parameter column width target |
| `--control-height` | `44px` | Standard control height |
| `--button-height` | `44px` | Primary and secondary button height |
| `--primary-action-height` | `56px` | Desktop primary action height |
| `--primary-action-height-mobile` | `52px` | Mobile primary action height |
| `--mobile-action-bar-height` | `72px` | Mobile fixed action bar height |
| `--touch-target` | `44px` | Minimum touch target |
| `--breakpoint-lg` | `1180px` | Desktop workspace breakpoint |
| `--breakpoint-md` | `980px` | Tablet / compact breakpoint |
| `--breakpoint-sm` | `768px` | Mobile breakpoint |
| `--z-header` | `40` | Sticky top chrome |
| `--z-drawer` | `50` | Mobile drawer |
| `--z-modal` | `60` | Dialogs and overlays |
| `--safe-area-bottom` | `env(safe-area-inset-bottom)` | Bottom CTA spacing |

## Motion Tokens

| Token | Value | Use |
| --- | --- | --- |
| `--motion-fast` | `120ms` | Hover / press feedback |
| `--motion-base` | `180ms` | Control transitions |
| `--motion-slow` | `240ms` | Panel state changes |

## Token Rules

- Keep the system dark and compact.
- Use fill or border emphasis for selected states, not large neon surfaces.
- Inputs, CTA buttons, ratio chips, and admin controls should share one border/radius language.
- `--primary-soft` is for subtle emphasis only and should not create large selected blocks.
- The ratio selector should rely on outline and text state changes, not colored panel fills.
- Primary generation and enhancement actions use the primary action height tokens; ordinary save, cancel, and filter buttons remain at `44px`.
- On mobile, the main action bar is fixed to the bottom and respects safe-area spacing.
- Do not introduce extra palette families before later modules need them.
