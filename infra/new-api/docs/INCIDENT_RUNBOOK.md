# Incident Runbook

## Common Incidents

- failed healthcheck
- backup failure
- restore rejection
- upgrade regression
- rollback request
- leaked secret in logs

## Response Order

1. isolate the deployment
2. capture a redacted log set
3. create a fresh backup if the current state is still valid
4. confirm the failure mode
5. restore or roll back only with explicit parameters
6. record the incident and follow-up work
