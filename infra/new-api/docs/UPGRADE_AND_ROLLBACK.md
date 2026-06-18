# Upgrade And Rollback

## Upgrade Baseline

1. run preflight
2. run `scripts/upgrade-check --target-image <pinned-image>`
3. review schema migration risk
4. create a backup
5. pull the new image
6. start or restart the stack
7. verify health
8. define rollback conditions before production use

The baseline does not auto-upgrade production. It only defines the sequence and required checks.

## Rollback Baseline

- keep the previous image reference
- keep the last known-good backup
- restore state before switching back
- do not auto-upgrade production
- rollback must be explicit and reversible
- rollback requires `--confirm ROLLBACK_NEW_API_TEST`

## Rollback Conditions

- New API fails healthcheck after upgrade
- login fails with known-good test credentials
- database migration produces unreconciled errors
- Redis/session behavior breaks
- payment or quota functions show inconsistent state
- logs contain new secret leakage
