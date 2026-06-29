# 3107 tunnelto test runbook

This runbook is for a temporary small-scope tunnelto test only. It is not a production deployment.

Do not expose 3106. Do not point 3107 at the formal `data` or `uploads` directories.

## 1. Preflight

Run from `E:\codex工作台\p003\new-jiemian-3107`:

```powershell
npm run lint
npm run typecheck
npm run build
```

Do not continue if any check fails.

Confirm the 3107 isolated runtime values:

```dotenv
PORT=3107
DATA_DIR=data-tunneltest
UPLOADS_DIR=uploads-tunneltest
RUNTIME_STORAGE_ISOLATION=strict
TEST_INVITE_CODE=临时邀请码
VOLCENGINE_IMAGEX_OUTPUT_DOMAIN=ImageX 输出域名
VOLCENGINE_VOD_OUTPUT_DOMAIN=VOD 输出域名
```

`DATA_DIR` must not be `data`.
`UPLOADS_DIR` must not be `uploads`.
Volcengine output domains are required for HD/upscale result download. If they are not known yet, do not include HD/upscale in the tunnelto test scope.

## 2. Start 3107

Set a temporary invite code in the shell that starts 3107:

```powershell
$env:TEST_INVITE_CODE="临时邀请码"
$env:VOLCENGINE_IMAGEX_OUTPUT_DOMAIN="ImageX 输出域名"
$env:VOLCENGINE_VOD_OUTPUT_DOMAIN="VOD 输出域名"
npm run dev:tunneltest
```

`npm run dev:tunneltest` seeds the 3107 test provider copy first, then starts Next.js on `127.0.0.1:3107` with strict isolated storage:

```dotenv
PORT=3107
DATA_DIR=data-tunneltest
UPLOADS_DIR=uploads-tunneltest
RUNTIME_STORAGE_ISOLATION=strict
APP_AUTH_PERSISTENCE_MODE=json
```

Local checks:

- Open `http://127.0.0.1:3107/register`.
- Confirm `/api/providers/enabled` returns the expected model list.
- Confirm `data-tunneltest` is used for test records.
- Confirm `uploads-tunneltest` is used for generated files.

## 3. Start tunnelto

Open a second terminal while 3107 is running:

```powershell
tunnelto --host 127.0.0.1 --port 3107
```

Send only the tunnelto public URL to the small test group. Keep 3106 private.

## 4. Message For Test Users

Use this exact message:

> 这是短期测试地址，只测功能体验。请用邀请码注册测试账号。不要使用常用密码。不要上传隐私图片或敏感资料。每个账号只有少量生成额度，请重点反馈哪里报错、哪里不好用、哪里看不懂。如果遇到生成或高清失败，请点击错误提示里的“复制反馈信息”，把复制内容、页面截图、操作步骤一起发给我。

Send the temporary invite code separately.

## 5. Test Scope

Ask testers to cover:

- Register with invite code.
- Log in.
- Generate an image.
- Generate a video.
- Use image/video HD or upscale where available.
- Confirm works are saved.
- Download a work.
- Delete a work.
- Try the mobile experience.
- Report unclear or unhelpful error messages.
- For any generation/upscale error, copy the error diagnostic text and send it with a screenshot plus reproduction steps.

Feedback must include:

- Copied diagnostic text with `错误码`, `Request ID`, and `发生时间`.
- Screenshot.
- The operation steps before the error.
- Whether retrying once changed the result.

The test environment has small per-account limits. Do not ask testers to stress-test usage volume.

## 6. End The Test

After the short test:

1. Close tunnelto.
2. Stop the 3107 dev server.
3. Modify or delete `TEST_INVITE_CODE`.
4. Check NewAPI/provider call volume.
5. Export or organize tester feedback.
6. Decide whether to keep or clear:
   - `data-tunneltest`
   - `uploads-tunneltest`

If clearing test data, only clear the explicitly named test directories. Never clean `data` or `uploads` for this tunnelto test.

## 7. Safety Checklist

- 3106 was not exposed.
- 3107 used `PORT=3107`.
- 3107 used `DATA_DIR=data-tunneltest`.
- 3107 used `UPLOADS_DIR=uploads-tunneltest`.
- 3107 used `RUNTIME_STORAGE_ISOLATION=strict`.
- Registration required `TEST_INVITE_CODE`.
- tunnelto was closed after the test.
- The invite code was changed or removed after the test.
