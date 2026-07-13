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
- Production k6 read-only smoke passed: 404 requests across homepage, login,
  registration, templates, and the backend health endpoint; no failed requests;
  P95 response duration was 170.07 ms at a maximum of 10 virtual users. It did
  not use authenticated, generation, upload, payment, or provider routes.
- `npm audit` reported zero production and development vulnerabilities after the
  test-tool dependency versions were pinned.
- Authenticated production A/B browser check passed once in desktop Chromium:
  both dedicated accounts established independent sessions and loaded their own
  libraries; a direct request by B for an existing A media object returned HTTP
  404. The authenticated case deliberately runs in one project only, avoiding
  parallel login rate-limit noise across browser projects.
- The real minimum credit purchase completed end to end: an Alipay payment of
  ¥9.90 settled as a completed order for 1,306 credits. The account balance
  changed from 519,460 to 520,766; the user-visible credit ledger and order
  history both show the same completed credit-recharge event.
- NewAPI administrator console access was confirmed with the supplied dedicated
  administrator account. The account could access administrator-only channel,
  subscription, model, user, and system-setting navigation. No API key, channel
  secret, provider credential, or user dataset was exported.

## Release Blockers

- P0: membership and quota are not consistently mapped between the application
  and NewAPI. A newly supplied application test account showed no membership and
  700 application credits. Its corresponding NewAPI user showed no plan and 958
  NewAPI credits, while a different NewAPI user had the manually enabled
  enterprise-month plan and 49,589 NewAPI credits. Do not run membership,
  generation, or billing acceptance on this account until the authoritative user
  mapping and entitlement synchronization are corrected and independently
  reverified.
- Administrator positive-path validation has not run because no dedicated admin
  test account has been provided. Public/unauthenticated administrator rejection
  remains covered by the existing browser and API checks.
- Real provider calls, task-to-ledger verification, real payment callback and
  credit settlement have not run. A payment must have an explicitly approved
  amount cap and channel immediately before it is created.
- Both supplied A/B test accounts are already enterprise members, so the product
  correctly disables the lowest membership plan for them. A dedicated account
  without an active membership is required to validate the ¥29.90 base plan;
  an enterprise renewal is not an equivalent substitute.
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
