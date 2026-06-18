# MODULE_04_IMAGE_WORKSPACE

## Scope

Module 4 A-side work covers only the front-end image workspace:

- AI image generator: `AI 图像生成器 -> image -> text-to-image`
- AI image editor: `AI 图片编辑器 -> image -> image-to-image`
- parameter hierarchy, preview states, mobile action, responsive behavior, validation, screenshots, and acceptance evidence for these two entries

This module does not handle New API deployment, auth/session backends, credits, payment, Docker, database, Redis, BFF, ports, or B-side integration branches.

## Branch And Baseline

- Repository: `https://github.com/jike072-collab/new-jiemian`
- Working branch: `feature/04-image-workspace`
- Target branch: `develop`
- Module 3 merge baseline in `develop`: `3a282d6`
- Module 4 implementation commit before final acceptance: `3e9467a ui(image): refine generator and editor workspace`

## State Source

`src/components/studio-app.tsx` remains the single business source for the image workspace. It owns:

- `activeWorkspaceToolId`
- provider loading and unavailable/error states
- the shared image form state: model, ratio, quality, prompt, files, validation errors, loading
- submit handling for text-to-image and image-to-image
- output state and library refresh
- mobile action registration

`src/components/workbench-shell.tsx` remains layout-only. It hosts shell navigation, tabs, drawer, panel slots, and the mobile action slot, but does not own image business data, fake login state, fake model state, or duplicate tool state.

## Mode Mapping

| Navigation entry | Workspace id | Business tool | Mode | Result |
| --- | --- | --- | --- | --- |
| AI 图像生成器 | `image` | `image` | `text-to-image` | Uses the shared image form and `/api/generate/image`. |
| AI 图片编辑器 | `image-editor` | `image` | `image-to-image` | Uses the same shared image form/API and requires a reference image. |

Switching the internal image mode uses `workspaceToolIdForImageMode()` so the navigation highlight, title, mode label, description, and button stay synchronized. Image generation and editing do not create two forms or two submit states.

## Upload And Preview

- File input accepts real local images through the existing browser file input.
- Supported types are PNG, JPEG, and WebP.
- The UI blocks unsupported file types near the upload area.
- Uploaded files show the selected/uploaded state and are sent through the same image submit path.
- Deleting/replacing an uploaded image updates the shared form state; preview URLs are released by the existing cleanup path.
- The preview panel shows real guide, loading, result, and error states. It does not create mock success results.

## Mobile Action

The mobile bottom action is registered from the same image form state and calls the same submit function as the desktop button:

- Text-to-image label: `生成图片`
- Image-to-image label: `开始编辑`
- Loading labels: `正在生成`, `正在编辑`
- Disabled state is derived from loading, provider availability, prompt validity, and edit-mode reference image requirement.
- No DOM click proxy, hidden button simulation, global variable, fake balance, or fake quota is used.

## Implementation Matrix

| Item | Current files | Final status | Verification |
| --- | --- | --- | --- |
| StudioApp | `src/components/studio-app.tsx` | Reused as the single business controller. | Navigation, model unavailable state, upload state, mobile action, and library checks passed. |
| Tool registry | `src/lib/workspace-registry.ts` | Keeps separate image generator and image editor entries mapped to one image business path. | Generator/editor mapping check passed. |
| Image generation mode | `src/components/studio-app.tsx` | Uses `text-to-image`, `生成图片`, and no-reference-required validation. | Browser text and disabled state checks passed. |
| Image editing mode | `src/components/studio-app.tsx` | Uses `image-to-image`, `开始编辑`, and required reference-image validation. | No-upload, uploaded, and invalid-file states checked. |
| Model loading/unavailable | `src/components/studio-app.tsx`, `/api/providers/enabled` | Shows real unavailable model state; no fake model is created. | Local environment had no configured image model; no-model screenshot captured. |
| Upload | `src/components/studio-app.tsx` | Shared file input and validation are used for generator/editor. | Real PNG upload and invalid `.txt` validation checked. |
| Prompt | `src/components/studio-app.tsx` | Shared controlled prompt remains in the image form. | Empty/no-model disables action; prompt state remains in shared form. |
| Ratio and quality | `src/components/studio-app.tsx`, `src/app/globals.css` | Existing controls remain token-driven and keyboard/button accessible. | Desktop and mobile screenshots captured without horizontal page scroll. |
| Preview | `src/components/studio-app.tsx` | Uses real slot content and real output only. | Initial, no-model, validation, and library states captured. |
| Mobile action | `src/components/studio-app.tsx`, `src/components/workbench-shell.tsx` | Calls the same submit path and reflects the same disabled/loading state. | Mobile generator/editor action screenshots captured. |
| Responsive | `src/app/globals.css`, `src/components/workbench-shell.tsx` | Module 3 shell retained; image workspace fits desktop, tablet, and mobile. | 1440, 1280, 1024, 768, 390, and 375 viewport checks passed. |
| A/B boundary | Docs and git diff | B-side New API/auth/quota/payment files were not changed. | Diff review confirmed no B-side files in module 4 final acceptance. |

## Browser Acceptance

Acceptance ran against the production preview at `http://127.0.0.1:3101/` from the latest branch head.

| Check | Result |
| --- | --- |
| AI 图像生成器 maps to `text-to-image` | Passed |
| AI 图片编辑器 maps to `image-to-image` | Passed |
| Navigation title, mode text, and button text stay synchronized | Passed |
| Generator and editor share one form and one submit path | Passed by source and browser state inspection |
| No fake model/result/balance/auth state | Passed |
| Model unavailable state | Passed; no image model configured locally |
| Real PNG upload state | Passed |
| Unsupported file validation | Passed |
| Mobile parameter/preview tabs | Passed |
| Mobile bottom action labels and disabled state | Passed |
| Library route/workspace still visible | Passed |
| Video generator route/workspace still visible | Passed |
| Horizontal page scroll | None detected at tested sizes |
| Console / React / Next.js issue | No captured errors or warnings in production preview |

## Responsive Results

| Viewport | Result |
| --- | --- |
| 1440x900 | No horizontal scroll; desktop image generator/editor/library/video states captured. |
| 1280x800 | No horizontal scroll; desktop generator captured. |
| 1024x768 | No horizontal scroll; tablet generator/editor captured. |
| 768x1024 | No horizontal scroll; tablet portrait generator captured. |
| 390x844 | No horizontal scroll; mobile params, preview, drawer, editor upload, and mobile action captured. |
| 375x812 | No horizontal scroll; mobile generator captured. |

## Screenshot Evidence

Directory: `docs/design-references/module-04-image-workspace/`

- `1440x900-image-generator-initial.png`
- `1440x900-image-generator-no-model.png`
- `1440x900-image-editor-no-upload.png`
- `1440x900-image-editor-uploaded.png`
- `1440x900-image-editor-validation-error.png`
- `1280x800-image-generator-initial.png`
- `1024x768-tablet-image-generator.png`
- `1024x768-tablet-image-editor.png`
- `768x1024-tablet-portrait-image-generator.png`
- `390x844-mobile-generator-params.png`
- `390x844-mobile-generator-preview.png`
- `390x844-mobile-drawer-open.png`
- `390x844-mobile-editor-no-upload.png`
- `390x844-mobile-editor-uploaded-action.png`
- `375x812-mobile-generator-params.png`
- `1440x900-library.png`
- `1440x900-video-generator.png`
- `acceptance-results.json`

## Quality Checks

The final module 4 acceptance pass records:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `git diff --check`
- hardcoded theme color search over changed shell/image files
- `any` search over changed shell/image files
- browser console/error capture

## Final Accessibility Patch

The final module 4 accessibility patch closed the review gaps without changing the image workspace business state source.

Selection semantics:

- Image mode, image quality, video mode, upscale scale, library filter, and library sort button groups now expose `role="group"` and `aria-pressed`.
- Image and video ratio buttons now expose `role="group"` on the group and `aria-pressed` on each option.
- The active shell navigation item now exposes `aria-current="page"`.
- Decorative icons inside selection/action buttons are hidden with `aria-hidden="true"`.

Tabs:

- The mobile parameter/preview switch now exposes `role="tablist"`.
- Each tab exposes `role="tab"`, `aria-selected`, and `aria-controls`.
- The parameter and preview panels expose stable ids for tab control targets.

Labels and input association:

- The model select now has `id="image-provider-select"` and an associated screen-reader label.
- The reference image file input now has `id="reference-image-input"`, a mode-specific accessible name, and `aria-describedby`.
- The visible upload controls point at the file input through `aria-controls`.
- The prompt textarea keeps its explicit label and now describes the internal counter through `aria-describedby`.
- Remove-image buttons keep file-specific names such as `删除 <file name>`.

Prompt counter follow-up:

- The prompt character counter no longer uses `aria-live`.
- The textarea keeps `aria-describedby="image-prompt-counter"`.
- The counter text now reads as `X 个字符`, for example `0 个字符`, so the number has a clear meaning without repeated live announcements during typing.
- No fake character limit was added.
- `ModeSwitch` no longer duplicates the same group name through both `aria-label` and `aria-labelledby`; the visible group label is referenced with `aria-labelledby`.

Errors and loading/status:

- Immediate submit and upload errors use `role="alert"`.
- Model loading, no-model, edit-mode missing-reference guidance, image processing, and real result completion use `role="status"` with polite updates where appropriate.
- Loading icons are decorative and use `aria-hidden="true"`.
- No fake progress percentage was added.

Keyboard and browser verification:

- Browser verification on the production preview at `http://127.0.0.1:3101/` confirmed image mode and quality buttons expose true/false `aria-pressed`.
- The image editor state confirmed `图片编辑` is the active pressed mode, the file input accessible name is `上传参考图片开始编辑`, and the submit button remains disabled when no model/reference image is available.
- The mobile tabs expose `aria-selected` and `aria-controls`.
- The page had no horizontal scroll at the verification viewport.
- Console capture for `127.0.0.1:3101` returned no errors, React warnings, hydration warnings, or Next.js issue output.

Unicode safety:

- Bidi control-character scan covered `src/` and `docs/`.
- Scanned ranges: `U+202A` through `U+202E`, and `U+2066` through `U+2069`.
- Final scan result: no bidi control characters found.
- No source file needed hidden Unicode cleanup.

## Unverified Content

The local environment had no configured image model, so these real provider-dependent flows were not executed:

- real image generation success
- real image editing success
- real generated media download
- real generated media save-to-library from provider output

No mock model, mock success result, or fake media was created to replace those unavailable real flows.

## A / B Boundary Confirmation

A-side module 4 changed only image workspace UI, docs, and screenshot evidence. It did not change:

- `docker-compose*`
- New API environment variables, deployment, or ports
- database, Redis, BFF, auth/session, user mapping, credits, recharge, payment, callback, or reconciliation code
- administrator/payment secrets
- B-side branches such as `integration/auth-newapi` or `feature/auth-newapi-*`

## Final Status

Module 4 segments 1, 2, and 3 are complete. The module is ready for human review and must not be merged or used as approval to start module 5 until the user explicitly confirms.
