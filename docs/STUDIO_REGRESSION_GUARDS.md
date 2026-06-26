# Studio Regression Guards

Stage 3 adds automated protection around the Studio module split. The goal is to catch accidental behavior changes in the split Studio files without calling real generation providers, NewAPI, or production data.

## Protected Behavior

- Studio exposes six modes: image generation, image editing, video generation, image upscale, video upscale, and library.
- Page-level checks cover `/`, `/login`, `/api/health/backend`, `/api/library`, `/admin/providers`, `/?preview=1`, and the six `/?preview=1&tool=...` Studio entries.
- Contract checks lock the Studio-facing endpoints, methods, request fields, response read paths, loading paths, error paths, preview panels, and library delete confirmation flow.
- `fetchJson` behavior is checked for successful JSON, JSON errors, non-JSON errors, empty responses, and network errors.
- Library deletion is protected so opening a delete intent only shows confirmation; the DELETE request remains behind confirmation.

## Forbidden Real Calls

Stage 3 tests must not call:

- `/api/generate/image`
- `/api/generate/video`
- `/api/upscale/image`
- `/api/upscale/video`
- `/api/prompts/optimize`
- `/api/quota/precheck`
- NewAPI provider URLs or real provider endpoints

Allowed requests are page loads, static assets, `/api/health/backend`, `/api/library`, and permission redirects such as `/admin/providers`.

Stage 4 adds `/api/admin/provider-health` as an admin-only, read-only diagnostics endpoint. It is allowed in provider-health tests because it does not submit generation payloads and is covered by separate mock-server guards.

## Commands

Run the full Stage 3 logic checks:

```bash
npm run test:stage3-studio-regression
npm run check:studio-api-contracts
```

For CI or local work without a running 3107 service, first run `npm run build`, then run with a managed temporary service:

```bash
STUDIO_TEST_MANAGE_SERVER=1 STUDIO_TEST_PORT=43109 npm run test:stage3-studio-regression
```

To run only the non-runtime behavior checks:

```bash
npm run test:stage3-studio-regression -- --skip-runtime
```

## NewAPI And Cost Check

The runtime tests record each HTTP request they make and fail if any request matches a generation, upscale submit, prompt optimization, quota precheck, or NewAPI pattern. The final test output includes:

- `generationEndpointsCalled: false`
- `newApiCalled: false`

Because no submit endpoints are called, Stage 3 does not consume generation quota.

## Data And Upload Isolation

When pointed at 3107, the UI checks snapshot `data-staging` and `uploads-staging` before and after the test and fail if either changes. In CI, the scripts run against a temporary data/upload root and delete it at the end.

Stage 3 must not copy data between production and staging. Production `data` and `uploads` are only read during final 3106 verification.

## Adding A Studio Mode

When adding a Studio mode, update:

- `studioModeRoutes` in `scripts/studio-ui-test-utils.mjs`
- `scripts/check-studio-api-contracts.mjs` endpoint and UI contracts
- the relevant preview and form tokens checked by `scripts/test-stage3-studio-regression.mjs`
- this document's mode list

Do not add real generation smoke tests to Stage 3. Real quota-consuming smoke tests require separate explicit authorization and a separate rollback plan.

## Manual Testing

Users do not need to perform technical manual testing for Stage 3 completion. The branch must provide automated local checks, CI checks, and 3107 deployment verification evidence.
