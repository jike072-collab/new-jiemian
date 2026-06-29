# 3107 tunnelto short test

This is a temporary public-entry smoke test, not a production deployment.

## Scope

- Use port `3107`.
- Use real `/register` and `/login` accounts.
- Reuse the current 3106 provider/model configuration by seeding a local 3107 test copy.
- The 3107 tunneltest provider seed only exposes the short-test models: image `image-img2-4k::model::image4k` and video `video-grok::model::grok-video-1.5`.
- Keep runtime storage isolated from 3106:
  - `DATA_DIR=data-tunneltest`
  - `UPLOADS_DIR=uploads-tunneltest`
  - `RUNTIME_STORAGE_ISOLATION=strict`
- Do not add Nginx, HTTPS, PM2, production PostgreSQL, billing changes, or production deploy work.

## Changed files

- `.gitignore`: ignores `data-tunneltest/` and `uploads-tunneltest/`.
- `package.json`: adds `seed:tunneltest-providers` and `dev:tunneltest`.
- `scripts/seed-tunneltest-providers.mjs`: copies the 3106 provider config into the isolated 3107 test data directory, then limits the short-test visible image/video models to image 4K and Grok video 1.5.
- `scripts/with-tunneltest-env.mjs`: starts child commands with forced 3107 tunneltest runtime variables.
- `src/components/customer-login.tsx`: exposes real registration fields for `email`, `username`, `password`, optional `displayName`, and test invite code.
- `src/app/api/auth/register/route.ts`: requires `TEST_INVITE_CODE` for open registration when configured, and always requires it in 3107 tunneltest mode.
- `src/app/api/library/route.ts`: requires an active auth session before reading or deleting the personal library.
- `src/app/api/files/[name]/route.ts`: requires an active auth session and only serves files owned by the current user.
- `src/lib/server/tunneltest-limits.ts`: stores 3107-only local test usage in `data-tunneltest/tunneltest-usage-log.json`.
- `src/app/api/generate/image/route.ts`, `src/app/api/generate/video/route.ts`, `src/app/api/upscale/image/route.ts`, `src/app/api/upscale/video/route.ts`: apply the 3107 local test quota/rate gate before provider calls.
- `src/components/studio/shared.tsx`: shows the diagnostic `code`, `requestId`, `occurredAt`, and a copyable short-test feedback block when generation or upscale fails.
- `src/app/auth-visual.css`: styles the short-test safety warning on `/register`.
- `src/lib/server/auth/tunneltest-registration-limit.ts`: records the current 3107 test-user baseline and allows 8 additional registrations for this short test.
- `docs/TUNNELTO_3107_SHORT_TEST.md`: records this short-test workflow and acceptance checklist.

## Prepare

From the `new-jiemian-3107` repository root:

```powershell
npm run seed:tunneltest-providers
```

This copies only `..\new-jiemian\data\providers.json` into `data-tunneltest\providers.json`.
The target directory is ignored by Git and must not be committed.

`npm run dev:tunneltest` loads the relevant server-side values from `..\new-jiemian\.env.local` when present, then forces the 3107 tunneltest port and storage directories. It does not inherit `NODE_ENV`, database URLs, persistence modes, `PORT`, `DATA_DIR`, or `UPLOADS_DIR`.

If real registration must sync users to New API, make sure these values exist in `..\new-jiemian\.env.local`, `.\.env.local`, or the current shell:

- `TEST_INVITE_CODE`
- `NEW_API_ENABLED`
- `NEW_API_ENVIRONMENT`
- `NEW_API_BASE_URL`
- `NEW_API_ADMIN_USER_ID`
- `NEW_API_ADMIN_ACCESS_TOKEN`
- `AUTH_SESSION_SECRET` or `SESSION_SECRET`

## Start 3107

```powershell
npm run dev:tunneltest
```

The command seeds providers first, then injects:

```dotenv
PORT=3107
DATA_DIR=data-tunneltest
UPLOADS_DIR=uploads-tunneltest
RUNTIME_STORAGE_ISOLATION=strict
APP_AUTH_PERSISTENCE_MODE=json
TEST_INVITE_CODE=<read from .env.local or current shell>
```

Local health signal:

- Terminal shows Next.js is ready on `127.0.0.1:3107`.
- `http://127.0.0.1:3107/register` loads.
- `http://127.0.0.1:3107/api/providers/enabled` returns JSON.

## 3107 test quota

These limits are local to 3107 and are stored in `data-tunneltest/tunneltest-usage-log.json`.
They are not a billing system and do not enable payments.

- Image generation: 5 attempts per account, max 5 per 10 minutes.
- Video generation: 1 attempt per account, max 1 per 30 minutes.
- Image upscale: 1 attempt per account, max 1 per 10 minutes.
- Video upscale: 1 attempt per account, max 1 per 10 minutes.

When the quota or rate window is exceeded, the API returns a clear `message` and the studio displays it in the existing error/toast surface.

## Feedback and error reporting

If a tester sees an error in image generation, video generation, image upscale, or video upscale, ask them to click `复制反馈信息` in the error panel and send:

- The copied diagnostic text, including `错误码`, `Request ID`, and `发生时间`.
- A screenshot of the current page.
- The operation steps that led to the problem.
- Whether retrying once changed the result.

The copied diagnostic text is designed for short-test triage only. It must not include API keys, cookies, database URLs, passwords, or uploaded private content.

Use tunnelto only after local 3107 is healthy. Run tunnelto in a second terminal while `npm run dev:tunneltest` keeps running:

```powershell
tunnelto --port 3107
```

Stop the tunnel immediately after the short test.

## Acceptance

1. Open `http://127.0.0.1:3107/register`.
2. Confirm registration without a test invite code is rejected.
3. Confirm registration with a wrong test invite code is rejected.
4. Register a new test account with the correct `TEST_INVITE_CODE`.
5. Confirm `data-tunneltest\auth-store.json` is created and `..\new-jiemian\data\auth-store.json` is not touched.
6. Open `http://127.0.0.1:3107/login` and log in with that account using only email/username and password.
7. Refresh the page and confirm `/api/auth/session` still returns the test user.
8. Log out and confirm `/api/library` returns 401 without the session cookie.
9. Remove or change `TEST_INVITE_CODE`, restart 3107, and confirm new registration is rejected.
10. Confirm `data-tunneltest\tunneltest-registration-baseline.json` is created and only 8 additional test registrations are allowed after that baseline.
11. Open `/admin/providers` on 3107 and confirm image generation only shows `image4k`, and video generation only shows `grok-video-1.5`.
12. Open the tunnelto public URL and repeat `/register` or `/login` smoke through the public URL.
13. Run one intentionally small image generation and confirm the result is saved under `uploads-tunneltest` with a record under `data-tunneltest`.
14. Run one intentionally small video generation if a video provider is enabled.
15. Run one image upscale, and one video upscale only if the project/provider setup is ready.
16. Confirm quota exhaustion with a disposable account, for example image generation stops after 5 attempts with a clear reason.
17. Register a second test user and confirm the first user's quota usage does not affect the second user.
18. Confirm user A cannot see, delete, or download user B's library items or stored files.
19. Confirm generated test artifacts appear only under `data-tunneltest` and `uploads-tunneltest`.
20. Confirm 3106 `data` and `uploads` timestamps/content are not changed by the 3107 test.
21. Trigger or observe one failed generation/upscale path and confirm the error panel shows `Code`, `Request ID`, `Time`, and `复制反馈信息`.
22. Confirm the copied feedback text contains the diagnostic fields and leaves space for tester reproduction steps and a screenshot.
