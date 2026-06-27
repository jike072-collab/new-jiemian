# Provider Model Health

Stage 8A adds a read-only provider and model health view for administrators. It helps verify whether the configured providers are present, whether required model fields are filled, and whether the NewAPI integration is configured. External provider model-list probing is skipped by default and requires separate authorization.

## What It Does

- Lists configured providers in the admin provider page.
- Reports endpoint, API key, model, supported tool, warning, and error status.
- Summarizes model coverage for image generation, image editing, video generation, image upscale, and video upscale.
- Reports NewAPI as configured or missing without exposing credentials.
- Uses masked hosts, masked key previews, and redacted error details.

## What It Does Not Do

- It does not call image generation.
- It does not submit image edits.
- It does not call video generation.
- It does not submit image or video upscale jobs.
- It does not mutate provider configuration.
- It does not change PostgreSQL, firewall, NewAPI, HTTPS, reverse proxy, or network binding settings.
- It does not publish or restart 3106.

## Why It Does Not Produce Cost

The default static check reads local configuration only. The Stage 8A model configuration check also stays local by default and reports external model-list probing as skipped. No prompt, image, video, upload body, generation request, upscale request, NewAPI generation request, or provider `/models` request is sent unless a future task separately authorizes that external probe.

## Checked Configuration

- Provider id, name, enabled state, endpoint type, and endpoint URL shape.
- Provider authentication presence without returning the secret value.
- Model field presence for supported tool types.
- Local model field presence for OpenAI-compatible and upscale provider rows; external provider `/models` reads are skipped by default.
- NewAPI enabled/base URL/admin credential presence, with external connection probing skipped by default.

## Normal Results

- `configured=true` means the provider has a valid endpoint, authentication is present, and required model fields for its supported tools are filled.
- `reachable=unchecked` means no external connectivity check was requested.
- `reachable=reachable` means the low-cost connectivity check succeeded.
- `available=unknown` with `reachable=skipped` means Stage 8A did not call the external provider model-list endpoint.

## Results Requiring Configuration

- Missing endpoint, API key, or model fields indicate that the frontend generation flow may fail until the admin completes provider configuration.
- `available=no` means the configured model was not present in the read-only model list.
- `reachable=unreachable` means the endpoint could not be reached by the safe connectivity check.
- NewAPI `configured=false` means the NewAPI integration is not configured for admin-side features.

## Redaction

The health report never returns raw provider API keys, `ADMIN_PASSWORD`, `APP_DATABASE_URL`, `NEW_API_ADMIN_ACCESS_TOKEN`, authorization headers, cookies, or complete connection strings. Error details are trimmed and redacted before being included in reports or tests.

## Future Live Smoke Tests

A future externally authorized probe can read provider model-list endpoints, and a separate live generation smoke test can verify end-to-end generation by submitting a tiny controlled request. Both are intentionally outside Stage 8A. Any real provider probe or generation smoke test must be separately authorized because it can touch external provider paths and may create usage costs.
