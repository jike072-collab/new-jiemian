#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const studioApp = read("src/components/studio-app.tsx");
const libraryView = read("src/components/studio/library-view.tsx");
const imageGenerator = read("src/components/studio/image-generator.tsx");
const videoGenerator = read("src/components/studio/video-generator.tsx");
const upscaleForm = read("src/components/studio/upscale-form.tsx");
const resultPreview = read("src/components/studio/result-preview.tsx");
const types = read("src/components/studio/types.ts");
const constants = read("src/components/studio/constants.ts");
const clientApi = read("src/lib/client/api.ts");
const uploadLimits = read("src/lib/upload-limits.ts");
const mediaUploadGuard = read("src/lib/server/media-upload-guard.ts");
const providerCall = read("src/lib/server/provider-call.ts");
const volcengineUpscale = read("src/lib/server/volcengine-upscale.ts");
const library = read("src/lib/server/library.ts");

const contracts = [
  {
    name: "library read",
    source: studioApp,
    checks: [
      "\"/api/library\"",
      "jsonFetch<{ items: LibraryItem[] }>",
      "setLibrary(data.items)",
    ],
  },
  {
    name: "library delete",
    source: studioApp,
    checks: [
      "\"/api/library\"",
      "method: \"DELETE\"",
      "headers: { \"Content-Type\": \"application/json\" }",
      "body: JSON.stringify({ id })",
      "await refreshLibrary()",
    ],
  },
  {
    name: "image generation",
    source: studioApp,
    checks: [
      "\"/api/quota/precheck\"",
      "operation: \"cloud_image_generation\"",
      "\"/api/generate/image\"",
      "method: \"POST\"",
      "form.set(\"providerId\", selectedImageProvider.id)",
      "form.set(\"mode\", activeImageMode)",
      "form.set(\"ratio\", imageWorkspace.ratio)",
      "form.set(\"quality\", imageWorkspace.quality)",
      "form.set(\"prompt\", imageWorkspace.prompt)",
      "form.set(\"taskId\", taskId)",
      "form.set(\"idempotencyKey\", taskId)",
      "form.set(\"estimatedQuotaUnits\", String(estimatedQuotaUnitsPerImage))",
      "form.append(\"files\", attachment.file)",
      "handleImageResult(data.item)",
    ],
  },
  {
    name: "video generation",
    source: studioApp,
    checks: [
      "operation: \"cloud_video_generation\"",
      "\"/api/generate/video\"",
      "method: \"POST\"",
      "form.set(\"providerId\", selectedVideoProvider.id)",
      "form.set(\"mode\", activeVideoMode)",
      "form.set(\"ratio\", videoWorkspace.ratio)",
      "form.set(\"duration\", String(videoWorkspace.duration))",
      "form.set(\"prompt\", videoWorkspace.prompt)",
      "form.set(\"taskId\", taskId)",
      "form.set(\"idempotencyKey\", taskId)",
      "form.set(\"estimatedQuotaUnits\", String(estimatedQuotaUnits))",
      "form.append(\"files\", attachment.file)",
      "handleVideoResult(data.item, data.job)",
    ],
  },
  {
    name: "image upscale",
    source: studioApp,
    checks: [
      "\"/api/upscale/status\"",
      "\"/api/upscale/image\"",
      "method: \"POST\"",
      "form.set(\"file\", currentFile.file)",
      "form.set(\"scale\", imageUpscaleWorkspace.scale)",
      "{ item: LibraryItem; job: JobRecord | null }",
      "await refreshLibrary()",
    ],
  },
  {
    name: "video upscale",
    source: studioApp,
    checks: [
      "\"/api/upscale/video\"",
      "method: \"POST\"",
      "form.set(\"file\", currentFile.file)",
      "form.set(\"scale\", videoUpscaleWorkspace.scale)",
      "updateVideoUpscaleWorkspace({ job: data.job })",
      "await refreshLibrary()",
    ],
  },
  {
    name: "job polling",
    source: studioApp,
    checks: [
      "`/api/jobs/${job.id}`",
      "jsonFetch<{ job: JobRecord | null }>",
      "const libraryData = await jsonFetch<{ items: LibraryItem[] }>(\"/api/library\")",
    ],
  },
  {
    name: "providers and health route references",
    source: `${studioApp}\n${read("scripts/studio-ui-test-utils.mjs")}\n${read("scripts/test-stage3-studio-regression.mjs")}`,
    checks: [
      "\"/api/providers/enabled\"",
      "\"/api/health/backend\"",
      "\"/admin/providers\"",
    ],
  },
];

for (const contract of contracts) {
  for (const token of contract.checks) {
    assert(contract.source.includes(token), `${contract.name} contract missing token: ${token}`);
  }
}

assertSequence("library delete confirmation order", studioApp, [
  "setLibraryDeleteConfirmItemId(id)",
  "const handleConfirmDeleteLibraryItem",
  "await jsonFetch(\"/api/library\"",
]);
const requestDeleteStart = studioApp.indexOf("const handleRequestDeleteLibraryItem");
const requestDeleteEnd = studioApp.indexOf("const handleCancelDeleteLibraryItem", requestDeleteStart);
assert(requestDeleteStart >= 0 && requestDeleteEnd > requestDeleteStart, "delete request handler boundary exists");
const requestDeleteBody = studioApp.slice(requestDeleteStart, requestDeleteEnd);
assert(!requestDeleteBody.includes("jsonFetch(\"/api/library\""), "delete request must not call DELETE before confirmation");
assert(libraryView.includes("LibraryDeleteConfirmDialog"), "delete confirmation dialog export exists");
assert(libraryView.includes("onClick={onCancel}"), "delete confirmation cancel path exists");
assert(libraryView.includes("onClick={onConfirm}"), "delete confirmation confirm path exists");
assert(libraryView.includes("studio-library-confirm"), "delete confirmation className exists");

const uiContracts = [
  [imageGenerator, "reference-image-input"],
  [imageGenerator, "PromptBox"],
  [imageGenerator, "SubmitButton"],
  [videoGenerator, "video-first-frame-input"],
  [videoGenerator, "VideoPromptBox"],
  [videoGenerator, "SubmitButton"],
  [upscaleForm, "image-upscale-input"],
  [upscaleForm, "video-upscale-input"],
  [upscaleForm, "ModeSegmentedControl"],
  [resultPreview, "ImagePreviewPanel"],
  [resultPreview, "VideoPreviewPanel"],
  [resultPreview, "ImageUpscalePreviewPanel"],
  [resultPreview, "VideoUpscalePreviewPanel"],
  [resultPreview, "OutputPanel"],
  [types, "BusinessToolId = \"image\" | \"video\" | \"image-upscale\" | \"video-upscale\" | \"library\""],
  [constants, "imageWorkspaceModeMeta"],
  [constants, "videoWorkspaceModeMeta"],
];

for (const [source, token] of uiContracts) {
  assert(source.includes(token), `Studio UI contract missing token: ${token}`);
}

for (const [sourceName, source] of [
  ["studio app", studioApp],
  ["studio constants", constants],
  ["provider call", providerCall],
  ["volcengine upscale", volcengineUpscale],
]) {
  assert(!source.includes("1024 * 1024 * 1024"), `${sourceName} must not keep a 1GB upload magic number`);
  assert(!source.includes("25 * 1024 * 1024"), `${sourceName} must not keep the old 25MiB image upscale limit`);
}

assert(uploadLimits.includes("videoUploadDefaultMiB = 200"), "video upload default must be centralized at 200MiB");
assert(uploadLimits.includes("uploadHardCapMiB = 256"), "upload hard cap must be centralized at 256MiB");
assert(uploadLimits.includes("recommendedNginxClientMaxBodySize"), "upload limits must expose a Nginx body-size reference");
assert(constants.includes("defaultPublicUploadLimits"), "client upload limits must import shared defaults");
assert(clientApi.includes("record.message || record.error || record.detail"), "client must surface server public diagnostic messages");
assert(studioApp.includes("setUploadLimits"), "client must accept server-reported lowered upload limits");
assert(studioApp.includes("createVideoUpscaleFile(files, uploadLimits.videoUpscale)"), "video upscale file chooser must use the current shared limit");
assert(studioApp.includes("视频高清增强文件不能超过 ${limit.label}"), "video upscale client error must use the shared limit label");
assert(types.includes("uploadLimits?: Pick<PublicUploadLimits"), "upscale status response must carry public upload limits");
assert(volcengineUpscale.includes("uploadLimits: {"), "upscale status route must return app upload limits");
assert(mediaUploadGuard.includes("MEDIA_VIDEO_UPLOAD_LIMIT_MIB"), "server must allow lowering the video upload cap via safe env");
assert(uploadLimits.includes("candidate > policy.hardCapBytes"), "server env limit above hard cap must not take effect");
assertSequence("upscale upload validation before Buffer allocation", volcengineUpscale, [
  "assertFileSizeAllowed(value, uploadKind)",
  "await assertFileFormatAllowed(value, uploadKind)",
  "Buffer.from(await value.arrayBuffer())",
]);
assertSequence("generation image upload validation before Buffer allocation", providerCall, [
  "assertFileSizeAllowed(file, \"reference-image\")",
  "await assertFileFormatAllowed(file, \"reference-image\")",
  "Buffer.from(await file.arrayBuffer())",
]);
assertSequence("authenticated video download delegates to streamed bounded storage", providerCall, [
  "storeRemoteUrlStreamed(url,",
  "headers: authHeaders(provider)",
]);
assertSequence("remote library download delegates to streamed bounded storage", library, [
  "return storeRemoteUrlStreamed(url, { prefix, fallbackMime })",
]);
assert(!providerCall.includes("sourceUrl: output.url"), "provider-call must not fall back to raw provider output URLs");
assert(!providerCall.includes("sourceUrl: outputUrl"), "provider-call must not expose provider output URLs through completed jobs");
assert(!providerCall.includes("sourceUrl: contentUrl"), "provider-call must not expose provider content URLs through completed jobs");

const forbiddenCiBypass = read(".github/workflows/ci.yml");
assert(!forbiddenCiBypass.includes("continue-on-error: true"), "CI must not hide Stage 3 failures with continue-on-error.");
assert(!forbiddenCiBypass.includes("|| true"), "CI must not hide Stage 3 failures with || true.");

console.log(JSON.stringify({
  ok: true,
  studioModes: 6,
  endpointContracts: contracts.length,
  generationEndpointsCalled: false,
  newApiCalled: false,
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
