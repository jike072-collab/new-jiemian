# Stage 9G-5 Upload And Temporary File Cleanup Plan

Stage 9G-5 is a planning-only document for uploads, temporary files, and failed artifact cleanup.

This stage does not delete files, does not move files, does not modify real uploads, does not scan or import real upload contents, does not write DB state, does not run migration, does not call a provider, does not call NewAPI, and does not touch 3106.

## Hard Boundary

The following are not authorized by this plan:

- no delete
- no move
- no modify
- no repair
- no import
- no migration
- no DB write
- no provider call
- no NewAPI call
- no real upload-content read
- no production path access
- no 3106 operation

This document may describe current path layout, risk categories, dry-run rules, and future cleanup sequencing only.

## Current Runtime Path Model

The current repo already separates runtime storage responsibilities.

### Expected Upload And Data Layout

Current repo expectations:

- production-style runtime uses:
  - `data/`
  - `uploads/`
- staging `3107` must use:
  - `data-staging/`
  - `uploads-staging/`
- temporary and scratch outputs must stay outside committed runtime roots
- build and release scratch output must stay under system temp or isolated scratch roots

### Current Isolation Guards

Current safeguards already present in the repo:

- `src/lib/server/runtime-paths.ts` validates runtime path containment
- `src/lib/server/paths.ts` resolves upload and data writes through centralized helpers
- `scripts/test-runtime-data-isolation.mjs` rejects `3107` if `DATA_DIR` or `UPLOADS_DIR` are missing, defaulted, nested, or overlapping
- `scripts/check-runtime-path-usage.mjs` guards against bypassing centralized runtime path helpers
- `scripts/check-release-test-artifact-isolation.mjs` verifies tests and release preflight use isolated temporary roots

Stage 9G-5 should build on these guards rather than introducing cleanup automation first.

## Uploads Directory Structure Expectation

Current expectations inferred from the repo:

1. user-visible bytes and generated output bytes live under the active uploads root
2. library and job metadata may point to stored outputs through `uploads/<stored-name>` or through adapter job references
3. API download paths such as `/api/files/[name]` depend on sanitized stored names and upload-root containment
4. staging and production uploads must remain isolated from each other

Cleanup planning must treat uploads as user-facing assets first, not as disposable cache.

## Temporary File Types

The repo already uses several temporary-file patterns.

### 1. Atomic JSON Write Temps

Current pattern:

- `src/lib/server/paths.ts` writes JSON through `*.tmp` files and then renames them into place

Cleanup implication:

- abandoned `*.tmp` files are candidates for future dry-run inventory
- cleanup must verify the corresponding final file exists and the temp file is not from an active writer

### 2. Test And Preflight Scratch Roots

Current pattern:

- `scripts/test-runtime-data-isolation.mjs`
- `scripts/test-staging-smoke.mjs`
- `scripts/test-ops-service.mjs`
- `scripts/release-preflight.mjs`

These scripts create isolated temp roots under system temp and remove them after the check finishes.

Cleanup implication:

- system-temp scratch roots are operationally different from real uploads
- they should be inventoried separately from application uploads

### 3. Runtime Operation Locks And Local Artifacts

Current pattern:

- ops tests and release checks refer to `.runtime`, release artifacts, service backups, and operation locks

Cleanup implication:

- these files may be disposable only if they are outside the active runtime and not needed for incident evidence
- cleanup of runtime artifacts must stay separate from upload cleanup

## Failed Task Artifact Types

Cleanup planning should distinguish between user-visible assets and failure evidence.

### Upload-Root Asset Outputs

Examples:

- library output files
- generated media files
- uploaded source files
- upscale outputs

Planning implication:

- these are not disposable by default
- no deletion should be considered until ownership, retention, and reference tracking are trustworthy

### Failure And Repair Evidence

Examples already present in the repo:

- auth dual-repair state under runtime data
- billing dual-repair state under runtime data
- operation-lock and release incident artifacts

Planning implication:

- failed artifact cleanup cannot run before the related incident, billing, or auth repair evidence is no longer needed

### Test-Only Scratch Artifacts

Examples:

- release-preflight scratch output
- temporary test runtime roots
- isolated service-test backup sandboxes

Planning implication:

- these are the safest future cleanup candidates
- they still require a dry-run inventory and path guard before any deletion automation

## Cleanup Eligibility Categories

Future cleanup should classify paths before doing anything destructive.

### Category A: Never Auto-Clean In Current State

- active uploads under the current runtime uploads root
- any file still referenced by library records, asset metadata, or job metadata
- any file under production-style `data/` or `uploads/`
- any path under 3106
- any failure evidence tied to an unresolved incident

### Category B: Manual Review Required

- orphaned upload candidates where ownership or reference confidence is incomplete
- runtime artifacts under `.runtime` tied to active or recent service state
- dual-repair and reconciliation artifacts
- release backup folders retained for rollback evidence

### Category C: Dry-Run Candidate First

- abandoned `*.tmp` JSON-write files
- isolated temp-root leftovers from tests or preflight
- expired scratch release artifacts outside active runtime roots
- known ignored local build/test folders that are not user data

Category C still requires dry-run first and explicit authorization before deletion.

## Dry-Run First Policy

Any future cleanup effort must start with dry-run inventory only.

### Required Dry-Run Output

At minimum, a dry-run should report:

- root being scanned
- path classification
- file count
- byte size
- age buckets
- whether the path is inside uploads, runtime scratch, or system temp
- whether there is an active reference dependency
- whether the item is blocked by ownership uncertainty

### Dry-Run Must Not Do

- delete
- move
- rewrite
- normalize file names
- open user file contents unless separately authorized
- touch production or 3106 runtime roots

### Existing Checks To Reuse Before Any Future Cleanup

- `npm run check:runtime-paths`
- `npm run check:release-test-artifact-isolation`
- `npm run test:runtime-isolation`
- `npm run db:library-consistency:check`

These checks are useful preconditions because they prove path isolation and catch reference drift without requiring cleanup execution.

## Retention Policy Outline

Stage 9G-5 only records a recommended policy shape.

### User-Facing Uploads

Default:

- retain
- never auto-delete until ownership/access guard and asset/reference confidence are proven

### Failed Task Evidence

Default:

- retain until the related billing/auth/task incident is resolved
- require explicit incident owner sign-off before cleanup

### Scratch Test And Preflight Outputs

Default:

- shortest retention class
- safe future candidate for automated expiration after dry-run evidence is reviewed

### Release And Rollback Artifacts

Default:

- retain according to rollback and deployment policy
- do not mix with upload cleanup

## Path Traversal Protection Dependency

Cleanup planning depends on path safety being stronger than the current cleanup candidate list.

Relevant current safeguards:

- `src/lib/server/runtime-paths.ts` enforces root containment
- `src/lib/server/library.ts` sanitizes stored names before reading or deleting upload-backed files
- `src/app/api/files/[name]/route.ts` benefits from path safety but still needs auth and ownership hardening

Planning implication:

- no cleanup script should accept arbitrary relative paths
- no cleanup script should work on paths not derived from centralized runtime path helpers
- no cleanup should assume `/api/files/[name]` is already safe from ownership leakage

## Ownership And Access Guard Dependency

Stage 9G-5 depends on stronger access semantics before upload cleanup can be trusted.

Current planning risks:

- `/api/files/[name]` still needs auth and ownership guard closure
- `/api/library` still reflects broader global-library behavior than a final multi-user ownership model
- `library-jobs-adapter` already has `user_id` and `ownerLocalUserId` mapping, but current data assumptions still allow incomplete ownership confidence

Planning consequence:

- no orphan-upload cleanup should be authorized until ownership guard work is complete
- no cross-user cleanup decision should be made from filename alone
- future cleanup must prefer metadata-backed ownership and reference checks over raw filesystem heuristics

## Cleanup Stop Conditions

Any future cleanup pass must stop immediately if any of the following is true:

- target path identity is unclear
- target path resolves to production-style `data/` or `uploads/`
- target path belongs to 3106
- ownership metadata is missing or inconsistent
- library or asset references cannot be verified safely
- runtime path isolation checks fail
- staging and production path boundaries are not clearly separated
- an active service incident or rollback window still needs the artifact
- cleanup scope expands beyond the reviewed class of files

## Evidence Checklist

Before any future cleanup execution is even considered, collect:

1. runtime root identity
2. uploads root identity
3. staging-versus-production path summary
4. dry-run inventory summary only
5. reference-check summary
6. ownership-confidence summary
7. rollback relevance summary
8. stop-condition review
9. explicit user authorization for any destructive step

## Future UploadThing Or Object Storage Evaluation

Stage 9G-5 does not recommend introducing UploadThing or object storage now.

Future evaluation can revisit:

- signed upload flows
- object lifecycle rules
- TTL cleanup on non-user-visible intermediates
- metadata-backed retention enforcement
- provider-agnostic object key design

That evaluation must remain separate from current local-runtime cleanup planning and requires separate authorization if it introduces dependencies or architecture changes.

## Recommended Future PR Sequence

Recommended order before any cleanup implementation:

1. finish ownership and access guard work
2. finish observability baseline for disk usage and upload growth
3. add dry-run inventory/reporting only
4. validate reference and ownership confidence on isolated test data
5. authorize one narrow cleanup class only if evidence is complete

## Items Requiring Separate Authorization

Separate user authorization is required for:

- any real upload inventory against live contents
- any delete
- any move
- any file repair
- any retention enforcement
- any DB write to mark cleanup state
- any cleanup automation touching real runtime roots
- any 3106-related file operation
- any production-path operation

## Evidence Sources

Primary repo evidence:

- `src/lib/server/runtime-paths.ts`
- `src/lib/server/paths.ts`
- `src/lib/server/library.ts`
- `src/app/api/files/[name]/route.ts`
- `src/app/api/library/route.ts`
- `src/lib/server/database/library-jobs-adapter.ts`
- `scripts/test-runtime-data-isolation.mjs`
- `scripts/test-staging-start-preflight.mjs`
- `scripts/check-runtime-path-usage.mjs`
- `scripts/check-release-test-artifact-isolation.mjs`
- `scripts/test-ops-service.mjs`
- `scripts/release-preflight.mjs`
- `docs/CLEANUP_AUDIT.md`
- `docs/3107_MANUAL_TEST_CHECKLIST.md`

## Outcome

Stage 9G-5 records the current uploads and temporary-file cleanup problem shape, the main safety dependencies, and a dry-run-first path.

It does not authorize cleanup execution, does not read or modify real uploads, and does not authorize any destructive file operation.
