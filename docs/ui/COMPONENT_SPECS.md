# COMPONENT_SPECS

## Reference Site Components

### Top Bar

- Reference observed: about `64px` high.
- Reference observed: logo area, language indicator, and login entry.
- Project target: left logo plus `奥皇 AI`, no circular logo frame, right account/login entry, and no language switcher.
- The top bar should stay compact and visually light on desktop.

### Sidebar Navigation

- Reference observed: about `288-304px` wide.
- Project target: about `232-248px` wide on desktop.
- Fixed to the left on desktop.
- Dense icon-plus-text rows with active highlight.
- Group labels and small badges stay compact and task-first.

### Middle Control Panel

- Reference observed: about `356px` wide on the measured pages.
- Project target: about `380-400px` wide on desktop.
- Uses stacked sections: model, template or mode, upload, prompt, ratio, quality, generate.
- Borders are thin and surfaces stay dark.

### Right Rail

- Video page: guidance rail with step cards, arrows, and sample media.
- Image page: sample/result rail with demo content and feature explanations.
- Both feel like a second workspace, not a tiny sidebar tip box.
- Project target: occupy the remaining width and avoid a centered max-width container.

### Model Selector

- Button-like select surface, dark fill, thin border.
- Reference observed: about `35px` high in the measured desktop page.
- Project target: keep a compact single-row control with a clear active/focus border and no glow.

### Template Strip

- Horizontal strip of small cards.
- Each card is about `64x88px` on desktop.
- "View all" is a light secondary link, not a large CTA.

### Upload Area

- Dark dashed or thin-border surface.
- Optional and required labels sit close to the control.
- Helper text is short and low-noise.

### Prompt Textarea

- Reference observed: desktop measured size is about `338x135px`.
- Project target: compact textarea with counter visible inside or adjacent to the field.
- Mobile should preserve the counter inside or near the field.
- Placeholder is concise and direct.

### Ratio Selector

- Reference observed: the image page shows five ratio choices in a single horizontal row.
- Project target: graphics-first ratio control with no outer card, no large background, and no unified dark button box.
- Each option uses a real ratio graphic above a label below, all centered in a shared drawing area so the row does not jump vertically.
- Default state: transparent background, white `1px` outline, white text.
- Hover: outline turns pink.
- Selected: only the ratio graphic outline or fill and the label turn pink.
- Mobile target: keep one horizontal row with horizontal scrolling, without compressing the graphics.
- Suggested graphic sizes: `1:1 36x36px`, `16:9 46x26px`, `9:16 24x42px`, `4:3 42x31px`, `3:4 29x40px`.
- Do not describe the control as equal chips, a chip row, or a unified rounded box row.

### Generate Button

- Primary action is wide and clearly separated from secondary controls.
- Disabled state is visibly muted.
- Project target: keep a strong primary button with a clear disabled state and no oversized background block.

## Reuse Notes

- Keep the same border, radius, and dark-surface language across frontend, login, and admin surfaces.
- The current app can reuse the same token family for controls even if the page structure remains different.
