# Module 3 Shell Final Evidence

Captured from the real running app at `http://127.0.0.1:3100/` on 2026-06-18.

Current final commit for this evidence: PR #3 head commit for `fix(ui): close module 3 shell acceptance gaps`.

## Final screenshots

| File | Viewport | Tool / route | Verified |
| --- | --- | --- | --- |
| `1440x900-ai-image-generator.png` | 1440x900 | AI 图像生成器 | Desktop shell, text-to-image entry, real `/login` link, no Issue badge |
| `1440x900-ai-image-editor.png` | 1440x900 | AI 图片编辑器 | Independent nav entry, image-to-image mode, shared image form |
| `1440x900-ai-video-generator.png` | 1440x900 | AI 视频生成器 | Video form and preview remain inside the real shell |
| `1440x900-library.png` | 1440x900 | 作品库 | Filters in parameter column, library browse area in main workspace |
| `1280x800-main.png` | 1280x800 | AI 图像生成器 | Desktop shell remains three columns without horizontal scroll |
| `1024x768-tablet-main.png` | 1024x768 | AI 图像生成器 | Tablet landscape layout without forced desktop compression |
| `768x1024-tablet-main.png` | 768x1024 | AI 图像生成器 | Tablet portrait layout without horizontal scroll |
| `390x844-mobile-parameter.png` | 390x844 | AI 图像生成器 | Mobile parameter tab and real bottom action |
| `390x844-mobile-preview.png` | 390x844 | AI 图像生成器 | Mobile preview tab |
| `390x844-mobile-action.png` | 390x844 | AI 图像生成器 | Mobile bottom action shows `生成图片` and uses the real submit handler |
| `390x844-mobile-drawer-open.png` | 390x844 | Drawer | Full tool names, group labels, selected state, `/login` link, no icon-only menu |
| `375x812-mobile-main.png` | 375x812 | AI 图像生成器 | Narrow mobile layout and login entry state |

## Browser verification summary

- `AI 图像生成器` maps to `image + text-to-image`.
- `AI 图片编辑器` maps to `image + image-to-image`.
- Mobile Drawer no longer passes the compact mode to `ToolButton`; it shows full tool names and descriptions.
- Tablet compact navigation behavior is unchanged.
- Mobile bottom actions use the same submit functions as the desktop form buttons.
- Drawer exposes `role="dialog"`, `aria-modal="true"`, `aria-controls`, `aria-expanded`, focus entry, body scroll lock, backdrop close, and tool-selection close.
- No horizontal page scroll was detected at 1440x900, 1280x800, 1024x768, 768x1024, 390x844, or 375x812.
- Fresh browser verification after the final Drawer patch reported zero new console errors or warnings.
- The Next.js Issue badge text was not present in the final verified page state.
- The running page did not contain developer-facing copy such as `插槽`, `后续接入`, `已预留`, `默认容器`, `在参数区操作`, `当前保留真实逻辑`, `safe-area`, `implementation`, `开发中`, or `待接入`.

## Historical evidence

Older module 3 screenshots were moved to `history/` so they are not mixed with the final acceptance set.

