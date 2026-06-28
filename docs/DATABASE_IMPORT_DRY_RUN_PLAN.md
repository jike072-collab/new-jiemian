# Database Import Dry-Run Plan

Stage 9C-B adds read-only planning checks for a future library import. It does not perform the import.

## Commands

- `npm run db:library-import:plan`
- `npm run db:library-consistency:check`

Both commands are read-only by default and reject `--apply`.

## Import Plan Output

The import plan reports:

- scanned data files
- scanned uploads root
- library record count
- job record count
- upload file count
- mappable records
- missing files
- orphan files
- duplicate records
- estimated `library_items`
- estimated `assets`
- estimated `generation_jobs`
- suggested import order
- risk level

It does not print database URLs, passwords, API keys, cookies, Authorization headers, or raw secret values.

## Consistency Check

The consistency check verifies:

- safe stored file names
- missing output files
- orphan upload files
- duplicate library records
- duplicate generation jobs
- orphan jobs
- succeeded jobs without output
- failed jobs with successful visible library items
- path traversal or absolute path risk in adapter source files

The check does not connect to a production or staging database by default.

## Why No Real Import In Stage 9C-B

Real import would modify durable library state and must be authorized separately. It requires:

- production-like backup
- restore rehearsal
- checksum baseline
- copied dataset or maintenance window
- explicit migration target
- rollback decision
- 3106 release authorization if production is involved

Stage 9C-B only establishes adapter and verification surfaces.

## Future Stage

A later Stage 9C-C or migration stage should:

1. Copy data/uploads into an isolated validation area.
2. Run dry-run plan.
3. Compare counts, sizes, checksums, and visible records.
4. Apply import to a temporary database only.
5. Rehearse rollback.
6. Request separate approval before staging or production import.
