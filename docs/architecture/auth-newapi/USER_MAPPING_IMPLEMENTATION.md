# User Mapping Implementation

## Scope

B08 adds the server-side user mapping and sync foundation between local project users and New API users.

It does not add login/register routes, a local user table, sessions, quota charging, billing, payment, frontend pages, or a formal database schema migration.

## Database And Migration Audit

Current repo findings:

| Area | Finding | B08 decision |
| --- | --- | --- |
| ORM/query layer | No Prisma, Drizzle, TypeORM, Knex, Sequelize, or SQL query layer is present. | Do not invent a full database layer in B08. |
| Migration mechanism | No formal migration runner or schema folder exists. | Add Repository implementation and migration draft only. |
| Current persistence | Existing server data uses JSON files under runtime `data/` through `src/lib/server/paths.ts`. | B08 follows the existing server persistence style for test/runtime mapping storage. |
| Test database | No dedicated test database exists. | Unit tests use an in-memory Repository. Real integration test uses the isolated New API container only for upstream creation. |
| Transactions | No cross-process transactional database support exists yet. | Repository serializes in-process mutations and uses optimistic `version`. Formal DB migration must add real unique constraints. |
| ID type | Existing project has no real user table yet. | `local_user_id` is a string supplied by the future B09 local auth layer. |
| Time type | Existing records use ISO timestamps. | Mapping timestamps are ISO strings. |
| Unique constraints | No database uniqueness is available yet. | Repository enforces uniqueness in code; migration draft below requires database unique indexes. |

## Files Added

- `src/lib/server/integrations/new-api/user-mapping.ts`
- `src/lib/server/integrations/new-api/user-sync.ts`
- `src/lib/server/integrations/new-api/__tests__/user-mapping.test.ts`
- `src/lib/server/integrations/new-api/__tests__/user-sync.test.ts`

B08 also extends the existing B07 test script and real New API integration test.

## Runtime Storage

`createJsonNewApiUserMappingRepository()` stores mappings in:

```text
data/new-api-user-mappings.json
```

This file is runtime data and must not be committed.

The JSON-backed Repository is a bridge until B09 or a later database module introduces a formal project account database. It is not a replacement for database constraints in production.

## Mapping Fields

The implemented record shape is:

| Field | Type | Notes |
| --- | --- | --- |
| `local_user_id` | string | Stable project user id supplied by local auth. |
| `new_api_user_id` | string or null | New API user id once confirmed. |
| `sync_status` | enum | `pending`, `active`, `failed`, `disabled`, `orphaned`, `repair_required`. |
| `created_at` | ISO string | Created timestamp. |
| `updated_at` | ISO string | Last local update timestamp. |
| `last_sync_at` | ISO string or null | Last sync attempt or terminal transition timestamp. |
| `last_error_code` | string or null | Sanitized machine code. |
| `last_error_message` | string or null | Sanitized message capped at 300 characters. |
| `retry_count` | number | Incremented on failed sync attempts. |
| `version` | number | Optimistic concurrency guard. |
| `idempotency_key` | string | Stable registration/sync idempotency key. |

## Repository Capabilities

The Repository supports:

- lookup by `local_user_id`
- lookup by `new_api_user_id`
- list by status
- idempotent pending creation
- mark active
- mark failed
- mark disabled
- mark orphaned
- schedule repair
- prepare retry

Rules:

- `local_user_id` is unique.
- `new_api_user_id` is unique for non-orphaned mappings.
- stale `version` transitions fail with `NEW_API_MAPPING_VERSION_CONFLICT`.
- secrets are redacted before storing `last_error_message`.
- retry exhaustion moves the mapping to `repair_required`.

## Sync Service

`NewApiUserSyncService.ensureMapped(profile, options)` performs:

1. Return existing active mapping without calling New API.
2. Create a pending local mapping if none exists.
3. Retry a failed mapping only when retry limits allow it.
4. Create a New API user through the B07 admin client.
5. On 409/duplicate or timeout, query New API users to confirm whether the upstream user already exists.
6. Activate mapping only after a confirmed New API user id exists.
7. Mark retryable upstream failures as `failed`.
8. Mark ambiguous or unsafe states as `repair_required`.

The sync service never automatically deletes New API users. If upstream creation succeeds but local activation cannot be confirmed, the local mapping enters repair state.

New API user creation uses normalized upstream fields:

- `username` is derived from local username, email, or `local_user_id`, then shortened to New API's 20-character limit with a stable hash suffix.
- `display_name` is shortened to New API's 20-character limit.
- `email` is sent only when the local email fits New API's 50-character limit. Overlong local emails stay in the local account layer and are not sent upstream.

The local account email remains local identity data. New API email is an optional upstream profile field and must not become the identity truth source.

## Migration Draft

When a formal project database is introduced, create a table equivalent to:

```sql
create table new_api_user_mappings (
  local_user_id text primary key,
  new_api_user_id text unique,
  sync_status text not null check (
    sync_status in ('pending', 'active', 'failed', 'disabled', 'orphaned', 'repair_required')
  ),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  last_sync_at timestamptz,
  last_error_code text,
  last_error_message text,
  retry_count integer not null default 0,
  version integer not null default 1,
  idempotency_key text not null unique
);

create index new_api_user_mappings_status_idx
  on new_api_user_mappings(sync_status);
```

Production migration requirements:

- run inside the chosen project database migration system;
- preserve existing JSON mapping rows if any exist;
- add real unique constraints for `local_user_id`, `new_api_user_id`, and `idempotency_key`;
- use row-level transactions for sync transitions;
- do not make New API the user identity database.

## Test Coverage

Unit tests cover:

- Repository create/query/state transitions
- optimistic concurrency
- duplicate local/user mapping conflicts
- retry exhaustion
- disabled/orphaned/repair states
- error redaction
- concurrent local create attempts
- sync success
- existing active mapping reuse
- 409 duplicate linking
- unconfirmed duplicate repair
- timeout then upstream confirmation
- retryable network failure then recovery
- non-retryable admin failure
- upstream-created/local-activation conflict repair

Real integration coverage:

- isolated New API health check
- admin authorization
- real New API user creation through `NewApiUserSyncService`
- local mapping activation against the real created New API user id
