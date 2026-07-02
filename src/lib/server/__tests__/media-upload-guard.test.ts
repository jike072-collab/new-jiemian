import assert from "node:assert/strict";
import test from "node:test";

import {
  bytesFromMiB,
  mediaUploadPolicies,
  resolveLoweredUploadLimitBytes,
} from "../../upload-limits";
import { createErrorDiagnostic, GenerationDiagnosticError } from "../error-diagnostics";
import {
  assertFileFormatAllowed,
  assertFileSizeAllowed,
  currentUploadLimitBytes,
} from "../media-upload-guard";

const previousImageLimit = process.env.MEDIA_IMAGE_UPLOAD_LIMIT_MIB;
const previousVideoLimit = process.env.MEDIA_VIDEO_UPLOAD_LIMIT_MIB;

test.afterEach(() => {
  restoreEnv();
});

test("199MiB video upscale input is within the 200MiB default", () => {
  restoreEnv();
  const limit = currentUploadLimitBytes("video-upscale");
  assert.equal(limit, bytesFromMiB(200));
  assert.equal(bytesFromMiB(199) <= limit, true);
});

test("video upscale input over 200MiB is rejected before full Buffer allocation", () => {
  restoreEnv();
  const file = fileLike({
    name: "clip.mp4",
    type: "video/mp4",
    size: bytesFromMiB(200) + 1,
    header: mp4Header(),
  });
  assert.throws(
    () => assertFileSizeAllowed(file, "video-upscale"),
    (error) => error instanceof GenerationDiagnosticError
      && error.code === "INPUT_FILE_TOO_LARGE"
      && error.publicMessage === "视频不能超过200MB。"
      && file.fullReadCount === 0,
  );
});

test("configuration above the hard cap falls back to the safe default", () => {
  process.env.MEDIA_VIDEO_UPLOAD_LIMIT_MIB = "300";
  assert.equal(currentUploadLimitBytes("video-upscale"), bytesFromMiB(200));
  assert.equal(
    resolveLoweredUploadLimitBytes(300, mediaUploadPolicies["video-upscale"]),
    bytesFromMiB(200),
  );
});

test("server env can lower but not raise the video upload limit", () => {
  process.env.MEDIA_VIDEO_UPLOAD_LIMIT_MIB = "128";
  assert.equal(currentUploadLimitBytes("video-upscale"), bytesFromMiB(128));
  process.env.MEDIA_VIDEO_UPLOAD_LIMIT_MIB = "220";
  assert.equal(currentUploadLimitBytes("video-upscale"), bytesFromMiB(200));
});

test("illegal MIME extension and signature are rejected with safe diagnostics", async () => {
  const wrongMime = fileLike({
    name: "clip.mp4",
    type: "application/octet-stream",
    size: 16,
    header: mp4Header(),
  });
  await assert.rejects(
    () => assertFileFormatAllowed(wrongMime, "video-upscale"),
    (error) => error instanceof GenerationDiagnosticError
      && error.code === "INPUT_UNSUPPORTED_FORMAT"
      && error.publicMessage === "视频高清增强仅支持 MP4、WebM 和 MOV。",
  );

  const wrongExtension = fileLike({
    name: "clip.txt",
    type: "video/mp4",
    size: 16,
    header: mp4Header(),
  });
  await assert.rejects(() => assertFileFormatAllowed(wrongExtension, "video-upscale"), GenerationDiagnosticError);

  const wrongSignature = fileLike({
    name: "clip.mp4",
    type: "video/mp4",
    size: 16,
    header: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]),
  });
  await assert.rejects(() => assertFileFormatAllowed(wrongSignature, "video-upscale"), GenerationDiagnosticError);
});

test("format check reads only the header slice", async () => {
  const file = fileLike({
    name: "clip.mp4",
    type: "video/mp4",
    size: bytesFromMiB(199),
    header: mp4Header(),
  });
  const mimeType = await assertFileFormatAllowed(file, "video-upscale");
  assert.equal(mimeType, "video/mp4");
  assert.equal(file.sliceReadCount, 1);
  assert.equal(file.fullReadCount, 0);
});

test("diagnostic output does not include file content", () => {
  const diagnostic = createErrorDiagnostic(new GenerationDiagnosticError({
    code: "INPUT_UNSUPPORTED_FORMAT",
    publicMessage: "视频高清增强仅支持 MP4、WebM 和 MOV。",
    safeDetails: {
      kind: "video-upscale",
      mimeType: "application/octet-stream",
      extension: ".txt",
    },
  }));
  const serialized = JSON.stringify(diagnostic);
  assert.equal(serialized.includes("raw-file-content"), false);
  assert.equal(diagnostic.message, "视频高清增强仅支持 MP4、WebM 和 MOV。");
});

function restoreEnv() {
  if (previousImageLimit === undefined) delete process.env.MEDIA_IMAGE_UPLOAD_LIMIT_MIB;
  else process.env.MEDIA_IMAGE_UPLOAD_LIMIT_MIB = previousImageLimit;
  if (previousVideoLimit === undefined) delete process.env.MEDIA_VIDEO_UPLOAD_LIMIT_MIB;
  else process.env.MEDIA_VIDEO_UPLOAD_LIMIT_MIB = previousVideoLimit;
}

function mp4Header() {
  return new Uint8Array([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70,
    0x69, 0x73, 0x6f, 0x6d,
    0x00, 0x00, 0x02, 0x00,
  ]);
}

class CountingBlob extends Blob {
  readonly #onRead: () => void;

  constructor(bytes: Uint8Array, onRead: () => void) {
    super([arrayBufferFromBytes(bytes)]);
    this.#onRead = onRead;
  }

  override async arrayBuffer() {
    this.#onRead();
    return super.arrayBuffer();
  }
}

class CountingFile extends File {
  readonly #declaredSize: number;
  readonly #header: Uint8Array;
  fullReadCount = 0;
  sliceReadCount = 0;

  constructor(input: {
    name: string;
    type: string;
    size: number;
    header: Uint8Array;
  }) {
    super([arrayBufferFromBytes(input.header)], input.name, { type: input.type });
    this.#declaredSize = input.size;
    this.#header = input.header;
  }

  override get size() {
    return this.#declaredSize;
  }

  override slice() {
    return new CountingBlob(this.#header, () => {
      this.sliceReadCount += 1;
    });
  }

  override async arrayBuffer() {
    this.fullReadCount += 1;
    return new ArrayBuffer(0);
  }
}

function fileLike(input: {
  name: string;
  type: string;
  size: number;
  header: Uint8Array;
}) {
  return new CountingFile(input);
}

function arrayBufferFromBytes(bytes: Uint8Array) {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}
