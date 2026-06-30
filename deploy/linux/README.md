# Linux Deployment Assets

These files are templates for a single Ubuntu 22.04 LTS production server.
They do not deploy anything by themselves and must not be used for local 3107.

## Production Shape

- Runtime: one Next.js production instance.
- Node.js: 24.x.
- Process manager: systemd.
- Reverse proxy: Nginx.
- Application bind: `127.0.0.1:3106`.
- Public ports: `22`, `80`, and `443` only.
- No WordPress, PHP, full LNMP stack, PM2, Docker, or Baota process manager.
- 3107 remains local-only for development optimization, automated tests, and manual acceptance.

The release flow stays:

```text
module branch development -> local 3107 tests -> push GitHub -> code review -> merge main -> manual server deploy to 3106
```

Codex module work prepares these templates only. It must not connect to, modify,
restart, or deploy the real server.

## Files

| File | Purpose |
| --- | --- |
| `aohuang-ai.service.example` | systemd unit for the single 3106 Next.js instance. |
| `aohuang-media-cleanup.service.example` | systemd one-shot unit that runs the media retention cleanup in apply mode. |
| `aohuang-media-cleanup.timer.example` | systemd timer that triggers the cleanup service hourly. |
| `nginx-site.conf.example` | Nginx HTTPS reverse proxy template for `127.0.0.1:3106`. |
| `production.env.example` | Production environment placeholder file with no real secrets. |
| `deploy-preflight.sh` | Read-only preflight checks for the server before installing or switching a release. |
| `health-check.sh` | Local-only health check for the 3106 application and safe backend health endpoint. |
| `journald.md` | Logging guidance for systemd journal retention and safe log review. |
| `directory-layout.md` | Recommended release, data, upload, runtime, and backup directories. |

## Directory Plan

Recommended paths:

```text
/opt/aohuang-ai/releases/<release-id>
/opt/aohuang-ai/current -> /opt/aohuang-ai/releases/<release-id>
/var/lib/aohuang-ai/data
/var/lib/aohuang-ai/uploads
/var/lib/aohuang-ai/runtime
/var/lib/aohuang-ai/backups
/etc/aohuang-ai/production.env
```

The service user should be a dedicated low-privilege account, for example
`aohuang-ai`. The service needs write access only to the data, uploads, and
runtime directories. Code releases should be readable by the service but not
written by it.

## Environment

Use `production.env.example` as a placeholder reference only. The real server
file should be stored at `/etc/aohuang-ai/production.env`, owned by root, and not
world-readable. Never paste real API keys, database passwords, admin passwords,
cookies, tokens, or production values into this repository.

Production invariants:

- `NODE_ENV=production`
- `PORT=3106`
- `APP_BIND_HOST=127.0.0.1`
- persistent storage under `/var/lib/aohuang-ai`
- `MEDIA_VIDEO_UPLOAD_LIMIT_MIB=200`
- `MEDIA_RETENTION_HOURS=24`

Run the application validation on the server environment before switching a
release:

```bash
npm run env:check:production
npm run release:preflight
```

Those checks must report variable names and reasons only, not secret values.

## systemd

The application unit:

- reads secrets from `EnvironmentFile=/etc/aohuang-ai/production.env`
- forces port `3106` and loopback bind host
- runs one service instance only
- restarts on failure
- uses `NoNewPrivileges=true` and `PrivateTmp=true`
- allows writes only to the data, uploads, and runtime directories
- gives in-flight requests time to finish on stop

Do not place real secrets in unit files. Do not create a 3107 server unit.

The cleanup timer runs once per hour. It does not delete every file hourly. It
calls the existing retention script, which deletes only completed local media
that is older than the configured retention window, normally 24 hours.

## Nginx

The Nginx template:

- redirects HTTP to HTTPS
- proxies HTTPS to `127.0.0.1:3106`
- forwards `Host`, `X-Real-IP`, `X-Forwarded-For`, and `X-Forwarded-Proto`
- sets `client_max_body_size 220m`, which is above the 200MiB app default and
  below the 256MiB hard cap
- keeps API responses uncached
- caches hashed Next.js static assets
- blocks dotfiles, `.env`, data, uploads, runtime, and backup paths
- documents login, admin, and generation rate-limit zones

Enable HSTS only after HTTPS is confirmed working. The template intentionally
does not add an aggressive CSP because that can break Next.js resources and blob
previews.

## Read-Only Checks

Before installing or switching a release, a human operator can run:

```bash
bash deploy/linux/deploy-preflight.sh
```

After the application is started locally on the server:

```bash
bash deploy/linux/health-check.sh
```

Both scripts are read-only. They do not run migrations, invoke generation
providers, delete media, restart services, or print environment variable values.

## Short-Term Backups

Daily 60GB server backups are documented in `docs/SERVER_BACKUP_AND_RESTORE.md`.
They back up PostgreSQL and necessary `data` metadata, but do not retain
24-hour generated media in `uploads`.

Useful commands:

```bash
npm run ops:backup:dry-run
npm run ops:backup:apply
npm run ops:backup:prune:dry-run
npm run ops:restore:verify -- --backup <server-backup-dir>
```

Local backups under `/var/lib/aohuang-ai/backups` are short-term copies only.
Sync them to external storage, a cloud snapshot, or another machine.
