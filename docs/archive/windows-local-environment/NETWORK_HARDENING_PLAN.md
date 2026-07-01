> Historical Windows-local network hardening plan. It does not apply to the
> current Ubuntu server deployment. The server runs only 3106; 3107 is
> local-only.

# Network Hardening Plan

This plan converts the Stage 7.2b read-only exposure audit into a future
maintenance-window sequence. It is not an authorization to change firewall,
PostgreSQL, NewAPI, reverse proxy, HTTPS, cloud security group, 3106, or 3107
configuration.

## Target Architecture

- 3106 production: `127.0.0.1:3106`, never directly exposed to the public
  internet.
- 3107 staging: `127.0.0.1:3107`, staging-only and not public.
- NewAPI: `127.0.0.1:3200` unless a separately approved HTTPS reverse proxy and
  access-control layer protects it.
- PostgreSQL: `127.0.0.1:55432` unless a documented remote client and exact
  masked source CIDR are approved.
- Public entry: HTTPS reverse proxy only, with explicit upstreams and separate
  logs.
- Admin surfaces: local-only or protected behind a reviewed access-control
  layer, not raw wildcard listeners.

## Firewall Plan

The safest firewall sequence is:

1. Identify the active remote-management path and source address.
2. Export current firewall policy before any change.
3. Add an allow rule for the management path before enabling a profile.
4. Add explicit deny or local-only controls for 3200 and 55432.
5. Enable profiles in the least risky order for the actual network role.
6. Verify app health and remote access after each step.
7. Keep rollback available until the whole validation matrix passes.

Example command text is included in `scripts/ops/network-hardening-plan.ps1` and
`docs/FIREWALL_ROLLBACK_RUNBOOK.md`, but Stage 7.2b scripts do not execute those
commands.

## NewAPI Binding Recommendation

If no remote NewAPI consumer is approved, bind NewAPI to `127.0.0.1:3200`.
If remote access is needed, place it behind a reviewed HTTPS reverse proxy with
authentication, rate limiting, and log redaction. Do not expose raw NewAPI on a
wildcard address without a separately approved exception.

## PostgreSQL Binding Recommendation

If NewAPI and the app run on the same host, bind the PostgreSQL application
instance to `127.0.0.1:55432` and reduce `pg_hba.conf` to local clients only.
If remote access is required, approve the exact masked source ranges, use
scram-sha-256 or stronger policy, and avoid `trust` or broad `0.0.0.0/0` and
`::/0` rules.

The read-only Stage 7.2b audit observed `listen_addresses = '*'` for the
PostgreSQL instance on port 55432. It also observed local-only `pg_hba.conf`
entries for `127.0.0.1/32` and `::1/128` using `scram-sha-256`. That means the
host listener should still be narrowed even though the current authentication
rules are not broad remote rules.

## HTTPS And Reverse Proxy Recommendation

Use HTTPS termination only through a reviewed reverse proxy. The proxy should:

- expose only intended public routes;
- avoid forwarding raw admin, NewAPI, or database ports;
- enforce request-size limits and timeouts;
- log without secrets;
- preserve enough evidence for incident review.

No reverse proxy or HTTPS change is part of Stage 7.2b.

## Logging And Alerting

The current log window should be checked for:

- HTTP 500 bursts;
- database connection errors;
- raw API keys, passwords, cookies, or Authorization values;
- generation endpoint calls;
- NewAPI generation calls;
- suspicious external connection growth.

Logs in reports must use `masked`, `configured`, or `missing` for sensitive
values.

## Pre-Change Checks

- Confirm user authorization for a network maintenance stage.
- Confirm 3106 PID, commit, data checksum, and uploads checksum.
- Confirm 3107 PID, commit, data-staging checksum, and uploads-staging checksum.
- Confirm rollback backups and firewall policy export.
- Confirm active remote-management port and trusted source.
- Confirm NewAPI remote clients, or prove local-only need.
- Confirm PostgreSQL remote clients, or prove local-only need.
- Record runtime secret files only as `present_not_read`, `configured`,
  `missing`, or `masked`.
- Confirm no generation or NewAPI generation call is part of the test plan.

## Post-Change Validation

- 3106 routes `/`, `/login`, `/api/health/backend`, and `/api/library` return
  expected statuses.
- 3107 routes `/`, `/login`, `/api/health/backend`, and `/api/library` return
  expected statuses.
- Staging watchdog reports `action=none`, `identity=owned`, and `ok=true`.
- 3106 PID and commit remain unchanged unless production release was explicitly
  authorized.
- 3106 and 3107 data/uploads checksums remain unchanged.
- NewAPI and PostgreSQL listeners match the approved target bindings.
- Current logs have no 500 storm, database error loop, raw secret, generation
  call, or NewAPI generation call.

## Rollback Conditions

Rollback immediately if remote management drops, 3106 health fails, 3107 health
fails, NewAPI local calls fail, PostgreSQL local calls fail, firewall rule state
differs from the approved plan, or any data/uploads checksum changes
unexpectedly.

## Authorization Boundary

This plan is documentation only. Applying it requires a later explicit user
authorization for the exact stage, command sequence, rollback point, and
expected downtime or no-downtime window.
