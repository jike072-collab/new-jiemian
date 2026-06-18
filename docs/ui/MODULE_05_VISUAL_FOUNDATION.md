# Module 5 Visual Foundation Audit

Status: module 5 implementation and acceptance completed. Waiting for human review before merge or module 6.

Branch: `feature/05-visual-foundation`
Baseline commit: `fd55897`
Target branch: `develop`
Reference evidence: `docs/design-references/module-05-visual-foundation/before/`
After evidence: `docs/design-references/module-05-visual-foundation/after/`

## Scope

Module 5 owns global visual foundation, shell information hierarchy, Header and Sidebar refinement, shared form and preview components, and visual regression rules.

Module 5 is not the video generator module. Video generator business work remains deferred to module 6.

## A/B Boundary

A-side module 5 may touch Header, Sidebar, WorkbenchShell hierarchy, dark visual layers, typography, borders, spacing, radius, scrollbars, panel titles, upload controls, ratio controls, mode controls, primary action area, preview states, responsive visual consistency, screenshots, and regression rules.

A-side module 5 must not touch New API deployment, New API ports, Docker, database, Redis, BFF, backend auth/session, user mapping, quota, usage, recharge, payment, payment callbacks, reconciliation, or B-side branches.

No fake model, fake balance, fake quota, or fake result may be introduced when a real model is unavailable.

## Before Baseline

Screenshots were captured from a production preview at `http://127.0.0.1:3103/` using commit `fd55897`.

The requested new dev port was blocked because Next detected an existing dev server for this repository. To avoid stale dev state, the baseline uses a fresh `npm run build` production preview from the current branch head.

| File | Viewport | Tool | State | Main issue captured |
| --- | --- | --- | --- | --- |
| `1440x900-ai-image-generator-before.png` | 1440x900 | AI image generator | Initial no configured model | Header, parameter, and preview repeat the same tool identity. |
| `1440x900-ai-image-editor-before.png` | 1440x900 | AI image editor | Initial no upload | Sidebar subtitles and inner form title increase scan cost. |
| `1440x900-ai-video-generator-before.png` | 1440x900 | AI video generator | Initial | Preview shows a full sample image while the library count says zero. |
| `1440x900-image-upscale-before.png` | 1440x900 | Image upscale | Initial | Upload uses native file styling instead of a shared compact upload pattern. |
| `1440x900-video-upscale-before.png` | 1440x900 | Video upscale | Initial | Upload/action patterns diverge from image workflows. |
| `1440x900-library-before.png` | 1440x900 | Library | Empty/current library | Library state is not using a unified preview/empty state. |
| `1024x768-tablet-main-before.png` | 1024x768 | AI image generator | Tablet main | Icon-only navigation hides meaning and repeated titles remain. |
| `390x844-mobile-params-before.png` | 390x844 | AI image generator | Mobile parameter tab | Mobile title, tabs, and parameter panel compete for hierarchy. |
| `390x844-mobile-drawer-before.png` | 390x844 | AI image generator | Mobile drawer open | Drawer keeps subtitles for every tool, making scan density high. |
| `390x844-mobile-preview-before.png` | 390x844 | AI image generator | Mobile preview tab | Preview repeats tool title and empty copy. |

## Information Hierarchy

Final ownership for module 5:

| Area | Owns | Must not own |
| --- | --- | --- |
| Header | Brand, global actions, account entry | Current tool title when desktop Sidebar already anchors tool identity |
| Sidebar | Tool location and current selection | Long per-tool explanations in the default desktop list |
| Parameter panel | Tool name, one-line description, parameters | Engineering label such as `参数区`; second inner tool title |
| Preview panel | `创作预览`, `生成结果`, and current state content | Another copy of the current tool title or a generic `工作区` label |

Tool names may appear once in Sidebar and once as the parameter panel title. Preview content should describe state, not repeat tool identity.

## Audit Matrix

| Area | Current file | Current behavior | Specific issue | Reference-site behavior | Borrow? | Planned change | Impacted pages | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Header menu | `src/components/workbench-shell.tsx`, `src/app/globals.css` | Menu button is visually present on desktop even though desktop nav is fixed. | Desktop menu has no useful action and competes with the brand. | Reference workspace keeps desktop nav visible and only uses drawer on small screens. | Yes | Hide menu on desktop fixed-sidebar layouts; keep it for tablet/mobile drawer. | All workspace pages | 1440 screenshot, keyboard focus order |
| Header center title | `src/components/workbench-shell.tsx` | Center shows active tool label. | Repeats Sidebar and parameter title. | Reference header is mostly brand/account oriented. | Yes | Remove desktop Header current-tool title. | All workspace pages | Header text audit at 1440/390 |
| Header account | `src/components/workbench-shell.tsx` | Login link is right aligned and real. | Size is acceptable, but center title makes spacing feel crowded. | Account entry is simple and right aligned. | Yes | Keep real `/login` link; do not add fake user state. | All workspace pages | Link target check |
| Sidebar background | `src/app/globals.css` | Sidebar sits on near-page background with active item as a heavy wine block. | Active surface is stronger than needed and page/sidebar separation is soft. | Reference uses a dark rail with concise selected emphasis. | Yes | Keep darkest rail; lighten selected state to pink text/icon plus soft surface or 2px indicator. | Desktop and drawer nav | Screenshot compare |
| Sidebar subtitles | `src/components/workbench-shell.tsx`, `src/lib/workspace-registry.ts` | Every desktop item shows `description`. | Slows scanning and repeats parameter-panel explanations. | Reference nav prioritizes compact tool names. | Yes | Hide desktop persistent descriptions; keep registry descriptions for panel/drawer/context where needed. | All nav groups | Desktop and mobile nav screenshots |
| Sidebar group spacing | `src/app/globals.css` | Group spacing is readable but active item height varies with subtitles. | Harder to scan vertically. | Compact fixed-height rows. | Yes | Normalize item height around 38-42px. | Sidebar/drawer | Computed visual check |
| Bottom `N` icon | N/A in current shell | No bottom circular `N` appears in current screenshots. | No action needed unless it returns. | Reference account/status icons need clear purpose. | No | Keep absent; any future bottom icon needs label and action. | Sidebar | Screenshot check |
| Parameter shell title | `src/components/workbench-shell.tsx` | Eyebrow says `参数区`, title repeats tool. | Engineering term should not be visible. | Reference uses direct tool title and concise instruction. | Yes | Remove `参数区`; keep tool title plus one-line description. | All parameter panels | Text scan |
| Inner form title | `src/components/studio-app.tsx` | `FormPanel` repeats tool title inside parameter slot. | Creates second tool title in the same column. | Reference panel has one clear title. | Yes | Convert inner title to content section or remove when shell already owns title. | Image/video/upscale | Text scan and screenshot |
| Field spacing | `src/app/globals.css` | Field labels, required marks, and help copy are functional. | Required stars and focus pink can over-concentrate pink. | Reference uses selective accent. | Partial | Keep required semantics; reduce accent competition in module 5 implementation. | Form controls | Visual check |
| Select/textarea/upload heights | `src/app/globals.css`, `src/components/studio-app.tsx` | Select and textarea are tokenized; uploads differ between image editor and video/upscale native input. | Shared upload experience is inconsistent. | Reference uses compact card-like dropzone. | Yes | Plan `CompactDropzone` as a shared display component around real file state. | Image, editor, video, upscale | Upload state screenshots |
| Primary action | `src/components/studio-app.tsx`, `src/app/globals.css` | Desktop action sits inside form content and may scroll away. | Main action should remain visible at bottom of parameter panel. | Reference keeps main action anchored. | Yes | Plan `StickyPrimaryAction`; desktop footer and mobile bar share real submit state. | All generation/upscale tools | Scroll check |
| Preview shell title | `src/components/workbench-shell.tsx` | Preview shell says `工作区`, title active tool, description generic result copy, chip repeats tool. | Four labels fight for one preview area. | Reference preview/guidance area has state-focused title. | Yes | Shell should only frame preview; preview slot owns `创作预览` or `生成结果`. | All preview pages | Text scan |
| Preview sample vs count | `src/components/studio-app.tsx` | Video/upscale preview can show large sample image while count says `0 条作品`. | Looks like a real generated result despite no real output. | Reference examples are visually labelled as guidance. | Partial | Mark samples as example effects or remove full-result-like samples when count is zero. | Video/upscale preview | Screenshot check |
| Preview nesting | `src/components/workbench-shell.tsx`, `src/components/studio-app.tsx` | Shell panel plus preview state plus media/empty boxes create multiple borders. | Border hierarchy is heavier than intended. | Reference uses fewer framed layers. | Yes | Plan one preview container plus state content; reduce nested card borders. | Preview panels | Border count check |
| Ratio controls | `src/components/studio-app.tsx`, `src/app/globals.css` | Image ratio shapes are close to spec; video has separate implementation. | Labels can sit on different perceived baselines; implementations are duplicated. | Reference uses fixed drawing area and aligned labels. | Yes | Plan `AspectRatioSelector` with fixed graphic well and equal label row. | Image/editor/video | Baseline screenshot |
| Mode switch | `src/components/studio-app.tsx` | `ModeSwitch` is shared inside StudioApp. | Needs to become an explicit shared display component with fixed semantics. | Reference uses compact segmented control. | Yes | Plan `ModeSegmentedControl` with `aria-pressed` and no duplicate labels. | Image/video/library filters | Keyboard and text checks |
| Loading/error/success | `src/components/studio-app.tsx` | States exist but are implemented separately across image preview, output panel, library, and provider messages. | State copy and visual density diverge. | Reference separates guidance, loading, and result states. | Yes | Plan `PreviewState` for initial/ready/loading/error/success. | Preview area | State screenshots |
| Global layers | `styles/tokens.css`, `src/app/globals.css` | Dark tokens exist; some surfaces and borders are similar in brightness. | Page/sidebar/panel/input hierarchy needs clearer depth. | Reference has strong dark base with slightly lifted panels. | Yes | Adjust existing tokens gradually, not by adding many colors. | All surfaces | Before/after visual diff |
| Text contrast | `styles/tokens.css`, `src/app/globals.css` | `--muted` is low for repeated nav descriptions. | Some secondary text is too weak for dense scanning. | Reference keeps nav labels readable. | Yes | Raise ordinary nav label contrast, keep helper text secondary. | Sidebar/forms | Contrast spot check |
| Pink usage | `src/app/globals.css` | Pink appears on active nav, selected controls, required marks, links, buttons, and focus. | Too many simultaneous accents. | Reference reserves accent for current selection and primary action. | Yes | Keep pink for active item, primary action, focus, necessary links; tone down secondary accents. | All controls | Color usage scan |
| Scrollbars | `src/app/globals.css` | Browser default scrollbars are thick/bright in panels. | Scrollbars draw too much attention in screenshot. | Reference has quieter scroll indicators. | Yes | Plan `WorkspaceScrollbar` global class for Chromium and Firefox. | Sidebar/parameter/preview | Screenshot at scrolled positions |
| Horizontal overflow | Screenshots | Baseline did not show horizontal overflow in captured states. | Keep as regression gate. | Reference also avoids page-level horizontal scroll. | Yes | Add visual regression rule. | Desktop/tablet/mobile | Browser measurement |

## Shared Component Plan

| Component | Current repeated implementation | Unified props | Business state owner | Tools using it | Module 4 impact | Avoiding duplicate state |
| --- | --- | --- | --- | --- | --- | --- |
| `ToolPanelHeader` | Shell header plus `FormPanel` inner title | `title`, `description`, optional `status` | `StudioApp` derives active tool from registry | All workspace tools | Removes duplicate visual title, preserves state | Pure display only |
| `AspectRatioSelector` | `RatioPicker`; video ratio controls in video form | `label`, `value`, `options`, `onChange`, `ariaLabel` | Existing controller/form state | Image generator, image editor, video generator | Keeps current ratio values | Controlled value and callback only |
| `CompactDropzone` | Image upload card and native `FileInput` | `label`, `required`, `accept`, `multiple`, `files`, `error`, `onFilesChange`, `onRemove`, `onClear` | Existing file state in StudioApp/tool forms | Image editor, optional image references, video/image upscale, image-to-video | No business change | File validation remains in current owner |
| `ModeSegmentedControl` | `ModeSwitch` | `label`, `value`, `options`, `onChange`, `groupId` | Existing active mode/tool state | Image, video, library filter/sort | Preserves `aria-pressed` fix | Controlled only |
| `StickyPrimaryAction` | `SubmitButton`, `MobileActionBar`, shell footer | `label`, `loadingLabel`, `loading`, `disabled`, `onClick`, optional `help` | Existing submit controller | Image, editor, video, upscales | Maintains shared submit function | No DOM click or second submit path |
| `PreviewState` | `ImagePreviewPanel`, `OutputPanel`, `studio-empty`, library states | `state`, `title`, `description`, `actions`, `media`, `count`, `isExample` | Existing output/job/library state | All preview pages | Keeps real-only success rule | Takes real output as props |
| `FieldGroup` | `FieldFrame`, `StackedControl`, provider/upload field wrappers | `label`, `required`, `hint`, `error`, `children` | Existing form state | All forms | Keeps labels and error semantics | Display wrapper only |
| `WorkspaceScrollbar` | Browser defaults in shell bodies | CSS class or global panel selector | CSS only | Sidebar, parameter body, preview body, drawer | No state impact | Styling only |

## Token Planning

No large new palette should be added in segment 2. Prefer tuning existing variables:

| Token area | Current | Recommendation |
| --- | --- | --- |
| Page background | `--background: #050507` | Keep as deepest layer. |
| Sidebar background | Shares page/panel treatment | Keep close to page background; active item should not become a thick block. |
| Main panel | `--panel: #101012` | Keep slightly lifted from page. |
| Input/upload surface | `--surface: #151517` | Use consistently for controls and dropzones. |
| Hover surface | Color-mix per component | Consider one shared hover surface derived from existing `--surface`. |
| Primary text | `--foreground` | Keep. |
| Secondary text | `--muted`, `--muted-strong` | Use `--muted-strong` for nav labels and `--muted` for helper text. |
| Group text | Color-mixed `--muted` | Increase enough to remain readable. |
| Normal border | `--border-subtle` | Lower perceived brightness where nested borders stack. |
| Strong border | `--border-strong` | Reserve for focus/hover, not every card. |
| Pink primary | `--primary` family | Keep for active nav, primary buttons, focus, necessary links. |
| Pink soft | `--primary-soft` | Use lightly; avoid large wine blocks. |
| Error/warning/success | Existing variables | Keep real semantic usage; do not use pink as every error border if a true error token is needed later. |

## Planned File Scope For Segment 2

Likely implementation files:

- `src/components/workbench-shell.tsx`
- `src/components/studio-app.tsx`
- `src/app/globals.css`
- `styles/tokens.css`
- New shared display component file only if it reduces real duplication, for example `src/components/workspace-controls.tsx`
- `docs/ui/MODULE_05_VISUAL_FOUNDATION.md`
- `docs/ui/IMPLEMENTATION_BOARD.md`
- `docs/ui/REVIEW_GATES.md`

Files that must stay out of scope:

- Docker and New API configuration
- Backend auth/session/quota/payment files
- B-side integration branches
- Provider secrets and environment files

## Regression Rules For Segment 2 And 3

- Capture before/after screenshots for public shell and shared component changes.
- Verify no duplicate visible tool title in Header, parameter content, and preview content.
- Verify desktop Header menu button is hidden when fixed Sidebar is present.
- Verify mobile Drawer still opens, traps focus, closes by Escape/overlay, and restores scroll.
- Verify Sidebar desktop list no longer permanently shows every description.
- Verify ratio labels share one baseline.
- Verify upload controls do not expose native file input chrome as the visible primary surface.
- Verify primary action stays visible and does not cover the final field.
- Verify no page-level horizontal overflow at 1440, 1024, 768, 390, and 375 widths.
- Verify build success does not replace visual screenshot review.

## Segment 2 Implementation Result

Segment 2 implemented the shell hierarchy and shared visual controls without changing backend APIs, authentication, quota, payment, New API configuration, or B-side integration code.

### Information Hierarchy

- Header now owns only brand, real global actions, and login/account entry.
- Desktop Header no longer displays the active tool title.
- Parameter panel owns the active tool title and one-line description from the registry.
- WorkbenchShell preview panel no longer writes shell-level `工作区`, active tool title, or generic result copy.
- Preview slots now own `创作预览`, `处理中`, `失败`, and `生成结果` states.
- `FormPanel` no longer repeats the current tool title inside the parameter column.

### Header And Sidebar

- Desktop fixed Sidebar keeps the hamburger button hidden.
- Tablet and mobile keep the Drawer menu button and existing Drawer focus, Escape, overlay, and scroll-lock behavior.
- Desktop Sidebar hides persistent tool descriptions and keeps compact tool rows.
- Active desktop navigation now uses pink text/icon, a light pink surface, and a narrow left indicator instead of a heavy block.
- The old unclear bottom `N` icon remains absent.

### Shared Controls

| Component | Implemented in | Users | State source |
| --- | --- | --- | --- |
| `AspectRatioSelector` | `src/components/studio-app.tsx` | Image generator, image editor, video generator | Existing controlled ratio state |
| `CompactDropzone` | `src/components/studio-app.tsx` | Image references, video references, image upscale, video upscale | Existing file/upload state |
| `StickyPrimaryAction` | `src/components/studio-app.tsx` | Image, editor, video, image upscale, video upscale | Existing submit functions and loading/disabled state |
| `PreviewState` | `src/components/studio-app.tsx` | Image preview and non-image output preview | Existing output/job/error/library state |

`AspectRatioSelector` uses fixed graphic and label areas so labels align across `1:1`, `16:9`, `9:16`, `4:3`, and `3:4`. It keeps `aria-pressed` and does not own ratio state.

`CompactDropzone` provides one visible upload surface with drag, keyboard activation, replace, delete, and thumbnail/list states. It delegates validation and object URL cleanup to the existing owners.

`StickyPrimaryAction` keeps the main desktop action visible at the bottom of the parameter panel and continues to share the same submit function used by the mobile action bar.

`PreviewState` centralizes initial, loading, error, and result framing. Example media is marked as `示例效果`; real success still requires real output data.

### Visual And Scrollbar Changes

- Page/sidebar remain the deepest layer, panels remain slightly lifted, and input/upload controls remain on the `--surface` layer.
- No new component-level theme hex colors were added; shell changes use existing tokens and color-mix from tokens.
- Sidebar, Drawer, parameter body, and preview body use a quieter 6px scrollbar in Chromium and thin scrollbar settings in Firefox.
- Page-level scrolling remains avoided on desktop; Sidebar scrolls only for long navigation, while parameter and preview bodies own their own scroll.

### Segment 2 Verification

- `npm run lint`: passed after excluding local `.chrome-stage5` browser-profile cache from ESLint scanning.
- `npm run typecheck`: passed.
- `npm run build`: passed with Next.js production build and all app routes generated.
- `git diff --check`: passed.
- 1440x900 desktop: Header has no active tool title, fixed Sidebar has no persistent descriptions, hamburger menu is hidden, parameter width is 392px, preview uses remaining width, ratio labels share one baseline, and no horizontal overflow was detected.
- 1280x800 desktop: three-column shell remains visible with 240px navigation, 392px parameter panel, remaining preview panel, no duplicate shell wording, no horizontal overflow, and no console warnings/errors.
- 1024x768 tablet landscape: compact navigation plus parameter and preview columns fit without horizontal overflow.
- 768x1024 tablet portrait: compact navigation remains visible, parameter and preview columns fit without page-level horizontal overflow.
- 390x844 and 375x812 mobile: Drawer menu appears, fixed Sidebar is hidden, parameter tab is active by default, mobile action slot is visible, and no horizontal overflow was detected.
- Mobile Drawer: opening locks body scroll and focuses the close button; selecting `AI 图片编辑器` closes the drawer and synchronizes title plus bottom button to `开始编辑`; Escape closes the drawer, restores body overflow, and returns focus to the menu button.
- Browser console: no captured error or warning logs during the 1280x800 production-preview check.
- Next.js Issue marker: not detected in the checked production-preview states.

### Remaining Segment 3 Work

- Completed in segment 3: after screenshots, visual comparison, quality checks, Draft PR.

## Segment 3 Acceptance Result

Segment 3 ran against the real production preview at `http://127.0.0.1:3104/` from the latest module 5 branch. It included one small visual hierarchy patch: `PreviewState` now hides the eyebrow when the eyebrow and title are identical, preventing the initial preview from showing `创作预览` twice.

## Final Patch 2 Result

Final patch 2 closes the visual parity and image-mode gaps found during PR #18 review.

- Image workspace mode source: the shared `imageWorkspace` state now owns `mode` in addition to provider, ratio, quality, prompt, files, errors, and loading. `AI 图像生成器` and `AI 图片编辑器` still share the same image business state and `/api/generate/image` submit path.
- Image generator mapping: `AI 图像生成器` opens the shared image workspace in `text-to-image` and exposes a `文生图 / 图生图` segmented control. Switching to `图生图` changes the upload requirement, prompt guidance, preview guidance, validation, and submit copy through the real mode state.
- Image editor mapping: `AI 图片编辑器` remains a separate navigation entry and sets the same image workspace mode to `image-to-image` by default. It does not create another model, upload, prompt, submit, result, or library state.
- Shared mode control: `ModeSegmentedControl` is the shared segmented display used by image mode, video mode, image quality, upscale scale, and library filters. It remains controlled by caller state and uses `aria-pressed`.
- Ratio visual refinement: `AspectRatioSelector` remains shared by image generation, image editing, and video generation. The active state now emphasizes fill and label color with a lighter outer border, while keeping equal graphic wells and aligned labels.
- Color hierarchy: Sidebar is the deepest layer; parameter and preview panels use distinguishable raised surfaces; upload/input areas use a clearer inner surface. Navigation text contrast was raised without restoring a heavy selected block.
- Sticky primary action: desktop action remains naturally after short content and sticky at the panel bottom for longer content with a stronger background separation. Mobile keeps the shell bottom action and does not duplicate the internal desktop button.
- Unicode safety: scanned `src/`, `docs/`, `AGENTS.md`, and current modified files for U+202A-U+202E and U+2066-U+2069; result is zero matches.
- Screenshot evidence: refreshed final patch 2 screenshots are stored in `docs/design-references/module-05-visual-foundation/final-patch-2/`. They were captured from the real Next dev server on `http://127.0.0.1:3100/` because the running production preview on `http://127.0.0.1:3104/` returned 500 for its CSS chunk during screenshot capture; production `npm run build` still passed separately.
- Final patch 2 browser audit: `acceptance-report.json` records no horizontal overflow, no Next.js issue marker, no repeated engineering copy, text/image mode changes, editor default `图生图`, aligned desktop ratio labels, and mobile internal sticky action hidden.

### Final Patch 2 Screenshot Set

| File | Viewport | Surface | Validation focus |
| --- | --- | --- | --- |
| `1440x900-ai-image-generator-text-to-image-final-patch2.png` | 1440x900 | AI image generator | `文生图` selected, optional reference image, shared ratio and mode controls |
| `1440x900-ai-image-generator-image-to-image-final-patch2.png` | 1440x900 | AI image generator | `图生图` selected, required reference image, `开始编辑` action |
| `1440x900-ai-image-editor-final-patch2.png` | 1440x900 | AI image editor | Independent nav entry defaults to shared image `图生图` mode |
| `1440x900-ai-video-generator-text-to-video-final-patch2.png` | 1440x900 | AI video generator | Shared mode control and ratio selector in text-to-video |
| `1440x900-ai-video-generator-image-to-video-final-patch2.png` | 1440x900 | AI video generator | Shared mode control in image-to-video |
| `1440x900-image-upscale-final-patch2.png` | 1440x900 | Image upscale | Color hierarchy, dropzone, and `开始增强` action |
| `1024x768-tablet-main-final-patch2.png` | 1024x768 | Tablet main | Tablet layout without horizontal overflow |
| `390x844-mobile-params-final-patch2.png` | 390x844 | Mobile params | Mobile bottom action remains the only visible primary action |
| `1440x900-mode-switch-closeup-final-patch2.png` | 1440x900 | Mode segmented control | Shared segmented visual and pressed state |
| `1440x900-ratio-selector-closeup-final-patch2.png` | 1440x900 | Ratio selector | Lighter item chrome, stronger active fill, aligned labels |
| `1440x900-sidebar-color-closeup-final-patch2.png` | 1440x900 | Sidebar | Darkest layer and clearer nav text |
| `1440x900-sticky-primary-action-final-patch2.png` | 1440x900 | Sticky action | Sticky action background separation |
| `acceptance-report.json` | N/A | Machine-readable report | Browser audit result, failed list is empty |

### After Screenshot Set

| File | Viewport | Surface | Validation focus |
| --- | --- | --- | --- |
| `1440x900-ai-image-generator-after.png` | 1440x900 | AI image generator | Header, Sidebar, parameter title, ratio selector, preview state |
| `1440x900-ai-image-editor-after.png` | 1440x900 | AI image editor | Required upload state, editor title, primary action |
| `1440x900-ai-video-generator-after.png` | 1440x900 | AI video generator | Shared ratio selector, video parameters, example preview badge |
| `1440x900-image-upscale-after.png` | 1440x900 | Image upscale | Shared dropzone and `开始增强` action |
| `1440x900-video-upscale-after.png` | 1440x900 | Video upscale | Shared dropzone and dependency status area |
| `1440x900-library-after.png` | 1440x900 | Library | Library filter column and empty/preview area |
| `1280x800-main-after.png` | 1280x800 | Main workspace | Desktop three-column fit |
| `1024x768-tablet-main-after.png` | 1024x768 | Tablet landscape | Compact nav plus two work columns |
| `768x1024-tablet-main-after.png` | 768x1024 | Tablet portrait | No horizontal overflow at narrow tablet width |
| `390x844-mobile-params-after.png` | 390x844 | Mobile params | Drawer button, tabs, bottom action |
| `390x844-mobile-drawer-after.png` | 390x844 | Mobile drawer | Drawer surface, overlay, navigation density |
| `390x844-mobile-preview-after.png` | 390x844 | Mobile preview | Preview tab and state hierarchy |
| `1440x900-aspect-ratio-closeup-after.png` | 1440x900 | Ratio selector | Equal wells and aligned labels |
| `1440x900-upload-closeup-after.png` | 1440x900 | Upload control | Thumbnail state, replace/delete actions |
| `1440x900-sticky-primary-action-closeup-after.png` | 1440x900 | Primary action | Fixed action sizing and visibility |
| `acceptance-report.json` | N/A | Machine-readable report | Audits, console logs, admin route check |

### Before/After Comparison

| Area | Before problem | After result | Evidence | Impacted pages | Remaining issue |
| --- | --- | --- | --- | --- | --- |
| Header | Header center repeated the active tool name and desktop menu could appear without useful purpose. | Header now shows brand plus real login/account entry; desktop menu is hidden when fixed Sidebar is present. | `before/1440x900-ai-image-generator-before.png`, `after/1440x900-ai-image-generator-after.png` | All workspace pages | None found. |
| Sidebar | Tool items permanently showed subtitles, making scanning slower. | Desktop Sidebar is a compact icon/name list with 40px rows; drawer keeps descriptions where helpful. | `before/1440x900-ai-image-editor-before.png`, `after/1440x900-ai-image-editor-after.png`, `after/390x844-mobile-drawer-after.png` | Desktop Sidebar and mobile Drawer | None found. |
| Title hierarchy | Header, parameter panel, inner form, and preview could repeat tool identity. | Tool title appears in Sidebar and parameter title; preview states no longer repeat tool names, and duplicate `创作预览` was removed in segment 3. | `after/1440x900-ai-image-generator-after.png`, `after/390x844-mobile-preview-after.png` | All tools | None found. |
| Dark grayscale | Sidebar, panels, and inputs had softer separation. | Page/Sidebar stay deepest, panels are lifted, inputs/dropzones use the surface layer. | `after/1280x800-main-after.png` | All workspace pages | Fine tuning can continue only in a future visual module. |
| Navigation selected state | Active item used a heavier block. | Active state uses pink text/icon, light pink surface, and left indicator. | `after/1440x900-ai-image-generator-after.png` | Sidebar and Drawer | None found. |
| Aspect ratio | Ratio controls were duplicated and labels could drift. | `AspectRatioSelector` is shared by image, editor, and video; desktop/tablet labels share one baseline. | `after/1440x900-aspect-ratio-closeup-after.png`, `after/1440x900-ai-video-generator-after.png` | Image generator, image editor, video generator | On mobile the selector intentionally wraps into two columns, so not all labels share one global line. |
| Upload | Image and upscale upload surfaces differed; upscales exposed native file input styling. | `CompactDropzone` provides a shared one-border surface, thumbnail state, replace/delete actions, and no visible native file input. | `before/1440x900-image-upscale-before.png`, `after/1440x900-upload-closeup-after.png` | Image editor, optional image reference, video reference, upscales | Object URL cleanup remains owned by existing business state. |
| Primary action | Desktop action could scroll with form content and sizes varied. | `StickyPrimaryAction` keeps a full-width 48px desktop action visible; mobile still uses the real mobile action slot. | `after/1440x900-sticky-primary-action-closeup-after.png`, `after/390x844-mobile-params-after.png` | Image, editor, video, upscales | None found. |
| Preview state | Preview shell repeated `工作区`, active tool, and generic result copy; examples looked like real results. | `PreviewState` owns initial/loading/error/result structure; examples are marked `示例效果`; success still requires real output. | `before/1440x900-ai-video-generator-before.png`, `after/1440x900-ai-video-generator-after.png` | All preview pages | No fake success result was created. |
| Scrollbars | Default scrollbars were bright and inconsistent. | Sidebar, Drawer, parameter body, and preview body use quiet 6px Chromium scrollbars and thin Firefox scrollbar settings. | `after/1280x800-main-after.png` | Desktop/tablet shell | Firefox visual was CSS-reviewed; Chromium was browser-captured. |
| Desktop | Three columns needed confirmation after shared control changes. | 1440x900 and 1280x800 audits show no horizontal overflow and expected nav/control/preview ownership. | `after/1440x900-ai-image-generator-after.png`, `after/1280x800-main-after.png`, `acceptance-report.json` | Desktop workbench | None found. |
| Tablet | Narrow tablet could squeeze content. | 1024x768 and 768x1024 screenshots show no horizontal overflow. | `after/1024x768-tablet-main-after.png`, `after/768x1024-tablet-main-after.png` | Tablet workbench | Preview width is naturally tighter at 768px but remains usable. |
| Mobile | Header/Drawer/tabs/bottom action needed final evidence. | 390x844 screenshots show params, Drawer, preview tab, and bottom action without horizontal overflow. | `after/390x844-mobile-params-after.png`, `after/390x844-mobile-drawer-after.png`, `after/390x844-mobile-preview-after.png` | Mobile workbench | Keyboard-open interaction was not screen-recorded; layout keeps normal scroll and bottom safe-area spacing. |

### Final Browser Acceptance

- All checked tools switched successfully: AI image generator, AI image editor, AI video generator, image upscale, video upscale, library.
- Admin settings entry navigated to `/admin/providers`; the route rendered and had no horizontal overflow.
- Header did not contain active tool titles in captured states.
- Sidebar did not show persistent subtitles on desktop.
- No checked state contained `参数区`, `工作区`, `生成结果将在这里显示`, or `创建视频与图片`.
- No visible native file input appeared in checked upload states.
- Desktop/tablet ratio labels aligned on one baseline; mobile intentionally wraps.
- Console and runtime logs in `acceptance-report.json` were empty.
- No Next.js Issue, hydration, or runtime error marker was detected.
- No B-side files were changed.

### Final Quality Checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Hardcoded color scan over module 5 shell/shared files found no new component-level theme hex colors.
- `any` scan over touched shell/shared source found no added meaningless `any`.

## Final Visual Closeout

This closeout finalizes the shared ratio selected state and replaces the earlier development-server evidence with clean production-preview screenshots from the current branch head.

- Ratio selected state: `AspectRatioSelector` now keeps the outer button surface transparent in both idle and selected states. The selected state is expressed by the ratio shape itself using the pink fill and pink border, plus a pink label. The selected item keeps the same size and continues to expose `aria-pressed`.
- Ratio idle state: inactive items keep a transparent outer surface, a quiet ratio-shape fill, a readable shape border, and foreground label text.
- Hover and focus: hover uses only a light token-derived surface lift; keyboard focus uses a visible pink outline. No page-specific override was added.
- Scope: the shared selector still serves the image generator, image editor, and video generator. No image/video model, upload, prompt, task, result, or library business state changed.
- Production preview: old local Next processes on ports 3100, 3101, 3103, and 3104 were stopped, `npm run build` was rerun, and a fresh `npm run start -- -p 3104` process served the evidence.
- CSS chunk validation: `http://127.0.0.1:3104/_next/static/chunks/0z~jgw7djqt3..css` returned `200 text/css`; sampled JS chunks also returned `200 application/javascript`.
- Production browser audit: no console errors or warnings were captured, no Next.js issue marker or development `N` marker was detected, and no horizontal overflow was detected in the checked desktop and mobile states.
- Unicode safety: scan over `src/`, `docs/`, `AGENTS.md`, and current modified files for U+202A-U+202E and U+2066-U+2069 returned zero matches.

### Final Production Screenshot Set

Evidence directory: `docs/design-references/module-05-visual-foundation/final-production/`

| File | Viewport | Surface | Validation focus |
| --- | --- | --- | --- |
| `1440x900-ai-image-generator-production.png` | 1440x900 | AI image generator | Production preview, shared image mode control, transparent ratio item surface, pink selected shape and label |
| `1440x900-ai-video-generator-production.png` | 1440x900 | AI video generator | Production preview, shared video mode control, same shared ratio selected state |
| `390x844-mobile-params-production.png` | 390x844 | Mobile parameter tab | Production preview, no development marker, no horizontal overflow, mobile action remains the shell action |
| `1440x900-ratio-selector-closeup-production.png` | 1440x900 | Ratio selector closeup | Active outer item transparent, active shape pink-filled, active label pink, labels aligned |

### Final Production Regression

- AI image generator: `text-to-image` opened with `文生图` selected, `图生图` switching worked, ratio active state used transparent outer surface plus pink shape/label, sticky primary action remained visible, and no horizontal overflow was detected.
- AI image editor: the independent nav entry still opened the shared image workspace with `图生图` selected by default; upload visibility and disabled edit action were preserved.
- AI video generator: `文生视频` and `图生视频` switching remained available; the same ratio selector styling was used. Video mode parameter differences remain deferred to module 6.
- Mobile: ratio items wrapped without horizontal overflow, no development marker was visible, and the internal desktop sticky action was hidden while the shell mobile action remained responsible for the primary action.

### Final Closeout Quality Checks

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Production preview command: `npm run start -- -p 3104`; result was ready at `http://127.0.0.1:3104/`.
- CSS/JS resource check: homepage returned `200 text/html`; CSS chunk returned `200 text/css`; sampled JS chunks returned `200 application/javascript`.

## Risks And Blockers

- Current local dev server could not be duplicated on a new port because Next detected an existing dev server for the same repository. Production preview at 3103 was used for baseline capture.
- Some repository files show mojibake when printed in this shell, while the rendered browser UI is Chinese. Segment 2 should avoid broad encoding rewrites and only edit targeted files through normal UTF-8-safe patches.
- Preview sample images for video/upscale are visually strong and may be mistaken for real results; segment 2 should decide whether to label them as examples or simplify them.
- Shared components must stay controlled and must not create a second source of model, upload, submit, job, or result state.
