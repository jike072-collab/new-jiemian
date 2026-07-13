# Upstream Provider Runbook

This runbook records the non-secret upstream configuration and the practical
checks for production generation and Volcengine upscale integrations.

Purpose:

- explain what "configured" really means;
- separate repo code state from upstream console and DNS state;
- make the next production diagnosis reproducible without rediscovery.

Do not put passwords, access tokens, API keys, cookies, or full DSNs into this
document.

## Private Local References

Sensitive credentials are intentionally kept out of the repo.

Local operators should use the private, untracked operations note. That note
records where the SSH credential reference file is stored and
how the current manual production deployment is performed.

## Scope

This runbook covers the current production chain on the Ubuntu `3106` server:

- app service: `aohuang-ai`
- app host: `38.95.75.47`
- app health endpoint: `http://127.0.0.1:3106/api/health/backend`
- app repo branch used during the July 2026 production fixes:
  `codex/first-load-warmup-20260703`

It focuses on two failure-prone areas:

1. New API / upstream video generation billing metadata
2. Volcengine ImageX and VOD upscale output delivery

## The Important Distinction

Seeing an env var set does not mean the feature is truly ready.

For these integrations, "configured" has four layers:

1. repo code supports the upstream path;
2. production env contains the expected variable names and values;
3. upstream console state is enabled and points at the same identifiers;
4. the app can complete a real job and download the final file back into
   `/api/files/...`.

Video upscale has repeatedly shown why this matters: code and env can be
correct, DNS can resolve, and the final result can still fail if VOD playback
output is not actually usable by the app.

## Current Non-Secret Production Values

As verified on July 6, 2026:

| Area | Key | Current value |
| --- | --- | --- |
| ImageX | `VOLCENGINE_IMAGEX_SERVICE_ID` | `f2fi84hcvm` |
| ImageX | output domain | `f2fi84hcvm.veimagex-pub.cn-north-1.volces.com` |
| VOD | `VOLCENGINE_VOD_SPACE_NAME` | `video-2-4` |
| VOD | `VOLCENGINE_VOD_OUTPUT_DOMAIN` | `vod.aohuang888.com` |
| VOD | output proto fallback | HTTP by default |
| New API | `ModelPrice["grok-video-1.5"]` | `0.4` |

Do not treat this table as proof that the feature currently works. It is only
the last known non-secret configuration snapshot.

## Where The Code Depends On These Values

Current video upscale runtime path:

- submit upload to VOD
- `StartExecution`
- poll `GetExecution`
- when complete, try output candidates in this order:
  - `GetPlayInfo` result
  - direct URL returned by execution payload
  - URL built from `StoreUri + VOLCENGINE_VOD_OUTPUT_DOMAIN`

Current code file:

- `src/lib/server/volcengine-upscale.ts`

Important behavior in that file:

- `fileUrlFromStoreUri(...)` builds a result URL from
  `VOLCENGINE_VOD_OUTPUT_DOMAIN`
- `vodPlayInfoUrl(...)` calls VOD `GetPlayInfo`
- `refreshVideoUpscaleJob(...)` marks the item failed if none of the candidate
  URLs can be downloaded and stored locally

This means a resolvable DNS record is necessary, but still not sufficient.

## New API Video Generation Notes

One real production failure was not a user balance problem. It was a missing
price mapping in `new-api`.

Observed fix:

- `new-api` had no `ModelPrice` entry for `grok-video-1.5`
- pre-deduction then failed with an inflated fake required amount
- production fix was to set:

```json
{
  "grok-video-1.5": 0.4
}
```

Operational rule:

- if app quota looks sufficient but Grok video generation still fails before
  upstream submission, inspect `new-api` pricing metadata before changing app
  code.

## Volcengine Upscale Notes

### Image Upscale

Image upscale uses ImageX and is currently the more stable path.

What success looks like:

- library item reaches `done`
- output is written to `/var/lib/aohuang-ai/uploads/image-upscale-*.png`
- `/api/files/image-upscale-*.png` returns `200`

### Video Upscale

Video upscale uses VOD and has a second-stage delivery dependency.

What success requires:

1. VOD processing succeeds upstream
2. app can obtain at least one usable final media URL
3. app downloads that media URL and stores it locally
4. library item switches from `generating` to `done`

If step 1 succeeds but steps 2-3 fail, the app returns a user-facing error
that means:

```text
Video upscale finished upstream, but the app could not obtain a usable VOD
playback/output domain for the final media download.
```

This message can still appear even after DNS starts resolving, because the app
needs a truly usable playback/download URL, not only a hostname that answers
DNS.

## VOD DNS Record

The historically important `vod` record is:

- host record: `vod`
- type: `CNAME`
- expected value: `vod.aohuang888.com.bytevdn.com`

Known bad historical value:

```text
vod.aohuang888.com.bytevcdn.com
```

The missing `d` in `bytevdn.com` is enough to break the chain.

## Volcengine Console Observation

As observed in the Volcengine VOD console on July 6, 2026, the current domain
page for `vod.aohuang888.com` showed:

- status: `Running`
- CNAME: `vod.aohuang888.com.bytevdn.com`
- dispatch switch: enabled
- HTTPS status: `Off`

This is an important control-plane signal, but it still does not prove that the
app can fetch the final processed media URL successfully. The app-side retest
below remained failed even with the console in this state.

## Server-Side Verification Commands

Use these from the production server after any VOD or upstream console change.

### 1. Health

```bash
curl http://127.0.0.1:3106/api/health/backend
```

Expected:

- `ok: true`

### 2. Production env presence

```bash
source /etc/aohuang-ai/production.env
printf '%s\n' \
  "$VOLCENGINE_IMAGEX_SERVICE_ID" \
  "$VOLCENGINE_VOD_SPACE_NAME" \
  "$VOLCENGINE_VOD_OUTPUT_DOMAIN"
```

This only proves env presence, not end-to-end readiness.

### 3. DNS resolution

```bash
getent hosts vod.aohuang888.com
getent hosts vod.aohuang888.com.bytevdn.com
```

Expected:

- both should resolve
- `vod.aohuang888.com` should point into the `bytevdn` / `volcgslb` chain

### 4. Real output-domain probe

If you already have a real `StoreUri` from a finished VOD job:

```bash
curl -I "http://vod.aohuang888.com/<StoreUri>"
```

This is the important probe. DNS success alone is not enough.

### 5. Real app-path retest

Retest with a real user account and inspect all three layers:

- quota precheck
- `/api/upscale/video` submit
- `/api/jobs/<runId>` final status
- `/api/library` final item status

## Current Known State On July 6, 2026

Current verified facts:

- `vod.aohuang888.com` now resolves on the server
- Volcengine console shows the domain `Running` and dispatch enabled
- image upscale is working
- video generation is working
- image generation is working
- video upscale still failed in a real production retest on July 6, 2026

Deeper app-side finding from the July 6 retest:

- `GetExecution` for the failed job did return the final enhanced file metadata
  (`FileId`, `StoreUri`, width, height, duration)
- but that payload did not include an output `Vid`
- the same media remained reachable through the execution input/source `Vid`
- `UpdateMediaPublishStatus` only worked with VOD API version `2020-08-01`
  in this environment; the earlier `2023-01-01` call did not publish the media
- after publishing the source `Vid`, `GetPlayInfo` returned an `oe` MP4
  `MainPlayUrl` for the enhanced `FileId`

Operational implication:

- for video upscale, do not assume the enhanced output has its own `Vid`
- if execution output has no `Vid`, fall back to the execution input/source
  `Vid`, publish it, then call `GetPlayInfo`

## Manual Production Deploy Shape

The current production deployment pattern for `38.95.75.47` is:

1. find the current active release under `/opt/aohuang-ai/current`
2. create a new release directory under `/opt/aohuang-ai/releases/<release-id>`
   by copying the current release
3. upload only the changed runtime files into the new release
4. inside the new release, run:
   - `npm run release:preflight`
   - `npm run build`
5. repoint `/opt/aohuang-ai/current` to the new release
6. restart `aohuang-ai`
7. verify:
   - `systemctl is-active aohuang-ai`
   - `curl http://127.0.0.1:3106/api/health/backend`

This repo document stays non-secret. Any credential file locations belong only
in the private desktop note above.

Retest evidence:

- task id: `real-vid-up-6f9fa3ec425d411abb8e9688adef1d20`
- job id: `qb:e0b89e32638eece52ccfaa699420f2e5`
- library item id: `522304e0-7d16-48f7-8c8a-926ddc6db8ba`
- final app result:

```text
The app still failed after upstream processing because it could not resolve a
usable playback/output URL for the final VOD media download.
```

Interpretation:

- the old pure-DNS typo was real and was fixed;
- the Volcengine domain page now also looks healthy at the console level;
- but the production problem is not fully closed until a real video-upscale job
  reaches local stored output and `/api/files/*.mp4` returns `200`.

## Latest Production Smoke Results

### Image Generation

Real retest on July 6, 2026:

- task id: `real-image-3ad3c184997940989ec51c3511a0e831`
- library item id: `447ed393-70b3-407d-882a-b36a7f71392d`
- output file:
  `/api/files/image-77f910e1-e1b6-4afb-b61d-26b1f72d7209.png`
- final status: `done`
- file availability: true
- file endpoint check: `200 image/png`

This confirms the current image generation path is working in production.

### Grok Video 1.0

Previously confirmed successful real run on July 6, 2026:

- task id: `real-video10-a5cd395d0de94a0aa59e4341fbf4932e`
- library item id: `6a5841fd-d752-426a-a19b-21b1c8b7d809`
- output file:
  `/api/files/video-9bdca655-fdde-4786-a6b0-842c02475a14.mp4`
- final status: `done`
- file endpoint check: `200 video/mp4`

Follow-up operational notes from the same day:

- a fresh `4` second / `16:9` Grok 1.0 submit currently needs an
  `estimatedQuotaUnits` value of `80`
- using a mismatched precheck value will fail closed with:
  `Task billing precheck does not match the generation request.`
- after the latest image retest, the current test account balance dropped to
  `68`, which is below the `80` units needed for a new `4` second Grok 1.0
  retest

Do not treat a `402` precheck failure here as an upstream model failure unless
the account has at least `80` available units and the request fingerprint
matches the final submit payload exactly.

### Video Upscale

Latest real retest after the Volcengine domain page showed `Running`:

- task id: `real-vid-up-80af73570648402992070d64b510731e`
- job id: `hb:34b291eaf21a99925f0e3b811333b816`
- library item id: `b303f28e-7e7a-4c05-88b4-10bee99f9923`
- final app result:

```text
Upstream processing completed, but the app still could not fetch a usable final
media URL from the VOD output/playback path.
```

This retest is the strongest current evidence that the remaining blocker is not
just DNS-record text or the visible domain status in the Volcengine console.

## Next Debug Order When Video Upscale Fails Again

1. confirm health and current env values;
2. confirm `vod.aohuang888.com` DNS from the server;
3. confirm VOD console shows the playback/output domain as active;
4. inspect the finished VOD execution result and whether `GetPlayInfo` returns a
   usable mp4 URL;
5. test `http://vod.aohuang888.com/<StoreUri>` directly;
6. only after those checks consider changing app code.

## Rule Of Thumb

Do not say "already configured" unless all of the following are true:

- env value exists;
- DNS resolves correctly;
- VOD console shows the domain usable;
- one real video-upscale task stores a local result file successfully.
