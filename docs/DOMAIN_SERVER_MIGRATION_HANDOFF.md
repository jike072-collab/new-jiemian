# Domain And Server Migration Handoff

This handoff separates the temporary Windows preview setup from the formal
production server setup. It is intentionally secret-free.

## Current Local Preview State

The development computer has already verified this shape:

- 3106 runs the reviewed `origin/main` release.
- The app listens on `127.0.0.1:3106`.
- Caddy can listen on local HTTP port `80`.
- Caddy reverse proxies HTTP traffic to `127.0.0.1:3106`.
- Windows firewall rules allow local inbound TCP `80` and `443`.
- A Windows startup task can reload or start Caddy after reboot.

This is only a preview of the public entry shape. It is not proof that a public
domain can reach the development computer, because the current computer is
behind private/NAT addresses and does not own the public entrypoint.

## What Moves To The Server

Move or recreate these on the real server:

- the reviewed application code from GitHub;
- production environment variables, entered directly on the server;
- persistent `DATA_DIR`, `UPLOADS_DIR`, and `RUNTIME_DIR`;
- database configuration and backups, if database-backed mode is enabled;
- the public reverse proxy on ports `80` and `443`;
- HTTPS certificate issuance or renewal;
- firewall and cloud security group rules for `80` and `443`;
- service manager startup for the 3106 app and the reverse proxy.

Do not copy local-only runtime files blindly. In particular, local `.runtime`
files, logs, generated release folders, and temporary Caddy process state should
be treated as machine-specific.

## Formal Production Shape

The current production docs define the formal single-server target as:

- Ubuntu server;
- one Next.js production service managed by systemd;
- app bound to `127.0.0.1:3106`;
- Nginx as the public HTTPS reverse proxy;
- no 3107 service on the server.

Use these docs for the formal path:

- [PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md)
- [PRODUCTION_OPERATIONS.md](PRODUCTION_OPERATIONS.md)
- [ROLLBACK_RUNBOOK.md](ROLLBACK_RUNBOOK.md)
- [SERVER_BACKUP_AND_RESTORE.md](SERVER_BACKUP_AND_RESTORE.md)

## Temporary Windows Server Shape

If the first month uses a Windows server instead of the formal Ubuntu shape,
recreate the preview setup on that Windows server:

1. Deploy the app and confirm local 3106 health:

   ```powershell
   node scripts/ops/service-status.mjs production --json
   Invoke-WebRequest -Uri http://127.0.0.1:3106/api/health/backend -UseBasicParsing
   ```

2. Install Caddy on the server.

3. Create a server-local Caddyfile:

   ```caddyfile
   {
     auto_https off
   }

   :80 {
     encode zstd gzip

     request_body {
       max_size 220MB
     }

     header {
       -Server
       X-Content-Type-Options "nosniff"
       X-Frame-Options "SAMEORIGIN"
       Referrer-Policy "strict-origin-when-cross-origin"
       Permissions-Policy "camera=(), microphone=(), geolocation=()"
     }

     @api path /api/*
     header @api Cache-Control "no-store"

     reverse_proxy 127.0.0.1:3106 {
       header_up Host {host}
       header_up X-Real-IP {remote_host}
     }
   }
   ```

4. Validate and start Caddy:

   ```powershell
   caddy validate --config <server-caddyfile-path>
   caddy start --config <server-caddyfile-path>
   ```

5. Open inbound TCP `80` and `443` in Windows Firewall and the cloud provider
   security group.

6. Add a startup task or service wrapper for Caddy so it survives reboot.

After the real domain A records point to the Windows server and public HTTP
works, replace the `:80` site block with the approved domain names and enable
Caddy automatic HTTPS.

## DNS And HTTPS Gate

Before enabling HTTPS, verify:

- the apex domain and `www` domain are approved;
- A records point to the actual server public IP;
- cloud security group allows inbound TCP `80` and `443`;
- the reverse proxy is listening on public `0.0.0.0:80`;
- `http://<server-public-ip>/api/health/backend` reaches this app;
- `http://<domain>/api/health/backend` reaches this app.

Only after those pass should the HTTPS certificate step run.

## Safe Smoke Checks

Safe public checks:

```text
/
/login
/admin/providers
/api/health/backend
/api/library
/api/providers/enabled
/api/billing/config
```

Do not use public smoke tests to submit prompts, upload media, create billing
orders, call generation providers, run migrations, or delete library items.

## Current Open Items

- The final server is not yet confirmed.
- The final approved domain list is not yet recorded here.
- Current local public IP testing does not prove public reachability to the
  development computer.
- Payment production remains disabled until payment approval and webhook setup
  are complete.
