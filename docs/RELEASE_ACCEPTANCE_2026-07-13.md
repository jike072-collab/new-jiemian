# Release Acceptance 2026-07-13

## Baseline

- Production target: `https://aohuang888.com`.
- Observed production release: `20260712T233000-library-detail-centered`.
- Recorded direct rollback release: `20260712T232500-library-detail-portal`.
- Service was active; the public backend health endpoint returned HTTP 200.
- NewAPI and production payments were enabled. Data and media storage were both at
  35 percent usage and reported the `normal` storage level.

## Candidate And Automated Evidence

- Feature candidate: `1e94fa9343571dde455982a8e279ffe62e57d00c`.
- Current validation commit: `b6c0f78a3e9fdfa08f67b25388bb96025012edd8` plus the
  uncommitted browser-testing additions in this validation pass.
- `npm run check` passed, including auth/session, CSRF, authorization, provider
  contracts, upload and media retention, database consistency, release artifact,
  storage capacity, and isolated rollback checks.
- Local Playwright smoke: 25/25 passed across Chromium, Firefox, WebKit, Android
  viewport, and iPhone viewport.
- Production Playwright smoke: 25/25 passed using only public GET routes. WebKit
  and mobile Safari were materially slower than Chromium and Firefox; this is a
  performance follow-up, not evidence of a functional failure.
- Lighthouse homepage scan: performance 0.86, accessibility 1.00, best practices
  0.96, SEO 1.00, and largest contentful paint about 3.75 seconds.
- `npm audit` reported zero production and development vulnerabilities after the
  test-tool dependency versions were pinned.
- Authenticated production A/B browser check passed once in desktop Chromium:
  both dedicated accounts established independent sessions and loaded their own
  libraries; a direct request by B for an existing A media object returned HTTP
  404. The authenticated case deliberately runs in one project only, avoiding
  parallel login rate-limit noise across browser projects.

## Release Blockers

- Administrator positive-path validation has not run because no dedicated admin
  test account has been provided. Public/unauthenticated administrator rejection
  remains covered by the existing browser and API checks.
- Real provider calls, task-to-ledger verification, real payment callback and
  credit settlement have not run. A payment must have an explicitly approved
  amount cap and channel immediately before it is created.
- k6 is not installed on this machine, so the checked-in read-only performance
  script has not run. It must run only against an isolated target or explicitly
  approved read-only production routes.
- Do not deploy this candidate or claim full release acceptance until the above
  items have recorded evidence for dedicated accounts.

## Repeatable Commands

```text
npm run check
npm run test:e2e:smoke
E2E_BASE_URL=https://aohuang888.com npm run test:e2e:smoke
LIGHTHOUSE_URL=https://aohuang888.com npm run test:lighthouse
PERF_BASE_URL=<isolated-target> npm run test:performance:smoke
LIVE_E2E=true E2E_BASE_URL=https://aohuang888.com npm run test:e2e:live
```

`test:e2e:live` also requires the dedicated `E2E_USER_A_*` and `E2E_USER_B_*`
credential variables. It intentionally does not create media, charge accounts, or
place a payment order; those actions require a separate, explicitly recorded live
acceptance run.
