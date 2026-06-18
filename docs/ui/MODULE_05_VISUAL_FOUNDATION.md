# Module 5 Visual Foundation Audit

Status: segment 2 implementation completed. Segment 3 screenshot acceptance and PR are still pending.

Branch: `feature/05-visual-foundation`
Baseline commit: `fd55897`
Target branch: `develop`
Reference evidence: `docs/design-references/module-05-visual-foundation/before/`

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

- Capture after screenshots for the same module 5 surfaces.
- Repeat and archive final after-screenshot acceptance from the latest HEAD.
- Create or update the module 5 Draft PR only after segment 3 acceptance.

## Risks And Blockers

- Current local dev server could not be duplicated on a new port because Next detected an existing dev server for the same repository. Production preview at 3103 was used for baseline capture.
- Some repository files show mojibake when printed in this shell, while the rendered browser UI is Chinese. Segment 2 should avoid broad encoding rewrites and only edit targeted files through normal UTF-8-safe patches.
- Preview sample images for video/upscale are visually strong and may be mistaken for real results; segment 2 should decide whether to label them as examples or simplify them.
- Shared components must stay controlled and must not create a second source of model, upload, submit, job, or result state.
