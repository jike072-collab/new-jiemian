# 3107 Manual Test Checklist

Use this checklist on the development computer only. Port 3107 is for local
optimization, automated checks, and manual acceptance. Do not deploy 3107 to the
server. The server production runtime remains 3106 only.

## Setup

- Confirm the branch under test is `chore/server-production-prep` or the reviewed
  branch produced from it.
- Start local staging on port 3107 with isolated `DATA_DIR` and `UPLOADS_DIR`
  such as `data-staging` and `uploads-staging`.
- Confirm no real production secrets are displayed in the terminal, browser, or
  admin UI.
- Confirm 3106 server deployment is not started or modified during this test.

## Account And Session

- Register a new local test account.
- Log in with the new test account.
- Refresh the page and confirm the session remains active.
- Log out and confirm protected pages or APIs require login again.

## Studio Workflows

- Generate an image and confirm the result renders in the workspace.
- Generate a video and confirm task status updates until completion or a safe
  failure message appears.
- Edit an image with at least one uploaded reference image.
- Run image upscale through the current image high-definition workflow.
- Run video upscale through the current video high-definition workflow.
- Confirm the UI labels use "image high-definition enhancement", "video
  high-definition enhancement", or "high-definition enhancement" wording and do
  not show retired local executable provider labels.

## Library And Media

- Open the library and confirm generated image, generated video, edited image,
  image upscale, and video upscale records are visible to the owning user.
- Download a generated image and a generated video.
- Delete a work manually and confirm it disappears immediately.
- Confirm manual deletion does not affect another user's library.
- Confirm each work clearly shows the 24-hour retention notice.
- Confirm work cards or details show an expected expiration time without a
  per-second countdown.

## Upload Limits

- Select a video file over the configured local video limit and confirm the
  client rejects it before submission.
- Confirm the message matches the application limit, for example "video cannot
  exceed 200MB" when the default 200 MiB limit is active.
- Try an unsupported media type and confirm the client or server rejects it with
  a clear safe message.

## Billing And Recovery

- Confirm credits are deducted for successful billable tasks according to the
  existing pricing.
- Force or observe a safe provider failure and confirm credits are not left in an
  inconsistent deducted state.
- Confirm failed task messages do not expose provider raw responses, keys, stack
  traces, or local file paths.

## Admin

- Open the admin provider page while unauthorized and confirm access is rejected.
- Log in as an authorized admin and confirm provider rows load.
- Confirm ImageX and VOD upscale providers are represented as current Volcengine
  configuration, not retired local executable configuration.
- Confirm provider health checks do not trigger generation or paid provider calls.

## Layout

- Check the main studio on a desktop-width viewport.
- Check login, register, studio, library, and admin basics on a phone-width
  viewport.
- Confirm text does not overlap buttons, cards, or media previews.

## Final Owner Signoff

- Record the tested commit hash.
- Record whether real provider test calls were intentionally made by the owner.
- Record any failed item before merge review.
- Do not merge to `main` until local 3107 manual acceptance is complete and code
  review has approved the branch.
