# Module 10 Handoff

## Completed Scope

B10 adds a server-side quota and usage adapter for the authenticated project user:

- current quota snapshot from New API user quota;
- short display cache for quota reads;
- fail-closed quota precheck endpoint;
- local usage audit repository;
- upstream New API log normalization;
- stable quota/usage error codes;
- tests and CI workflow for the quota adapter.

## Files Added

| File | Purpose |
| --- | --- |
| `src/lib/server/quota/types.ts` | Quota, usage, operation, and error contracts. |
| `src/lib/server/quota/cache.ts` | Short-lived display cache. |
| `src/lib/server/quota/repository.ts` | Local usage audit repository. |
| `src/lib/server/quota/service.ts` | New API-backed quota and usage service. |
| `src/lib/server/quota/http.ts` | API response helpers. |
| `src/app/api/quota/route.ts` | Current user quota route. |
| `src/app/api/quota/precheck/route.ts` | CSRF-protected quota precheck route. |
| `src/app/api/usage/route.ts` | Current user usage route. |
| `src/lib/server/quota/__tests__/quota-service.test.ts` | B10 unit tests. |
| `scripts/test-quota-usage.mjs` | B10 test runner. |
| `tsconfig.quota-usage-tests.json` | B10 test compilation config. |
| `.github/workflows/quota-usage.yml` | PR validation for B10 paths. |

## Files Extended

| File | Change |
| --- | --- |
| `src/lib/server/integrations/new-api/user.ts` | Added admin helpers for New API user quota and logs. |
| `src/lib/server/integrations/new-api/index.ts` | Exported New API quota/log helpers and types. |

## Runtime Data

The JSON repository writes to `data/quota-usage-log.json` at runtime. The `data/` directory is ignored by Git and must not be committed.

This file is an audit log, not a balance table.

## Current API Surface

| Route | Method | Auth |
| --- | --- | --- |
| `/api/quota` | `GET` | B09 project session. |
| `/api/quota/precheck` | `POST` | B09 project session plus CSRF. |
| `/api/usage` | `GET` | B09 project session. |

## Important Non-Goals

B10 does not:

- change the workbench UI;
- change generation, upscale, library, file, or job routes;
- perform New API recharge;
- implement payment or webhook handling;
- create a local mutable balance;
- modify database schema;
- add real payment credentials;
- copy New API UI.

## Follow-Up For Task Integration

The following routes still need future task billing integration and currently remain outside B10:

- `src/app/api/generate/image/route.ts`
- `src/app/api/generate/video/route.ts`
- `src/app/api/upscale/image/route.ts`
- `src/app/api/upscale/video/route.ts`
- `src/app/api/jobs/[id]/route.ts`
- `src/app/api/library/route.ts`
- `src/app/api/files/[name]/route.ts`

Future integration must call B10 precheck before billable cloud submission and must update usage status after upstream acceptance, completion, failure, cancellation, retry, and reconciliation.

The future Workbench integration must use a stable task ID and idempotency key so repeated submits, retries, duplicate callbacks, and browser refreshes do not create duplicate audit rows or bypass quota precheck.

Generation and upscale outcomes must be recorded as:

- prechecked;
- submitted;
- succeeded;
- failed;
- cancelled;
- retrying;
- reconciled.

Failed or cancelled tasks must not be counted as successful actual consumption unless New API confirms quota usage. If upstream usage is charged but local task state fails, the task must enter reconciliation instead of silently refunding or creating a local balance correction.

## Verification Coverage

Local B10 tests cover:

- normal quota;
- zero quota;
- insufficient quota;
- large safe integer quota;
- New API unavailable;
- missing/inactive mapping;
- local usage pagination;
- repeated task/idempotency behavior;
- failed task audit logging;
- cache invalidation;
- permission isolation by local user;
- upstream log mapping;
- upstream usage failure and rate limiting;
- secret redaction in local error messages.

Remote PR workflow runs:

- `node scripts/test-quota-usage.mjs`;
- `npm run typecheck`;
- `npm run lint`;
- `npm run build`.

## Open Risks

- New API log list response shape is normalized defensively because the official response may vary by version.
- Upstream logs do not always contain the product operation, so normalized upstream-only entries use a placeholder operation until future task integration records the real operation locally.
- This machine does not provide Docker; real container verification remains covered by existing B05/B06/B07/B08 remote workflows, not by B10 local checks.
- Workbench task routes are still unauthenticated for quota purposes until a future integration task connects them to B09 sessions, B08 mappings, and B10 precheck.
