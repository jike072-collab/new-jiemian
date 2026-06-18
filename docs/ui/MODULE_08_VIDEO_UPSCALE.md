# Module 08 Video Upscale

## Scope

Module 8 completes the first usable Video2X video upscale workspace for the A-side workbench.

This module only touches the foreground video upscale workflow:

- single video upload
- Video2X and FFmpeg runtime detection
- 2x / 4x scale selection
- start processing
- processing, success, and failure states
- real result playback
- source and output resolution display
- result download

It does not enter the library module and does not modify B-side New API, auth, quota, payment, Docker, database, Redis, BFF, or session code.

## Runtime

| Item | Result |
| --- | --- |
| Video2X executable | `data/providers.json` local config points to `E:/codex工作台/tools/video2x/6.4.0/video2x.exe` |
| FFmpeg check | Video2X Windows package includes FFmpeg runtime DLLs: `avcodec-61.dll`, `avformat-61.dll`, `avfilter-10.dll`, `avutil-59.dll`, `swscale-8.dll`, `swresample-5.dll` |
| FFprobe | Not separately installed on PATH; first version falls back to MP4 file header parsing for resolution when FFprobe is unavailable |
| Invocation | `spawn(video2x.exe, args)` with argument array and `cwd` set to the Video2X install directory |
| Shell command strings | Not used for user file paths |
| Input path | Random file under `data/work/` |
| Output path | Random stored MP4 under `uploads/` |
| Download | `/api/files/[name]`, constrained by `safeStoredName` and `uploadsRoot` |

## Command Shape

Video2X is called with:

```text
video2x.exe
  -i <random input path>
  -o <random output path>
  -p realesrgan
  -s 2|4
  --realesrgan-model <provider model>
  -c libx264
  -e crf=18
  --no-progress
```

Optional `VIDEO2X_GPU_ID` adds `-d <id>`.

## States

| State | Behavior |
| --- | --- |
| 未上传 | Main action disabled; preview explains upload and scale selection. |
| 依赖不可用 | Shows a clear message and a retry detection action; no processing is allowed. |
| 可处理 | One video is selected, Video2X is ready, scale is selected, and the main action is enabled. |
| 处理中 | Shows `正在增强视频`; no fake percent is shown; repeated submit is blocked. |
| 处理成功 | Plays the real output video, shows source/output resolution and scale, and exposes a real download link. |
| 处理失败 | Keeps source video and scale, shows sanitized error text, supports retry after re-detecting if needed. |

## Validation Evidence

Local test video:

```text
data/module-08-tests/sample_640x360.mp4
```

This file is ignored runtime evidence and is not committed.

| Case | Result |
| --- | --- |
| Status API | `/api/upscale/status` returned video `ready: true` with Video2X and FFmpeg runtime available. |
| 2x submit | `/api/upscale/video` accepted the real MP4 and created a generating job. |
| 2x result | Success, source `640 x 360`, output `1280 x 720`, stored MP4 size `3,105,847` bytes. |
| 4x submit | `/api/upscale/video` accepted the real MP4 and created a generating job. |
| 4x result | Success, source `640 x 360`, output `2560 x 1440`, stored MP4 size `11,245,215` bytes. |
| Download | `/api/files/video-upscale-*.mp4` returned real MP4 files; downloaded byte sizes matched stored output. |
| Temp cleanup | No `video-upscale-input-*` files remained under `data/work/` after completion. |

Video2X on this Windows build exits with code `3221225477` after writing a valid file. The monitor treats that as success only when the log confirms an output was written and the output path contains a valid MP4 header.

## Security Notes

- User filenames are not used to build shell command strings.
- Input and output filenames are random.
- Process invocation uses `spawn` with an argument array.
- Output downloads are limited to stored filenames under `uploads/`.
- Error messages sanitize local absolute paths before being stored or shown.
- The page does not expose full command lines, absolute local paths, API keys, or internal stacks.

## UI Notes

- The video upscale workspace reuses `CompactDropzone`, `ModeSegmentedControl`, `StickyPrimaryAction`, `PreviewState`, and existing token styles.
- The upload control supports one video, replacement, removal, and video thumbnail playback.
- Desktop and mobile share the same submit function and disabled/loading state.
- No Header, Sidebar, or global color redesign was made.

## Quality Checks

Final checks:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build` | Passed, with one existing Turbopack NFT trace warning from `next.config.ts` and `src/lib/server/local-upscale.ts` import tracing. |
| `git diff --check` | Passed |

Unicode control-character scan over `src/` and `docs/`: passed with no matches.
