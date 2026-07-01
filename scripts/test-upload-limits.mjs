#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const outDir = join(root, "dist", "upload-limits-tests");
const tempRoot = mkdtempSync(join(tmpdir(), "aohuang-upload-limits-"));

let status = 0;
try {
  if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true });
  const compile = spawnSync("npx", ["tsc", "-p", "tsconfig.upload-limits-tests.json"], {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (compile.status !== 0) {
    status = compile.status ?? 1;
  } else {
    const mediaUploadGuardTestFile = [
      "dist/upload-limits-tests/src/lib/server/__tests__/media-upload-guard.test.js",
      "dist/upload-limits-tests/server/__tests__/media-upload-guard.test.js",
    ].find((candidate) => existsSync(join(root, candidate)));
    const remoteMediaDownloadTestFile = [
      "dist/upload-limits-tests/src/lib/server/__tests__/remote-media-download.test.js",
      "dist/upload-limits-tests/server/__tests__/remote-media-download.test.js",
    ].find((candidate) => existsSync(join(root, candidate)));
    assert(mediaUploadGuardTestFile, "compiled upload limit test file must exist");
    assert(remoteMediaDownloadTestFile, "compiled remote media download test file must exist");
    const run = spawnSync("node", ["--conditions=react-server", "--test", mediaUploadGuardTestFile, remoteMediaDownloadTestFile], {
      cwd: root,
      env: {
        ...process.env,
        PORT: "3107",
        AOHUANG_ALLOW_RUNTIME_DIR_OVERRIDE: "1",
        RUNTIME_STORAGE_ISOLATION: "strict",
        DATA_DIR: join(tempRoot, "data"),
        UPLOADS_DIR: join(tempRoot, "uploads"),
        MEDIA_IMAGE_UPLOAD_LIMIT_MIB: "1",
      },
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    status = run.status ?? 1;
  }

  const sources = {
    studioApp: read("src/components/studio-app.tsx"),
    constants: read("src/components/studio/constants.ts"),
    uploadLimits: read("src/lib/upload-limits.ts"),
    mediaUploadGuard: read("src/lib/server/media-upload-guard.ts"),
    volcengineUpscale: read("src/lib/server/volcengine-upscale.ts"),
  };
  assert(sources.uploadLimits.includes("videoUploadDefaultMiB = 200"), "video default upload cap must be 200MiB");
  assert(sources.uploadLimits.includes("uploadHardCapMiB = 256"), "video hard upload cap must be 256MiB");
  assert(sources.constants.includes("defaultPublicUploadLimits"), "client constants must use centralized upload defaults");
  assert(sources.studioApp.includes("视频高清增强文件不能超过 ${limit.label}"), "client prompt must use centralized limit label");
  assertSequence("video upscale rejects size before header and full read", sources.volcengineUpscale, [
    "assertFileSizeAllowed(value, uploadKind)",
    "await assertFileFormatAllowed(value, uploadKind)",
    "Buffer.from(await value.arrayBuffer())",
  ]);
  assert(!sources.studioApp.includes("视频高清增强文件不能超过 1GB"), "client must not advertise 1GB video uploads");
  assert(!sources.volcengineUpscale.includes("1024 * 1024 * 1024"), "server must not keep 1GB video upload cap");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

if (status !== 0) process.exit(status);

console.log(JSON.stringify({
  ok: true,
  videoDefaultMiB: 200,
  videoHardCapMiB: 256,
  oversizedRejectedBeforeBuffer: true,
  illegalMimeRejected: true,
  generationEndpointsCalled: false,
  realProviderCalled: false,
}, null, 2));

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function assertSequence(name, source, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert(index > cursor, `${name} missing or reordered token: ${token}`);
    cursor = index;
  }
}
