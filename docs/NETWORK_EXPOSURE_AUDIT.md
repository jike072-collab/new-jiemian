# Network Exposure Audit

This is the current network exposure checklist for the Ubuntu 3106 production
shape. The older Windows-local snapshot was archived under
[archive/windows-local-environment/NETWORK_EXPOSURE_AUDIT.md](archive/windows-local-environment/NETWORK_EXPOSURE_AUDIT.md).

This document is read-only. It does not authorize firewall, Nginx, DNS,
certificate, PostgreSQL, New API, systemd, 3106, or 3107 changes.

## Current Findings

- Production target: one 3106 service bound to `127.0.0.1:3106`.
- Public entry: Nginx on ports 80 and 443.
- Management entry: SSH on port 22.
- 3107 is local-only on the development computer and is not present on the
  server.
- Raw app, database, New API, and provider ports must not be public entrypoints.
- Server facts must come from a human-operated read-only check or the templates
  in [deploy/linux/](../deploy/linux/).

## Port Inventory

| Port | Expected binding | Purpose | Public |
| --- | --- | --- | --- |
| 22 | server SSH | operator access | yes, restricted by host policy |
| 80 | Nginx | HTTP to HTTPS redirect | yes |
| 443 | Nginx | HTTPS reverse proxy | yes |
| 3106 | `127.0.0.1` | Next.js production app | no |
| 3107 | none on server | local development only | no |

## Risk Ratings

- Critical: raw 3106, database, New API, or provider service reachable from the
  public internet.
- High: Nginx proxies to a wildcard app bind, missing upload limits, or logs
  expose secrets.
- Medium: DNS, TLS renewal, log retention, or disk/inode monitoring is unclear.
- Low: 3106 is loopback-only and public traffic enters only through Nginx.

## Masked Information

Reports must show secret values only as `configured`, `missing`, `masked`, or
`not_checked`. Do not print API keys, database passwords, cookies,
Authorization headers, admin passwords, full DSNs, New API tokens, provider
secrets, or production environment values.

## Why No Configuration Change Was Executed

Network and firewall changes can lock out operators or interrupt 3106. This
document is a checklist only. Applying any server change requires a separate
explicit execution task with rollback material and human approval.
