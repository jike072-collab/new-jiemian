# New API BFF Client Foundation

## Scope

B07 adds a server-only New API integration foundation under `src/lib/server/integrations/new-api/`.

It does not add login pages, customer sessions, user mapping storage, quota charging, billing, or payment behavior.

## Project Audit

- Server directory: existing server helpers live under `src/lib/server/`.
- API routes: existing Next route handlers live under `src/app/api/**/route.ts` and use Node runtime where needed.
- Environment variables: existing server code reads `process.env` directly; no central env schema exists.
- Logging: existing code uses platform console behavior; no structured logger dependency exists.
- Test framework: no repo test framework is configured in `package.json`; B07 uses Node 24 built-in `node:test` with TypeScript type stripping.
- Type system: strict TypeScript is enabled by `tsconfig.json`.
- Client/server boundary: client components are marked with `"use client"` and must not import `src/lib/server/integrations/new-api`.

## Configuration

Server-only environment variables:

- `NEW_API_ENABLED`
- `NEW_API_ENVIRONMENT`
- `NEW_API_BASE_URL`
- `NEW_API_TIMEOUT_MS`
- `NEW_API_MAX_RESPONSE_BYTES`
- `NEW_API_ADMIN_USER_ID`
- `NEW_API_ADMIN_ACCESS_TOKEN`

`NEW_API_ADMIN_ACCESS_TOKEN` and `NEW_API_ADMIN_USER_ID` are required only for admin operations. Health checks can run without admin credentials.

Configuration is fail-closed:

- enabled integration without `NEW_API_BASE_URL` throws a structured config error
- invalid base URL throws a structured config error
- admin requests without admin user id and access token throw before the upstream call
- the client never falls back to mock data

## Context Separation

The BFF client separates three contexts:

- health context: public `GET /api/status` style checks
- user context: requires New API user id plus user access token and sends `New-Api-User`
- admin context: requires admin New API user id plus admin access token and sends `New-Api-User`

Ordinary user helpers cannot call admin helpers without explicitly constructing an admin context.

## HTTP Behavior

The client implements:

- per-request timeout through `AbortSignal.timeout`
- generated or caller-provided request id
- JSON-only response parsing
- content-type validation
- invalid JSON handling
- maximum response body size
- structured errors with `code`, `message`, `status`, `retryable`, `requestId`, `upstreamStatus`, and `safeDetails`
- log redaction for Authorization, Cookie, token, key, password, and `sk-*` shaped values
- GET retries for retryable network/status failures
- no blind retries for write operations
- explicit 429 and 5xx error mapping

## Browser Boundary

The browser must not receive:

- `NEW_API_ADMIN_ACCESS_TOKEN`
- New API session cookies
- New API user access tokens
- raw upstream stack traces
- internal New API base URLs in public bundles

B07 includes a bundle-boundary test that scans client components for imports from the New API server integration. The PR workflow also builds the app and checks `.next/static` for New API admin config strings.

## Real Integration Verification

The `New API BFF` workflow starts the isolated B05/B06 New API stack, initializes a test root account, generates a real New API access token, and verifies:

- BFF health check reaches `GET /api/status`
- unauthenticated admin request is rejected locally
- admin authorization succeeds against the real test service
