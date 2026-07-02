> Historical Windows-local network audit. It does not apply to the current
> Ubuntu server deployment. The server runs only 3106; 3107 is local-only.

# Network Exposure Audit

Stage 7.2b is a read-only server network exposure audit. It records local
listener, firewall, NewAPI, PostgreSQL, and runtime evidence, then produces a
future hardening plan. It does not apply network, firewall, PostgreSQL, NewAPI,
reverse proxy, HTTPS, cloud security group, or service changes.

## Current Findings

- OS observed during the Stage 7.2b snapshot: Windows 11 Pro `10.0.26100`.
- Current user observed during the snapshot: Administrator account, high
  integrity.
- Node observed: `v24.16.0`.
- npm observed: `11.13.0`.
- 3106 production listened on `127.0.0.1:3106`.
- 3107 staging listened on `127.0.0.1:3107`.
- NewAPI listened on `:::3200`, which is a wildcard IPv6 listener.
- PostgreSQL production-side instance listened on `0.0.0.0:55432` and
  `:::55432`.
- PostgreSQL configuration evidence from the read-only audit showed
  `listen_addresses = '*'` and `port = 55432`.
- `pg_hba.conf` non-comment rules observed during the read-only audit were
  local host rules using `127.0.0.1/32` and `::1/128` with `scram-sha-256`.
- A local PostgreSQL staging instance listened on `127.0.0.1:5432`.
- Windows Firewall Domain, Private, and Public profiles were observed disabled.
- No running nginx, caddy, IIS worker, traefik, cloudflared, ngrok, frp, or
  tailscale process was observed in the read-only snapshot.
- The observed NewAPI runtime was a standalone exe under the project runtime
  area, not the repository's Docker Compose stack. Its command-line summary did
  not require printing any secret value.

Stage 7.2a already closed the app-level unauthenticated and missing-CSRF upscale
POST path and hardened NewAPI raw log redaction. The remaining findings are
server and network boundaries, not business-route fixes.

## Port Inventory

| Port | Observed binding | Owner summary | Risk |
| --- | --- | --- | --- |
| 3106 | `127.0.0.1:3106` | 3106 Next.js production service | Low, loopback only |
| 3107 | `127.0.0.1:3107` | 3107 Next.js staging service | Low, loopback only |
| 3200 | `:::3200` | NewAPI | High until bound or firewalled |
| 5432 | `127.0.0.1:5432` | local PostgreSQL staging instance | Low, loopback only |
| 55432 | `0.0.0.0:55432`, `:::55432` | PostgreSQL 16 service | High until bound or firewalled |

Other non-loopback listeners were observed for Windows system services, vendor
utilities, proxy/virtual network addresses, and remote-control software. They
are outside the application release scope, but they should be reviewed before a
server-hardening maintenance window because they can affect remote access and
the firewall profile decision.

## Listening Address Summary

- Loopback-only application listeners: 3106, 3107, and staging PostgreSQL 5432.
- Wildcard application-adjacent listeners: NewAPI 3200 and PostgreSQL 55432.
- Reverse proxy or tunnel processes: none observed for nginx, caddy, IIS,
  traefik, cloudflared, ngrok, frp, or tailscale.
- HTTPS termination: none observed in the local process snapshot.
- Domain binding: not established by this local read-only snapshot.

## Risk Ratings

- Critical: none confirmed by the local read-only snapshot. No established
  non-loopback connection to 3106, 3107, NewAPI 3200, or PostgreSQL 55432 was
  observed during the sample.
- High: Windows Firewall profiles disabled; NewAPI wildcard listener on 3200;
  PostgreSQL wildcard listeners on 55432 caused by `listen_addresses = '*'`.
- Medium: remote-control and vendor LAN services are present and must be
  accounted for before firewall enablement to avoid locking out the operator.
- Medium: runtime directories may contain pgpass, cookie, or admin-token files;
  their presence can be recorded as `present_not_read`, but contents must not be
  read or reported during this audit.
- Low: 3106 and 3107 are bound to loopback and did not show public listener
  exposure in the snapshot.
- Info: app-level Stage 7.2a auth/CSRF and log-redaction fixes remain in place.

## Masked Information

The audit and scripts must report secrets only as `configured`, `missing`, or
`masked`. They must not print API keys, database passwords, cookies,
Authorization headers, ADMIN_PASSWORD, APP_DATABASE_URL, NewAPI keys, raw
database URLs, or bearer tokens.

## Risks Already Solved By Stage 7.2a

- Unauthenticated `/api/upscale/image` POST rejection.
- Unauthenticated `/api/upscale/video` POST rejection.
- Missing or invalid CSRF rejection before provider calls.
- Default NewAPI raw log redaction for sensitive request and response values.

## Risks Requiring Network-Level Change

- NewAPI should be bound to `127.0.0.1:3200` unless a separately approved
  reverse proxy protects it.
- PostgreSQL should be bound to `127.0.0.1:55432` unless a documented remote
  client exists.
- `pg_hba.conf` should remain local-only unless an approved remote source exists,
  and it should avoid `trust`, `md5`, `0.0.0.0/0`, `::/0`, or broad LAN ranges.
- Windows Firewall profiles should not be enabled until remote-management access
  is explicitly preserved and rollback is ready.
- Any public access should terminate at a reviewed HTTPS reverse proxy rather
  than raw app, NewAPI, or PostgreSQL listeners.

## Why No Configuration Change Was Executed

Changing firewall profiles, listener bindings, PostgreSQL access files, or
reverse proxy settings can lock out remote access or break production callers.
Stage 7.2b is therefore limited to read-only evidence, dry-run scripts, and
rollback-ready runbooks. Any actual change requires a later, separately
authorized maintenance stage.
