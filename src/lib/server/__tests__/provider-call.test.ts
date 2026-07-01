import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import test from "node:test";

import { createErrorDiagnostic, logDiagnosticEvent } from "../error-diagnostics";
import { providerCallInternalsForTests } from "../provider-call";

const provider = {
  id: "provider-test",
  kind: "image",
  title: "Provider Test",
  role: "test",
  apiUrl: "https://provider.example.test/v1/images/generations",
  model: "provider-model",
  apiKey: "masked-test-key",
  enabled: true,
  endpointType: "images-generations",
} as const;

test("small valid provider JSON passes", async () => {
  const response = jsonResponse({
    data: [{ url: "https://cdn.example.test/result.png" }],
  });
  const payload = await providerCallInternalsForTests.readProviderJson(response, provider);
  const output = providerCallInternalsForTests.parseProviderOutput(payload);
  assert.equal(output.url, "https://cdn.example.test/result.png");
});

test("legal image base64 JSON above 2MiB and within 16MiB is accepted", async () => {
  const base64 = Buffer.alloc(Math.floor(2.5 * 1024 * 1024), 0xaa).toString("base64");
  const response = jsonResponse({
    data: [{ b64_json: base64 }],
  });
  const payload = await providerCallInternalsForTests.readProviderJson(response, provider);
  const output = providerCallInternalsForTests.parseProviderOutput(payload);
  assert.equal(output.base64, base64);
  assert(base64.length > 2 * 1024 * 1024);
  assert(base64.length < providerCallInternalsForTests.providerJsonDefaultLimitBytes);
});

test("oversized success JSON without content-length is rejected while streaming", async () => {
  const { response } = streamingJsonResponse({
    status: 200,
    chunks: [
      "{\"data\":[{\"b64_json\":\"",
      "a".repeat(providerCallInternalsForTests.providerJsonDefaultLimitBytes),
      "\"}]}",
    ],
  });
  await assert.rejects(() => providerCallInternalsForTests.readProviderJson(response, provider));
});

test("misleading small content-length still rejects once actual body exceeds 16MiB", async () => {
  const { response, state } = streamingJsonResponse({
    status: 200,
    headers: { "content-length": "1" },
    chunks: [
      "{\"data\":[{\"b64_json\":\"",
      "b".repeat(providerCallInternalsForTests.providerJsonDefaultLimitBytes),
      "\"}]}",
    ],
  });
  await assert.rejects(() => providerCallInternalsForTests.readProviderJson(response, provider));
  assert.equal(state.cancelled, true);
});

test("oversized error JSON is rejected at the 1MiB error limit", async () => {
  const response = jsonResponse({
    error: { message: "x".repeat(providerCallInternalsForTests.providerJsonErrorLimitBytes + 128) },
  }, { status: 500 });
  await assert.rejects(() => providerCallInternalsForTests.readProviderJson(response, provider));
});

test("reader is cancelled when JSON limit is exceeded", async () => {
  const { response, state } = streamingJsonResponse({
    status: 200,
    chunks: [
      "{\"data\":[{\"b64_json\":\"",
      "c".repeat(providerCallInternalsForTests.providerJsonDefaultLimitBytes),
      "\"}]}",
    ],
  });
  await assert.rejects(() => providerCallInternalsForTests.readProviderJson(response, provider));
  assert.equal(state.cancelled, true);
});

test("image base64 output still enforces real decoded media size limits", async () => {
  const decodedBytes = Buffer.alloc(10 * 1024 * 1024 + 1, 0xff);
  await assert.rejects(() => providerCallInternalsForTests.outputToLibrary({
    base64: decodedBytes.toString("base64"),
    mimeType: "image/png",
  }, "image", "provider-image"));
});

test("video base64 provider results are explicitly rejected", async () => {
  await assert.rejects(
    () => providerCallInternalsForTests.outputToLibrary({
      base64: Buffer.from("0000ftyp").toString("base64"),
      mimeType: "video/mp4",
    }, "video", "provider-video"),
    /视频 Base64/,
  );
});

test("image URL and video URL outputs still use normal remote-url flow", () => {
  const imagePlan = providerCallInternalsForTests.planProviderOutputStorage({
    url: "https://cdn.example.test/result.png",
    mimeType: "image/png",
  }, "image");
  const videoPlan = providerCallInternalsForTests.planProviderOutputStorage({
    url: "https://cdn.example.test/result.mp4",
    base64: Buffer.from("ignored").toString("base64"),
    mimeType: "video/mp4",
  }, "video");
  assert.deepEqual(imagePlan, {
    mode: "remote-url",
    url: "https://cdn.example.test/result.png",
    fallbackMime: "image/png",
  });
  assert.deepEqual(videoPlan, {
    mode: "remote-url",
    url: "https://cdn.example.test/result.mp4",
    fallbackMime: "video/mp4",
  });
});

test("error logs do not include oversized response bodies or base64 payloads", async () => {
  const bodySnippet = `SECRET-BODY-${createHash("sha256").update("provider-json").digest("hex")}`;
  const { response } = streamingJsonResponse({
    status: 500,
    chunks: [
      "{\"error\":{\"message\":\"",
      bodySnippet.repeat(40000),
      "\"}}",
    ],
  });
  let captured: unknown;
  try {
    await providerCallInternalsForTests.readProviderJson(response, provider);
  } catch (error) {
    captured = error;
  }
  assert(captured instanceof Error);
  const diagnostic = createErrorDiagnostic(captured, {
    requestId: "req-provider-json-log",
    providerId: provider.id,
    model: provider.model,
  });
  let logged = "";
  const original = console.error;
  console.error = (...args: unknown[]) => {
    logged += args.map((value) => String(value)).join(" ");
  };
  try {
    logDiagnosticEvent(diagnostic);
  } finally {
    console.error = original;
  }
  assert.equal(logged.includes(bodySnippet), false);
  assert.equal(logged.includes("\"error\":{\"message\""), false);
});

test("provider call tests do not leave temp upload files behind", async () => {
  const uploadsDir = process.env.UPLOADS_DIR;
  assert(uploadsDir);
  const leftovers = (await readdir(uploadsDir)).filter((name) => name.includes(".store-") || name.includes(".remote-"));
  assert.deepEqual(leftovers, []);
});

function jsonResponse(payload: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(payload), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers || {}),
    },
  });
}

function streamingJsonResponse(input: {
  status?: number;
  headers?: Record<string, string>;
  chunks: string[];
}) {
  const state = { cancelled: false };
  let index = 0;
  const response = new Response(new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index >= input.chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(Buffer.from(input.chunks[index], "utf8"));
      index += 1;
    },
    cancel() {
      state.cancelled = true;
    },
  }), {
    status: input.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(input.headers || {}),
    },
  });
  return { response, state };
}
