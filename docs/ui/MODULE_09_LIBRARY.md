# MODULE_09_LIBRARY

Branch: `feature/09-library`

## Scope

Module 9 owns the first A-side works library:

- display real image and video works
- distinguish generated images, generated videos, image upscale, and video upscale
- preview stored media
- download real stored files
- delete works and their allowed local files
- show loading, empty, error, missing-file, deleting, and delete-failed states
- keep desktop and mobile usable

Module 9 does not modify B-side New API, authentication, quota, payment, database, Docker, Redis, BFF, or sessions. It also does not enter module 10.

## Data Source

The library reuses the existing local data path:

| Area | Current source | Module 9 behavior |
| --- | --- | --- |
| Metadata | `data/library.json` through `src/lib/server/library.ts` | Reused as the single source of truth. |
| Images and videos | `uploads/<storedName>` through `/api/files/[name]` | Reused for preview and download. |
| Image generation | `addLibraryItem()` in provider flow | Successful real outputs appear in the library. |
| Video generation | `addLibraryItem()` and job refresh | Done or failed job records remain visible. |
| Image upscale | Upscayl output item | Real output dimensions and scale are shown when available. |
| Video upscale | Video2X output item | Real output dimensions, duration, and scale are shown when available. |

No second library data store was created.

## First Version Behavior

| Requirement | Result |
| --- | --- |
| Loading state | The library preview shows a loading state while `/api/library` is read. |
| Real works | Cards render only items from `data/library.json`. |
| Empty state | Empty library and filtered-empty states are explicit and do not show sample works. |
| Type filters | The parameter panel keeps `全部 / 图片 / 视频`. |
| Type labels | Cards distinguish `文生图`, `图生图`, `文生视频`, `图生视频`, `图片高清`, and `视频高清` by item mode. |
| Preview | Images render with `<img>` and videos render with native controls. |
| Download | Download links are shown only for stored local files with `storedName`. |
| Delete | Delete requires confirmation, shows deleting state, removes the real output file before metadata, refreshes after success, and preserves the card if deletion fails. |
| Missing file | Stored files are checked server-side; missing files render as `文件失效` without crashing the page. |
| Mobile | The library keeps no mobile primary action slot and uses the existing shell tabs. |

## Security Notes

| Risk | Handling |
| --- | --- |
| Arbitrary file read | `/api/files/[name]` still passes through `safeStoredName()` and only reads from `uploadsRoot`. |
| Arbitrary delete | Deletion only removes the selected library item's stored output and only when the stored name is unchanged after sanitization. |
| Path traversal | User-provided names are sanitized and rejected when sanitized output differs. |
| Absolute path leakage | UI displays title, type, status, size, dimensions, and prompt/error only; local paths are not shown. |
| Large media | Videos are served through `/api/files/[name]` and rendered by the browser video element, not read into frontend memory. |

## Final Delete Flow

| Step | Result |
| --- | --- |
| Locate item | `/api/library` returns `404` when the work ID is absent. |
| Validate output | Stored output names must round-trip through `safeStoredName()` before any file operation. |
| Delete file first | The stored output file is removed before library metadata is written. Missing files are treated as already cleaned. |
| Preserve on failure | File deletion errors return a safe error and leave the work metadata and card in place. |
| Delete metadata | Library metadata is removed only after the file step succeeds or the file is already missing. |
| Delete related jobs | Associated job records are removed through the existing jobs write queue, preventing overlap with job status updates. |
| Frontend failure | The deleting state is cleared, the card remains visible, and the API error is shown in the library error surface. |

## Validation Plan

- Open the library workspace on desktop and mobile.
- Verify real image and video cards from existing generation/upscale outputs.
- Verify image and video preview.
- Verify download links for stored image/video files.
- Verify delete confirmation and deletion refresh.
- Verify filtered empty state.
- Verify missing-file state by using a record whose stored file is absent.
- Run `npm run lint`, `npm run typecheck`, `npm run build`, and `git diff --check`.

## Known Limits

- This is a local first version. Cloud sync, sharing links, folders, tags, favorites, batch actions, and advanced search are intentionally out of scope.
- Remote provider URLs that could not be stored locally remain preview-only; the library does not present them as controlled downloads.
