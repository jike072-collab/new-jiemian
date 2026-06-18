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

