# Firewall Rollback Runbook

This is the current firewall rollback checklist for the Ubuntu 3106 server. The
older Windows-local firewall rollback note was archived under
[archive/windows-local-environment/FIREWALL_ROLLBACK_RUNBOOK.md](archive/windows-local-environment/FIREWALL_ROLLBACK_RUNBOOK.md).

It is documentation only and does not authorize firewall changes.

## Required Backups

Before any authorized firewall or Nginx change, the human operator must have:

- current firewall policy summary;
- current Nginx site config summary;
- current 3106 service status;
- current safe health check result;
- latest PostgreSQL and metadata backup manifest;
- rollback owner and recovery access path.

Do not paste secret values, private keys, full DSNs, cookies, tokens, or provider
credentials into the report.

## Export Current Policy

Use the server operator's approved method to export or record firewall policy
before changes. This repository does not provide an automatic apply command for
the production firewall.

## Preserve Remote Management

Do not change firewall policy unless SSH or an equivalent recovery path is
confirmed. Preserve port 22 or the approved management path before touching
public HTTP/HTTPS rules.

## Immediate Recovery

If access or health fails after an authorized change:

1. Use the preserved recovery path.
2. Restore the previously exported firewall policy or known-good Nginx config.
3. Verify SSH/recovery access.
4. Verify Nginx and 3106 safe health checks.
5. Stop the maintenance window and preserve logs for review.

## Authorization Points

Separate explicit authorization is required before:

- changing firewall rules;
- changing Nginx;
- changing DNS or TLS certificates;
- exposing or binding 3106 differently;
- restarting, stopping, publishing, or rolling back 3106;
- running cleanup apply, migrations, generation, upscale, or provider calls.
