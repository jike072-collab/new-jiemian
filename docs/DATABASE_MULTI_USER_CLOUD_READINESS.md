# Database Multi-User Cloud Readiness

Stage 9C-A prepares database foundations for cloud and multi-user work, but it does not complete a cloud migration.

## What Is Still Missing

The app still needs later-stage work before it is fully multi-user cloud-ready:

- route-level repository cutover from JSON/filesystem stores
- user ownership enforcement on every library and job query
- object storage adapter and signed URL policy
- data/uploads migration plan
- quota policy and billing source-of-truth decision
- production migration gate
- rollback rehearsal against a real production-like database
- privacy review for prompt retention and deletion policy

## User And Owner Isolation

Stage 9C-A adds nullable `user_id` links to:

- `generation_jobs`
- `library_items`
- `quota_accounts`

Nullable ownership keeps anonymous/local workflows compatible. Before cloud release, every authenticated route must explicitly scope reads and writes by owner. Admin routes must use a separate authorization policy and audit trail.

Required later checks:

- users cannot list another user's jobs
- users cannot load another user's assets
- users cannot mutate another user's library item
- deleted items stay hidden by default
- admin access is logged with `audit_logs`

## Assets And Object Storage

`assets.storage_type` supports:

- `local`
- `object_storage`
- `remote_url`
- `external`

Stage 9C-A does not move existing files. Current uploads remain in the filesystem.

Later stages should add:

- object key naming rules
- signed URL expiration
- checksum verification
- media metadata extraction
- upload malware/type checks if public uploads are enabled
- deletion lifecycle policy

## Library Cloud Path

Current library behavior stays JSON/filesystem-backed. The staged path is:

1. Keep existing `/api/library` contract unchanged.
2. Add repository-backed reads behind a feature flag.
3. Run dual-read comparison on 3107.
4. Backfill `assets` and `library_items` from a copied dataset.
5. Verify counts, sizes, checksums, and visible library items.
6. Cut over only after separate production authorization.

## Suggested Later Stages

### Stage 9C-B

Connect selected 3107 runtime code to the database repository behind a feature flag. Do not affect 3106.

### Stage 9D

Rehearse migration and import on isolated temporary data only. Use checksum-based verification, consistency checks, and rollback preparation. Do not touch 3106.

### Stage 9E

Only after separate authorization, plan production cutover with backup, restore drill, rollback authorization, and user-facing compatibility checks.

## Explicit Non-Goals

Stage 9C-A does not implement:

- real payment
- real orders
- real quota deduction
- provider secret storage
- NewAPI generation calls
- image or video generation calls
- server firewall changes
- domain, HTTPS, or reverse proxy changes
