# Parallel Line B Execution Log

## B01 - Isolated Workspace And Git Baseline

Status: Completed

Branch: `feature/auth-newapi-01-workspace`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

Pull request: `#4`

## Initial Baseline

- Original checkout: `E:\codex工作台\p003\new-jiemian`
- Original branch: `feature/03-multi-device-shell`
- Original checkout has uncommitted main line A work. B01 did not clean, reset, or overwrite it.
- Remote: `https://github.com/jike072-collab/new-jiemian.git`
- Integration branch was created from `origin/develop` because the remote branch did not exist.
- Isolated worktree: `E:\codex工作台\p003\new-jiemian-auth-newapi`

## B01 Scope

- Created line B scope, file ownership, execution log, Git workflow, and UI work matrix documents.
- No authentication research was performed.
- No New API deployment was performed.
- No business code was written.

## Gate Notes

- One module uses one branch and one pull request.
- Module pull requests target `integration/auth-newapi`.
- The final line handoff may only create a Draft PR to `develop`.
- Main line A files remain out of scope.

## B01 Verification

- `git diff --check` passed before commit.
- Changed files were limited to `docs/architecture/auth-newapi/**` and `docs/ui/PARALLEL_WORK_MATRIX.md`.
- No `src/**`, package files, database files, or protected main line A files were modified.
- Sensitive-pattern scan on the new B01 documents found no secret values.
- Remote PR diff was reviewed after push.

## B02 - Current Authentication And Account Capability Audit

Status: Completed locally

Branch: `feature/auth-newapi-02-auth-audit`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

## B02 Scope

- Audited current login, registration, logout, account, admin provider, session, cookie, token, local storage, user/customer model, quota, points, usage, and route protection surfaces.
- Created current-state audit documents only.
- No login page fixes were made.
- No auth library, user table, schema, New API deployment, or placeholder user was added.

## B02 Verification

- Source search found no user database, customer table, session table, cookie session, JWT lifecycle, register route, logout route, account route, or quota ledger.
- `/login` was traced to `LoginPage` and `CustomerLogin`; the form navigates to `/` without authentication.
- `/admin/providers` was traced to `AdminProvidersClient`, `/api/admin/providers`, `requireAdmin`, and provider JSON storage.
- Generation, upscale, library, job, and files APIs were traced and found to run without auth, user ownership, or charge hooks.

## B03 - New API Official Capability, Version, Security, And License Audit

Status: Completed locally

Branch: `feature/auth-newapi-03-newapi-audit`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

## B03 Scope

- Reviewed only official New API sources: GitHub repository, public documentation, OpenAPI spec, Docker release workflow, and Docker Hub registry data.
- No deployment was performed.
- No project business code, schema, or main line A file was changed.

## B03 Verification

- Latest visible official release verified as `v1.0.0-rc.11` on 2026-06-13.
- Docker Hub manifest digest for `calciumion/new-api:v1.0.0-rc.11` verified as `sha256:bd30213d808857bb569ef47d3c9209d061a66ea089c2472ef46ce51e75517f19`.
- Official code and docs confirm user/auth, quota, payment, webhook, deployment, and license behavior.

## B04 - Account, Session, Mapping, And Quota Truth Sources

Status: Completed locally

Branch: `feature/auth-newapi-04-source-of-truth`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

## B04 Scope

- Compared local-project-primary accounts against New-API-primary accounts.
- Selected local project account identity with New API mapped backend users.
- Defined single truth sources for user identity, session, user ID, cloud quota, payment orders, usage logs, and management permissions.
- Defined user mapping states, session cookie policy, quota boundaries, payment ledger boundary, failure recovery behavior, and BFF trust boundary.
- No code, schema, auth library, New API deployment, fake user, fake balance, or fake payment was added.

## B04 Verification

- Session truth source is singular: project BFF HttpOnly session.
- Cloud quota ledger is singular: New API user quota for cloud AI/API usage.
- Payment order truth source is singular: project billing/order table planned for B11.
- User identity and management permission truth sources are local project records planned for B09.
- Local image/video HD work that does not call New API or another upstream cloud provider does not deduct New API quota.
- New API outage allows local login but blocks billable cloud actions and quota settlement.

## B05 - New API Isolated Test Deployment

Status: In progress

Branch: `feature/auth-newapi-05-deployment`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

## B05 Scope

- Add an isolated New API Docker Compose test deployment under `infra/new-api/`.
- Keep New API detached from the frontend and from real payment credentials.
- Use fixed New API release/image references from B03 and a fresh official release check on 2026-06-18.

## B05 Notes

- Official latest GitHub Release rechecked as `v1.0.0-rc.11`, published `2026-06-13T08:15:40Z`.
- Official `controller/setup.go` at `v1.0.0-rc.11` was checked for `/api/setup` bootstrap fields.
- An attempted official docs raw path for `docs/installation/deployment-methods/docker-compose-installation.md` returned 404; this was not used as deployment evidence.
- Local Docker validation is currently blocked on this machine because `docker`, `docker-compose`, `podman`, `nerdctl`, and `wsl` are not available in `PATH`, and the default Docker Desktop install path is absent.
- The B05 deployment definition still requires real container verification on a Docker-enabled host before it can be treated as fully operational.

## B06 - Health, Backup, Restore, Upgrade, And Rollback Operations

Status: Completed

Branch: `feature/auth-newapi-06-operations`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

Pull request: `#9`

## B06 Scope

- Add operational scripts for preflight, health check, backup, restore, upgrade check, rollback, and log redaction.
- Add operations documentation for backup/restore, upgrade/rollback, healthcheck, and incident handling.
- Keep all destructive steps parameterized and non-interactive.

## B06 Notes

- The local machine still does not provide Docker, Docker Compose, Podman, nerdctl, or WSL in `PATH`.
- The local machine also does not provide a POSIX `sh`, so the POSIX shell scripts cannot be executed directly on this host.
- Because of that environment gap, the isolated real restore test required by B06 cannot yet be executed here.
- The scripts are written to make the restore path safer by taking an automatic backup before destructive restoration steps.

## B06 Verification

- GitHub Actions run `27733418637` passed the `New API Ops / operations` job on PR `#9`.
- The remote Docker-enabled validation covered script syntax, preflight, stack startup, `/api/status`, healthcheck, test admin setup, login, database marker backup, restore, login after restore, bad backup rejection, and log redaction.
- The first remote validation attempt found that Docker `internal: true` prevented host health probes even though the New API container was healthy internally; the compose network was adjusted so New API can bind to the configured host address while PostgreSQL and Redis remain without host port mappings.
- Local verification remains limited to static checks because this machine does not provide Docker, Docker Compose, Podman, nerdctl, WSL, or POSIX `sh`.

## B07 - Server BFF Client And Configuration Safety

Status: In progress

Branch: `feature/auth-newapi-07-bff-client`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

Pull request: `#10`

## B07 Scope

- Add a server-only New API BFF client foundation under `src/lib/server/integrations/new-api/`.
- Separate health, user, and admin contexts so ordinary user code cannot call admin helpers accidentally.
- Add config validation, timeouts, request IDs, JSON/content-type guards, response-size limits, structured safe errors, redacted logging, GET retries, and fail-closed behavior.
- Add Node built-in tests and a GitHub Actions workflow that verifies the client against the isolated New API test stack.

## B07 Notes

- Existing server helpers live under `src/lib/server`; B07 follows that structure instead of creating a new top-level server root.
- The project has no dedicated test framework or test script in `package.json`; B07 uses Node 24 built-in `node:test` and does not modify `package.json`.
- Official New API `AdminAuth` and `UserAuth` require `Authorization` plus `New-Api-User`, so both admin and user contexts carry a New API user id.

## B07 Local Verification

- `npm ci` completed from the existing lockfile; it reported existing dependency audit findings, but no dependency or lockfile change was made.
- `node scripts/test-new-api-bff.mjs` passed local unit and client-boundary tests.
- `npm run typecheck` passed.
- `npm run lint` passed after aligning ESLint ignores with the existing ignored `dist/` build output.
- `npm run build` passed.
- `.next/static` was scanned for `NEW_API_ADMIN_ACCESS_TOKEN`, `NEW_API_ADMIN_USER_ID`, `NEW_API_BASE_URL`, and `admin-secret`; no client static bundle match was found.
- GitHub Actions run `27735759479` passed the `New API BFF / bff-client` job on PR `#10`, including unit tests, real New API container startup, health check, test admin setup, access-token generation, real BFF health call, unauthorized admin rejection, authorized admin call, production build, and static bundle leak scan.
- Initial local Git push failed with `schannel: failed to receive handshake`; the branch was pushed with a per-command OpenSSL backend override and no remote/global Git config change.

## B08 - User Mapping, Sync, Compensation, And Repair

Status: In progress

Branch: `feature/auth-newapi-08-user-mapping`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

Pull request: `#12`

## B08 Scope

- Add server-side New API user mapping Repository capabilities.
- Add sync orchestration for local user to New API user creation/lookup/activation.
- Cover idempotency, retry, compensation, conflict, orphan, disabled, and repair states.
- Add implementation documentation, state machine, repair runbook, and migration draft.

## B08 Notes

- The current repo has no Prisma, Drizzle, TypeORM, Knex, Sequelize, SQL schema, or formal migration runner.
- Existing persistence uses runtime JSON files under `data/`; B08 follows this pattern for the temporary Repository while documenting the future SQL migration shape.
- B08 does not add a local user table, login/register routes, sessions, schema migration, quota charging, billing, payment, frontend pages, or New API UI.
- The mapping model keeps one identity truth source: future B09 local project user identity. New API remains the mapped quota/execution account.
- Automatic repair never deletes New API users and never creates a second cloud quota ledger.

## B08 Local Verification

- `npm ci` completed from the existing lockfile; it reported existing dependency audit findings, but no dependency or lockfile change was made.
- `node scripts/test-new-api-bff.mjs` passed 31 local unit and boundary tests including B08 Repository and sync cases.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.
- Local real container verification remains blocked because `docker` and `docker compose` are not available in `PATH`; PR CI must run `node scripts/test-new-api-bff.mjs --real` against the isolated New API stack.

## B08 Remote Verification

- GitHub Actions run `27737484928` passed the `New API BFF / bff-client` job on PR `#12`.
- The remote Docker-enabled validation covered unit tests, isolated New API startup, test admin initialization, admin access-token generation, real BFF health call, unauthorized admin rejection, authorized admin call, real user mapping creation/activation, production build, and static bundle leak scan.
- A previous remote validation attempt found that New API rejects user creation when `User.Email` exceeds the official 50-character limit. The sync layer now sends local email upstream only when it fits the New API field limit; overlong local emails remain local identity data and are confirmed upstream by the normalized username.

## B09 - Registration, Login, Logout, And Secure Session Backend

Status: In progress

Branch: `feature/auth-newapi-09-auth-session`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

Pull request: `#13`

## B09 Scope

- Add a real local project account backend.
- Add password hashing, login, registration, logout, current user, session refresh, CSRF, rate limiting, and audit logging.
- Use B08 `NewApiUserSyncService` for New API user mapping during registration.
- Keep New API credentials server-only and out of browser cookies/localStorage.
- Do not build the final login/register visual pages.

## B09 Notes

- Current repo still has no formal ORM, SQL schema, or migration runner; B09 follows the existing runtime JSON persistence pattern and documents the future compensation boundary.
- The existing provider-admin `x-admin-password` gate remains separate and is not reused as customer auth.
- The project account store is the single user identity truth source.
- The project HttpOnly session store is the single customer session truth source.
- Registration may return `mapping_pending` when the local user exists but New API mapping is not active; billable cloud actions remain blocked for that state.

## B09 Local Verification

- `npm ci` completed from the existing lockfile; it reported existing dependency audit findings, but no dependency or lockfile change was made.
- `node scripts/test-auth-session.mjs` passed 17 B09 auth/session tests covering registration, duplicate registration, weak password, concurrent registration, mapping failure, login, session rotation, invalid credentials, disabled user, verification-required user, rate limiting, session expiry, logout, route protection helper, refresh, CSRF, open redirect protection, audit redaction, and cookie attributes.
- `node scripts/test-new-api-bff.mjs` passed 31 B07/B08 BFF and mapping tests.
- `npm run typecheck` passed.
- `npm run lint` passed.
- `npm run build` passed.

## B09 Remote Verification

- GitHub Actions run `27738455649` passed the `Auth Session / auth-session` job on PR `#13`.
- The remote validation covered `node scripts/test-auth-session.mjs`, `npm run typecheck`, `npm run lint`, and `npm run build`.

## B10 - Quota, Usage, And Log Adapter

Status: In progress

Branch: `feature/auth-newapi-10-quota-usage`

Base: `origin/integration/auth-newapi`

Integration target: `integration/auth-newapi`

## B10 Scope

- Add a New API-backed quota and usage adapter for authenticated project users.
- Add current quota, usage pagination, and CSRF-protected quota precheck API routes.
- Add local usage audit logging without creating a second mutable balance ledger.
- Add upstream New API log normalization for read-only usage views.
- Define task billing boundary for future workbench integration.

## B10 Notes

- New API user `quota` and `used_quota` remain the only cloud quota ledger.
- The display unit is `credits` because B03/B04 did not define a reviewed product conversion to RMB, points, or tokens.
- Local image/video HD work that does not call New API or another upstream cloud provider remains non-billable against New API quota.
- B10 does not modify the workbench UI or generation/upscale task routes.
- Runtime `data/quota-usage-log.json` is an audit log and is ignored by Git.
- The local quota cache is short-lived display state only; precheck forces a fresh New API quota read.

## B10 Local Verification

- `npm ci` completed from the existing lockfile; it reported existing dependency audit findings, but no dependency or lockfile change was made.
- `node scripts/test-quota-usage.mjs` passed 10 B10 quota and usage tests covering normal quota, zero quota, insufficient quota, large values, New API unavailable, mapping missing, pagination, idempotency, failed-task audit logging, cache invalidation, user isolation, upstream log mapping, usage failure, and rate limiting.
- `node scripts/test-auth-session.mjs` passed 17 B09 auth/session tests after the quota changes.
- `node scripts/test-new-api-bff.mjs` passed 31 B07/B08 New API BFF, mapping, and sync tests after the quota changes.
- `npm run typecheck` passed.
- `npm run lint` passed without warnings after cleanup.
- `npm run build` passed and listed the new `/api/quota`, `/api/quota/precheck`, and `/api/usage` routes.
- `git diff --check` passed.
- Protected main line files, `package.json`, and `AGENTS.md` were not modified.

## B10 Remote Verification

- Pull request `#14` was created from `feature/auth-newapi-10-quota-usage` to `integration/auth-newapi`.
- GitHub Actions passed `Auth Session / auth-session`, `New API BFF / bff-client`, and `Quota Usage / quota-usage`.
- PR `#14` was merged into `integration/auth-newapi` at merge commit `f4cb873`.

## B11 - Recharge Orders, Webhook, And Payment Sandbox

Status: In progress

Branch: `feature/auth-newapi-11-billing-sandbox`

Base: `origin/integration/auth-newapi` at `f4cb873`

Integration target: `integration/auth-newapi`

## B11 Scope

- Add sandbox-only payment channel configuration returned by the server.
- Add local payment order repository and state machine.
- Add authenticated order creation and current-user order read APIs.
- Add HMAC-verified sandbox webhook handling with timestamp/replay protection.
- Add idempotent New API quota credit boundary after verified payment.
- Add reconciliation logic for timed-out or quota-credit-failed orders.
- Add a sandbox reconciliation script with dry-run default and explicit `--execute` repair mode.

## B11 Notes

- No real payment provider, real funds, production domain, or production payment credential is enabled.
- The local order store is the payment truth source; New API user quota remains the only cloud quota ledger.
- Runtime `data/billing-store.json` is ignored by Git.
- Paid status is only assigned after verified sandbox payment and successful New API quota credit.
- Payment success with quota credit failure enters `review` and is repairable.

## B11 Local Verification

- `npm ci` completed from the existing lockfile; it reported existing dependency audit findings, but no dependency or lockfile change was made.
- `node scripts/test-billing-sandbox.mjs` passed 11 B11 tests covering config, order creation, duplicate order idempotency, invalid amounts, inactive mapping, missing secret, bad signature, replay, duplicate webhook, concurrent webhook, amount/user/currency/channel tamper, out-of-order callbacks, quota-credit failure and reconciliation, refund, and user isolation.
- A final B11 self-review added a distinct-event concurrent paid webhook test; `node scripts/test-billing-sandbox.mjs` now passes 12 tests including duplicate and concurrent webhook idempotency.
- `node scripts/reconcile-billing-sandbox.mjs --dry-run --json` passed and reported the local sandbox order reconciliation preview without writing runtime data.
- `node scripts/test-quota-usage.mjs` passed 10 B10 regression tests after the billing changes.
- `node scripts/test-auth-session.mjs` passed 17 B09 regression tests after the billing changes.
- `node scripts/test-new-api-bff.mjs` passed 31 B07/B08 regression tests after the billing changes.
- `npm run typecheck` passed.
- `npm run lint` passed without warnings after cleanup.
- `npm run build` passed and listed `/api/billing/config`, `/api/billing/orders`, `/api/billing/orders/[id]`, and `/api/billing/webhooks/sandbox`.
