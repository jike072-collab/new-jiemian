# Stage 9C-B Database Library And Jobs Integration

Stage 9C-B starts wiring the existing library and generation job persistence surface to the Stage 9C-A database repository. It is intentionally default-off and 3107-only.

## Scope

In scope:

- Add a server-side adapter for library records, assets, and generation jobs.
- Keep `/api/library`, generation endpoints, upscale endpoints, request fields, response fields, UI, and Chinese copy unchanged.
- Keep JSON/filesystem persistence as the default path.
- Add dry-run checks for library import planning and DB/file consistency.
- Add mock tests that do not connect to production or staging databases.

Out of scope:

- Production migration.
- Staging migration.
- Real data/uploads import.
- File deletion cleanup.
- Full multi-user library authorization.
- Real provider calls.
- NewAPI calls.
- Payment, orders, quota deduction, domain, HTTPS, reverse proxy, or firewall work.

## Feature Flags

Default values:

- `LIBRARY_STORAGE_BACKEND=json`
- `GENERATION_JOBS_BACKEND=existing`
- `DATABASE_LIBRARY_DUAL_WRITE=false`
- `DATABASE_LIBRARY_READ_ENABLED=false`
- `DATABASE_JOBS_WRITE_ENABLED=false`
- `DATABASE_IMPORT_DRY_RUN_ONLY=true`

The database backend also requires a runtime guard. It is active only in tests or on an isolated `PORT=3107` runtime with strict storage and explicit `DATA_DIR` / `UPLOADS_DIR`.

This prevents accidental 3106 database mode if a single flag is misconfigured.

## Compatibility

JSON mode remains the rollback path. Clearing the database flags returns the app to the existing `data/library.json`, `data/jobs.json`, and `uploads` behavior.

The Stage 9C-B adapter does not change the schema created in Stage 9C-A. It reuses:

- `assets`
- `generation_jobs`
- `library_items`
- `api_call_logs`
- `error_events`

The default runtime does not connect to a database unless the explicit flags and runtime guard allow it.

## Verification

New commands:

- `npm run test:database-library-integration`
- `npm run test:generation-jobs-db-integration`
- `npm run test:library-storage-backend`
- `npm run db:library-import:plan`
- `npm run db:library-consistency:check`

The tests use mock repositories and static checks by default. They do not call generation, NewAPI, real providers, production DB, or staging DB.

## Known Risks

- The current JSON library is global and does not yet enforce per-user ownership.
- DB job polling needs a later schema decision for external task references before real cutover.
- Real import still requires a separate authorized migration stage with backup, restore, and checksum gates.
