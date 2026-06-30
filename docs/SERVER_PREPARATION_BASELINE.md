# Server Preparation Baseline

This document records the baseline for the `chore/server-production-prep` preparation branch. It is documentation only and does not authorize server deployment.

## Git Baseline

- Repository: `jike072-collab/new-jiemian`
- Branch: `chore/server-production-prep`
- Baseline commit: `6a53ca938f8b65924e115f10f3e2184ca1f6c311`
- Source baseline: latest `origin/main` fetched before creating the branch
- Server deployment target: 3106 only
- Development and acceptance target: local 3107 only

## Runtime Baseline

- Required Node.js version: `>=24`
- Verified local Node.js version during baseline capture: `v24.16.0`
- Next.js version: `16.2.9`
- React version: `19.2.4`
- GitHub Actions reviewed: workflows under `.github/workflows/` use Node 24 for repository checks.

## Release Flow

1. Develop each preparation module on `chore/server-production-prep`.
2. Run the module-required checks locally.
3. Commit one clear module topic.
4. Push the branch to GitHub immediately after checks pass.
5. Use local 3107 for automated checks and manual acceptance.
6. Send the pushed change through code review.
7. Merge to `main` only after review and explicit human approval.
8. Deploy the reviewed `main` release to server 3106 by a separate manual deployment task.

Codex must not automatically merge `main`, deploy 3106, deploy 3107, operate server systemd or Nginx, or read or record real secrets.

## Main Features

- Image generation and image editing through configured providers.
- Video generation through configured providers.
- Image upscale and video upscale workspaces.
- Library for generated, edited, uploaded, and upscaled media.
- Provider administration UI.
- Login/session, quota, billing, and New API integration support.
- Release, runtime isolation, database, security, and operations checks.

## Storage And Data

- Runtime files default to local `data/` and `uploads/`.
- Local 3107 must use isolated `DATA_DIR` and `UPLOADS_DIR`, commonly `data-staging` and `uploads-staging`.
- `PORT=3107` rejects missing storage variables and rejects fallback to default `data/` or `uploads/`.
- Library items still depend on JSON and file-system storage by default.
- Video and upscale job state currently uses `data/jobs.json`.
- Media bytes stay in `uploads/`; database adapters store metadata or file references, not media bytes.

## Database State

- PostgreSQL baseline code exists for application database work through `pg`.
- `APP_DATABASE_URL` and `APP_DATABASE_EXPECTED_NAME` are required before application database operations.
- Production release checks require production persistence modes to be PostgreSQL-backed.
- Studio library and media storage still have JSON/file-system dependencies that must be handled before a production cutover.
- SQLite is not the active runtime database and release checks reject SQLite database files in artifacts.
- No production database migration is authorized by this module.

## Upscale State

- Current upscale API routes import `src/lib/server/volcengine-upscale.ts`.
- Image upload validation allows PNG, JPEG, and WebP up to 10 MB.
- Video upload validation allows MP4, WebM, and QuickTime up to 1 GB.
- README still contains older local Upscayl/Video2X setup text, so the production documentation must be reconciled with the current Volcengine upscale implementation before release.
- This baseline module does not change upscale code, upload limits, cleanup logic, or deployment scripts.

## Existing Test Commands

Required for this module:

```bash
npm run lint
npm run typecheck
git diff --check
```

Common broader checks available in `package.json`:

```bash
npm run build
npm run check
npm run test:runtime-isolation
npm run check:runtime-paths
npm run test:staging-smoke
npm run test:upscale-auth-csrf
npm run test:network-hardening-dry-run
npm run test:abuse-guard-contracts
npm run test:upload-temp-cleanup
npm run audit:database
npm run check:stage9d
npm run test:ops
npm run test:rollback-drill
```

## Pre-Launch Issues To Resolve

- Old upscale documentation: README still describes local Upscayl/Video2X while current upscale routes use Volcengine integration.
- 1 GB video memory risk: current video upscale upload parsing can buffer up to 1 GB in process memory.
- 24-hour media cleanup: stale temporary cleanup exists for `*.tmp`, but production media retention and 24-hour cleanup policy still need explicit release rules.
- Disk protection: production needs explicit capacity checks, upload growth controls, and safe handling for large media outputs.
- Production environment variables: production `ADMIN_PASSWORD`, database settings, provider secrets, storage roots, and release flags must be specified without committing or logging real values.
- Linux deployment files: server 3106 systemd, Nginx, working directory, artifact path, and restart steps need explicit reviewed files or runbooks.
- Rate limiting: auth and quota rate-limit paths exist, but production-wide request limits and proxy limits need verification.
- Backup and restore: PostgreSQL, `data/`, and `uploads/` backup and restore drills must be verified before production deployment.
- Outdated documentation: docs still mix older local-first, staging, deployment, and upscale wording; release-facing docs need a pass before server work.
