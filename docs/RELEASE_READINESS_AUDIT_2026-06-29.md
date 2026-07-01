> Historical audit snapshot. This file is retained for release-hardening history and does not describe the current 3106 server deployment.

# P1 Abuse Guard And Temp Cleanup Audit

This main-based P1 hardening note covers only the abuse-guard contract audit
and stale runtime `.tmp` cleanup safety checks.

## Scope

- Adds static abuse-guard contract coverage for protected user-resource routes,
  CSRF-protected write routes, existing rate-limit guard wiring, explicit public
  route whitelist, and billing webhook signature/idempotency paths.
- Adds a stale runtime `.tmp` cleanup tool that defaults to dry-run and requires
  explicit `DATA_DIR` and `UPLOADS_DIR` roots.
- Adds isolated cleanup tests that use temporary runtime directories only.
- Registers the two P1 checks in `npm run check`.

## Non-Goals

- No HTTP API request or response shape changes.
- No business behavior changes.
- No `/api/library` or `/api/files/[name]` behavior changes.
- No Redis, queue, or global rate-limit middleware.
- No provider/NewAPI call-chain changes.
- No database schema, migration, Stage 9E, deployment, 3106, or production
  runtime changes.

## Deployment Gates Still Required

The 3106 runtime, production environment variables, HTTPS/Nginx, production
database, real backups, and uploads backup checks remain deployment-stage gates.
This P1 hardening does not complete or simulate those gates.
