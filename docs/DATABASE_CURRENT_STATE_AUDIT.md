# Database Current State Audit

Stage 9A is a read-only database and persistence audit. It records the current
state and future design boundaries without changing schemas, running migrations,
writing production data, calling generation providers, calling NewAPI, or probing
live provider `/models`.

## Baseline

- Repository: `jike072-collab/new-jiemian`
- Baseline main commit: `1f6a6c9119bd9701e35464165284ed69da1cf450`
- Production port: `3106`
- Staging port: `3107`
- Production data summary at Stage 8D:
  - `data`: count=17, size=21070884, sha256=`aa788abb2067d9cab1a6996c00e58b172865a589a9a608c0b5ab963d5e69ac1c`
  - `uploads`: count=5, size=13238351, sha256=`db55e210ea69bfeb4a0a0685f80b46ee134c0be6739f03dc6cfdda39c907924e`
- Staging data summary at Stage 8D:
  - `data-staging`: count=0, size=0, sha256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  - `uploads-staging`: count=0, size=0, sha256=`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`

## Current Database Type

The project has an application PostgreSQL baseline:

- `pg` and `@types/pg` are present.
- `src/lib/server/database/config.ts` requires `APP_DATABASE_URL` and
  `APP_DATABASE_EXPECTED_NAME` before application database operations.
- `src/lib/server/database/client.ts` uses a shared `pg.Pool` and verifies the
  current database identity before health checks and migration-sensitive work.
- `db/migrations` contains raw SQL migrations.
- `scripts/database/migrate.mjs` manages `schema_migrations` with checksums.

The application database is separate from the NewAPI database. This project must
not read or write NewAPI internal tables.

## PostgreSQL Usage

PostgreSQL is available for the application backend line and has repository
implementations for:

- auth users and sessions
- NewAPI user mappings
- billing orders and webhook events
- usage records
- task billing records and task quota adjustments
- audit events and reconciliation runs

Production release checks require production persistence modes to be PostgreSQL.
Stage 9A did not connect to production PostgreSQL and did not run metadata or row
queries against production tables.

## SQLite Usage

The source tree contains checks that reject SQLite files inside release
artifacts. No active application repository uses SQLite as its primary runtime
database. Any `.sqlite`, `.sqlite3`, or `.db` file in runtime data is treated as
artifact or local state risk and must not be committed.

## JSON And File-System Data

The project still uses JSON and the file system for the Studio runtime surface:

- `src/lib/server/library.ts`
  - `data/library.json` is the current library metadata source.
  - `data/jobs.json` is the current video/upscale job state source.
  - `uploads/` stores generated, edited, uploaded, and upscaled media files.
- `src/lib/server/providers.ts`
  - `data/providers.json` stores customized provider configuration.
  - environment defaults are merged when no stored provider record exists.
  - public/provider frontend views use sanitized provider records.
- `src/lib/server/auth/repository.ts`
  - non-production JSON auth stores still exist for development and migration
    compatibility.
- `src/lib/server/billing/repository.ts`
  - JSON billing stores still exist for local and test modes.
- `src/lib/server/quota/repository.ts` and
  `src/lib/server/quota/task-billing-repository.ts`
  - JSON quota and task-billing stores still exist for local and test modes.

## Runtime Storage Directories

Production and staging storage are separated by runtime path validation:

- production `3106` uses `data/` and `uploads/`
- staging `3107` must use `data-staging/` and `uploads-staging/`
- `PORT=3107` rejects missing storage variables and rejects fallback to default
  `data/` or `uploads/`
- `DATA_DIR` and `UPLOADS_DIR` cannot be the same directory or nested inside
  each other

## Current Library Source

The current library endpoint reads `data/library.json` through
`readLibrary()` in `src/lib/server/library.ts`. It does not use PostgreSQL for
library items today.

The Stage 8D production library count was `6`. That count comes from the current
library JSON file, not from a database table.

## Current Provider Configuration Source

Provider configuration is resolved by `readProviders()`:

- load optional stored records from `data/providers.json`
- merge them with environment-backed defaults
- return sanitized records for public/admin display
- keep API keys server-side

The Stage 8D provider count was `8`. Provider model metadata can be stored
without secrets; API keys must stay encrypted or environment-only.

## Current Login And Admin Configuration Source

Authentication has both JSON and PostgreSQL repositories. Production release
checks require PostgreSQL persistence modes. Admin authorization is based on
auth/session state and role checks. Admin password, session cookies, raw tokens,
and database URLs must never be logged or returned to clients.

## Migrations And Schema Files

Migration files exist in `db/migrations`:

1. `001_initial_application_schema.sql`
2. `002_harden_database_baseline.sql`
3. `003_billing_webhook_processing_status.sql`
4. `004_task_billing_lifecycle.sql`
5. `005_task_billing_precheck_fingerprint.sql`
6. `006_task_billing_dispatch_states.sql`

`scripts/database/migrate.mjs` supports migration status and migration apply
using raw SQL and checksum records. Stage 9A did not run any migration command.

## Backup And Restore State

The release tooling supports:

- data/uploads snapshots with stable file counts, sizes, and SHA-256 manifests
- PostgreSQL backup through `pg_dump` custom format
- `pg_restore --list` verification
- backup manifests and checksum files
- rollback scripts that restore service code, data/uploads, and PostgreSQL dump
  material

Stage 8B rollback material still exists, but rollback authorization has expired.
Any real rollback must be separately re-authorized.

## Data Flow Audit

When a user opens Studio:

- frontend shell loads static assets and page data
- provider lists are loaded through sanitized provider APIs
- library data is loaded through `/api/library`
- files are served through `/api/files/[name]`
- generation and upscale actions are authenticated/CSRF-protected before any
  provider call

Current data flow boundaries:

- uploads enter the file system through upload or provider result storage paths
- generated outputs are stored in `uploads/`
- library metadata is stored in `data/library.json`
- video/upscale job metadata is stored in `data/jobs.json`
- auth/billing/quota production paths are PostgreSQL-backed
- provider API keys come from environment or server-side provider storage and
  are sanitized before display

Health checks report `newApiCalled=false` by using internal test guards and
non-generation paths. Watchdog reports `identity=owned` by matching the service
process identity and managed runtime metadata.

## Persistence Coverage

| Area | Current persistence | Notes |
| --- | --- | --- |
| users | PostgreSQL in production mode, JSON still exists for local/migration modes | Existing schema covers `app_users`. |
| sessions | PostgreSQL in production mode, JSON still exists for local/migration modes | Raw tokens are never stored; hashes only. |
| providers | JSON plus environment defaults | Move config metadata to DB later; protect secrets. |
| provider models | environment/default/static and optional provider health data | Safe to persist public model metadata. |
| library items | JSON file | Highest-priority migration candidate. |
| assets | file system only, metadata in library JSON | Needs DB metadata plus object storage boundary. |
| generation jobs | JSON `jobs.json` for video/upscale; immediate outputs for images | Needs unified job table. |
| API call logs | partial usage/task billing tables; no general generation call log | Needs safe, redacted log table. |
| error events | audit/error diagnostics are sanitized but not unified as DB events | Needs `error_events`. |
| quota and billing | PostgreSQL baseline exists | Keep ledger model; no single mutable balance only. |
| payments | repository and schema exist for orders/webhooks | Real payment remains out of scope for Stage 9A. |

## Risks

- Library and asset state still depends on JSON/file-system consistency.
- Deleting a library item currently deletes both metadata and stored file in one
  code path; a crash between DB/file operations would need future reconciliation.
- Provider keys can exist in server-side provider storage; any database move must
  use encryption and strict display redaction.
- PostgreSQL schema exists for auth/billing/quota but does not yet model the full
  Studio asset and generation lifecycle.
- Rollback authorization has expired; rollback material exists but execution
  needs fresh approval.

## Why Stage 9A Does Not Modify Data

Stage 9A is an audit and design phase. It intentionally does not:

- change schema
- run migrations
- no migration
- read business rows
- write production database data
- modify `data/`, `uploads/`, `data-staging/`, or `uploads-staging/`
- call NewAPI
- call generation providers
- call live provider `/models`
- publish or restart `3106` or `3107`
