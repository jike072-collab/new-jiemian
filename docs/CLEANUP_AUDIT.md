# Cleanup Audit

Date: 2026-06-20

Baseline: `develop` at `3e39e742b501008bf3b8c923846c5743ff27e8d3`

Scope: read-only audit for the first cleanup pass after the small-test release
candidate was sealed. This document records candidates only. No production code,
database migration, rollback, authentication, quota, billing, webhook, task
billing, New API mapping, backup, readiness, or security gate file is deleted in
this branch.

Update: cleanup-01 removed the three low-risk superseded planning documents that
were marked as suggested deletes. Their planning content is now covered by the
final handoff, Final QA, current mainline integration documents, and execution
log.

Update: cleanup-02 removed three pre-integration auth audit documents. The
useful historical note is that the old application had a visual-only login form,
no customer user table, no HttpOnly customer session, no quota ledger, and
global local JSON artifact/job records. The current source of truth is now
documented by `FINAL_HANDOFF.md`, `FINAL_QA_REPORT.md`,
`MAINLINE_INTEGRATION_REQUIREMENTS.md`, `AUTH_API_CONTRACT.md`,
`SESSION_FLOW.md`, `SESSION_ARCHITECTURE.md`, `ADR_APPLICATION_DATABASE.md`,
and `USER_MAPPING_CONTRACT.md`.

## Release Baseline

- Release branch: `release/v0.9-small-test`
- Tag: `v0.9.0-rc1`
- Purpose: small-range testing
- Included: A/B UI and backend integration, image and video generation, account
  auth, quota, orders, and task billing
- Not included: production payment enablement or formal server deployment
- Follow-up: code and file cleanup after this audit is reviewed

## Verification Before Audit

| Check | Result | Notes |
| --- | --- | --- |
| `npm run typecheck` | Passed | TypeScript completed without errors. |
| `npm run lint` | Passed | ESLint completed without errors. |
| `npm run build` | Passed | Next build passed; Turbopack still reports the existing trace warning from `next.config.ts` through local upscale code. |
| `node scripts/test-auth-session.mjs` | Passed | 17 tests passed. |
| `node scripts/test-quota-usage.mjs` | Passed | 28 passed, 3 PostgreSQL integration cases skipped without local DB env. |
| `node scripts/test-billing-sandbox.mjs` | Passed | 22 passed, 2 PostgreSQL integration cases skipped without local DB env. |
| `node scripts/test-admin-api.mjs` | Passed | 9 tests passed. |
| `node scripts/test-new-api-bff.mjs` | Passed | 32 tests passed. |
| `npm run test:prompt-optimizer` | Passed | 5 tests passed. |
| `npm run test:security-release` | Passed | 9 tests passed. |
| `node scripts/database/bundle-scan.mjs` | Passed | No server secret marker found in client bundle. |
| `npm run security:release-check` | Passed | npm audit 0; secret scan clear; production payment fail-closed and disabled. |

## Safety Findings

- No tracked `.env`, runtime database, log, `.next`, upload, or JSON runtime
  store was found.
- Local ignored runtime artifacts exist and remain untracked:
  `.env.local`, `.next/`, `.runtime/`, `data/`, `dist/`,
  `infra/new-api/.env`, `node_modules/`, `tsconfig.tsbuildinfo`, `uploads/`,
  and one local `bp02-job-82151925065.log`.
- Secret pattern scan for private keys, GitHub tokens, AWS access keys, and
  OpenAI-style keys returned no tracked matches.
- Production payment remains disabled and fail-closed.

## Candidate Cleanup Items

| Path | Current use | Referenced by code | Deletion risk | Recommendation | Tests after deletion |
| --- | --- | --- | --- | --- | --- |
| `docs/design-references/module-03-shell/history/` | Historical screenshots from early shell iterations. | No runtime code reference found; only documentation evidence. | Medium: useful for visual regression history and PR archaeology. |待确认| `npm run lint`, `npm run build`, visual smoke on desktop/mobile. |
| `docs/design-references/current-before-rebuild/` | Pre-rebuild screenshots and baseline captures. | No runtime code reference found. | Medium: useful if future design regression comparisons need the old baseline. |待确认| Documentation link scan, `npm run build`. |
| `docs/design-references/module-05-visual-foundation/before/` | Before-state screenshots and baseline index for visual foundation work. | No runtime code reference found. | Medium: evidence for visual change rationale. |待确认| Documentation link scan, `npm run build`. |
| `docs/design-references/module-05-visual-foundation/after/` | After-state screenshots for visual foundation acceptance. | No runtime code reference found. | Medium: acceptance evidence; lower runtime risk but useful context. |待确认| Documentation link scan, `npm run build`. |
| `docs/design-references/module-05-visual-foundation/final-patch-2/` | Patch-specific screenshot evidence and acceptance report. | No runtime code reference found. | Medium: may be redundant after final production evidence. |待确认| Documentation link scan, `npm run build`. |
| `docs/design-references/module-05-visual-foundation/final-production/` | Final production screenshots for visual foundation. | No runtime code reference found. | Low to medium: likely retain one final screenshot set and remove earlier sets only. |保留| None unless older screenshot sets are removed. |
| `docs/design-references/reference-site/` | Reference screenshots copied from target/reference UI. | No runtime code reference found. | Medium: still useful when future visual polish needs source comparison. |待确认| Documentation link scan, `npm run build`. |
| `docs/design-references/module-04-image-workspace/` | Module 04 screenshot evidence and acceptance results. | No runtime code reference found. | Medium: acceptance archive only. |待确认| Documentation link scan, `npm run build`, image workflow smoke. |
| `docs/design-references/module-06-video-workspace/` | Module 06 screenshot evidence and video workspace notes. | No runtime code reference found. | Medium: includes mode-specific verification history. |待确认| Documentation link scan, `npm run build`, video workflow smoke. |
| `docs/design-references/module-07-image-upscale/` | Historical image-upscale screenshots and local-output evidence. | No runtime code reference found. | Medium: historical evidence only; current image upscale uses Volcengine ImageX. |保留| Documentation link scan if any file is moved later. |
| `docs/design-references/module-08-video-upscale/` | Historical video-upscale screenshots. | No runtime code reference found. | Medium: historical evidence only; current video upscale uses Volcengine VOD. |保留| Documentation link scan if any file is moved later. |
| `public/images/reference/*.png` | Example/reference images shown in the current workbench UI. | Yes, referenced by `src/components/studio-app.tsx`. | High: deleting would break visible UI media. |保留| `npm run build`, desktop/mobile workbench smoke. |
| `public/brand/logo.svg` | App brand logo. | Yes, referenced by shared brand components. | High: deleting would break header/login/admin branding. |保留| `npm run build`, login/admin/workbench smoke. |
| `docs/ui/MODULE_03_ROOT_CAUSE.md` | Historical root-cause analysis mentioning fake login and early shell problems. | No runtime code reference found. | Medium: old statements are stale but useful for why later work exists. |待确认| Documentation review only. |
| `docs/ui/MODULE_04_IMAGE_WORKSPACE.md` through `docs/ui/MODULE_09_LIBRARY.md` | Module delivery reports and acceptance notes. | No runtime code reference found. | Medium: module 7/8 legacy local upscale reports are archived; remaining reports are current traceability. |待确认| Documentation review only. |
| `docs/ui/FEATURE_FREEZE.md` | Historical freeze policy for UI modules. | No runtime code reference found. | Medium: may still explain why some UI features are intentionally absent. |待确认| Documentation review only. |
| `docs/architecture/auth-newapi/FINAL_GATE_AUDIT.md`, `FINAL_VALIDATION_REPORT.md`, `FINAL_QA_REPORT.md`, `FINAL_HANDOFF.md` | Final validation and handoff evidence. | No runtime code reference found. | High: release evidence for `v0.9.0-rc1`. |保留| None. |
| `docs/architecture/auth-newapi/USER_*`, `QUOTA_*`, `BILLING_*`, `PAYMENT_*`, `TASK_BILLING_BOUNDARY.md`, `RECONCILIATION_RUNBOOK.md` | Active backend API, state-machine, and operations documentation. | No runtime code reference found. | High: still needed for operations and future UI/admin work. |保留| None. |
| `.github/workflows/admin-api.yml`, `auth-session.yml`, `quota-usage.yml`, `billing-sandbox.yml`, `new-api-bff.yml` | Module-specific CI retained alongside final gates. | Yes, GitHub Actions. | Medium: possibly redundant with `auth-newapi-final-gate.yml`, but useful for targeted reruns. |待确认| Trigger affected workflows and `Auth New API Final Gate`. |
| `.github/workflows/auth-newapi-final-gate.yml`, `backend-security-release.yml`, `application-database.yml`, `new-api-ops.yml`, `ci.yml` | Main release and security gates. | Yes, GitHub Actions. | High: required for release confidence. |保留| Full CI. |
| `scripts/test-*.mjs` | Node test entrypoints used by CI and local verification. | Yes, referenced by workflows and package scripts. | High: deleting reduces verification coverage. |保留| Related workflow and `npm run build`. |
| `scripts/reconcile-billing-sandbox.mjs` | Dry-run and future reconciliation helper for sandbox billing. | Yes, referenced by CI and billing docs. | High: required for billing recovery path. |保留| Billing sandbox tests and reconciliation dry-run. |
| `scripts/database/*` | Migration, schema, bundle boundary, and auth-data migration utilities. | Yes, referenced by workflows and package scripts. | High: explicitly forbidden for deletion in this audit. |保留| Application Database Migration workflow. |
| `db/migrations/*.sql` | Application schema and upgrade path. | Yes, migration runner. | High: explicitly forbidden for deletion. |保留| Full migration workflow from empty DB and upgrade tests. |
| `src/lib/server/*/__tests__/*` | Unit and integration tests. | Yes, compiled through dedicated test scripts. | High: local strings such as `local-user` are test fixtures, not fake runtime state. |保留| Corresponding test script. |
| `src/components/customer-login.tsx` | Real login/register UI component using auth API. | Yes, `src/app/login/page.tsx`. | High: deleting breaks login route. |保留| Auth UI smoke, `npm run build`. |
| `src/components/workspace-account-panel.tsx` | Real account, quota, usage, order, and sandbox top-up panel. | Yes, `src/components/studio-app.tsx`. | High: deleting breaks account surface. |保留| Account/quota/order smoke, `npm run build`. |
| `src/components/application-container.tsx` | Root app container. | Yes, `src/app/page.tsx`. | High: deleting breaks root route. |保留| `npm run build`, home smoke. |
| `src/components/admin-providers-client.tsx` | Provider admin page client component, including display-name management. | Yes, `src/app/admin/providers/page.tsx`. | High: requested admin surface and provider configuration. |保留| Admin provider smoke, `npm run build`. |
| `src/lib/server/volcengine-upscale.ts` | Volcengine ImageX/VOD高清增强 integration. | Yes, upscale API routes. | High: active functionality for current image and video高清增强. |保留| `npm run build`, upscale auth/CSRF, provider health, log redaction. |
| Legacy upscale endpoint values | Historical provider config values mapped at the read/update boundary only. | Compatibility path only. | Medium: legacy values must not appear in current public API/UI/new saved provider data. |已处理| Provider display-name tests, provider health, keyword scan. |
| Root `.env.example` and `infra/new-api/.env.example` | Placeholder environment documentation. | Yes, docs and setup. | Medium: root defaults still include JSON local mode for development; production preflight rejects this. |保留| Release preflight and docs review. |
| Ignored local `.env.local`, `.runtime/`, `data/`, `dist/`, `.next/`, `uploads/`, `tsconfig.tsbuildinfo`, `bp02-job-82151925065.log` | Local runtime/build/test artifacts in this workstation. | No tracked code reference as committed files. | Low for repo, but deletion should be manual and explicit because local test evidence may be useful. |待确认| `git status --ignored`, build smoke if local cleanup is performed. |

## False Positives

- `local-user` appears in backend tests as a fixture. It is not a runtime fake
  login or fake account source.
- Historical docs mention fake login, fake quota, or fake model states to record
  earlier defects. They are not current runtime behavior.
- `.env.example` and CI-generated `.env` snippets contain placeholders or masked
  test values. No real secret was detected in tracked files.
- PostgreSQL integration tests skipped locally without `APP_DATABASE_URL`; remote
  database workflows remain the authoritative verification path.

## Suggested Cleanup Order

1. Decide retention policy for visual evidence under `docs/design-references/`.
   Keep one final screenshot set per major surface before deleting older history.
2. Archive or remove superseded planning docs only after confirming final handoff
   documents cover the same operational knowledge.
3. Keep all migrations, recovery scripts, release gates, and backend module tests.
4. Only after the documentation cleanup is merged, consider a separate local
   artifact cleanup for ignored files. Do not mix local artifact deletion with
   tracked code cleanup.

## Candidate Counts

- Suggested delete: 0 grouped documentation candidates after cleanup-01.
- Awaiting confirmation: 13 grouped documentation or local-artifact candidates after cleanup-02.
- Explicitly retained high-risk items: 18 grouped candidates.
