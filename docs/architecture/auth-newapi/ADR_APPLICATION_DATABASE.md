# ADR: Application Database Baseline

## Status

Accepted for BP-01A.

## Context

B09 to B11 added real backend foundations using local JSON repositories. That is acceptable for isolated backend validation, but production account, session, mapping, billing, webhook, usage, and audit data need a formal database baseline before any mainline integration review can treat the backend as production-track work.

The application database is separate from the New API database. This project must never read or write New API internal tables; New API remains reachable only through the server-side BFF/API integration.

## Options

| Dimension | `pg` + raw SQL migrations | Drizzle ORM | Prisma |
| --- | --- | --- | --- |
| Node 24 and Next.js 16 compatibility | Mature Node client with small runtime surface. Works in Node server code and scripts. | Compatible in principle, but adds ORM-specific build and migration conventions. | Compatible in principle, but adds generated client and engine lifecycle concerns. |
| Server-only support | Direct server imports and scripts; easy to keep out of browser bundles. | Server-only possible, but schema modules can be accidentally imported by shared code. | Server-only possible, but generated client and environment loading require stricter guardrails. |
| Migration controllability | Full SQL visibility; checksum logic can fail closed when an applied file changes. | Structured migrations, but generated SQL must be reviewed and tool behavior learned. | Strong migration tooling, but generated migrations and shadow DB behavior add process weight. |
| Transaction support | Native PostgreSQL transactions through `PoolClient`. | Good transaction support through ORM APIs. | Good transaction support through Prisma client APIs. |
| Type safety | SQL result typing is manual and narrower. | Better query typing from schema definitions. | Strong generated model types. |
| Bundle risk | Lowest added bundle risk because no schema/client code is needed outside server modules. | Moderate; schema files may be imported by shared code if not disciplined. | Higher; generated client must be kept strictly server-side. |
| Dependency size | Smallest new dependency set: `pg` and `@types/pg`. | Adds ORM package and migration tooling. | Adds Prisma packages, generated client, and engine downloads. |
| CI complexity | Simple PostgreSQL service plus Node scripts. | Requires Drizzle migration commands and schema generation discipline. | Requires Prisma generate/migrate steps and engine caching. |
| Existing TypeScript service adaptation | Fits current repository/service pattern with repository interfaces and explicit DTOs. | Would require introducing ORM schema style before repositories exist for SQL. | Would require Prisma schema and generated model naming decisions now. |
| Connection pooling | Uses node-postgres pool directly; suitable for current long-running Node/Next deployment assumption. | Usually delegates to driver/pool; still needs operational tuning. | Pool behavior depends on Prisma runtime and deployment mode. |
| Serverless vs long-running Node | Best for long-running Node. Serverless would later require a pooler or serverless driver decision. | Similar deployment questions. | Prisma has serverless guidance but adds runtime-specific choices. |
| Long-term maintenance | SQL is explicit and portable, but type safety discipline remains manual. | More abstraction once data access grows. | Strong model layer, but bigger upgrade and generation workflow. |
| Security advisory and upgrade cost | Small dependency surface makes advisories easier to track. | Moderate dependency surface. | Larger dependency/runtime surface. |

## Decision

Use `pg` with raw SQL migrations for BP-01A.

Reasons:

- BP-01A needs a conservative database baseline, not a broad data-access rewrite.
- Existing B-side code already uses explicit service/repository boundaries. Raw SQL can be introduced underneath those repositories later without changing public API contracts.
- Raw SQL gives reviewers direct visibility into status checks, unique constraints, foreign keys, integer money/quota fields, and the absence of a local cloud quota balance ledger.
- The dependency surface stays limited to `pg`, `@types/pg`, and the Next/React `server-only` marker package.
- Migration checksum enforcement is simple to audit and does not require generated migration artifacts.

## Rejected Options

Drizzle is not chosen in BP-01A because its main benefits appear when query code is already being migrated into typed ORM repositories. This module does not replace JSON repositories yet, so adding an ORM schema would be extra process before the first SQL read/write path exists.

Prisma is not chosen in BP-01A because generated client management, engine downloads, and migration conventions add weight to a baseline that only needs audited SQL, a connection helper, CI, and a migration plan.

## Schema Scope

The baseline migration creates:

- `schema_migrations`
- `app_users`
- `auth_sessions`
- `new_api_user_mappings`
- `billing_orders`
- `billing_webhook_events`
- `billing_idempotency_keys`
- `usage_records`
- `task_billing_records`
- `audit_events`
- `reconciliation_runs`

The schema intentionally does not create a local mutable quota balance table. New API remains the single cloud quota ledger.

## Application Impact

- Adds server-side database config, pool, transaction, and health helpers under `src/lib/server/database`.
- Adds migration and schema test scripts under `scripts/database`.
- Adds environment placeholders to `.env.example`.
- Adds CI for PostgreSQL migration and client bundle boundary scans.
- Adds `server-only` imports to the database entry modules so Client Component imports fail at build time.
- Requires `APP_DATABASE_EXPECTED_NAME` before migration, status, health, or schema tests execute database DDL or read application tables.
- Does not change any existing API route contract.
- Does not enable PostgreSQL as the primary runtime write path in BP-01A.
- Does not remove or modify existing JSON runtime stores.

## Rollback

Before any production write path uses the application database, rollback is:

1. Remove the BP-01A database files under `db/`, `scripts/database/`, and `src/lib/server/database/`.
2. Remove the application database workflow.
3. Remove `APP_DATABASE_*` placeholders from `.env.example`.
4. Remove `pg`, `@types/pg`, and `server-only` from package files if no later server-only modules still use it.

After later modules begin writing to PostgreSQL, rollback must be handled by a module-specific data rollback plan and must not delete production tables automatically.

## Security Notes

- `APP_DATABASE_URL` is server-only and must not be exposed to client components or browser bundles.
- `APP_DATABASE_EXPECTED_NAME` must be set explicitly and compared with `select current_database()` before creating `schema_migrations`, running migrations, checking status, health, or schema tests.
- The migration scripts must fail before DDL when connected to an unexpected database name.
- Production must fail closed when `APP_DATABASE_URL` is absent.
- Production and test migration commands also fail closed when `APP_DATABASE_EXPECTED_NAME` is absent.
- Database credentials must not be reused from New API.
- Test and production databases must use different credentials.
- PostgreSQL and Redis must not be public.
- Password hashes remain compatible with the existing `scrypt$...` format from `src/lib/server/auth/password.ts`.
- Session rows store SHA-256 hexadecimal token hashes only, never raw session tokens. Migration `002_harden_database_baseline.sql` replaces the initial length-only check with `^[a-f0-9]{64}$`.
