# Provider Health Checks

Stage 4 adds read-only provider health checks for the admin provider page.

## What It Checks

- Static check: validates local provider configuration without external requests.
- Connectivity check: sends a short `HEAD` request to a safe gateway endpoint, preferring inferred `/models` paths for OpenAI-compatible providers and origin checks for providers without a model-list surface.
- Model list check: reads a safe `/models` endpoint inferred from the configured provider URL.

The checks cover endpoint presence, URL shape, API key configured/missing state, disabled providers, duplicate provider IDs, empty strings, leading/trailing whitespace, configured model values, gateway reachability, response format, and whether a configured model appears in a returned model list.

## No Generation

These checks do not call image generation, image edit submission, video generation, image upscale, or video upscale routes. They do not submit prompts, files, image payloads, video payloads, or generation parameters.

Live generation smoke checks are not part of Stage 4. The server module rejects live generation mode unless a future implementation explicitly adds a separate guarded workflow. The current report always returns `liveGenerationEnabled: false`.

## NewAPI And Cost Boundary

The default static check makes no external request. Connectivity uses only `HEAD` against safe gateway endpoints. Model list uses `GET /models` style endpoints for providers that support that surface and keeps only non-sensitive model identifiers.

If a gateway does not support a free model list endpoint, the check reports the failure category instead of falling back to generation. It must not be treated as a generation smoke test or quota-consuming verification.

## API Key Masking

Provider API keys are never returned in full. Reports expose only:

- `configured`: whether a usable key-like value exists.
- `masked`: a short masked preview, for example `sk-****1234`.

The response does not include `Authorization`, cookies, `APP_DATABASE_URL`, `ADMIN_PASSWORD`, or full upstream responses.

## Admin Endpoint

- `GET /api/admin/provider-health?mode=static`
- `GET /api/admin/provider-health?mode=connectivity`
- `GET /api/admin/provider-health?mode=models`
- `POST /api/admin/provider-health` with `{ "mode": "static" | "connectivity" | "models" }`

The endpoint reuses the existing admin permission gate. Anonymous and non-admin users cannot read provider health details.

## Error Codes

- `PROVIDER_MISSING_ENDPOINT`: endpoint is empty.
- `PROVIDER_INVALID_ENDPOINT`: endpoint is not an `http` or `https` URL.
- `PROVIDER_MISSING_API_KEY`: API key is missing.
- `PROVIDER_DISABLED`: provider is disabled.
- `PROVIDER_DUPLICATE_ID`: more than one provider uses the same ID.
- `PROVIDER_TIMEOUT`: gateway or model list request timed out.
- `PROVIDER_NETWORK_ERROR`: gateway could not be reached.
- `PROVIDER_AUTH_FAILED`: upstream returned 401.
- `PROVIDER_FORBIDDEN`: upstream returned 403.
- `PROVIDER_RATE_LIMITED`: upstream returned 429.
- `PROVIDER_BAD_RESPONSE`: upstream returned an unexpected status or response.
- `PROVIDER_NON_JSON_RESPONSE`: model list response was not JSON.
- `MODEL_LIST_UNAVAILABLE`: inferred model list endpoint is unavailable.
- `MODEL_LIST_EMPTY`: model list returned no usable model IDs.
- `MODEL_MISSING_IMAGE`: image generation model/config field is missing.
- `MODEL_MISSING_IMAGE_EDIT`: image edit model/config field is missing.
- `MODEL_MISSING_VIDEO`: video generation model/config field is missing.
- `MODEL_MISSING_IMAGE_UPSCALE`: image upscale ServiceId/config field is missing.
- `MODEL_MISSING_VIDEO_UPSCALE`: video upscale SpaceName/config field is missing.
- `MODEL_NOT_FOUND`: configured model was not found in the model list.
- `PROVIDER_EMPTY_VALUE`: provider metadata contains an empty required display value.
- `PROVIDER_TRIMMED_VALUE`: provider metadata contains leading/trailing whitespace.
- `PROVIDER_ENVIRONMENT_MIXED`: endpoint text suggests staging/production mixing.
- `LIVE_GENERATION_DISABLED`: live generation checks are not enabled for Stage 4.
- `UNKNOWN_ERROR`: fallback category for unexpected failures.

## Admin Page

Open `/admin/providers` as an admin user. The provider page keeps the existing edit/save workflow and adds a separate connection-check area. It shows status, endpoint host, API key configured/masked state, model status, recent check duration, and error reasons.

No full provider secret is rendered in the DOM, written to console, or included in the test output.

## Adding Providers Or Model Types

Keep provider storage compatible with `data/providers.json`. Add new detection by mapping the provider `endpointType` to a model kind in `src/lib/server/provider-health.ts`, then add a stable error code and a mock-server test in `scripts/test-stage4-provider-health.mjs` coverage.

Do not use generation endpoints as a fallback for health checks.

## Explicit Authorization Boundary

Checks that might send prompts, upload media, submit jobs, or produce images/videos require a separate future stage and explicit authorization. They are not allowed by Stage 4.

The automated test suite covers this boundary; users do not need to run manual technical tests.
