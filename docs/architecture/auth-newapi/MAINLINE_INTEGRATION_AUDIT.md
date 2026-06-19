# Auth/New API Mainline Integration Audit

Date: 2026-06-18

Audit branch: `review/auth-newapi-mainline-integration`

Repository: `https://github.com/jike072-collab/new-jiemian`

## Baseline

| Item | Value |
| --- | --- |
| Latest `develop` SHA | `fd558972fb88d900d6579226a6d4a504cf974ef0` |
| Latest `integration/auth-newapi` SHA | `d2b33c94e6df792f2dc1c4a4756644fad20ec29d` |
| Audit branch start SHA | `d2b33c94e6df792f2dc1c4a4756644fad20ec29d` |
| PR #17 head SHA at audit start | `d2b33c94e6df792f2dc1c4a4756644fad20ec29d` |
| PR #19 head SHA | `fe9bda7c730889d1034e97194e2b1bcaaf163316` |
| PR #19 merge commit | `d2b33c94e6df792f2dc1c4a4756644fad20ec29d` |

`origin/develop` is already an ancestor of the current integration head. The
latest develop content entered the B12 line through merge commit
`87fe84155b1da5198fbdcf44dd466e5da7804a96`, then PR #19 merged the B12-FG
final validation work into `integration/auth-newapi`.

## Remote PR State

| PR | Branches | State | Evidence | Blocking |
| --- | --- | --- | --- | --- |
| #19 | `fix/auth-newapi-final-validation` -> `integration/auth-newapi` | Merged, not draft at merge time | `gh pr view 19` returned `state=MERGED`, `mergedAt=2026-06-18T08:11:07Z`, merge commit `d2b33c94e6df792f2dc1c4a4756644fad20ec29d`. | No |
| #17 | `integration/auth-newapi` -> `develop` | Open Draft | `gh pr view 17` returned `state=OPEN`, `isDraft=true`, `mergeStateStatus=CLEAN`, `mergeable=MERGEABLE`. | No current GitHub merge conflict; still requires human review. |

## Final Gate Evidence On Current Integration Head

Workflow: `Auth New API Final Gate`

Run ID: `27745957244`

Head SHA: `d2b33c94e6df792f2dc1c4a4756644fad20ec29d`

| Job | Job ID | Status |
| --- | --- | --- |
| BFF and user mapping tests | `82084172062` | Success |
| New API Docker health and real BFF | `82084172074` | Success |
| Backup, restore, bad backup rejection | `82084172103` | Success |
| Auth and session tests | `82084172144` | Success |
| Typecheck, lint, build | `82084172152` | Success |
| Quota and usage tests | `82084172185` | Success |
| Server secrets, client bundle, diff scan | `82084172243` | Success |
| Billing, webhook, reconciliation | `82084172257` | Success |

The separate `CI / quality` check also passed on PR #17 run `27745957415`.

## Audit Matrix

| Audit area | `develop` state | `integration/auth-newapi` state | Conflict | Handling | Conclusion |
| --- | --- | --- | --- | --- | --- |
| Git history | `origin/develop` at `fd558972fb88d900d6579226a6d4a504cf974ef0`. | Current integration at `d2b33c94e6df792f2dc1c4a4756644fad20ec29d`. `git log --left-right --cherry-pick origin/develop...HEAD` shows only B-side commits after the develop ancestor. | None. | No rebase or history rewrite. `git merge-base --is-ancestor origin/develop HEAD` succeeded. | No merge-history blocker. |
| A-side protected files | `develop` owns `src/app/page.tsx`, `src/app/globals.css`, `styles/tokens.css`, `src/components/workbench-shell.tsx`, and `src/components/studio-app.tsx`. | `git diff --name-only origin/develop...HEAD --` those exact paths returned no files. B-side diff adds only `docs/ui/PARALLEL_WORK_MATRIX.md` under UI docs. | None. | Do not edit A-side visual, shell, header, sidebar, token, or workbench layout files. | No active B-side modification to protected A files. |
| API routes | `develop` has admin/provider, generation, files, jobs, library, provider-enabled, and upscale API routes. | B-side adds `/api/auth/*`, `/api/quota`, `/api/quota/precheck`, `/api/usage`, and `/api/billing/*`. All inspected routes declare `runtime = "nodejs"`. | None found. | Keep B routes in auth/quota/usage/billing namespaces. Do not modify generation/upscale routes in this phase. | No same-path route conflict or Edge/Node mismatch found. |
| `package.json` | Owns app scripts and dependencies. | No diff against `origin/develop`. | None. | No dependency or script changes. | No package manifest conflict. |
| `package-lock.json` | Existing lockfile from develop. | No diff against `origin/develop`. | None. | Do not rebuild lockfile for this audit branch. | No lockfile conflict. |
| ESLint config | Existing project config. | Adds `dist/**` ignore to support generated test output cleanup boundary. | Low risk. | Retain the single ignore entry because B test scripts compile into `dist/*-tests`. | Not blocking. |
| Environment variables | `develop` has existing `.env.example` entries. | Adds server-only `NEW_API_*` placeholders to `.env.example`; `infra/new-api/.env.example` contains placeholders such as `replace-with-a-strong-*`. | None. | Keep admin token/server secrets server-only; do not add `NEXT_PUBLIC_*` secret variables. | No real secret or client-exposed admin credential found. |
| Auth/Session | No real app user auth backend in develop. | Adds B09 auth backend, HttpOnly cookie helpers, CSRF helpers, repository, service, API routes, and tests. | No duplicate session source found in B scope. | Future UI must call B09 contracts and must not keep fake login as truth source. | Ready for mainline review; not production approved. |
| User mapping | No New API user mapping in develop. | Adds New API user mapping and user sync services plus tests. | None. | Mapping remains B-owned; no public UI added. | Ready for review. |
| Quota/Usage | Workbench generation routes in develop do not perform cloud quota precheck/final settlement. | Adds quota adapter, usage route, precheck contract, tests, and handoff docs. | Functional integration remains pending, but no route conflict. | Future workbench task must wire generation/upscale submission to B10 contract. | Non-blocking for backend review; production task billing remains incomplete. |
| Billing/Webhook | No production payment in develop. | Adds sandbox-only billing config, order service, HMAC webhook, reconciliation dry-run, and tests. | None. | Production payment remains disabled; no real funds or provider credentials. | Ready for sandbox review only. |
| Docker/Ops | No New API test stack in develop. | Adds isolated `infra/new-api` compose, scripts, docs, and final gate Docker jobs. | None. | PostgreSQL/Redis have no host ports; New API binds to `127.0.0.1` in test config. | Ready for review; PostgreSQL and Redis digest pinning remains a production hardening task. |
| CI workflows | `develop` has existing CI quality. | Adds auth/session, BFF, quota, billing, ops, and final-gate workflows. | None found. | Do not remove tests, use `continue-on-error`, or mask failures with `|| true` in final gate. | Final gate passed on current integration head. |
| Sensitive information | No known real secret in develop baseline. | Formal final gate secret scan and bundle scan passed on current integration head. Local audit `git grep` for private key, GitHub PAT, AWS AKIA, and OpenAI-style key patterns returned no matches. | None. | Keep `.env`, runtime data, backups, and logs ignored. | No current secret blocker. |

## File Scope Summary

`git diff --stat origin/develop...HEAD` reports 146 changed files and 13,730
insertions. The scope is limited to:

- auth/New API architecture documentation under `docs/architecture/auth-newapi`;
- one UI coordination document, `docs/ui/PARALLEL_WORK_MATRIX.md`;
- New API test infrastructure under `infra/new-api`;
- B-side scripts under `scripts/test-*.mjs` and `scripts/reconcile-billing-sandbox.mjs`;
- B-side API routes under `src/app/api/auth`, `src/app/api/quota`, `src/app/api/usage`, and `src/app/api/billing`;
- B-side server modules under `src/lib/server/auth`, `src/lib/server/integrations/new-api`, `src/lib/server/quota`, and `src/lib/server/billing`;
- B-side test TypeScript configs;
- B-side CI workflows.

No `package.json` or `package-lock.json` change is present.

## Runtime Data And Secret Boundary

The diff does not add `.env`, SQLite/DB files, Docker volumes, `.next`,
`node_modules`, JSON user/session/order stores, logs, or actual backup archives.
Paths containing `backup` are limited to operations documentation and scripts,
not runtime backup output.

The final gate and local audit keep these production blockers visible:

- `npm audit` reports 12 vulnerabilities, including 4 high findings;
- formal database schema and migration are not implemented;
- workbench generation/upscale flows are not yet wired to quota precheck and final settlement;
- admin review APIs and UI are not complete;
- production payment is not enabled;
- PostgreSQL and Redis images are pinned by tag but not digest.

## API Contract Coverage

The B-side test scripts and final gate cover the required backend contract
surface:

1. CSRF retrieval;
2. successful registration;
3. duplicate registration rejection;
4. successful login;
5. wrong password rejection;
6. current user retrieval;
7. session expiry handling;
8. logout;
9. quota summary;
10. quota precheck;
11. usage pagination;
12. sandbox payment channel configuration;
13. sandbox order creation;
14. duplicate webhook idempotency;
15. tampered amount/user/currency/channel handling through review/error states;
16. reconciliation dry-run without data mutation.

Remote Docker coverage additionally verifies New API startup, PostgreSQL, Redis,
healthcheck, test administrator initialization, login, admin token generation,
real BFF calls, user mapping, backup/restore, invalid-backup rejection, port
binding, and log redaction.

## Merge Preparation Conclusion

`integration/auth-newapi` currently contains latest `develop` and has no
detected file, route, dependency, environment, or secret conflict that blocks a
review PR into `integration/auth-newapi`.

This audit does not approve production release and does not approve automatic
merge of PR #17 into `develop`.

Conclusion for this audit branch before remote revalidation:
`READY_FOR_SYNC_PR_REVIEW`
