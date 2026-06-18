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
