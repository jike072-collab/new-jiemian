# Operations

This directory contains the operational baseline for the isolated New API test deployment.

## Principle

- use strict shell mode
- fail closed on missing dependencies
- do not print secrets
- support non-interactive execution
- require explicit parameters for destructive operations
- require explicit confirmation tokens for restore and rollback

## Script Set

- `preflight`
- `healthcheck`
- `backup`
- `restore`
- `upgrade-check`
- `rollback`
- `redact-logs`

## Non-interactive Examples

```bash
scripts/preflight
scripts/healthcheck
scripts/backup
scripts/restore --backup backups/20260618T010000Z --confirm RESTORE_NEW_API_TEST
scripts/upgrade-check --target-image calciumion/new-api:v1.0.0-rc.11
scripts/rollback --backup backups/20260618T010000Z --previous-image calciumion/new-api:v1.0.0-rc.11 --confirm ROLLBACK_NEW_API_TEST
scripts/redact-logs --input .runtime/new-api/logs/app.log --output .runtime/new-api/logs/app.redacted.log
```

## Notes

The operational scripts are intentionally separated so that health, backup, restore, upgrade, and redaction can be run independently in automation.
