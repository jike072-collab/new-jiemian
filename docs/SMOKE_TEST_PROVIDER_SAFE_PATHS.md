# Provider-Safe Smoke Test Paths

This document classifies smoke-test paths for 3106 release readiness. It is
based on static repository review only. It does not authorize live production or
staging HTTP requests, provider calls, NewAPI calls, DB writes, uploads reads,
or paid operations.

## Safe Candidates After Separate Release Authorization

These paths are candidates for post-release smoke tests because existing repo
scripts and docs treat them as safe availability checks:

- `GET /`
- `GET /login`
- `GET /api/health/backend`
- `GET /api/health/backend?mode=liveness`
- `GET /api/library`
- `GET /admin/providers` only to confirm expected unauthenticated redirect,
  401, 403, or reviewed public behavior
- Static assets automatically loaded by the above pages

Important limits:

- `/api/library` GET reads library metadata. It must not be followed by DELETE.
- `/admin/providers` must not save provider settings during smoke testing.
- Any health readiness mode that checks DB connectivity must be approved by the
  total-control owner before being used against production.

## Unsafe Paths To Avoid

These paths can trigger provider calls, NewAPI calls, DB writes, real uploads
handling, cost, or destructive operations. They must not be part of default
post-release smoke tests.

- `POST /api/generate/image`
- `POST /api/generate/video`
- `POST /api/upscale/image`
- `POST /api/upscale/video`
- `GET /api/upscale/status` unless a separate static review proves it cannot
  call provider APIs or expose sensitive capability details in the deployed
  version
- `GET /api/upscale/status` in any workflow that would then submit upscale jobs
- `POST /api/prompts/optimize`
- `POST /api/quota/precheck`
- `GET /api/quota` unless the session, mapping, and NewAPI behavior are
  explicitly approved for that smoke run
- `POST /api/billing/orders`
- `POST /api/billing/webhooks/sandbox`
- `POST /api/billing/webhooks/production`
- `DELETE /api/library`
- `GET /api/files/[name]` for real production stored media
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `PATCH /api/auth/session`
- `POST /api/admin/providers`
- `GET /api/admin/provider-health?mode=connectivity`
- `GET /api/admin/provider-health?mode=models`
- `GET /api/admin/models/health`
- Any NewAPI endpoint under the separate NewAPI service
- Any provider URL from admin configuration or env

## Uncertain Paths Requiring Fresh Review

These paths may be safe in some modes or environments, but they require explicit
review before production smoke testing:

- `GET /api/auth/csrf`: likely read-like, but it issues a CSRF cookie.
- `GET /api/auth/session`: reads session state and may touch auth persistence
  depending on implementation.
- `GET /api/billing/config`: read-like, but belongs to payment surface.
- `GET /api/jobs/[id]`: may refresh provider job status depending on job state.
- `GET /api/upscale/status`: implementation imports `volcengine-upscale`; treat
  as uncertain until the deployed version is reviewed for no provider request.
- `GET /api/admin/provider-health?mode=static`: intended as read-only, but
  requires admin authorization and should not be used as public smoke.

## Evidence From Repo

- `scripts/ops/health-check.mjs` calls only `/api/health/backend`, `/`, `/login`,
  `/api/library`, and `/admin/providers`, and returns `newApiCalled: false`.
- `docs/STUDIO_REGRESSION_GUARDS.md` explicitly forbids generation, upscale
  submit, prompt optimization, quota precheck, NewAPI provider URLs, and real
  provider endpoints in regression checks.
- `src/app/api/generate/image/route.ts` and
  `src/app/api/generate/video/route.ts` call provider dispatch functions.
- `src/app/api/upscale/image/route.ts` and
  `src/app/api/upscale/video/route.ts` call Volcengine upscale functions.
- `src/app/api/library/route.ts` has safe-looking `GET` but also a destructive
  `DELETE`.
- `src/app/api/files/[name]/route.ts` reads stored files from the uploads
  storage boundary.

## Smoke Test Rules

- Use GET-only availability checks unless total-control approval says otherwise.
- Do not submit prompts, files, forms, billing orders, quota prechecks, provider
  health connectivity checks, model health checks, or admin saves.
- Do not authenticate a real user for a smoke test unless the test plan has a
  rollback and data-write policy.
- Do not read real production media files through `/api/files/[name]`.
- Do not call production or staging from Codex during documentation-only work.
- If a smoke test unexpectedly returns 500, provider-looking errors, DB errors,
  or secret-looking text, stop and return to total-control approval.
