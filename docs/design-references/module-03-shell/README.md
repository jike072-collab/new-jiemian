# Module 3 Shell Final Evidence

Captured from the real running app at `http://127.0.0.1:3100/` on 2026-06-18.

## Final screenshots

| File | Viewport | Tool / route | Verified |
| --- | --- | --- | --- |
| `1440x900-ai-image-generator.png` | 1440x900 | AI 图像生成器 | Desktop three columns, text-to-image active, `/login` link |
| `1440x900-ai-image-editor.png` | 1440x900 | AI 图片编辑器 | Independent nav entry, image-to-image active, shared image form |
| `1440x900-ai-video-generator.png` | 1440x900 | AI 视频生成器 | Video form and preview remain in the real shell |
| `1440x900-library.png` | 1440x900 | 作品库 | Filters in parameter column, library browse area in main workspace |
| `1280x800-main.png` | 1280x800 | AI 图像生成器 | Desktop shell remains three columns without horizontal scroll |
| `1024x768-main.png` | 1024x768 | AI 图像生成器 | Tablet landscape compact navigation and no horizontal scroll |
| `768x1024-tablet-portrait.png` | 768x1024 | AI 图像生成器 | Tablet portrait compact navigation and main content preserved |
| `390x844-main.png` | 390x844 | AI 图像生成器 | Mobile parameter view and real bottom action |
| `390x844-mobile-drawer-open.png` | 390x844 | Drawer | Dialog role, overlay, focus entry, login link, tool list |
| `375x812-mobile-params.png` | 375x812 | AI 图像生成器 | Mobile parameter tab and bottom action |
| `375x812-mobile-preview.png` | 375x812 | AI 图像生成器 | Mobile preview tab |

## Browser verification summary

- `AI 图像生成器` maps to `image + text-to-image`.
- `AI 图片编辑器` maps to `image + image-to-image`.
- Switching from image generation to image editing kept the prompt value `模块三状态保持测试`.
- Mobile bottom actions use the same submit functions as the desktop form buttons.
- Drawer exposes `role="dialog"`, `aria-modal="true"`, `aria-controls`, `aria-expanded`, focus entry, body scroll lock, backdrop close, and tool-selection close.
- No horizontal page scroll was detected at 1440x900, 1280x800, 1024x768, 768x1024, 390x844, or 375x812.
- No browser console errors were observed during final local verification.
- The running page did not contain developer-facing copy such as `插槽`, `后续接入`, `已预留`, `默认容器`, `在参数区操作`, `当前保留真实逻辑`, or `safe-area`.

## Notes

- Older `desktop-*`, `tablet-*`, and `mobile-*` files in this folder are retained as previous module 3 evidence.
- Final acceptance evidence is the timestamped viewport set listed above.
