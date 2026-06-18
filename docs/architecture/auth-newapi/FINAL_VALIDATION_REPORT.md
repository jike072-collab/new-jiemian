# Final Validation Report

Validation date: 2026-06-18

Final conclusion: `READY_FOR_MAINLINE_REVIEW`

This report records the B12-FG remote final-gate validation for PR #19 before
the documentation-only validation-results commit. The documentation commit SHA
is intentionally reported in the operator final response because a file cannot
contain the commit hash that is created from its own contents.

## Git References

| Item | Value |
| --- | --- |
| Repository | `jike072-collab/new-jiemian` |
| `origin/develop` SHA | `fd558972fb88d900d6579226a6d4a504cf974ef0` |
| `origin/integration/auth-newapi` SHA | `8bca8e25c571e32ca268c9946f2a8838e8d3af41` |
| PR #19 | `fix/auth-newapi-final-validation` -> `integration/auth-newapi` |
| PR #19 validated head SHA | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| PR #19 state | Open, Draft |
| PR #17 | `integration/auth-newapi` -> `develop` |
| PR #17 head SHA | `8bca8e25c571e32ca268c9946f2a8838e8d3af41` |
| PR #17 state | Open, Draft |

## Runtime Versions

| Runtime | Version |
| --- | --- |
| Local Node | `v24.16.0` |
| Local npm | `11.13.0` |
| GitHub Actions Node | `v24.16.0` |
| GitHub Actions npm | `11.13.0` |
| Local Docker | Not available on this Windows host: `docker` is not on `PATH`. |
| Local Docker Compose | Not available on this Windows host: `docker` is not on `PATH`. |
| Remote runner | GitHub-hosted `ubuntu-24.04`, image `20260615.205.1`. |
| Remote Docker and Compose | Used successfully by GitHub Actions; the workflow did not print separate engine version lines. |

## Final Gate Jobs

Workflow run: `27744908374`

Workflow: `Auth New API Final Gate`

Commit SHA: `aaf258db7d1dc55c6290b6390e297454bad51f29`

| Job | Job ID | Status | Started | Completed | Duration | Commit SHA |
| --- | --- | --- | --- | --- | --- | --- |
| Typecheck, lint, build | `82080723228` | Success | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:55Z` | 43s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| Auth and session tests | `82080723197` | Success | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:37Z` | 25s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| BFF and user mapping tests | `82080723162` | Success | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:40Z` | 28s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| Quota and usage tests | `82080723255` | Success | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:34Z` | 23s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| Billing, webhook, reconciliation | `82080723297` | Success | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:36Z` | 25s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| New API Docker health and real BFF | `82080723262` | Success | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:56Z` | 45s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| Backup, restore, bad backup rejection | `82080723267` | Success | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:47Z` | 35s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| Server secrets, client bundle, diff scan | `82080723169` | Success | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:44Z` | 33s | `aaf258db7d1dc55c6290b6390e297454bad51f29` |

## Docker Real Environment Verification

The remote Docker job used the isolated New API test deployment and completed
real service validation:

- the stack started with the pinned New API image
  `calciumion/new-api:v1.0.0-rc.11@sha256:bd30213d808857bb569ef47d3c9209d061a66ea089c2472ef46ce51e75517f19`;
- `healthcheck ok` was printed;
- static compose JSON showed no PostgreSQL or Redis host ports;
- runtime Docker `PortBindings` for PostgreSQL and Redis had no host bindings;
- New API runtime binding was `127.0.0.1:3000->3000/tcp`;
- no `0.0.0.0` or `::` public binding was accepted;
- test admin initialization and login completed;
- a masked management token was generated;
- `node scripts/test-new-api-bff.mjs --real` passed four real-service tests:
  health, unauthorized admin rejection, authorized admin call, and real user
  mapping creation/activation;
- redacted log validation completed;
- containers and the test network were removed.

## Backup And Restore Verification

The remote restore job completed:

- New API stack startup;
- test administrator initialization and login verification;
- database marker seeding;
- backup creation;
- restore after marker mutation;
- `restore ok`;
- login after restore;
- rejection of an incomplete `backups/bad-backup` directory.

## Secret And Diff Scan Results

The final security job completed:

- tracked runtime file scan: passed;
- server secret pattern scan: passed;
- pull request diff sensitive-pattern scan: passed;
- no tracked `.env`, real key, token, cookie, private key, runtime database,
  backup archive, log file, or build artifact was reported.

The server secret scan now treats no-match status `1` as success and any
unexpected scanner status as failure. A positive match still fails the job.

## Client Bundle Scan Results

The workflow built the application and scanned `.next/static` for server-only
markers:

- `NEW_API_ADMIN_ACCESS_TOKEN`
- `NEW_API_ADMIN_USER_ID`
- `PAYMENT_SANDBOX_WEBHOOK_SECRET`
- `AUTH_SESSION_SECRET`
- `SESSION_SECRET`
- `CRYPTO_SECRET`
- `SQL_DSN`
- `REDIS_CONN_STRING`
- `admin-secret`

No marker was found in the client static bundle.

## npm Audit Result

The final gate records, but does not hide, the existing dependency audit risk:

```json
{"info":0,"low":1,"moderate":7,"high":4,"critical":0,"total":12}
```

This is a production release blocker and must be remediated in a separate
dependency-security PR before production rollout. It is not treated as a secret
leak and did not mask or skip any final-gate job.

## Scope Checks

| Check | Result |
| --- | --- |
| A-side protected files modified by B12-FG | No |
| WorkbenchShell modified by B12-FG | No |
| StudioApp modified by B12-FG | No |
| global tokens or global styles modified by B12-FG | No |
| formal login/register UI started | No |
| formal account center UI started | No |
| production payment enabled | No |
| real payment or real funds used | No |
| PR #17 merged | No |
| PR #19 merged | No |
| force push used | No |

## Unresolved Risks

- `npm audit` reports 12 vulnerabilities including 4 high findings; this blocks
  production release until remediated.
- Production persistence still needs a formal database schema and migration
  runner.
- Workbench generation and upscale routes are not yet connected to quota
  precheck or final usage settlement.
- Admin review APIs and UI for users, mapping, quota, orders, and reconciliation
  are not implemented.
- Production payment remains disabled and requires a separate launch checklist.
- Local Windows host cannot run Docker because `docker` is not on `PATH`; real
  container validation was performed by GitHub Actions.
- PostgreSQL and Redis images are pinned by tag but not digest.

## Final Conclusion

`READY_FOR_MAINLINE_REVIEW`

The B12-FG final gate is ready for reviewer attention on PR #19 and PR #17.
This is not a production release approval because dependency vulnerabilities and
the listed production hardening items remain unresolved.
