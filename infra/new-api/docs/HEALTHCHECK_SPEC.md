# Healthcheck Spec

## Health Signals

- New API container
- PostgreSQL service
- Redis service
- service response
- data volume presence
- disk free space
- release pin/version
- recent error logs
- time sync availability

## Script Coverage

`scripts/healthcheck` checks local deployment files, runtime volume presence, disk space, required image/secret variables, recent error patterns in logs, basic system clock sanity, Docker Compose status, PostgreSQL readiness, Redis readiness, the New API `/api/status` response, and the running image listing.

## Output Rules

- do not print secrets
- return a non-zero exit code on failures
- keep the output suitable for non-interactive automation
