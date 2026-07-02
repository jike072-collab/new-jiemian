# Aohuang AI

Aohuang AI is a single-instance image and video generation studio. The current
implementation includes image generation, image editing, video generation,
Volcengine ImageX image upscale, Volcengine VOD video upscale, a local media
library, provider administration, login/session support, quota and billing
support, and PostgreSQL-ready persistence foundations.

## Runtime Shape

- Node.js 24 is required.
- Next.js 16 App Router, React 19, TypeScript strict mode, and Tailwind CSS v4.
- Local 3107 runs only on the development computer for optimization, automated
  tests, and manual acceptance.
- 3107 is not deployed to the server and does not need server systemd, Nginx, or
  server data directories.
- The Ubuntu production server runs only one 3106 instance behind Nginx.
- The current workload and rate limits are in-process and are suitable for one
  app instance, not a multi-instance deployment.

## Local 3107

Use the local staging lane for development acceptance:

```bash
npm install
npm run dev:staging
```

The staging example is `.env.example`. It uses:

```dotenv
PORT=3107
DATA_DIR=data-staging
UPLOADS_DIR=uploads-staging
RUNTIME_STORAGE_ISOLATION=strict
```

Manual acceptance notes live in [3107_MANUAL_TEST_CHECKLIST.md](docs/3107_MANUAL_TEST_CHECKLIST.md).

## Server 3106

Production uses Ubuntu, systemd, Nginx, Node.js 24, and one Next.js service on
`127.0.0.1:3106`. The server does not run 3107.

Server deployment templates are in [deploy/linux/README.md](deploy/linux/README.md).
Production environment placeholders are in [.env.production.example](.env.production.example)
and [deploy/linux/production.env.example](deploy/linux/production.env.example).
The full variable index is [ENVIRONMENT_VARIABLES.md](docs/ENVIRONMENT_VARIABLES.md).

Deployment is not part of automated Codex module work. The release flow is:

```text
module branch development -> local 3107 tests -> push GitHub -> code review -> merge main -> manual server deploy to 3106
```

## Data Storage

- Runtime JSON and metadata default to `DATA_DIR`.
- Generated and uploaded media files live under `UPLOADS_DIR`.
- PostgreSQL support exists for application data and release checks, but current
  library and generation job defaults remain JSON/file-system backed unless the
  explicit database flags and runtime guard are enabled.
- Generated media is retained for 24 hours by default and then cleaned by the
  separate media retention task.
- Video uploads default to 200MiB; image uploads default to 10MiB.
- Disk protection defaults to 70/80/85/90/95 percent thresholds.

## Upscale Providers

Current upscale is cloud-provider based:

- Image upscale: Volcengine ImageX, endpoint type `volcengine-imagex-upscale`.
- Video upscale: Volcengine VOD, endpoint type `volcengine-vod-upscale`.

Retired local executable upscale providers are historical only. Current UI,
provider saves, and API responses must not write retired local endpoint types.

## Checks

Common local checks:

```bash
npm run check:docs
npm run lint
npm run typecheck
npm run build
```

For the current documentation map, start with [docs/README.md](docs/README.md).
