# Current Account Data Model

## Summary

The current application has no customer account data model. It has provider configuration records, library item records, and video job records stored in local JSON files under `data/`. These records are global to the local app and are not scoped to a user.

## Persisted Records

| Data area | File path | Function or type | Call direction | Real runtime behavior | Database connection | Placeholder status | Reusable | Later module owner |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Data root | `src/lib/server/paths.ts` | `dataRoot`, `uploadsRoot`, `readJsonFile`, `writeJsonFile` | Server helpers -> filesystem | Yes, reads/writes local files | No database; filesystem JSON/files | Real runtime storage helper | Reusable for local dev fixtures only | B05/B06/B10 |
| Provider config | `src/lib/server/providers.ts`; type in `src/lib/server/types.ts` | `ProviderConfig`, `PublicProvider`, `ProviderUpdate` | Admin API and generation APIs -> provider config | Yes | Local JSON `data/providers.json` | Real provider config, not account data | Useful BFF config boundary | B07 |
| Library items | `src/lib/server/library.ts`; type in `src/lib/server/types.ts` | `LibraryItem`, `readLibrary`, `addLibraryItem`, `updateLibraryItem`, `deleteLibraryItem` | Generate/upscale routes -> library JSON | Yes | Local JSON `data/library.json` | Real artifact storage, globally scoped | Reusable shape after adding owner/quota fields | B10 |
| Jobs | `src/lib/server/library.ts`; type in `src/lib/server/types.ts` | `JobRecord`, `readJobs`, `addJob`, `updateJob` | Video submit/upscale/polling -> jobs JSON | Yes | Local JSON `data/jobs.json` | Real job tracking, globally scoped | Reusable after adding owner/access checks | B10 |
| Upload files | `src/lib/server/library.ts`, `src/app/api/files/[name]/route.ts` | `storeBytes`, `readStoredFile`, files under `uploads/` | Generation/upscale stores files -> files API serves them | Yes | Filesystem only | Real local artifact storage | Reusable after access control | B10/B12 |

## Missing Account Records

| Missing model | Evidence | Current status | Later owner |
| --- | --- | --- | --- |
| User table | No schema, ORM, migration, user model, or user route found | Missing | B04/B09 |
| Customer table | No customer route, customer component, or customer persistence found | Missing | B04/B09 |
| Session table | No session model, cookie helper, or token store found | Missing | B04/B09 |
| Password credential table | No user password creation or verification code found | Missing | B09 |
| Admin role table | No role, permission, or admin-user model found | Missing | B04/B09 |
| Balance/points/quota ledger | Only UI copy mentions points; no persisted ledger found | Missing | B04/B10 |
| Usage log | Jobs/library exist, but no per-user usage ledger or cost record exists | Missing | B10 |
| Recharge order | No order/payment/webhook records found | Missing | B11 |

## Current ID Sources

| ID | Source | Scope | User-safe? | Notes |
| --- | --- | --- | --- | --- |
| `LibraryItem.id` | `randomUUID()` in `addLibraryItem` | Local artifact | No | Identifies artifact only, no owner. |
| `JobRecord.id` | Provider job ID or `randomUUID()` | Local/external job | No | Identifies job only, no owner. |
| `ProviderConfig.id` | Static/default provider IDs | Provider configuration | No | Not a user ID. |
| Stored media name | `randomUUID()` plus sanitized prefix | Local uploaded/generated file | No | File access is global by name. |

## Direct Answers

- Real user database: none.
- User unique ID source: none.
- Password storage: none for customers; `ADMIN_PASSWORD` is environment-only, provider keys are local JSON config.
- Admin roles: none; only local/password provider-admin gate.
- Real points/balance/quota: none.
- Usage tracking: artifact/job records exist, but no billable usage or user-scoped logs.

## Reuse Notes

The local JSON pattern is useful for narrow local development state, but it should not become the final account source of truth. Later modules must choose one account/session/quota truth source and avoid creating a second ledger around these global artifact records.
