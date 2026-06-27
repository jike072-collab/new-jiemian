# Database Stage 9B Implementation Gate

Stage 9B is an implementation gate and plan-freeze stage. It decides whether the
project is ready for a separately authorized minimum database implementation
stage. It does not create tables, modify schema, run migrations, write any real
database, call generation providers, call NewAPI, call live provider `/models`,
publish `3106`, restart `3106`, or restart `3107`.

## Baseline

- Repository: `jike072-collab/new-jiemian`
- Baseline main commit: `05fdb117bc3ed20b48882751086cbd76fb5d6f0d`
- Production service: `3106`
- Staging service: `3107`
- Stage 9A output: audit and design only
- Stage 9B output: gate documents and read-only CI check only

## Gate Decision

Stage 9B can recommend a later Stage 9C only when all of these are true:

- Stage 9A documents are present and internally consistent.
- The minimum Stage 9C MVP scope is frozen.
- Deferred tables and forbidden first-batch features are explicit.
- Migration tool, schema location, and migrations directory are selected.
- Test, staging, and production database identities are distinguishable.
- CI cannot run production migrations or production writes implicitly.
- Backup and restore gates are documented before any migration is authorized.
- `3107` validation is required before any `3106` release decision.
- `data`, `uploads`, `data-staging`, and `uploads-staging` remain unchanged.
- Secrets, database URLs, cookies, authorization headers, and API keys stay
  masked.

## What Stage 9B Allows

- Read Stage 9A database documents.
- Inspect source files, package scripts, and CI configuration.
- Add read-only gate documentation.
- Add a CI-safe gate script.
- Check for dangerous migration or DB-write wiring in install/build/check hooks.
- Check whether runtime data, uploads, environment files, dumps, or backups are
  tracked by Git.
- Record `3106` and `3107` status through read-only service helpers.

## What Stage 9B Forbids

- Creating or changing database tables.
- Changing database schema files.
- Running `prisma migrate`, `drizzle push`, `knex migrate`, or the local raw SQL
  migration apply command.
- Running `ALTER`, `CREATE`, `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, or `INSERT`
  against any real database.
- Writing production DB, staging DB, or an existing service DB.
- Moving or modifying JSON stores in `data` or `data-staging`.
- Moving or modifying files in `uploads` or `uploads-staging`.
- Copying production data to staging or staging data to production.
- Changing firewall, PostgreSQL bind settings, NewAPI listener settings, HTTPS,
  domain, or reverse proxy configuration.
- Calling image generation, image editing, video generation, upscale generation,
  NewAPI, or live provider `/models`.
- Publishing, stopping, or restarting `3106`.
- Entering Stage 9C.

## Stage 9A Document Review

The Stage 9A documents are sufficient for a gate decision when they cover:

- current PostgreSQL, JSON, and file-system usage
- current library source and provider configuration source
- migration tool and migration directory
- backup and restore strategy
- production/staging isolation
- secret and log redaction requirements
- `data/uploads` consistency risk
- first-batch versus deferred database scope

The Stage 9A implementation plan is
`docs/DATABASE_STAGE9_IMPLEMENTATION_PLAN.md`. Any reference to
`DATABASE_STAGE4_IMPLEMENTATION_PLAN.md` in handoff text is treated as a naming
mistake unless such a file appears in the repository.

## Migration Tool Gate

The next implementation stage should continue the existing raw SQL migration
toolchain unless a separate architecture decision changes it:

- migration tool: `scripts/database/migrate.mjs`
- migration files: `db/migrations/*.sql`
- migration bookkeeping: `schema_migrations`
- PostgreSQL client: `pg`
- identity guard: `APP_DATABASE_EXPECTED_NAME`

Stage 9B does not run the migration tool. Stage 9C may only run it against a
throwaway or separately authorized staging database.

## CI Gate

CI must run:

- `npm run check:database-gate`

The gate script must remain read-only and must fail if:

- `.env` or `.env.local` is tracked
- `data`, `uploads`, `data-staging`, `uploads-staging`, `.runtime`, logs, PID
  files, backup files, dump files, or generated artifacts are tracked
- install/build/check lifecycle scripts run migration, seed, or DB-write
  commands
- `check:database-gate` is not wired into the main `check` command
- CI does not call `npm run check:database-gate` in both Linux and Windows jobs
- the gate script contains executable DB mutation statements

CI must not connect to production DB, run production migrations, call NewAPI,
call providers, write runtime data, or create persistent dumps.

## Environment State Reporting

Reports may say only:

- `configured/masked`
- `missing`
- `present_not_read`
- `not_found`

Reports must not print:

- database connection strings
- API keys
- passwords
- cookies
- authorization headers
- raw provider responses

## Stage 9C Authorization Boundary

Even if Stage 9B passes, Stage 9C still requires a separate user authorization.
That authorization must name the database target and confirm whether the work is
limited to throwaway/test DB, staging DB, or a later production migration plan.

Stage 9B completion never authorizes:

- production schema changes
- production migration
- production DB writes
- `3106` release
- real generation smoke tests
- live provider `/models`
