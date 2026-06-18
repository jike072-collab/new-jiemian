# Module 6 Video Workspace Audit

Branch: `feature/06-video-workspace`

Baseline commit: `e436d7c` (`Merge pull request #18 from jike072-collab/feature/05-visual-foundation`)

Target branch: `develop`

## Scope

Module 6 owns the A-side AI video generator foreground workspace:

- `text-to-video`
- `image-to-video`
- video model selection
- first-frame/reference upload
- prompt guidance
- aspect ratio
- duration
- submit/loading/error/result states
- desktop, tablet, and mobile interaction

Module 6 must keep the module 5 visual foundation. It must reuse `ModeSegmentedControl`, `AspectRatioSelector`, `CompactDropzone`, `StickyPrimaryAction`, `PreviewState`, `FieldGroup`, and `WorkbenchShell`. Any shared component change must be a minimal compatibility extension and must not redesign Header, Sidebar, three-column color hierarchy, scrollbars, ratio controls, upload controls, primary action, or preview shell.

## A/B Boundary

A-side module 6 must not modify New API deployment, New API ports, Docker, databases, Redis, BFF, authentication backend, Session, user mapping, quota, usage, recharge, payment, administrator keys, payment keys, or B-side branches.

If no real video model is configured, the UI must show the real unavailable state. It must not create fake models, fake balances, fake progress, or fake video results.

## Current Video State Source

Current code keeps video business state inside `VideoGenerator` in `src/components/studio-app.tsx`:

| State | Current owner | Notes |
| --- | --- | --- |
| `mode` | `VideoGenerator` local `useState<WorkspaceVideoMode>(initialMode)` | Initialized from active registry action, then lives inside the component. |
| `providerId` | `VideoGenerator` local state | Auto-selects first video provider when available. |
| `ratio` | `VideoGenerator` local state | Defaults to `16:9`. |
| `duration` | `VideoGenerator` local state | Defaults to `5`. |
| `prompt` | `VideoGenerator` local state | Shared between both modes. |
| `files` | `VideoGenerator` local state | Shared between both modes. No object URL preview is currently shown for video reference files. |
| `loading` | `VideoGenerator` local state | Used by desktop and mobile actions. |
| `job` | `VideoGenerator` local state | Polled through `/api/jobs/[id]`. |

Planned single source: introduce a parent-level `videoWorkspace` state whose `videoWorkspace.mode` drives title/description, upload requirement, prompt placeholder, validation, submit disabled state, empty state, and request `mode`.

## Current Request Path And Payload

Frontend submit path:

`VideoGenerator.submit` in `src/components/studio-app.tsx` posts `FormData` to:

```text
POST /api/generate/video
```

Current `FormData` fields:

| Field | Current source |
| --- | --- |
| `providerId` | selected video provider id |
| `mode` | local `mode`, either `text-to-video` or `image-to-video` |
| `ratio` | local `ratio` |
| `duration` | local `duration` |
| `prompt` | local `prompt` |
| `files` | all uploaded local `File` objects |

API route:

`src/app/api/generate/video/route.ts`

- Reads `FormData`.
- Normalizes `mode` to `image-to-video` only when the submitted field exactly matches `image-to-video`; otherwise uses `text-to-video`.
- Parses `duration`; default is `5`.
- Calls `submitVideo` with `providerId`, `mode`, `prompt`, `ratio`, `duration`, and `files`.

Provider call:

`src/lib/server/provider-call.ts`

Current provider JSON body:

```json
{
  "model": "provider.model",
  "prompt": "input.prompt",
  "image": ["data:<mime>;base64,<bytes>"],
  "duration": "input.duration",
  "aspect_ratio": "input.ratio",
  "response_format": "url"
}
```

Current backend validation:

- Provider must be enabled, kind `video`, and have an API key.
- Prompt must be non-empty.
- `image-to-video` requires at least one uploaded file.

Current backend output handling:

- If provider returns a direct URL, stores it as a real video result and creates a completed library item.
- If provider returns a job/status, creates a queued/generating library item and job.
- Polling uses `/api/jobs/[id]`, `refreshVideoJob`, and `deriveStatusUrl`.

Important gap: provider JSON currently does not send a dedicated `mode` field. The only request-level difference is that `image-to-video` sends a non-empty `image` array and is server-validated for uploaded files. Segment 2 must confirm whether the configured video provider expects an explicit mode field before adding one.

## Mode Difference Matrix

| Item | Text-to-video | Image-to-video |
| --- | --- | --- |
| Business mode | `text-to-video` | `image-to-video` |
| Model | Real enabled video provider from `/api/providers/enabled` | Real enabled video provider from `/api/providers/enabled` |
| First-frame material | Not required; optional only if real provider supports reference input | Required by current backend validation |
| Prompt | Should describe full video: scene, subject action, camera movement, environment, atmosphere | Should describe how the reference image moves, what should stay, and camera changes |
| Ratio | Current shared values: `1:1`, `16:9`, `9:16`, `4:3`, `3:4` | Current shared values: `1:1`, `16:9`, `9:16`, `4:3`, `3:4` |
| Duration | Current UI values: `5`, `8`, `10`, `15` seconds | Current UI values: `5`, `8`, `10`, `15` seconds |
| Submit validation | Model + non-empty prompt; upload not required | Model + uploaded material + non-empty prompt |
| Empty state | Should guide text description of video | Should guide first-frame/reference upload first |
| Request fields | `providerId`, `mode=text-to-video`, `ratio`, `duration`, `prompt`, optional `files`; provider JSON currently includes `image: []` | `providerId`, `mode=image-to-video`, `ratio`, `duration`, `prompt`, `files`; provider JSON includes base64 data URLs in `image` |
| Error state | Model unavailable, empty prompt, provider/API/job error | Upload missing/error, model unavailable, empty prompt, provider/API/job error |

## Current Text-To-Video Status

- Navigation entry `AI 视频生成器` maps through the workspace registry to `toolId: "video"` and `mode: "text-to-video"`.
- The mode switch displays `文生视频 / 图生视频`.
- Text-to-video currently shows the same reference upload area as image-to-video, marked optional.
- Prompt placeholder is generic video copy and does not strongly distinguish full text-to-video planning.
- Desktop submit button is disabled only by `loading`; it does not disable when no model or empty prompt.
- Mobile action uses the same `submit` function, but is also disabled only by `loading`.
- Preview is the generic `OutputPanel`, with sample guidance shared with other video states rather than mode-specific text-to-video empty/ready/error states.
- Request sends `mode=text-to-video`, ratio, duration, prompt, and any uploaded files.

## Current Image-To-Video Status

- Image-to-video is a local mode inside the same `VideoGenerator`, not a separate navigation entry.
- Switching mode changes the upload field from optional to required visually.
- Submit is not disabled when files are missing; the server rejects missing files in `submitVideo`.
- Prompt placeholder is the same generic video prompt as text-to-video.
- Preview and empty state remain generic and do not guide first-frame upload.
- Request sends `mode=image-to-video`; backend rejects if no `files`; provider JSON includes uploaded files as base64 data URLs in `image`.

## Parts Not Currently Differentiated

| Area | Current behavior | Required module 6 change |
| --- | --- | --- |
| State source | Local `mode` in `VideoGenerator`; parent derives `initialMode` only | Parent/controller should own `videoWorkspace.mode` as the single source |
| Upload requirement | Visual required marker changes; desktop/mobile disabled state does not | Disable submit and show local upload error before request |
| Prompt guidance | One placeholder for both modes | Mode-specific prompt placeholder and help |
| Empty preview | Generic video preview/sample state | Mode-specific `PreviewState` initial/ready/error guidance |
| Submit button | Disabled only during loading | Disabled for missing provider, provider loading, empty prompt, and missing file in image-to-video |
| Mobile action | Shared submit, disabled only during loading | Same validation and disabled state as desktop |
| Request mode | FormData includes mode; provider JSON does not include explicit mode | Confirm provider expectation; do not invent fields without evidence |
| File preview | `FileInput` shows name/size only; no object URL thumbnail | Use or minimally extend shared upload behavior if first-frame preview is required |
| Error ownership | Errors go to global toast/message only | Add local mode-aware error state near upload/prompt/preview |
| Result state | Generic output state keyed by `video` | Preserve real result/library/job flow, add mode-aware preview copy only |

## Implementation Matrix

| Area | Current file | Current function | Current problem | Reuse | Planned change | Business impact | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| StudioApp | `src/components/studio-app.tsx` | Chooses `VideoGenerator initialMode` from registry action | Video mode not held by parent state after mount | Keep `WorkbenchShell` and registry | Add `videoWorkspace` state and callbacks in `StudioApp` | Centralizes mode/submit disabled/mobile action derivation | Switch modes and navigate away/back without losing meaningful state |
| Video controller | `src/components/studio-app.tsx` | `VideoGenerator` owns all state | Mixed UI/controller responsibilities | Reuse current submit/polling logic | Split into controller plus parameter/preview props if needed | Keeps existing request/job/library flow | No duplicate request or state |
| Mode switch | `ModeSegmentedControl` | Shared visual, local `setMode` | Only part of UI changes | Reuse as-is | Drive from `videoWorkspace.mode` | Real text/image mode changes | `aria-pressed`, prompt/upload/disabled all update |
| Model loading | `providers.video` | Shared enabled provider fetch | No local unavailable state in video form beyond select | Reuse `ProviderSelect` | Add mode-aware disabled/help in video workspace | No fake models | No provider shows real unavailable state |
| First-frame upload | `FileInput` + `CompactDropzone` | Required marker changes by mode | Missing upload not reflected in disabled state; no thumbnail preview | Reuse/extend `CompactDropzone` only if needed | Image-to-video requires upload; text-to-video optional or hidden by real capability | Prevents invalid request | Missing file cannot submit in image-to-video |
| Prompt | `PromptBox` | One placeholder | Not mode-specific | Reuse `PromptBox` | Mode-specific placeholder/help, no fake limit | Better input guidance | Text remains after failure/switch |
| Ratio | `AspectRatioSelector` | Shared selector | Already shared | Reuse unchanged | Keep controlled value in video state | No visual redesign | Labels aligned, no overflow |
| Duration | Native `select` | Fixed values `5/8/10/15` | Not documented as provider-supported | Keep until backend capability says otherwise | Document as current UI-supported values; only change if real provider data exists | Avoid fake options | Selected duration sent in request |
| Submit | `submit` callback | Posts to `/api/generate/video` | Disabled only by loading | Reuse request path | Add derived `canSubmit`, local errors, duplicate-submit guard | Fewer invalid requests | Empty prompt/no model/no file checks |
| Mobile button | `registerMobileAction` | Same submit, disabled only by loading | Mobile can trigger invalid image-to-video request | Reuse mobile action slot | Register same label/loading/disabled/submit as desktop | Keeps one submit path | Mobile disabled mirrors desktop |
| Preview | `OutputPanel` | Generic sample and result shell | No mode-specific initial/ready/error guidance | Reuse `PreviewState` | Add `VideoPreviewPanel` or extend output content with mode-aware copy | No fake result | Initial/ready/loading/error/result states |
| Task refresh | `job` interval | Polls `/api/jobs/[id]` every 5s | Works but tied to component-local state | Reuse | Keep job state in video workspace/controller | Preserve real async jobs | Queued/generating updates library/result |
| Result display | `OutputPanel` + `MediaCard` | Shows real output and sample state | Generic copy only | Reuse `MediaCard`/library | Only change guidance, not output storage | No fake video | Real output/download/library preserved |
| Download | `MediaCard`/library output | Uses stored output URL | No planned change | Reuse | Keep existing real URL behavior | None | Download/view remains real only |
| Library | `/api/library` + `LibraryWorkspace` | Stores mode and params | Works | Reuse | Ensure `mode` remains accurate | Better traceability | Generated item records correct mode |
| Responsive | Module 5 shell/CSS | Stable visual foundation | Video-specific validation not checked | Reuse module 5 components | No shell redesign | Maintains visual baseline | 1440/1024/390 checks in later segment |
| Accessibility | Shared controls | `aria-pressed`, labels, counters | Submit disabled and errors not mode-specific | Reuse shared semantics | Add local error association where needed | Better screen-reader flow | Keyboard and screen-reader checks |

## Segment 2 Implementation Notes

Implemented in `src/components/studio-app.tsx`:

- Video workspace state is now owned by `StudioApp` as one `videoWorkspace` object.
- `videoWorkspace.mode` is the only source for the current video mode.
- `VideoGenerator` is controlled by props and no longer owns a separate local mode, provider, prompt, file, loading, or job state.
- Desktop `StickyPrimaryAction` and mobile action slot share `submitVideoWorkspace`, `videoWorkspace.loading`, `videoWorkspaceCanSubmit`, and `videoWorkspace.mode`.
- `VideoPreviewPanel` uses mode-specific initial, ready, loading, error, and result copy while showing only real provider output as success.
- Image-to-video uses the shared `CompactDropzone` with real file state, object URL preview, replace, remove, clear, and cleanup.
- Text-to-video hides the first-frame upload because the current provider model data exposes no reference-image capability field.
- Switching modes keeps prompt, ratio, duration, and provider when still valid. Uploaded images remain in local state for returning to image-to-video, but text-to-video requests do not include them.

Implemented in `src/lib/server/provider-call.ts`:

- The internal API still receives and validates `mode`.
- Image-to-video provider payload includes exactly one base64 `image` data URL.
- Text-to-video provider payload no longer sends an empty or stale `image` field.
- Image-to-video now rejects 0 files and rejects more than 1 file instead of silently truncating.
- Text-to-video now rejects any submitted first-frame file before provider dispatch.

## Segment 2 Mode Behavior

| Area | Text-to-video | Image-to-video |
| --- | --- | --- |
| Single source | `videoWorkspace.mode = "text-to-video"` | `videoWorkspace.mode = "image-to-video"` |
| Upload UI | Hidden by default because no real reference-image capability is exposed | Required shared `CompactDropzone` |
| Submit disabled | Disabled when no model, providers are loading, prompt is empty, or request is loading | Disabled when no model, providers are loading, prompt is empty, no first-frame image, or request is loading |
| Prompt guidance | Describes subject, action, scene, camera, motion, lighting, and mood | Describes subject motion, camera movement, background change, and consistency requirements |
| Preview empty state | Guides text description of a video scene | Guides first-frame upload first, then motion description |
| Frontend payload | `providerId`, `mode=text-to-video`, `ratio`, `duration`, `prompt` | `providerId`, `mode=image-to-video`, `ratio`, `duration`, `prompt`, `files` |
| Provider payload | `model`, `prompt`, `duration`, `aspect_ratio`, `response_format` | Same fields plus exactly one `image` data URL |
| Result state | Real provider output only | Real provider output only |

## Final Acceptance Patch

Current branch: `feature/06-video-workspace`

Patch scope:

- Tightened the image-to-video first-frame contract to a single image.
- Kept `videoWorkspace.mode` as the only mode source.
- Kept module 5 shared components and shell visuals unchanged.
- Kept B-side New API, authentication, quota, payment, Docker, database, Redis, BFF, and port configuration untouched.

### Single First-Frame Contract

| Layer | Result | Verification |
| --- | --- | --- |
| Frontend copy | The image-to-video upload help now says `仅支持 1 张 PNG、JPEG 或 WebP 图片，单张不超过 10MB。` and no longer says `最多 10 张`. | Production DOM check |
| Frontend input | `#video-first-frame-input` renders as a single file input with `multiple === false`. | Production DOM check |
| Frontend state | `createVideoWorkspaceFiles` rejects more than one file and keeps at most one accepted `VideoWorkspaceFile`. | Code review and upload test |
| Replace | Selecting a new first frame replaces the previous thumbnail and releases the previous object URL. | CDP upload report |
| Delete | Deleting the first frame removes the thumbnail, restores the missing-upload guidance, disables submit, and releases the object URL. | CDP upload report and screenshot |
| API route | `/api/generate/video` rejects `image-to-video` with 0 files or more than 1 file before provider dispatch. | API request check |
| Server provider call | `submitVideo` rejects text-to-video files, rejects image-to-video 0/>1 files, and sends a one-item `image` array only for image-to-video. | API request check and code review |

API request checks against production preview at `http://127.0.0.1:3105/`:

| Request | Result |
| --- | --- |
| `image-to-video` with 0 files | `400`, `图生视频模式需要上传 1 张首帧图片。` |
| `image-to-video` with 2 files | `400`, `图生视频模式只能上传 1 张首帧图片。` |
| `text-to-video` with 1 file | `400`, `文生视频模式不接收首帧图片。` |
| `text-to-video` with 0 files | Reached real provider validation and returned `视频供应商未配置或未启用。` in the current no-model environment. |

### Upload, Replace, Delete Evidence

Temporary local test images were used only for browser acceptance and were not committed.

Evidence was captured through a clean production preview plus a temporary Chrome DevTools Protocol session so the real browser file input received local PNG files. No fake generated video result was used.

CDP upload report summary:

| Step | Result |
| --- | --- |
| Initial image-to-video state | `multiple: false`, single-frame copy present, old `最多 10 张` copy absent, submit disabled. |
| Upload | One local PNG was selected through the real file input. The UI showed the thumbnail, filename, replacement action, and delete action. |
| Replace | A second local PNG replaced the first. The first blob URL was revoked. |
| Delete | Thumbnail count returned to 0, missing-upload guidance returned, submit stayed disabled, and all created blob URLs were revoked. |
| Text-to-video regression | No first-frame upload input is present and the text-generation guidance remains visible. |
| Mobile uploaded state | 390x844 screenshot shows the image-to-video thumbnail state without a Next.js development marker. |

### Final Patch Screenshots

Directory:

```text
docs/design-references/module-06-video-workspace/
```

New or refreshed evidence:

- `1440x900-image-to-video-uploaded-first-frame.png`
- `1440x900-image-to-video-after-delete.png`
- `768x1024-text-to-video.png`
- `390x844-image-to-video-uploaded.png`

Requested but not regenerated as a fake state:

- `390x844-video-loading-action.png` remains unverified because the current environment has no enabled real video model, so the app cannot enter a real video generation loading state without inventing a provider or fake result.

## Current Backend Capability Limitation

`PublicProvider` currently exposes provider identity, kind, title, role, API URL, model, enabled status, endpoint type, and configuration status. It does not expose capability metadata for:

- `text-to-video`
- `image-to-video`
- supported aspect ratios
- supported durations
- optional reference-image support

Because of that, segment 2 does not hard-code vendor capability guesses. Both modes use the real enabled video provider list from `/api/providers/enabled`. If a future backend adds explicit capability fields, the video workspace should filter providers and mode options from those fields instead of adding a second front-end capability table.

## State Source Plan

Target:

```ts
type VideoWorkspaceState = {
  mode: WorkspaceVideoMode;
  providerId: string;
  ratio: string;
  duration: number;
  prompt: string;
  files: File[];
  fileError: string;
  submitError: string;
  loading: boolean;
  job: JobRecord | null;
};
```

`videoWorkspace.mode` derives:

- parameter title/description through registry + mode metadata
- whether upload is hidden, optional, or required
- upload error wording
- prompt placeholder and help
- submit label and loading label
- desktop and mobile disabled state
- preview initial/ready/error copy
- request `mode`

Do not separately maintain navigation mode, form mode, request mode, and preview mode.

## Backend Capability Notes

Current backend supports both mode strings in server validation and library records. It blocks `image-to-video` without files. It does not currently prove that every configured provider supports both modes or that the provider expects an explicit `mode` field in JSON. Segment 2 should preserve existing provider payload unless there is concrete provider/API evidence to change it.

If no enabled video provider exists, module 6 must show the real unavailable state and must not create mock video output.

## Segment 3 Acceptance

Current branch: `feature/06-video-workspace`

Accepted commit: `532fb5f` before final evidence commit.

Production preview:

- Built with `npm run build`.
- Served from current HEAD at `http://127.0.0.1:3100/` using `npm run start -- -p 3100`.
- No Next.js development badge or issue overlay was present in the captured evidence.

### Browser Acceptance Results

| Area | Result | Evidence |
| --- | --- | --- |
| Text-to-video mode | Passed. The form shows video model, ratio, duration, and video prompt. No first-frame upload is shown, and missing image does not add a disabled reason. | `1440x900-text-to-video-initial.png` |
| Image-to-video mode | Passed for required empty state. The first-frame upload area appears, prompt label changes to motion description, preview copy changes, and submit stays disabled while no file/model is available. | `1440x900-image-to-video-missing-first-frame.png` |
| Mode switch | Passed. `aria-pressed` switches between text-to-video and image-to-video; prompt labels, placeholders, upload visibility, disabled reasons, and preview copy change with `videoWorkspace.mode`. | Browser DOM check, 2026-06-18 |
| Model availability | Passed for current environment. No enabled video model exists, so the UI keeps the real unavailable state and does not create fake models. | `1440x900-no-video-model-state.png` |
| Payload difference | Passed by code path and disabled-state review. Frontend uses one submit entry, sends `mode`, and appends `files` only for image-to-video. Server provider payload adds `image` only for image-to-video. | `src/components/studio-app.tsx`, `src/lib/server/provider-call.ts` |
| Preview state | Passed for initial and unavailable states. Text-to-video and image-to-video use different guidance. Success was not shown because no real video model/result exists. | screenshots in `docs/design-references/module-06-video-workspace/` |
| Desktop responsive | Passed at 1440x900 and 1280x800 with no horizontal overflow. | `1440x900-text-to-video-initial.png`, `1280x800-text-to-video.png` |
| Tablet/mobile responsive | Partially passed. 390x844 mobile text and image mode screenshots show correct mode-specific content and no horizontal overflow. 1024/768 screenshots were captured, but some automated tool switching was unstable at tablet breakpoints. | mobile screenshots listed below |
| Console and React warnings | Passed for checked pages. Browser console warning/error list was empty during desktop and mobile checks. | Browser log check, 2026-06-18 |

### Screenshot Evidence

Directory:

```text
docs/design-references/module-06-video-workspace/
```

Files:

- `1440x900-text-to-video-initial.png`
- `1440x900-image-to-video-missing-first-frame.png`
- `1440x900-image-to-video-uploaded-first-frame.png`
- `1440x900-image-to-video-after-delete.png`
- `1440x900-no-video-model-state.png`
- `1440x900-real-unavailable-error-state.png`
- `1280x800-text-to-video.png`
- `1024x768-text-to-video.png`
- `1024x768-image-to-video.png`
- `768x1024-text-to-video.png`
- `390x844-mobile-text-to-video-params.png`
- `390x844-mobile-image-to-video-upload.png`
- `390x844-image-to-video-uploaded.png`
- `390x844-mobile-preview.png`
- `390x844-mobile-bottom-action.png`

### Quality Checks

Final checks to run before the segment 3 commit:

- `npm run lint`
- `npm run typecheck`
- `npm run build`
- `git diff --check`

### Not Verified In Segment 3

- Real successful video generation, playback, download, and library completion were not verified because the current environment has no enabled real video model.
- A real video generation loading state was not verified because the current environment has no enabled real video model. The mobile action label code now uses `state.loading ? meta.loadingLabel : meta.submitLabel`.
- Provider capability filtering could not be verified because the current provider API exposes no capability fields for text-to-video, image-to-video, ratios, durations, or optional reference-image support.
