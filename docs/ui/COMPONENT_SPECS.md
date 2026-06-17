# COMPONENT_SPECS

## Reference Site Components

### Top Bar

- Height: about `64px`.
- Contains logo area, ZH indicator, and login entry.
- Background is nearly transparent on desktop and dark on smaller screens.

### Sidebar Navigation

- Width: about `288-304px`.
- Fixed to the left on desktop.
- Dense icon-plus-text rows with active highlight.
- Group labels and small badges are compact, not marketing-style cards.

### Middle Control Panel

- Width: about `356px` on the measured reference pages.
- Uses stacked sections: model, template or mode, upload, prompt, ratio, quality, generate.
- Borders are thin and surfaces stay dark.

### Right Rail

- Video page: guidance rail with step cards, arrows, and sample media.
- Image page: sample/result rail with demo content and feature explanations.
- Both feel like a second workspace, not a tiny sidebar tip box.

### Model Selector

- Button-like select surface, dark fill, thin border.
- Height: about `35px` in the measured desktop page.
- Uses a clear active/focus border rather than a big glow.

### Template Strip

- Horizontal strip of small cards.
- Each card is about `64x88px` on desktop.
- “View all” is a light secondary link, not a large CTA.

### Upload Area

- Dark dashed or thin-border surface.
- Optional and required labels sit close to the control.
- Helper text is short and low-noise.

### Prompt Textarea

- Desktop measured size: about `338x135px`.
- Mobile should preserve the counter inside or near the field.
- Placeholder is concise and direct.

### Ratio Selector

- Image page buttons: about `72x96px` on desktop capture and about `59-60x96px` on the mobile capture.
- Buttons keep one consistent box shape and a separate label inside.
- Selected state uses pink fill or a strong pink border.

### Generate Button

- Primary action is wide and clearly separated from secondary controls.
- Disabled state is visibly muted.

## Reuse Notes

- Keep the same border, radius, and dark-surface language across frontend, login, and admin surfaces.
- The current app can reuse the same token family for controls even if the page structure remains different.
