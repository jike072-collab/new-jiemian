# Server Preparation Final Audit

Status vocabulary:

- `PASS`: completed and tested inside the repository.
- `MANUAL-3107`: requires the repository owner to test locally on port 3107.
- `SERVER-GATE`: must be verified later on the real Ubuntu 3106 server.
- `DEFERRED`: not required for the first deployment.
- `FAIL`: blocking issue.

Final repository state before real server validation:

`REPOSITORY_READY_FOR_LOCAL_3107_VALIDATION`

This document does not authorize a merge to `main` and does not authorize server
deployment. Server deployment is a separate future task.

## PASS

| Item | Status | Evidence |
| --- | --- | --- |
| Preparation branch | PASS | Work completed on `chore/server-production-prep`; no `main` merge performed. |
| Module commit chain | PASS | Modules 1 through 10 are separate commits on the preparation branch and pushed to GitHub. |
| Clean dependency install | PASS | `npm ci` completed from `package-lock.json` with 0 vulnerabilities. |
| Repository check suite | PASS | `npm run check` passed after a focused diagnostic redaction fix. |
| Whitespace check | PASS | `git diff --check` passed. |
| Local production-build startup smoke | PASS | `npm run test:local-production-readiness` started the built Next app on a temporary local port bound to `127.0.0.1`, verified health, and stopped its process. |
| Protected route contracts | PASS | `test:abuse-guard-contracts` covers unauthenticated protected API and unauthorized admin rejection without provider calls. |
| Upload memory safety | PASS | `test:upload-temp-cleanup` covers 199 MiB allowed, over-limit rejection before Buffer allocation, illegal MIME rejection, and upload cleanup. |
| Disk protection | PASS | `test:ops` covers 69/70/80/85/90/95 threshold behavior, stat failures, multiple roots, and read/cleanup allowance at emergency. |
| 24-hour media retention | PASS | `test:upload-temp-cleanup` covers unexpired media preservation, expired media cleanup, processing-task preservation, external URL preservation, path escape refusal, and idempotent repeat execution. |
| Log redaction | PASS | `test:log-redaction` and the local readiness script verified test password/token/AK/SK values were not emitted. |
| Runtime isolation | PASS | `npm run check` includes runtime isolation and release artifact isolation checks. |
| Documentation index | PASS | Current documentation routes local 3107, server 3106, Linux deployment, environment variables, backup/restore, and historical archives separately. |
| Git-tracked runtime data check | PASS | Final command checks found only `.env.example`, `.env.production.example`, and `infra/new-api/.env.example`; no real `.env`, `data/`, `uploads/`, `runtime/`, or `backups/` files are tracked. |

## MANUAL-3107

| Item | Status | Owner action |
| --- | --- | --- |
| Registration and login | MANUAL-3107 | Create a local test account and sign in on port 3107. |
| Refresh session | MANUAL-3107 | Refresh after login and confirm the session remains active. |
| Image generation | MANUAL-3107 | Generate one image using approved test provider settings. |
| Video generation | MANUAL-3107 | Generate one video using approved test provider settings. |
| Image editing | MANUAL-3107 | Upload a test image and run the image editing workflow. |
| Image high-definition enhancement | MANUAL-3107 | Run the current Volcengine ImageX image enhancement path. |
| Video high-definition enhancement | MANUAL-3107 | Run the current Volcengine VOD video enhancement path. |
| Work download and delete | MANUAL-3107 | Download and manually delete generated works. |
| 24-hour notice | MANUAL-3107 | Confirm the UI says generated works are kept for 24 hours and shows an expected expiration time. |
| File over-limit prompt | MANUAL-3107 | Select an oversized video and confirm the client rejects it with the current limit. |
| User library isolation | MANUAL-3107 | Confirm one user cannot see or delete another user's works. |
| Credit deduction and failure recovery | MANUAL-3107 | Confirm successful billing and safe recovery on failed tasks. |
| Admin console | MANUAL-3107 | Confirm unauthorized admin access is rejected and authorized admin access works. |
| Mobile and desktop layout | MANUAL-3107 | Check login, register, studio, library, and admin basics on phone and desktop widths. |

## SERVER-GATE

| Item | Status | Future server validation |
| --- | --- | --- |
| Ubuntu host | SERVER-GATE | Verify Ubuntu 22.04 LTS, Node.js 24, Nginx, and systemd on the real server. |
| 3106 binding | SERVER-GATE | Verify the application listens only on `127.0.0.1:3106`. |
| Nginx proxy | SERVER-GATE | Verify HTTPS proxy headers, upload body size, timeout settings, static caching, and protected path denial. |
| Production environment | SERVER-GATE | Run production environment checks with real server paths and real secret values kept private. |
| Persistent storage | SERVER-GATE | Verify `/var/lib/aohuang-ai/data`, `/uploads`, `/runtime`, and `/backups` ownership and free space. |
| PostgreSQL | SERVER-GATE | Verify production database identity, migration status, backup ability, and restore plan before any write. |
| Media cleanup timer | SERVER-GATE | Install and verify the hourly cleanup timer without deleting unexpired or processing media. |
| Disk capacity guard | SERVER-GATE | Verify real filesystem statistics for DATA_DIR and UPLOADS_DIR. |
| Backup and restore | SERVER-GATE | Run a real server backup dry-run and a separately authorized restore drill. |
| Public firewall | SERVER-GATE | Confirm only 22, 80, and 443 are exposed publicly; 3106 is not public. |
| Real provider configuration | SERVER-GATE | Verify enabled providers only, with ImageX and VOD credentials supplied privately. |

## DEFERRED

| Item | Status | Reason |
| --- | --- | --- |
| Object storage | DEFERRED | Not implemented for first deployment; local filesystem retention is the current design. |
| Multi-instance runtime | DEFERRED | Current rate limits and workload slots are single-instance and in-memory. |
| Streaming supplier upload | DEFERRED | Current implementation keeps Buffer upload with a 200 MiB default and 256 MiB hard cap. |
| Long-term generated media archive | DEFERRED | Generated media intentionally expires after the retention window. |

## FAIL

None.
