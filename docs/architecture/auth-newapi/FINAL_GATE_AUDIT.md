# Auth New API Final Gate Audit

Audit date: 2026-06-18

This audit records the state before the B12-FG corrective branch changed CI.
It does not treat historical module PR results as proof that the current final
handoff head has already passed the same checks.

## Git And Pull Request Baseline

| Item | Value |
| --- | --- |
| Repository | `jike072-collab/new-jiemian` |
| Final handoff PR | `#17` |
| PR #17 base | `develop` |
| PR #17 head | `integration/auth-newapi` |
| PR #17 state | Open, Draft |
| PR #17 merge state | `CLEAN` |
| `origin/develop` SHA | `fd558972fb88d900d6579226a6d4a504cf974ef0` |
| `origin/integration/auth-newapi` SHA | `8bca8e25c571e32ca268c9946f2a8838e8d3af41` |
| PR #17 head SHA | `8bca8e25c571e32ca268c9946f2a8838e8d3af41` |

## Current PR #17 Checks Before B12-FG

| Workflow | Job | Event | Head SHA | Result | Evidence |
| --- | --- | --- | --- | --- | --- |
| `CI` | `quality` | `pull_request` | `8bca8e25c571e32ca268c9946f2a8838e8d3af41` | Passed | GitHub Actions run `27742888440` |

Conclusion: PR #17 currently shows only the generic `CI / quality` job. It does
not show separate B-side final acceptance jobs for New API operations, BFF,
mapping, auth/session, quota/usage, billing/webhook, or security scans.

## Existing Workflow Trigger Audit

| Workflow file | Workflow name | Pull request target branches | Path filters | Dispatch |
| --- | --- | --- | --- | --- |
| `.github/workflows/ci.yml` | `CI` | `main`, `develop` | None | No |
| `.github/workflows/auth-session.yml` | `Auth Session` | `integration/auth-newapi` | Auth, New API integration, auth test runner, auth tsconfig, workflow file | Yes |
| `.github/workflows/billing-sandbox.yml` | `Billing Sandbox` | `integration/auth-newapi` | Billing, auth, New API integration, quota, billing scripts, billing tsconfig, workflow file | Yes |
| `.github/workflows/new-api-bff.yml` | `New API BFF` | `integration/auth-newapi` | New API integration, New API infra, workflow file | Yes |
| `.github/workflows/new-api-ops.yml` | `New API Ops` | `integration/auth-newapi` | New API infra, workflow file | Yes |
| `.github/workflows/quota-usage.yml` | `Quota Usage` | `integration/auth-newapi` | Quota, usage, auth, New API integration, quota script, quota tsconfig, workflow file | Yes |

Why PR #17 only shows part of the checks:

- PR #17 targets `develop`.
- The B-side module workflows target pull requests whose base branch is
  `integration/auth-newapi`.
- The B-side module workflows also use path filters designed for module PRs.
- Therefore PR #17 runs the generic `CI` workflow but does not run or display the
  module-specific B-side workflows on the final `integration/auth-newapi` head.

## Package Scripts And Test Entrypoints

`package.json` has these real scripts:

| Script | Command |
| --- | --- |
| `dev` | `next dev -H 127.0.0.1` |
| `build` | `next build` |
| `start` | `next start -H 127.0.0.1` |
| `lint` | `eslint` |
| `typecheck` | `tsc --noEmit` |
| `check` | `npm run lint && npm run typecheck && npm run build` |

Line B test entrypoints:

| Module range | Entrypoint | Notes |
| --- | --- | --- |
| B05-B06 | `infra/new-api/scripts/preflight`, `start`, `healthcheck`, `backup`, `restore`, `rollback`, `redact-logs` | Requires Docker-enabled host. |
| B07-B08 | `node scripts/test-new-api-bff.mjs` | Local unit and bundle-boundary tests. |
| B07-B08 real service | `node scripts/test-new-api-bff.mjs --real` | Requires B05 New API test service and generated admin token. |
| B09 | `node scripts/test-auth-session.mjs` | Auth/session backend tests. |
| B10 | `node scripts/test-quota-usage.mjs` | Quota and usage adapter tests. |
| B11 | `node scripts/test-billing-sandbox.mjs` | Billing sandbox, webhook, and idempotency tests. |
| B11 reconciliation | `node scripts/reconcile-billing-sandbox.mjs --dry-run --json` | Dry-run reconciliation preview. |

## Current Integration-Head Acceptance Matrix Before B12-FG

| Acceptance area | Modules | Workflow or command | Executed on current integration head | Evidence | Conclusion |
| --- | --- | --- | --- | --- | --- |
| New API deployment and operations | B05-B06 | `New API Ops / operations`; `infra/new-api/scripts/preflight`; `scripts/start`; `scripts/healthcheck`; `scripts/backup`; `scripts/restore` | No, not on PR #17 head before B12-FG | PR #17 checks show only `CI / quality` for run `27742888440` | Needs final gate coverage on the current integration head. |
| BFF | B07 | `node scripts/test-new-api-bff.mjs`; real `--real` verification | No, not on PR #17 head before B12-FG | Existing `New API BFF` workflow targets PRs into `integration/auth-newapi`, not PR #17 into `develop` | Needs final gate coverage on the current integration head. |
| User mapping | B08 | `node scripts/test-new-api-bff.mjs`; real mapping test in `--real` mode | No, not on PR #17 head before B12-FG | Existing `New API BFF` workflow path/target does not run for PR #17 | Needs final gate coverage on the current integration head. |
| Auth/Session | B09 | `node scripts/test-auth-session.mjs` | No, not on PR #17 head before B12-FG | Existing `Auth Session` workflow targets PRs into `integration/auth-newapi`, not PR #17 into `develop` | Needs final gate coverage on the current integration head. |
| Quota/Usage | B10 | `node scripts/test-quota-usage.mjs` | No, not on PR #17 head before B12-FG | Existing `Quota Usage` workflow targets PRs into `integration/auth-newapi`, not PR #17 into `develop` | Needs final gate coverage on the current integration head. |
| Billing/Webhook | B11 | `node scripts/test-billing-sandbox.mjs`; `node scripts/reconcile-billing-sandbox.mjs --dry-run --json` | No, not on PR #17 head before B12-FG | Existing `Billing Sandbox` workflow targets PRs into `integration/auth-newapi`, not PR #17 into `develop` | Needs final gate coverage on the current integration head. |
| Secret and client bundle scan | B12 | Client static bundle grep, tracked runtime file scan, Git diff sensitive scan | No dedicated final-gate job on PR #17 head before B12-FG | PR #17 checks show only `CI / quality`; B12 local scan evidence is documented but not displayed as separate final gate jobs | Needs final gate coverage on the current integration head. |

## Corrective CI Strategy

The minimal corrective change is to add a dedicated final gate workflow instead
of rewriting the module workflows:

- keep existing module workflows for module PRs targeting `integration/auth-newapi`;
- add a final gate workflow that runs for PRs targeting `develop` and
  `integration/auth-newapi`;
- split final acceptance into separate jobs so PR #17 can display the B-side
  gate by area;
- reuse existing scripts and deployment commands instead of copying test logic;
- use generated temporary test secrets only;
- keep real payment disabled and sandbox-only.

## B12-FG Corrective Branch

| Item | Value |
| --- | --- |
| Corrective branch | `fix/auth-newapi-final-validation` |
| Corrective PR | `#19` |
| PR #19 base | `integration/auth-newapi` |
| PR #19 state | Open, Draft |
| Latest validated head before final documentation | `aaf258db7d1dc55c6290b6390e297454bad51f29` |
| Workflow run | `27744908374` |
| Workflow | `Auth New API Final Gate` |
| Event | `pull_request` |
| Result | Success |

The second corrective round repaired the two failed final-gate areas without
skipping jobs, adding `continue-on-error`, using `|| true`, force pushing, or
merging PR #19 or PR #17.

## B12-FG Job Results

| Job | Run ID | Head SHA | Started | Completed | Duration | Result |
| --- | --- | --- | --- | --- | --- | --- |
| Typecheck, lint, build | `82080723228` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:55Z` | 43s | Success |
| Auth and session tests | `82080723197` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:37Z` | 25s | Success |
| BFF and user mapping tests | `82080723162` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:40Z` | 28s | Success |
| Quota and usage tests | `82080723255` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:34Z` | 23s | Success |
| Billing, webhook, reconciliation | `82080723297` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:36Z` | 25s | Success |
| New API Docker health and real BFF | `82080723262` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:56Z` | 45s | Success |
| Backup, restore, bad backup rejection | `82080723267` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:12Z` | `2026-06-18T07:51:47Z` | 35s | Success |
| Server secrets, client bundle, diff scan | `82080723169` | `aaf258db7d1dc55c6290b6390e297454bad51f29` | `2026-06-18T07:51:11Z` | `2026-06-18T07:51:44Z` | 33s | Success |

## Repaired Gate Details

Secret scanning now uses a pattern that does not begin with a bare `-----BEGIN`
option-like token. The workflow calls `git grep` with `-e "$PATTERN"` and
distinguishes result codes:

- `0`: a potential secret was found, so the job prints the matched location and
  fails.
- `1`: no match was found, so the scan passes.
- any other status: the scan tool failed, so the job fails with that status.

The pull request diff scan uses `grep -n -E -- "$PATTERN" pr.diff`, so the
pattern cannot be parsed as a grep option.

Docker exposure verification now checks both static compose configuration and
runtime Docker bindings:

- `postgres` and `redis` must not define host ports in `docker compose config
  --format json`;
- `new-api` static ports must bind only to `127.0.0.1`;
- runtime `docker inspect .HostConfig.PortBindings` for `postgres` and `redis`
  must be `null` or `{}`;
- runtime `new-api` port bindings must use `HostIp` equal to `127.0.0.1`.

## Remote Docker Evidence

The `New API Docker health and real BFF` job completed the full real-service
path:

- started the pinned New API stack;
- ran the healthcheck and printed `healthcheck ok`;
- verified PostgreSQL and Redis are not publicly bound;
- confirmed New API exposes only `127.0.0.1:3000->3000/tcp`;
- initialized the test administrator;
- logged in and generated a masked management token;
- ran `node scripts/test-new-api-bff.mjs --real`;
- passed real health, unauthorized admin rejection, authorized admin call, and
  real user mapping creation/activation checks;
- ran log redaction validation;
- stopped and removed the containers and network.

The `Backup, restore, bad backup rejection` job also completed the real
restore path:

- started the stack;
- initialized and verified administrator login;
- seeded a database restore marker;
- created a backup;
- mutated the marker and restored the backup;
- printed `restore ok`;
- verified login after restore;
- rejected an intentionally incomplete backup directory.

## Security Scan Evidence

The `Server secrets, client bundle, diff scan` job completed:

- tracked runtime file scan;
- server secret pattern scan;
- pull request diff sensitive-pattern scan;
- production build for bundle scanning;
- client static bundle leak scan;
- npm audit recording.

No real secret, token, cookie, private key, `.env` file, runtime database, log,
backup archive, or build output was reported in the tracked diff. The client
bundle scan did not find server-only New API, payment, session, crypto, SQL, or
Redis markers in `.next/static`.

`npm audit` remains a production dependency blocker: the recorded summary is
`{"info":0,"low":1,"moderate":7,"high":4,"critical":0,"total":12}`.

## Draft PR State

- PR #19 remains Open and Draft.
- PR #17 remains Open and Draft.
- No PR was merged during B12-FG.
- The final mainline PR #17 still targets `develop`; PR #19 is only the
  corrective PR into `integration/auth-newapi`.
