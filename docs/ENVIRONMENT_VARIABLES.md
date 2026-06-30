# Environment Variables

This project has two runtime lanes.

- Local 3107: runs only on the development computer for optimization, automated tests, and manual acceptance. It uses local staging data directories and does not need server Nginx, systemd, or server data directories.
- Server 3106: the only production server runtime. It runs with `NODE_ENV=production`, listens on `127.0.0.1`, and is reached through Nginx. Production config must pass `npm run env:check:production` and `npm run release:preflight`.

Server deployment is outside the automated module work. The release flow remains: module branch development -> local 3107 testing -> push GitHub -> code review -> merge `main` -> server deploy 3106.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run env:check:local-staging` | Checks the local 3107 staging boundary without requiring production provider secrets. |
| `npm run env:check:production` | Checks the server 3106 production boundary and fails closed on unsafe config. |
| `npm run release:preflight` | Runs runtime storage, production/staging environment, and backend release checks before `next start`. |

## Core Runtime

| Variable | Purpose | Sensitive | Local 3107 | Production 3106 | Default | Allowed range | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | Runtime mode. | No | Optional | Required | Next.js default | Production must be `production` | Next.js, release preflight |
| `PORT` | App port. | No | Required `3107` | Required `3106` | Next.js default | `3107` local, `3106` production | scripts, runtime paths |
| `APP_BIND_HOST` | Production bind host checked by preflight. | No | Optional | Required | `127.0.0.1` | Loopback only | production env check |
| `NEXT_TELEMETRY_DISABLED` | Disable Next.js telemetry. | No | Optional | Recommended | `1` in service env | `0` or `1` | service env |
| `ADMIN_PASSWORD` | Admin provider/API password. | Yes | Optional | Required | Empty local-only fallback | Strong, not common placeholder | admin auth, production env check |
| `AUTH_SESSION_SECRET` / `SESSION_SECRET` | Session signing secret. | Yes | Optional | Required | Dev fallback only outside production | At least 32 chars | auth secret, release check |
| `DATA_DIR` | Persistent JSON/data root. | No | Required staging dir | Required Linux absolute path | `data` | Not `/tmp`, `.next`, `node_modules`, release scratch | runtime paths |
| `UPLOADS_DIR` | Generated/uploaded media root. | No | Required staging dir | Required Linux absolute path | `uploads` | Not nested with `DATA_DIR` | runtime paths |
| `RUNTIME_DIR` | Service runtime metadata/log/release root. | No | Optional | Required Linux absolute path | service `.runtime` | Not `/tmp`, `.next`, `node_modules`, release scratch | service env, production env check |
| `RUNTIME_STORAGE_ISOLATION` | Forces explicit isolated data/upload roots. | No | `strict` recommended | Optional | Empty | `strict` or empty | runtime storage preflight |

## Safety Limits

| Variable | Purpose | Sensitive | Local 3107 | Production 3106 | Default | Allowed range | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `MEDIA_IMAGE_UPLOAD_LIMIT_MIB` | Lowers image upload limit. | No | Optional | Optional | `10` | Integer `1..10` in production | upload guard, env check |
| `MEDIA_VIDEO_UPLOAD_LIMIT_MIB` | Lowers video upload limit. | No | Optional | Optional | `200` | Integer `1..200` in production; hard cap 256 | upload guard, env check |
| `MEDIA_RETENTION_HOURS` | Generated media retention. | No | Optional | Optional | `24` | Integer `1..168` | media retention cleanup, UI |
| `SERVER_BACKUP_ROOT` | Short-term server backup root. | No | Optional | Recommended | sibling `backups` near data root | Absolute path outside release, data, uploads, and runtime roots | server backup ops |
| `SERVER_BACKUP_RETENTION_COUNT` | Local backup count to retain. | No | Optional | Optional | `5` | Integer `3..7`; invalid values use default | server backup prune |
| `STORAGE_WARNING_PERCENT` | Disk warning threshold. | No | Optional | Optional | `70` | Lowerable, must stay increasing | storage capacity policy |
| `STORAGE_CRITICAL_PERCENT` | Disk critical threshold. | No | Optional | Optional | `80` | Lowerable, must stay increasing | storage capacity policy |
| `STORAGE_VIDEO_BLOCK_PERCENT` | Blocks new video writes. | No | Optional | Optional | `85` | Lowerable, must stay increasing | storage capacity policy |
| `STORAGE_MEDIA_BLOCK_PERCENT` | Blocks all new media writes. | No | Optional | Optional | `90` | Lowerable, must stay increasing | storage capacity policy |
| `STORAGE_EMERGENCY_PERCENT` | Emergency read/cleanup-only level. | No | Optional | Optional | `95` | Lowerable, must stay increasing | storage capacity policy |
| `WORKLOAD_USER_IMAGE_TASKS` | Per-user concurrent image tasks. | No | Optional | Optional | `2` | Integer `1..2` | workload guard |
| `WORKLOAD_USER_VIDEO_TASKS` | Per-user concurrent video tasks. | No | Optional | Optional | `1` | Integer `1` | workload guard |
| `WORKLOAD_USER_LARGE_UPLOADS` | Per-user large upload slots. | No | Optional | Optional | `1` | Integer `1` | workload guard |
| `WORKLOAD_PROCESS_LARGE_VIDEO_IO` | Per-process large video buffer/upload slots. | No | Optional | Optional | `1` | Integer `1` | workload guard |
| `WORKLOAD_SITE_VIDEO_UPLOAD_PHASE` | Site-wide video upload phase slots. | No | Optional | Optional | `2` | Integer `1..2` | workload guard |
| `AUTH_LOGIN_FAILED_PER_IP_PER_MINUTE` | Failed login rate limit. | No | Optional | Optional | `5` | Integer `1..5` | auth/workload guard |
| `AUTH_REGISTER_PER_IP_PER_HOUR` | Registration rate limit. | No | Optional | Optional | `3` | Integer `1..3` | auth/workload guard |
| `AUTH_ADMIN_PASSWORD_FAILED_PER_IP_PER_MINUTE` | Admin password failure rate limit. | No | Optional | Optional | `3` | Integer `1..3` | workload guard |

## Database And New API

| Variable | Purpose | Sensitive | Local 3107 | Production 3106 | Default | Allowed range | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `APP_DATABASE_URL` | Application PostgreSQL connection. | Yes | Optional | Required | Empty | PostgreSQL URL | database config, release check |
| `APP_DATABASE_EXPECTED_NAME` | Database identity guard. | No | Optional | Required | Empty | Explicit DB name | database config |
| `APP_DATABASE_MAX_CONNECTIONS` | PostgreSQL pool size. | No | Optional | Optional | `5` | `1..50` | database config |
| `APP_DATABASE_CONNECT_TIMEOUT_MS` | DB connect timeout. | No | Optional | Optional | `5000` | `100..30000` | database config |
| `APP_DATABASE_QUERY_TIMEOUT_MS` | DB query timeout. | No | Optional | Optional | `10000` | `100..60000` | database config |
| `APP_DATABASE_IDLE_TIMEOUT_MS` | DB idle timeout. | No | Optional | Optional | `30000` | `1000..120000` | database config |
| `APP_AUTH_PERSISTENCE_MODE` | Auth persistence backend. | No | Optional | Required | `json` local | Production must be `postgres` | auth persistence |
| `APP_BILLING_PERSISTENCE_MODE` | Billing persistence backend. | No | Optional | Required | `json` local | Production must be `postgres` | billing persistence |
| `APP_TASK_BILLING_PERSISTENCE_MODE` | Task billing persistence backend. | No | Optional | Required | `json` local | Production must be `postgres` | quota persistence |
| `LIBRARY_STORAGE_BACKEND` | Library DB read mode gate. | No | Optional | Optional | `json` | `json` or `database` | Stage 9E DB flags |
| `GENERATION_JOBS_BACKEND` | Generation jobs backend gate. | No | Optional | Optional | `existing` | `existing` or `database` | Stage 9E DB flags |
| `DATABASE_LIBRARY_DUAL_WRITE` | Library dual-write gate. | No | Optional | Optional | `false` | Boolean | Stage 9E DB flags |
| `DATABASE_LIBRARY_READ_ENABLED` | Library database read gate. | No | Optional | Optional | `false` | Boolean | Stage 9E DB flags |
| `DATABASE_JOBS_WRITE_ENABLED` | Jobs database write gate. | No | Optional | Optional | `false` | Boolean | Stage 9E DB flags |
| `DATABASE_IMPORT_DRY_RUN_ONLY` | Blocks real import apply. | No | Optional | Required true | `true` | Must stay true unless separately approved | import tooling |
| `NEW_API_ENABLED` | Enables New API BFF integration. | No | Optional | Required true for release | `false` | Boolean | New API config, release check |
| `NEW_API_ENVIRONMENT` | New API environment label. | No | Optional | Required | `test` | Production release requires `production` | New API config |
| `NEW_API_BASE_URL` | New API base URL. | Yes | Optional | Required when enabled | Empty | HTTP(S) URL | New API config |
| `NEW_API_TIMEOUT_MS` | New API timeout. | No | Optional | Optional | `10000` | `1000..60000` | New API config |
| `NEW_API_MAX_RESPONSE_BYTES` | New API response cap. | No | Optional | Optional | `1048576` | `1024..5242880` | New API config |
| `NEW_API_ADMIN_USER_ID` | New API admin user id. | Yes | Optional | Required when enabled | Empty | Positive integer | New API config |
| `NEW_API_ADMIN_ACCESS_TOKEN` | New API admin token. | Yes | Optional | Required when enabled | Empty | Non-empty | New API config |

## Providers

Provider variables are optional until their key is configured or the matching provider is enabled through the admin provider store. Production checks only require secrets and provider fields for enabled or intentionally configured providers.

| Variable group | Purpose | Sensitive | Local 3107 | Production 3106 | Default | Allowed range | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `IMAGE_API_URL`, `IMAGE_MODEL`, `IMAGE_DISPLAY_NAME`, `IMAGE_MODEL_API_KEY`, `IMAGE_ENDPOINT_TYPE` | Main image provider. | Key is sensitive | Optional | Optional unless enabled | Built-in image URL/model | HTTP(S), supported endpoint type | providers |
| `IMG2_IMAGE_API_URL`, `IMG2_IMAGE_MODEL`, `IMG2_IMAGE_DISPLAY_NAME`, `IMG2_IMAGE_API_KEY`, `IMG2_IMAGE_ENDPOINT_TYPE` | Secondary image provider. | Key is sensitive | Optional | Optional unless enabled | Built-in img2 URL/model | HTTP(S), supported endpoint type | providers |
| `VIDEO_API_URL`, `VIDEO_MODEL`, `VIDEO_DISPLAY_NAME`, `VIDEO_MODEL_API_KEY`, `VIDEO_ENDPOINT_TYPE` | Main video provider. | Key is sensitive | Optional | Optional unless enabled | Built-in video URL/model | HTTP(S), supported endpoint type | providers |
| `GROK_VIDEO_API_URL`, `GROK_VIDEO_MODEL`, `GROK_VIDEO_DISPLAY_NAME`, `GROK_VIDEO_API_KEY` | Grok video provider. | Key is sensitive | Optional | Optional unless enabled | Built-in Grok URL/model | HTTP(S) | providers |
| `PROMPT_OPTIMIZER_API_URL`, `PROMPT_OPTIMIZER_MODEL`, `PROMPT_OPTIMIZER_DISPLAY_NAME`, `PROMPT_OPTIMIZER_API_KEY`, `DEEPSEEK_API_KEY` | Prompt optimizer provider. | Keys are sensitive | Optional | Optional unless enabled | DeepSeek URL/model | HTTP(S) | prompt optimizer, providers |
| `VOLCENGINE_ACCESS_KEY_PAIR`, `VOLCENGINE_ACCESS_KEY_ID`, `VOLCENGINE_SECRET_ACCESS_KEY`, `VOLCENGINE_REGION` | Volcengine credentials and region. | Keys are sensitive | Optional | Required only when Volcengine upscale is enabled | `cn-north-1` | Pair or AK+SK | providers, upscale |
| `VOLCENGINE_IMAGEX_ENDPOINT`, `VOLCENGINE_IMAGEX_SERVICE_ID`, `VOLCENGINE_IMAGEX_OUTPUT_DOMAIN`, `VOLCENGINE_IMAGEX_OUTPUT_TPL`, `VOLCENGINE_IMAGEX_WORKFLOW_TEMPLATE_ID`, `VOLCENGINE_IMAGEX_MODEL_ID` | ImageX image upscale. | No | Optional | Required only when ImageX upscale is enabled | ImageX endpoint and workflow defaults | HTTP(S), non-empty IDs when enabled | providers, upscale |
| `VOLCENGINE_VOD_ENDPOINT`, `VOLCENGINE_VOD_SPACE_NAME`, `VOLCENGINE_VOD_OUTPUT_DOMAIN`, `VOLCENGINE_VOD_TEMPLATE_1K`, `VOLCENGINE_VOD_TEMPLATE_2K`, `VOLCENGINE_VOD_TEMPLATE_4K` | VOD video upscale. | No | Optional | Required only when VOD upscale is enabled | VOD endpoint and template defaults | HTTP(S), non-empty IDs when enabled | providers, upscale |

## Billing

| Variable | Purpose | Sensitive | Local 3107 | Production 3106 | Default | Allowed range | Used by |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `PAYMENT_SANDBOX_WEBHOOK_SECRET` | Sandbox webhook secret for local billing tests. | Yes | Optional | No | Empty | Non-empty for sandbox webhook tests | billing config |
| `PAYMENT_PRODUCTION_ENABLED` | Production payment gate. | No | Optional | Optional disabled by default | `false` | Boolean | billing config |
| `PAYMENT_PRODUCTION_WEBHOOK_SECRET` | Production payment webhook secret. | Yes | Optional | Required only if production payment is separately enabled | Empty | Non-empty | billing config |

Deprecated local upscale variables such as `UPSCAYL_*`, `VIDEO2X_*`, `upscayl-cli`, and `video2x-cli` are historical only and must not appear in active runtime config.
