# Module 7 Image Upscale Audit

Branch: `feature/07-image-upscale`

Baseline commit: `9bd6aab` (`Merge pull request #22 from jike072-collab/feature/06-video-workspace`)

Target branch: `develop`

## Scope

Module 7 owns the A-side image upscale foreground workspace and the real local image upscale loop:

- local image upscale tool status
- image upload
- scale selection
- start processing
- processing, failed, and success states
- original/result comparison
- real output download
- existing library save/display flow
- desktop, tablet, and mobile interaction
- module documentation, tests, and screenshots

Module 7 must keep the module 5 visual foundation. It should reuse `WorkbenchShell`, `CompactDropzone`, `StickyPrimaryAction`, `PreviewState`, `FieldGroup`, shared button/error patterns, global tokens, and workspace scrollbars.

Module 7 must not redesign Header, Sidebar, global three-column colors, upload controls, primary actions, preview shell, or global scrolling. If a shared component lacks a required image-upscale capability, only a minimal compatibility extension is allowed.

## A/B Boundary

A-side module 7 must not modify New API deployment, New API ports, Docker, databases, Redis, BFF, authentication backend, Session, user mapping, quota, usage, recharge, payment, video upscale business, or B-side branches.

Image upscale is currently a local processing capability. It must not be changed into a New API model call in module 7.

If the local dependency is missing, the UI must keep the real unavailable state. It must not create fake tools, fake progress, fake results, or static examples as successful output.

## Audit File List

| File | Reason |
| --- | --- |
| `src/components/studio-app.tsx` | Image upscale workspace UI, upload state, scale state, submit action, mobile action, preview output. |
| `src/app/api/upscale/status/route.ts` | Local dependency status endpoint. |
| `src/app/api/upscale/image/route.ts` | Image upscale API entry, form parsing, scale parsing, file validation call. |
| `src/lib/server/local-upscale.ts` | Upscayl detection, command construction, process execution, input/output paths, validation, and local result creation. |
| `src/lib/server/providers.ts` | Default local image-upscale provider configuration. |
| `src/lib/server/paths.ts` | Runtime data, upload, and work directory roots. |
| `src/lib/server/library.ts` | Stored output URL, file download boundary, library item creation, deletion cleanup. |
| `src/app/api/files/[name]/route.ts` | Runtime file read/download response. |

## Current Local Tool

The current image upscale implementation uses local Upscayl CLI:

```text
provider id: image-upscale
provider kind: image-upscale
endpoint type: upscayl-cli
default executable env: UPSCAYL_BIN
default model env: UPSCAYL_MODEL
default model fallback: upscayl-standard-4x
optional models dir env: UPSCAYL_MODELS_DIR
optional gpu env: UPSCAYL_GPU_ID
```

The provider default lives in `src/lib/server/providers.ts`. Local providers do not require API keys in `readEnabledProviders`.

Current environment status from the existing status flow:

| Tool | Current state | Detail |
| --- | --- | --- |
| Upscayl | Not detected | No local `UPSCAYL_BIN` or PATH executable is currently available in this workspace environment. |
| Image upscale model | Not verified at runtime | Model files are checked only after an Upscayl executable is found. |

This is a real local dependency blocker for end-to-end processing. Module 7 implementation must keep the dependency-missing state and must not fake a successful upscale result.

## Tool Detection

`readUpscaleStatus()` in `src/lib/server/local-upscale.ts` checks the image provider and then resolves an executable from these sources:

1. provider `apiUrl`, which is the configured local executable path
2. `process.env.UPSCAYL_BIN`
3. `%LOCALAPPDATA%\Programs\Upscayl\resources\bin\upscayl-bin.exe`
4. `%LOCALAPPDATA%\Programs\upscayl\resources\bin\upscayl-bin.exe`
5. `%ProgramFiles%\Upscayl\resources\bin\upscayl-bin.exe`
6. `%ProgramFiles(x86)%\Upscayl\resources\bin\upscayl-bin.exe`
7. PATH lookup for `upscayl-bin.exe` or `upscayl-bin`

After finding an executable, it checks models through:

```text
UPSCAYL_MODELS_DIR
dirname(executable)/models
dirname(executable)/../models
```

The selected model must have complete model files according to `upscaylModelReady()`.

Current issue: the normal workspace status detail can include absolute executable/model paths when a tool is found or models are missing. Module 7 should avoid exposing local absolute paths to ordinary users.

## Current Command And Parameters

`upscaleImage(file, scale)` builds an Upscayl command in `src/lib/server/local-upscale.ts`.

Current command shape:

```text
<upscayl executable>
  -i <inputPath>
  -o <outputPath>
  -m <modelsPath>
  -n <provider.model || upscayl-standard-4x>
  -z <nativeScale>
  -f png
  -c 0
  [-s <requestedScale>]
  [-g <UPSCAYL_GPU_ID>]
```

Execution uses `spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })` through `runProcess()`.

Current process rules:

- no shell string command is used
- stdout/stderr are capped to the last 16000 characters
- timeout is 15 minutes
- non-zero exit rejects with captured output or exit code
- input file is deleted in `finally`

The exact runtime behavior of `-z <nativeScale>` plus optional `-s <requestedScale>` still needs verification with an installed Upscayl binary because the current environment has no local dependency.

## 2x / 4x Mapping

| Layer | Current behavior |
| --- | --- |
| UI | `UpscaleForm` stores `scale` as string, default `"2"`, options `"2"` and `"4"`. |
| API | `src/app/api/upscale/image/route.ts` maps `Number(form.get("scale")) === 2 ? 2 : 4`. Any non-2 value becomes `4`. |
| Server | `upscaleImage(file, scale)` accepts `2 | 4`. |
| Model native scale | `upscaylNativeScale(provider.model)` extracts `2`, `3`, or `4` from model name, falling back to `4`. |
| Command | Always passes `-z <nativeScale>`. If requested scale differs from native scale, also passes `-s <requestedScale>`. |
| Result metadata | Library item title is `图片高清 ${scale}x`; params include `{ scale, sourceName }`. |

Implementation concern: module 7 should verify the Upscayl CLI scale semantics against the installed tool before claiming true 2x/4x output. Until then, the code has a real mapping but the local machine cannot prove output dimensions.

## Input, Output, And Temporary Files

Runtime roots from `src/lib/server/paths.ts`:

```text
dataRoot: process.cwd()/data
uploadsRoot: process.cwd()/uploads
workRoot: data/work
```

Current image upscale file lifecycle:

| Item | Current path or owner | Notes |
| --- | --- | --- |
| Provider config | `data/providers.json` when customized | Defaults come from environment if missing. |
| Temporary input | `data/work/image-upscale-input-${uuid}${extension}` | Written from uploaded bytes. Deleted after processing attempt. |
| Output file | `uploads/image-upscale-${uuid}.png` | Created by Upscayl. Kept for library/download on success. |
| Library item | `data/library.json` | Created by `addLibraryItem()` after success. |
| Download URL | `/api/files/<storedName>` | Stored through `runtimeFileUrl(storedName)`. |
| Jobs | Not used for image upscale | Image endpoint returns `job: null`. |

Current issue: if image processing fails after creating a partial output file, `upscaleImage()` deletes the input but does not explicitly delete the output path. Segment 2 should clean partial output on failure.

## Current State Source

`UpscaleForm` in `src/components/studio-app.tsx` owns the current image upscale UI state:

| State | Current owner | Notes |
| --- | --- | --- |
| `scale` | `UpscaleForm` local state | String `"2"` or `"4"`. |
| `file` | `UpscaleForm` local state | One `File | null`. |
| `loading` | `UpscaleForm` local state | Used during submit. |
| `statusLoading` | `UpscaleForm` local state | Used while checking `/api/upscale/status`. |
| `availability` | `UpscaleForm` local state | One of status API results for image/video. |
| `job` | `UpscaleForm` local state | Only meaningful for video upscale polling; image upscale returns `null`. |
| `outputs["image-upscale"]` | `StudioApp` state | Receives the real library item after success. |
| global `message` | `StudioApp` state | Receives upload/dependency/request errors. |

There is no explicit image-upscale state enum such as `idle`, `dependency-missing`, `ready`, `processing`, `success`, or `error`. Segment 2 should derive or introduce one state model without creating a second submit or file-state source.

Current submit disabled behavior:

- desktop action is disabled by `loading || statusLoading`
- mobile action is disabled by `loading || statusLoading`
- missing file and missing dependency are handled after click through messages

Segment 2 should disable earlier for missing file and dependency-missing while preserving the same real submit function.

## Desired State Model

| State | Definition | UI behavior |
| --- | --- | --- |
| `idle` | No source image uploaded | Main action disabled; preview guides upload. |
| `dependency-missing` | Upscayl is not installed, disabled, path invalid, or model incomplete | Show clear dependency status and retry check; no fake processing. |
| `ready` | Source image uploaded, dependency ready, scale selected | Main action enabled. |
| `processing` | Real Upscayl process is running | Prevent duplicate submit; show real processing state without fake percent. |
| `success` | Real output file exists and library item is created | Show real output, dimensions if available, comparison, download. |
| `error` | Upload, dependency, process, or file error occurred | Preserve source image and scale; support retry; do not leak local paths or stack traces. |

## Capability And Parameter Matrix

| Item | Current implementation | Problem | Plan |
| --- | --- | --- | --- |
| Local tool | Upscayl CLI through `upscayl-bin.exe` or `upscayl-bin` | Current environment has no detected executable | Keep real dependency-missing state; support retry detection |
| Tool detection | `/api/upscale/status` calls `readUpscaleStatus()` | User-facing detail can expose absolute local paths | Sanitize normal workspace detail while keeping admin/provider diagnostics separate |
| Upload | `FileInput` uses shared `CompactDropzone` through real `File` state | Image upscale upload does not show thumbnail/source preview | Add real source preview using existing file state and object URL cleanup |
| File limits | Server accepts PNG, JPEG, WebP up to 25MB | UI help text is generic and does not state the true limit | Show true server limits near upload |
| Scale | 2x / 4x UI and API mapping | Runtime output dimensions unverified without installed Upscayl | Verify against real dependency in later segment; keep no fake claim |
| Input file | Written into `data/work` with UUID prefix | Extension may come from untrusted filename before MIME fallback | Prefer MIME-derived safe extension for image inputs |
| Output file | Written to `uploads/image-upscale-${uuid}.png` | Partial output cleanup missing on image process failure | Delete partial output on error/timeout |
| Processing | `loading` state plus blocking API request | No explicit image state model; no cancellation | Add clear processing state; no fake progress |
| Result | Library item with real stored PNG output | No original/result comparison or dimensions | Add real original/result preview and optional dimensions/file size when available |
| Download | `/api/files/[name]` serves stored output | Content disposition is inline, but real URL exists | Keep real file download/view; add explicit download action only for real output |
| Library | `addLibraryItem()` creates an image item on success | Current params store source name and scale only | Preserve existing library flow; add dimensions only if reliably available |

## Security Audit

| Check | Current finding | Segment 2 plan |
| --- | --- | --- |
| Shell command construction | Uses `spawn` with argument array; no `exec` string for image processing | Keep argument-array execution |
| PATH lookup | Uses `execFile` for `where.exe`/`which` during detection | Acceptable for detection; keep no shell string |
| User filename in command | Command uses generated UUID input path, not original filename | Keep generated paths |
| User filename in metadata | Original filename is stored in prompt/params | Safe for display if escaped by React; keep out of command |
| Path traversal | Output name uses `safeStoredName`; download uses `readStoredFile()` and safe name check | Keep strict stored-name boundary |
| Runtime directories | Input in `data/work`; output in `uploads` | Keep paths under workspace runtime roots |
| Supported formats | PNG, JPEG, WebP | Surface true limits in UI |
| File size | 25MB for image upscale | Surface true limit in UI |
| Timeout | 15 minutes | Keep and show user-friendly timeout error |
| Child failure | Non-zero exits reject; input is cleaned | Also delete partial output on failure |
| Temp cleanup | Input cleaned in `finally` | Add output cleanup on error/timeout |
| Absolute path exposure | Status detail can include executable/model paths | Sanitize regular workspace errors |
| Object URL lifecycle | Current image upscale has no source object URL | If thumbnail/comparison adds object URL, release it promptly |
| Static success | No static result is created by server | Remove or clearly de-emphasize sample output in empty preview |

## Preview And Comparison Plan

After success, the preview should show real output only. Planned capabilities:

- original image preview
- upscale result preview
- original dimensions when available
- result dimensions when available
- selected scale
- file size change when reliable
- original/result toggle
- optional comparison slider only if it is stable across desktop and mobile
- download real output
- retry with the same source and scale

Do not show a static portrait/sample as a completed result. When library count is `0`, the preview must not look like a real finished upscale image.

## Implementation Matrix

| Area | Current file | Current function | Current problem | Reuse | Planned change | Business impact | Verification |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Studio controller | `src/components/studio-app.tsx` | `StudioApp` stores `outputs["image-upscale"]` | Result state exists but no source/result comparison state | Keep current output state | Add image-upscale-specific derived preview props if needed | Preserve library/result flow | Existing output still appears after success |
| Form state | `src/components/studio-app.tsx` | `UpscaleForm` | No explicit idle/dependency/ready/processing/success/error model | Reuse `FieldGroup`, `StickyPrimaryAction` | Derive clear action disabled/error state from file, availability, loading, output | Prevent invalid clicks | Missing file/dependency disables desktop and mobile actions |
| Upload | `src/components/studio-app.tsx` | `FileInput` + `CompactDropzone` | No true source thumbnail, generic helper text | Reuse `CompactDropzone` | Add source thumbnail, replace/delete, server limit copy, object URL cleanup | Real file state unchanged | Upload, replace, delete, cleanup |
| Scale | `src/components/studio-app.tsx` | `ModeSegmentedControl` | Current values are real but runtime dimensions unverified | Reuse shared mode control | Keep 2x/4x values; document real command mapping | No fake scale options | Submitted scale reaches API |
| Dependency status | `src/app/api/upscale/status/route.ts`, `src/lib/server/local-upscale.ts` | `readUpscaleStatus()` | Path details may leak; UI only checks after mount | Reuse endpoint | Sanitize user-facing detail and provide retry | No fake availability | Missing dependency state remains clear |
| API request | `src/app/api/upscale/image/route.ts` | `POST` | Scale defaults to 4 for any non-2 | Keep real route | Optionally reject invalid scale instead of silent fallback | More predictable validation | Bad scale rejected or documented |
| Local command | `src/lib/server/local-upscale.ts` | `upscaleImage()` | Partial output cleanup missing; extension trusts filename first | Keep Upscayl CLI | Clean partial output; prefer MIME-derived extension | Safer local processing | Failure leaves no orphan output |
| Process timeout | `src/lib/server/local-upscale.ts` | `runProcess()` | No fake progress; timeout exists | Keep | Show friendly timeout state | Better user feedback | Timeout error preserved without stack |
| Preview | `src/components/studio-app.tsx` | `OutputPanel` | Empty state can show static example as a full image; success has no comparison | Reuse `PreviewState`, `MediaCard` | Add image upscale preview states and comparison | No fake result | Empty, processing, error, success screenshots |
| Download | `src/app/api/files/[name]/route.ts`, `src/lib/server/library.ts` | `readStoredFile()` | Real stored output only; no dedicated download label in upscale preview | Reuse existing route | Add clear action only when real output exists | No dead button | Download URL reads output only |
| Library | `src/lib/server/library.ts` | `addLibraryItem()` | Success item exists; dimensions not stored | Reuse | Keep existing item creation; add metadata only if reliable | No duplicate save flow | Library shows output |
| Mobile action | `src/components/studio-app.tsx` | `registerMobileAction()` | Disabled state does not include missing file/dependency | Reuse WorkbenchShell action slot | Same disabled/loading/submit as desktop | No double action | Mobile cannot submit invalid state |
| Responsive | Module 5 shell/styles | Workbench layout | Comparison area not planned yet | Reuse module 5 layout | Fit source/result preview at all required viewports | No shell redesign | 1440, 1280, 1024, 768, 390, 375 checks |
| Accessibility | Shared controls | Upload/action/scale | Error messages mostly global | Reuse labels and shared controls | Use local `role="alert"` for upload/dependency errors where appropriate | Better keyboard/screen-reader flow | Keyboard can upload, choose scale, submit |

## Responsive Verification Plan

| Viewport | Planned check |
| --- | --- |
| 1440x900 | Parameter and preview visible together; action follows module 5 sticky rule; comparison does not overflow. |
| 1280x800 | Same desktop hierarchy; no horizontal overflow. |
| 1024x768 | Tablet drawer/navigation and parameter/preview layout remain stable. |
| 768x1024 | Tablet portrait tabs and preview fit without clipped controls. |
| 390x844 | Upload, 2x/4x selector, mobile primary action, preview tab, and result fit naturally. |
| 375x812 | No double primary button, no horizontal overflow, download remains reachable. |

## Segment 2 Planned File Scope

Likely implementation files:

- `src/components/studio-app.tsx`
- `src/lib/server/local-upscale.ts`
- `src/app/api/upscale/image/route.ts`
- `src/app/api/upscale/status/route.ts` if user-facing status detail needs endpoint-level shaping
- `src/app/globals.css` only for small image-upscale preview/comparison styling, without changing the module 5 shell baseline
- `docs/ui/MODULE_07_IMAGE_UPSCALE.md`

Likely validation:

- missing dependency status does not allow fake processing
- upload/replace/delete source image
- 2x and 4x submit to the route
- no partial output left on failure
- output download points to a real file only
- no local absolute path shown to normal workspace users
- desktop/tablet/mobile visual regression

## Segment 2 First Version

Implemented first usable image upscale workspace on branch `feature/07-image-upscale`.

### Workspace Behavior

| Area | Result |
| --- | --- |
| Upload | Image upscale now has its own foreground state and uses the shared `CompactDropzone`. It accepts exactly one PNG, JPEG, or WebP file up to 25MB. |
| Preview | The uploaded source image is shown from a real object URL. Replacing or deleting the image revokes the previous object URL. |
| Scale | `2x` and `4x` are controlled by the shared `ModeSegmentedControl` and submitted to `/api/upscale/image`. |
| Local dependency | The page uses `/api/upscale/status` and shows `未检测`, `工具可用`, `工具不可用`, or `检测失败` states. |
| Submit | Desktop sticky action and mobile action share the same `submitImageUpscale` function, loading state, and disabled rule. |
| Disabled rule | Submit is disabled until a source image exists, the local tool is ready, status check is complete, and no request is running. |
| Processing | Shows `正在增强` without fake progress. |
| Failure | Keeps source image and scale; supports re-detect and retry. |
| Success | Shows only the real stored output image returned by local processing and exposes a real download link. |

### Server-Side Safety

| Area | Result |
| --- | --- |
| Process execution | Still uses `spawn(executable, args)` with an argument array; no user filename is shell-concatenated. |
| Scale validation | `/api/upscale/image` now rejects invalid scale values instead of silently treating non-2 values as 4x. |
| Input extension | Runtime input file extension now comes from MIME type first, avoiding untrusted filename extensions for image inputs. |
| Path disclosure | Normal image Upscayl status no longer exposes local executable or model directory paths in workspace detail text. |
| Cleanup | Image upscale now deletes the temporary input file and also deletes a partial output file when processing fails before a library item is completed. |
| Download boundary | Download still uses stored output names through `/api/files/[name]` and `readStoredFile()`. |

### Current Blocker

The current environment still does not detect an installed Upscayl executable, so real successful upscale output cannot be verified on this machine yet. The implemented UI keeps the dependency-unavailable state and does not show fake success output.

## Segment 3 Acceptance

Acceptance branch: `feature/07-image-upscale`

Preview URL: `http://127.0.0.1:3106/`

Screenshot directory: `docs/design-references/module-07-image-upscale/`

Captured evidence:

| File | Viewport | State |
| --- | --- | --- |
| `1440x900-desktop-no-upload-upscayl-unavailable.png` | 1440x900 | Desktop image upscale, no upload, Upscayl unavailable, start disabled. |
| `1440x900-desktop-upscayl-unavailable.png` | 1440x900 | Desktop image upscale dependency-unavailable state and retry detection. |
| `390x844-mobile-params-upscayl-unavailable.png` | 390x844 | Mobile parameter page, upload/scale/dependency state, single disabled bottom action. |

### Upscayl Detection

Image upscale is fixed to Upscayl for module 7. The status endpoint remains:

```text
GET /api/upscale/status
```

The image status path checks the configured provider path, `UPSCAYL_BIN`, common Windows Upscayl install locations, and PATH entries `upscayl-bin.exe` / `upscayl-bin`. If the executable is found, the model path is checked through `UPSCAYL_MODELS_DIR`, `dirname(executable)/models`, and `dirname(executable)/../models`.

Current acceptance result:

| Check | Result |
| --- | --- |
| Upscayl executable | Not detected in the current environment. |
| Model files | Not checked because executable is missing. |
| UI availability | Shows real tool-unavailable state. |
| Start action | Disabled while dependency is unavailable. |
| Fake result | Not used. |

### Real Command Contract

When Upscayl is available, the image route calls the existing local command path:

```text
<upscayl executable>
  -i <data/work/image-upscale-input-${uuid}.${safe-extension}>
  -o <uploads/image-upscale-${uuid}.png>
  -m <modelsPath>
  -n <provider.model || upscayl-standard-4x>
  -z <nativeScale>
  -f png
  -c 0
  [-s 2|4 when requested scale differs from nativeScale]
  [-g <UPSCAYL_GPU_ID>]
```

Execution uses `spawn(executable, args)` with an argument array. The original user filename is not concatenated into a shell command.

### 2x / 4x Acceptance

| Layer | Result |
| --- | --- |
| UI | `2x` and `4x` are the only selectable options. |
| API | `/api/upscale/image` rejects any scale other than `2` or `4`. |
| Server | `upscaleImage(file, scale)` receives typed `2 | 4` and passes the requested scale into the Upscayl command contract. |
| Real output | Passed with local Upscayl `E:/codex工作台/tools/upscayl/2.15.0/resources/bin/upscayl-bin.exe`. |
| 2x result | Test image `96 x 64` produced a real PNG `192 x 128` at `/api/files/image-upscale-bc0b6440-2444-44b8-a62d-c6fccbf05070.png`. |
| 4x result | Test image `96 x 64` produced a real PNG `384 x 256` at `/api/files/image-upscale-e9db416c-287b-49f3-88dd-ffe095e3ac7a.png`. |
| Concurrent run | Parallel 2x and 4x submissions now both complete after serializing local library/job JSON writes. |

### Download And Temporary Files

| Item | Result |
| --- | --- |
| Input file | Written under `data/work/` with generated UUID name and MIME-derived extension. |
| Output file | Written under `uploads/` with generated safe stored name. |
| Success download | Only exposed when a real output file exists. |
| Failed processing | Deletes temporary input and partial output. |
| Download boundary | `/api/files/[name]` still uses `readStoredFile()` and `safeStoredName()` so arbitrary local paths cannot be read. |
| Verified downloads | 2x and 4x output URLs returned real `image/png` responses with expected dimensions. |
| Temporary input cleanup | `data/work/image-upscale-input-*` had no remaining files after successful processing. |

### Browser Acceptance

| Case | Result |
| --- | --- |
| Desktop no upload | Captured. Shows upload prompt, `2x` default, and disabled start action. |
| Desktop Upscayl unavailable | Captured. Shows tool unavailable and retry detection without absolute local path. |
| Desktop Upscayl ready | Captured at `docs/design-references/module-07-image-upscale/1440x900-desktop-upscayl-ready-no-upload.png`. |
| Desktop uploaded state | Browser runtime cannot programmatically set local file chooser contents; real upload path was verified through the same multipart API used by the page. |
| Real 2x output | Captured as `docs/design-references/module-07-image-upscale/real-upscayl-2x-96x64-to-192x128.png`. |
| Real 4x output | Captured as `docs/design-references/module-07-image-upscale/real-upscayl-4x-96x64-to-384x256.png`. |
| Mobile upload/parameters | Captured at `docs/design-references/module-07-image-upscale/390x844-mobile-upscayl-ready-params.png`; no horizontal overflow. |
| Mobile result | Real output files exist; full mobile result UI upload replay remains limited by unavailable file chooser automation. |

### Quality Checks

| Command | Result |
| --- | --- |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed. |
| `npm run build` | Passed. |
| `git diff --check` | Passed. |
| Unicode control scan | Passed for modified source/docs: no U+202A-U+202E or U+2066-U+2069. |

### Final Upscayl Acceptance Note

Upscayl is now installed and configured locally. Module 7 real image upscale acceptance used a generated local PNG source, not a static example result. Both requested scales were submitted through `/api/upscale/image`, executed by the local Upscayl CLI, written under `uploads/`, and downloaded through `/api/files/[name]`. The page now records and displays source dimensions, output dimensions, and the selected scale for successful image-upscale results.
