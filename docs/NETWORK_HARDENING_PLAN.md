# Network Hardening Plan

This is the current high-level network hardening plan for the Ubuntu 3106
server. The older Windows-local plan was archived under
[archive/windows-local-environment/NETWORK_HARDENING_PLAN.md](archive/windows-local-environment/NETWORK_HARDENING_PLAN.md).

It is documentation only and does not authorize server changes.

## Target Architecture

- 3106 production app binds only to `127.0.0.1:3106`.
- 3107 is not deployed to the server.
- Nginx is the only public HTTP/HTTPS entrypoint.
- Public ports are limited to 22, 80, and 443.
- Database, New API, provider, data, uploads, runtime, backup, and `.env` paths
  are not publicly served.
- No WordPress, PHP, full LNMP stack, PM2, Docker, or Baota process manager is
  used for this app.

## Firewall Plan

Before any firewall change, the human operator must confirm:

1. SSH access and recovery path.
2. Current Nginx and 3106 health.
3. Backup and rollback owner.
4. Allow rules for 22, 80, and 443.
5. No public allow rule for 3106, 3107, PostgreSQL, New API, or provider ports.

The module work does not run firewall commands.

## Pre-Change Checks

- Run `bash deploy/linux/deploy-preflight.sh` in read-only mode.
- Confirm `npm run env:check:production` and `npm run release:preflight` pass
  without printing secret values.
- Confirm disk, inode, backup, and log retention status.
- Confirm safe health checks do not call generation, upscale, providers, New API
  generation, migrations, cleanup apply, or billing writes.

## Post-Change Validation

- `/`, `/login`, `/admin/providers`, `/api/health/backend`, and `/api/library`
  return expected safe responses.
- Nginx still proxies to `127.0.0.1:3106`.
- Raw 3106 is not publicly reachable.
- Public exposure remains limited to 22, 80, and 443.
- Logs contain no secrets, raw provider responses, prompts, base64 media, full
  DSNs, cookies, tokens, or Authorization headers.

## Rollback Conditions

Rollback or stop immediately if:

- SSH or the approved recovery path is lost.
- Nginx or 3106 health fails.
- 3106 is exposed publicly.
- A safe check triggers generation, upscale, New API generation, a migration, a
  cleanup apply, or a billing write.
- Data, uploads, or database state changes unexpectedly.
- Secret-shaped values appear in output or logs.
