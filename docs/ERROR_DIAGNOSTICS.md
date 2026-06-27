# Error Diagnostics

Stage 5 adds a compatible diagnostic layer for generation and upscale failures.

## Response Shape

Failure responses still include the legacy top-level `error` string. New clients can also read `diagnostic`:

```json
{
  "error": "供应商认证失败。",
  "diagnostic": {
    "code": "PROVIDER_AUTH_FAILED",
    "category": "upstream",
    "message": "供应商认证失败。",
    "technicalMessage": "Authorization: Bearer [redacted]",
    "retryable": false,
    "requestId": "req-example",
    "occurredAt": "2026-06-27T00:00:00.000Z",
    "status": 502,
    "upstreamStatus": 401,
    "providerId": "image-main",
    "model": "image-model",
    "action": "请联系管理员检查 API Key。",
    "adminNote": "Upstream returned 401.",
    "safeDetails": {}
  }
}
```

Successful API responses are unchanged.

## Covered Surfaces

- `POST /api/generate/image`
- `POST /api/generate/video`
- `POST /api/upscale/image`
- `POST /api/upscale/video`
- `GET /api/jobs/[id]`
- `DELETE /api/library`
- Studio form error blocks
- Studio preview failure states

## Code Categories

- Configuration: provider missing, disabled, missing endpoint, invalid endpoint, missing API key, provider health failure.
- Model: missing image/image-edit/video/upscale model, model not found, model unavailable.
- Input: missing prompt, missing image, invalid image, invalid parameters, file too large, unsupported format.
- Network and upstream: timeout, network error, auth failure, forbidden, rate limited, bad request, upstream 4xx/5xx, non-JSON, bad response, empty response.
- Task: create failure, poll failure, failed status, timeout, cancelled, unknown status.
- Storage: library save failure, upload missing/read/write failure, result asset missing.
- System: internal and unknown errors.

The canonical list lives in `src/lib/error-diagnostic-catalog.ts`.

## Redaction Boundary

Diagnostics and logs must not expose:

- Full API keys
- `Authorization`
- `Cookie`
- `APP_DATABASE_URL`
- `ADMIN_PASSWORD`
- Postgres connection URLs
- query-string tokens, keys, secrets, or passwords
- raw upstream response bodies
- stack traces
- full prompts, uploads, or base64 payloads

`src/lib/server/error-diagnostics.ts` centralizes redaction before responses and diagnostic logs.

## No Generation Boundary

Stage 5 tests do not call image generation, image edit submission, video generation, image upscale, video upscale, or NewAPI generation endpoints. The automated test is a pure logic/static-contract check:

```bash
npm run test:stage5-error-diagnostics
```

The script compiles the diagnostic module, runs unit tests, checks route and UI contracts, and reports:

```json
{
  "generationEndpointsCalled": false,
  "newApiCalled": false
}
```

## Operator Use

Users see a short message, recommended action, retry hint, code, and request ID. Admins can use the code and request ID to inspect sanitized server logs without needing the user to expose prompts, uploads, or secrets.
