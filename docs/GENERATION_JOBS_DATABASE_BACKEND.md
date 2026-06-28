# Generation Jobs Database Backend

Stage 9C-B adds a guarded adapter path for generation job records. The default runtime still uses the existing job store.

## Current Default

Default generation job storage remains:

- `data/jobs.json`
- status values `queued`, `generating`, `done`, `failed`
- existing polling and billing reconciliation behavior

Stage 9C-B does not change generation endpoint paths, request fields, response fields, or provider calling code.

## Database Mapping

The adapter maps JSON job states to Stage 9C-A database states:

- `queued` -> `queued`
- `generating` -> `running`
- `done` -> `succeeded`
- `failed` -> `failed`

Database states are mapped back to the existing JSON response shape when the guarded DB jobs backend is enabled.

## Relationships

The intended relationship is:

1. `generation_jobs` tracks lifecycle.
2. `assets` tracks input/output file references.
3. `library_items` links visible library records to assets and jobs.

Stage 9C-B uses existing Stage 9C-A tables only. It does not add a migration.

## Error And API Call Logging

Stage 9C-A already provides:

- `error_events`
- `api_call_logs`

The repository redacts secret-shaped values before insert. Stage 9C-B tests verify safe repository behavior but do not call real providers or NewAPI.

## Known Deferral

The current Stage 9C-A schema does not have a dedicated external provider task id or status URL column. Stage 9C-B therefore keeps default job polling on the existing JSON store and treats DB jobs as a guarded integration path. A later schema/migration stage should add explicit provider task reference fields before production cutover.

## Mock Testing

`npm run test:generation-jobs-db-integration` uses an in-memory repository. It verifies status mapping and adapter behavior without:

- production DB writes
- staging DB writes
- migrations
- generation calls
- NewAPI calls
- real provider calls
