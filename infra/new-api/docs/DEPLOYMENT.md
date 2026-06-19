# New API Test Deployment

## Goal

This deployment is only for the B05 isolated test environment:

- fixed New API version
- dedicated PostgreSQL
- dedicated Redis
- persistent runtime data
- health checks
- New API bound only to localhost or a controlled test network
- PostgreSQL and Redis attached to the compose network without host port mappings
- no frontend integration
- no real payment configuration

## Version Record

| Item | Record |
| --- | --- |
| Image source | Docker Hub `calciumion/new-api` |
| Fixed image | `calciumion/new-api:v1.0.0-rc.11@sha256:bd30213d808857bb569ef47d3c9209d061a66ea089c2472ef46ce51e75517f19` |
| Check date | `2026-06-18` |
| Reason | B03 and a fresh official Release check both confirmed `v1.0.0-rc.11` as the latest public Release. The deployment pins this version for repeatable testing and does not use uncontrolled `latest`. |

## Runtime Directories

Runtime data lives under `.runtime/new-api/`:

- `.runtime/new-api/data`
- `.runtime/new-api/logs`
- `.runtime/new-api/postgres`
- `.runtime/new-api/redis`

These paths are ignored by the repository and must not be committed.

## Prepare

1. Copy the example environment file:

```bash
cp .env.example .env
```

2. Replace every placeholder in `.env` with local test values.
3. Make sure port `3000` is free, or choose another controlled test port.

## Scripts

Run these from `infra/new-api`:

```bash
sh scripts/start
sh scripts/status
sh scripts/logs
sh scripts/stop
```

`start` pulls the fixed image and then starts the stack.

## Test Administrator Bootstrap

The real `POST /api/setup` fields were checked from official `controller/setup.go` at `v1.0.0-rc.11`:

- `username`
- `password`
- `confirmPassword`
- `SelfUseModeEnabled`
- `DemoSiteEnabled`

Example request:

```bash
curl -sS http://127.0.0.1:3000/api/setup \
  -H "Content-Type: application/json" \
  --data-raw '{
    "username": "testroot",
    "password": "REPLACE_WITH_STRONG_PASSWORD",
    "confirmPassword": "REPLACE_WITH_STRONG_PASSWORD",
    "SelfUseModeEnabled": true,
    "DemoSiteEnabled": false
  }'
```

Rules:

- create only a test administrator
- username is 12 characters or fewer
- password is 8 characters or longer
- do not use default weak passwords
- do not import real customers
- do not configure real model keys
- do not configure real payment keys

## Required Real Verification

Run these checks in a machine with Docker available:

1. `docker compose config`
2. `docker compose up -d`
3. `docker compose ps`
4. `docker compose logs --tail=200`
5. `GET /api/status` returns healthy status
6. unauthenticated management API access is rejected
7. data persists after restart
8. PostgreSQL and Redis have no host/public port mapping
9. logs contain no secrets, cookies, Authorization headers, or webhook secrets
10. the stack can stop and start again

## Current Local Verification Gap

On the B05 authoring machine, `docker`, `docker-compose`, `podman`, `nerdctl`, and `wsl` were not available in `PATH`, and the default Docker Desktop install path was not present. Therefore the real container checks could not be executed locally and must be rerun on a Docker-enabled host before this deployment is treated as fully operational.

The repository still includes the deployment files because they are statically checkable and keep the isolated test environment definition under version control. Do not claim real container integration passed until the checks above have been executed.

## Security Requirements

- do not commit `.env`
- do not commit real passwords, tokens, cookies, API keys, or webhook secrets
- do not store New API admin credentials in the browser
- do not log passwords, cookies, Authorization headers, API keys, or webhook secrets
- do not expose PostgreSQL or Redis publicly
- do not use default weak passwords
- do not use real payment or real funds
