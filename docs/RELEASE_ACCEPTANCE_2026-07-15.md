# Production acceptance report - 2026-07-15

## Release baseline

- Target: `https://aohuang888.com`
- Branch: `fix-newapi-membership-concurrency-ux`
- Candidate commit: `bfb67a82ddc42ade65ced1d3fc2d7c5ff6454cde`
- Active release: `/opt/aohuang-ai/releases/20260715T013100-image-reveal-once`
- Direct rollback: `/opt/aohuang-ai/releases/20260715T001500-moving-image-reveal`
- Verified backup: `/var/lib/aohuang-ai/backups/server-production-20260714-162825-17d228d5`
- Database migrations: `001` through `016` applied

## Accepted changes

- Image generation waits with a 20 by 20 dot field whose visible radial window moves across the result frame. Only part of the field is visible at a time.
- Completed images first replace the loading dots with corresponding image fragments, expand into a brief mosaic, and then fade into the complete sharp image.
- Completed image reveal keys are retained for the current page session, so switching to another tool and back displays existing results immediately without replaying the loading or reveal animation.
- The 400-cell reveal overlay is removed after completion instead of accumulating hidden DOM nodes.
- Reduced-motion behavior, Chromium, Firefox, WebKit, mobile Chrome, and mobile Safari remain supported.
- Historical migration files match their originally applied SQL. Migration checksum comparison treats LF and CRLF as equivalent while still rejecting SQL content changes.
- Migration `016` records removal of membership order foreign keys without editing an already-applied migration.

## Verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Full repository gate | Pass | `npm run check`; includes lint, typecheck, security, auth, runtime isolation, database rehearsals, rollback drill, and production build |
| Final lint and typecheck | Pass | `npm run lint`, `npm run typecheck` |
| Final production build | Pass | Next.js built 40 routes successfully |
| Local image motion E2E | 5/5 pass | Chromium, Firefox, WebKit, mobile Chrome, mobile Safari |
| Production browser acceptance | 5/5 projects pass | Chromium, mobile Chrome, and mobile Safari passed in the parallel run; Firefox and WebKit passed their immediate standalone reruns after parallel first-load/timing misses |
| Moving-window regression | Pass | Test compares computed mask positions at two times and requires a changed position |
| Tool-switch replay regression | Pass | Four completed cards remain `ready` and have zero reveal overlays after image to video to image navigation |
| Migration status before apply | Pass | `001-015` applied, `016` pending |
| Backup and verification | Pass | PostgreSQL/server backup created and restore verification completed before migration |
| Migration status after apply | Pass | `001-016` applied |
| Release manifest | Pass | SHA-256 manifest verified before activation |
| Service and public HTTPS | Pass | Service active, backend liveness OK, public response HTTP 200 |
| Post-activation error log | Pass | Zero error-level service log entries in the activation window |
| Storage | Pass | Normal level, about 62.3 percent used at final health check |

## Prior acceptance retained

- Production account isolation for the two dedicated users passed previously, including a cross-user media request returning 404.
- Manual grant records, remaining-entitlement display, upscale entitlements, prompt settings, and library actions passed previously for the dedicated test account.
- Lighthouse previously recorded Performance 0.86, Accessibility 1.00, Best Practices 0.96, SEO 1.00, LCP about 3.75 seconds, TBT 5 ms, and CLS 0.019.
- The read-only production k6 smoke previously completed 362 requests with zero failures, P95 about 502 ms, and at most 10 virtual users.

## Scope and residual risk

- No paid generation, provider generation, recharge, membership purchase, refund, or payment callback was repeated for this UI and migration release. Production image E2E intercepted generation and quota APIs, so it did not deduct user points or call an upstream provider.
- This release contains no database or billing changes. Migrations `001-016` remain applied, and the previously verified backup remains the recovery point for database-level incidents.
- A fresh paid end-to-end transaction is required only when billing or provider code changes again; this release did not change those paths.
