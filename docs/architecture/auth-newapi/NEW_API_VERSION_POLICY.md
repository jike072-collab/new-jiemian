# New API Version Policy

## Current Official Release

As of 2026-06-18, the latest visible official GitHub Release is `v1.0.0-rc.11`, published at `2026-06-13T08:15:40Z`.

Sources:

- [GitHub releases](https://github.com/QuantumNous/new-api/releases)
- [Latest release page](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.11)

## Official Image Source

- Docker Hub: [calciumion/new-api](https://hub.docker.com/r/calciumion/new-api)
- Official build workflow: [docker-build.yml](https://github.com/QuantumNous/new-api/blob/main/.github/workflows/docker-build.yml)

## Fixed References

- Tag: `calciumion/new-api:v1.0.0-rc.11`
- Multi-arch manifest digest: `sha256:bd30213d808857bb569ef47d3c9209d061a66ea089c2472ef46ce51e75517f19`

The registry digest was checked directly against Docker Hub, so this is not a cached guess.

## Why Production Should Not Use Uncontrolled `latest`

- The official workflow repoints `latest` on every release.
- A pull or redeploy can therefore change runtime behavior without changing the deployment manifest.
- New API also performs schema migration at startup, so an uncontrolled upgrade can change both code and database state together.
- For production, pin a tag; for stricter environments, pin a digest as well.

## Database Migration Notes

The official source performs startup migration in `model/main.go`:

- `InitDB()` chooses SQLite, MySQL, or PostgreSQL from `SQL_DSN`
- the master node runs `migrateDB()`
- `migrateDB()` uses `AutoMigrate(...)`
- there are manual migration steps for `SubscriptionPlan.price_amount` and `Token.model_limits`
- `LOG_SQL_DSN` can route logs to a separate database

Implication: version upgrades must be paired with a real database backup.

## Update And Rollback

Official update path:

- pull the chosen image/tag
- restart with the same volumes and environment
- in multi-node mode, roll nodes in a controlled order

Rollback path:

- only safe if the previous image and pre-upgrade database backup are still available
- a database schema change may make image-only rollback incomplete

## Backup Requirements Before Upgrade

Minimum production backup set before every upgrade:

- primary database dump
- optional log database dump when `LOG_SQL_DSN` is separate
- compose file and environment variables
- `/data` volume or bind mount
- `/app/logs` when payment, audit, or troubleshooting history must be preserved
- exact running image tag and digest

## Multi-node Notes

- All nodes must share the same database.
- Redis is required for shared cache/session coordination in clustered deployment.
- All nodes must share the same `SESSION_SECRET` and `CRYPTO_SECRET`.
- Slave nodes must not perform schema migration; the master node owns migrations.

## Environment Anchors

The deployment docs and code consistently rely on:

- `SESSION_SECRET`
- `CRYPTO_SECRET`
- `SQL_DSN`
- `REDIS_CONN_STRING`
- `NODE_TYPE`
- `PORT`
- `TZ`

## Notes

- The repo's quick-start docs still show `latest` as an example, but that is a sample deployment shape, not a production pinning policy.
- This project should treat `latest` as mutable and therefore unsuitable for controlled production rollouts.
