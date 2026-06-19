# Module 5 Visual Foundation Before Baseline

Source: production preview at `http://127.0.0.1:3103/`

Branch: `feature/05-visual-foundation`

Baseline commit: `fd55897`

Capture date: 2026-06-18

These screenshots were captured before module 5 visual implementation. They are the baseline for Header, Sidebar, shell hierarchy, shared controls, and preview-state regression.

| File | Viewport | Tool | State | Current commit | Issues noted |
| --- | --- | --- | --- | --- | --- |
| `1440x900-ai-image-generator-before.png` | 1440x900 | AI 图像生成器 | Initial no configured model | `fd55897` | Header center repeats current tool; parameter panel shows engineering eyebrow; preview repeats tool name and empty-state text. |
| `1440x900-ai-image-editor-before.png` | 1440x900 | AI 图片编辑器 | Initial no upload | `fd55897` | Sidebar keeps subtitle under each tool; parameter title and inner form title duplicate the tool. |
| `1440x900-ai-video-generator-before.png` | 1440x900 | AI 视频生成器 | Initial | `fd55897` | Preview uses full sample image while library count may be zero; video ratio/control styling differs from image workspace. |
| `1440x900-image-upscale-before.png` | 1440x900 | 图片高清 | Initial | `fd55897` | Upload is native file input style rather than shared compact dropzone; preview sample can look like a real output. |
| `1440x900-video-upscale-before.png` | 1440x900 | 视频高清 | Initial | `fd55897` | Upload and action patterns are not shared with image editor; preview repeats tool title. |
| `1440x900-library-before.png` | 1440x900 | 作品库 | Empty or current library | `fd55897` | Library empty state occupies preview area without unified PreviewState; filter controls use the same shell panel as generation params. |
| `1024x768-tablet-main-before.png` | 1024x768 | AI 图像生成器 | Tablet main | `fd55897` | Tablet narrow rail hides labels but keeps repeated panel titles; navigation icon-only meaning depends on icons. |
| `390x844-mobile-params-before.png` | 390x844 | AI 图像生成器 | Mobile parameter tab | `fd55897` | Mobile header and tabs still show current tool while parameter panel also titles tool; bottom action exists but hierarchy remains busy. |
| `390x844-mobile-drawer-before.png` | 390x844 | AI 图像生成器 | Mobile drawer open | `fd55897` | Drawer keeps full subtitles under each tool; group and entry density is high for scanning. |
| `390x844-mobile-preview-before.png` | 390x844 | AI 图像生成器 | Mobile preview tab | `fd55897` | Preview tab repeats creation preview plus tool title and empty copy; preview state is not a shared component. |

Notes:

- A separate new dev server port was blocked because Next detected an existing dev server for this repository.
- To avoid stale hot-reload state, this baseline was captured from a fresh `npm run build` production preview on port `3103`.
- Screenshots do not include terminal noise, cache folders, or browser profile data.
