# Library Database Backend

The library database backend is a Stage 9C-B adapter behind feature flags. It keeps the existing API contract intact and leaves JSON mode as the default.

## Current Default

Default library storage is still:

- `data/library.json`
- `uploads`
- hard delete from JSON mode after the existing delete confirmation flow

No API path, request field, response field, frontend read path, UI layout, or Chinese copy is changed by Stage 9C-B.

## Database Mode

When explicitly enabled in a guarded 3107/test runtime, the adapter maps:

- `LibraryItem` to `library_items`
- output file references to `assets`
- generation context to `generation_jobs` when a job is available

The adapter stores file references such as `uploads/<storedName>` and never stores file bytes. It does not move, copy, import, or delete real upload files.

## Read Flow

JSON mode:

1. Read `data/library.json`.
2. Check `output.storedName` availability.
3. Return the existing response shape.

Database mode:

1. Read non-deleted `library_items`.
2. Load linked `assets`.
3. Load linked `generation_jobs` when present.
4. Return the existing library item response shape.

Missing DB rows are skipped or returned safely by the adapter. Missing file metadata must not become a 500.

## Delete Flow

JSON mode keeps existing behavior:

- remove the JSON item
- remove linked JSON jobs
- remove the stored file when present

Database mode uses soft delete:

- set `library_items.is_deleted=true`
- set `deleted_at`
- do not delete uploads
- do not modify JSON files

Physical file cleanup is delayed to a separate authorized cleanup stage.

## Rollback

Unset the Stage 9C-B database flags or set:

- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`

The app returns to JSON/filesystem behavior. No production or staging import is performed by this stage.
