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
| `--primary` | `#EC4899` | Main accent and active state |
| `--primary-strong` | `#F472B6` | Hover accent |
| `--primary-soft` | `rgba(236,72,153,0.14)` | Selected fill |
| `--success` | `#34D399` | Ready / configured state |
| `--warning` | `#FBBF24` | Missing-key / attention state |

## Typography Tokens

- English and numbers: `Inter`, `system-ui`, `Arial`
- Chinese: `PingFang SC`, `Microsoft YaHei`, `Noto Sans SC`, `sans-serif`
- Base text uses crisp, low-noise contrast; no decorative glow or shadow

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
| `--space-page-mobile` | `12px` | Mobile page padding |
| `--space-panel` | `16px` | Inner panel padding |
| `--space-stack` | `12px` | Tight vertical gap |
| `--space-block` | `20px` | Section separation |

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
- Do not introduce extra palette families before later modules need them.
