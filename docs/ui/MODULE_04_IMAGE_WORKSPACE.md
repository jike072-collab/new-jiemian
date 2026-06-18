# MODULE_04_IMAGE_WORKSPACE

## Segment 1 Scope

Module 4 A-side work covers only the front-end image workspace:

- `AI 图像生成器` -> `image` -> `text-to-image`
- `AI 图片编辑器` -> `image` -> `image-to-image`
- parameter hierarchy, preview states, mobile action, responsive behavior, and accessibility for these two entries

This module does not handle New API deployment, auth/session backends, credits, payment, Docker, database, Redis, BFF, ports, or B-side integration branches.

## Branch And Baseline

- Repository: `https://github.com/jike072-collab/new-jiemian`
- Current branch: `feature/04-image-workspace`
- Target branch: `develop`
- Module 3 merge baseline: `origin/develop @ 3a282d6`
- Module 3 final head included in develop: `1637753 fix(ui): close module 3 shell acceptance gaps`
- PR #3 status checked as merged into `develop`.
- Current worktree is not a B-side worktree or B-side integration branch.

## Current Business Chain

- Home workspace entry: `src/components/studio-app.tsx`
- Tool registry: `src/lib/workspace-registry.ts`
- Image API route: `src/app/api/generate/image/route.ts`
- Provider call and image/edit routing: `src/lib/server/provider-call.ts`
- Library read/delete route: `src/app/api/library/route.ts`
- Library persistence and stored media: `src/lib/server/library.ts`
- Shared media/data types: `src/lib/server/types.ts`
- Shell slots and mobile action host: `src/components/workbench-shell.tsx`

`StudioApp` currently owns the real provider loading, library loading, active workspace tool, output state, global message, mobile action registration, and library filters. `WorkbenchShell` receives slots and should remain layout-only.

## Image Workspace Mapping

| Navigation entry | Workspace tool id | Business tool | Mode | Reuse rule |
| --- | --- | --- | --- | --- |
| AI 图像生成器 | `image` | `image` | `text-to-image` | Reuse the existing shared image form and image API. |
| AI 图片编辑器 | `image-editor` | `image` | `image-to-image` | Reuse the same image form and submit path; require reference image before submit. |

`workspaceToolIdForImageMode()` already maps `image-to-image` back to `image-editor`, so the internal mode switch and navigation highlight can stay synchronized without adding a second image state source.

## Implementation Matrix

| Item | 当前文件 | 当前功能 | 当前问题 | 是否复用 | 计划修改 | 业务影响 | 验证方法 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| StudioApp | `src/components/studio-app.tsx` | Loads providers/library, owns active workspace id, renders image/video/upscale/library slots, stores outputs and mobile action. | File is too large and mixes orchestration, image form, preview, and library UI; image workspace changes can become risky if done in one pass. | Yes, logic source of truth. | Keep state and API flow; later extract image form/preview helpers only if it reduces risk. | High if broken. | Navigate between image and image editor, submit validation, library refresh, mobile action registration. |
| 图像生成模式 | `src/components/studio-app.tsx`, `src/lib/workspace-registry.ts` | `image` entry derives `text-to-image` and renders shared `ImageGenerator`. | Front-end button disabled state does not reflect missing model or empty prompt; field-level feedback is weak. | Yes. | Add clear disabled/error state using existing submit path; keep API contract unchanged. | Medium. | Empty prompt, no provider, and valid prompt flows show correct state and call `/api/generate/image`. |
| 图片编辑模式 | `src/components/studio-app.tsx`, `src/lib/server/provider-call.ts` | `image-editor` entry derives `image-to-image`; server requires at least one reference image. | Required upload is mostly enforced server-side; front-end can still present an enabled primary action without a file. | Yes. | Mirror server requirement in the form and mobile action disabled state; do not create a second form. | Medium. | Open image editor, no file blocks submit visibly, file + prompt submits same image API. |
| 模型加载 | `src/components/studio-app.tsx`, `src/app/api/providers/enabled` | Loads enabled image/video providers once and auto-selects first image provider. | Loading and unavailable states are not explicit enough in the image form. | Yes. | Add user-facing unavailable/loading state in the model area; no fake model data. | Medium. | Disable action when no image provider exists; show real unavailable message. |
| 参考图上传 | `src/components/studio-app.tsx`, `src/lib/server/provider-call.ts` | `FileInput` accepts PNG/JPEG/WebP, multiple files, sends `files` through `FormData`. | Text-to-image optional upload and image-edit required upload use same control, but hierarchy and helper copy need clearer distinction. | Yes. | Keep shared input; adjust labels, helper text, required state, and validation per mode. | Medium. | Upload count displays; image edit requires file; state persists across image/image-editor switching. |
| 提示词 | `src/components/studio-app.tsx`, `src/lib/server/provider-call.ts` | Controlled textarea with 3000 max length and internal bottom-right counter. | Empty prompt is only blocked during submit; no inline error/disabled state yet. | Yes. | Add lightweight validation state and keep counter inside textarea. | Medium. | Empty prompt disables or reports inline; typed prompt persists when switching modes. |
| 图片比例 | `src/components/studio-app.tsx`, `src/app/globals.css` | Ratio picker uses graphic shapes and token-colored selected state. | Needs final visual verification in the image workspace, especially horizontal scroll on mobile. | Yes. | Keep component; tune spacing only if screenshot shows issue. | Low. | 1:1/16:9/9:16/4:3/3:4 selectable; no mobile horizontal page scroll. |
| 清晰度 | `src/components/studio-app.tsx` | ModeSwitch chooses `1k` or `2k`, sent as `quality`. | Uses generic chip-style control; selected background may need alignment with module 2 token rules for image workspace. | Yes. | Keep data value and submit field; restyle only if needed. | Low. | Selected value survives navigation and is included in form data. |
| 提交按钮 | `src/components/studio-app.tsx` | Desktop button calls `submit`, shows loading icon, posts to image API. | `disabled` currently only tracks `loading`; does not prevent known invalid states. | Yes. | Derive disabled from loading, provider, prompt, and edit-mode file requirement. | Medium. | Repeated clicks prevented; invalid states do not call API; valid states call same submit function. |
| 手机按钮 | `src/components/studio-app.tsx`, `src/components/workbench-shell.tsx` | Image form registers `MobileActionBar` with same `submit` callback and mode-specific label. | Disabled state mirrors the desktop button weakness; mobile may allow invalid submit until server rejects. | Yes. | Use the same derived action state as desktop; keep bottom action calling the same submit function. | Medium. | Mobile image says `生成图片`; editor says `开始编辑`; disabled/loading match desktop. |
| 预览区 | `src/components/studio-app.tsx` | `OutputPanel` shows guide content before output and `MediaCard` after result. | Image generation and image editing share generic image preview copy; field/result states are not tailored enough. | Partial. | Keep output and media display; improve copy/state separation without adding fake examples or new features. | Medium. | Empty, loading, success, and failed result states are understandable and use real output only. |
| 错误状态 | `src/components/studio-app.tsx`, API routes | Errors are surfaced through global toast `message`; API returns provider/prompt/file errors. | No field-specific error placement; global toast can be missed, especially on mobile. | Partial. | Keep toast for global errors; add local validation where the user can fix the issue. | Medium. | Missing prompt/file/provider errors are visible without checking console. |
| 结果、保存和下载 | `src/components/studio-app.tsx`, `src/lib/server/library.ts` | Successful image call creates `LibraryItem`, refreshes library, and `MediaCard` provides download link. | Download exists, but save/download affordance may be visually weak; no fake result should be added. | Yes. | Keep library persistence and download; improve visible result actions only. | Medium. | Generated item appears in preview/library and download link uses real media URL. |
| 响应式 | `src/components/workbench-shell.tsx`, `src/app/globals.css` | Shell provides desktop columns, mobile tabs, and mobile action slot. | Image controls need final checks inside the module 3 shell at desktop/tablet/mobile sizes. | Yes. | Adjust only image workspace-specific spacing or overflow; do not rebuild shell. | Medium. | 1440/1280/1024/768/390/375 widths have no horizontal page scroll. |
| 可访问性 | `src/components/studio-app.tsx`, `src/components/workbench-shell.tsx` | Buttons/selects/textarea are keyboard-usable; drawer a11y was completed in module 3. | Form labels are visual wrappers rather than explicit `label htmlFor`; file input and validation state can be clearer. | Partial. | Add direct labels/aria only where needed for image controls. | Low/Medium. | Keyboard can reach controls; screen reader names are meaningful; disabled states are announced. |

## Findings For Segment 2

- The correct single business source already exists: `activeWorkspaceToolId` plus `workspace-registry` derives the image mode.
- `AI 图像生成器` and `AI 图片编辑器` are separate navigation entries, but they share the same image form and API path as required.
- Switching between image generation and editing should preserve form state because `ImageGenerator` stays mounted when the business tool remains `image`; this must be verified in browser before any refactor.
- The server already validates empty prompt and edit-mode missing reference image; the front end should mirror those validations for better desktop and mobile UX.
- The mobile bottom button already calls the same `submit` function as desktop, but its disabled state is too narrow.
- The current image form, preview, and helper components are all inside one large file; extraction should be surgical and only done if it makes validation/action state clearer.
- Some current source/doc display in prior terminal output appeared mojibaked; module 4 should avoid introducing new encoding damage and should verify visible Chinese copy in browser.
- The image preview currently uses generic guide copy and reference images; module 4 should make states clearer without adding template browsing or fake results.

## A / B Boundary Confirmation

A-side module 4 may change:

- `src/components/studio-app.tsx`
- image workspace presentation helpers if extracted from `StudioApp`
- image workspace-specific styles in `src/app/globals.css`
- image workspace docs and screenshots under `docs/**`

A-side module 4 must not change:

- `docker-compose*`
- New API environment variables, deployment, or ports
- database, Redis, BFF, auth/session, user mapping, credits, recharge, payment, callback, or reconciliation code
- administrator/payment secrets
- B-side branches such as `integration/auth-newapi` or `feature/auth-newapi-*`

If account, quota, payment, or model inventory is unavailable to the front end, the image workspace must show real unavailable states only. It must not create fake balances, fake models, fake auth, or dead payment routes.

## Segment 1 Stop Condition

This segment is documentation and audit only. No module 4 implementation commit is created in segment 1. Coding should start only after the next instruction for segment 2.
