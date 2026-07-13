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

test("provider output prefers explicit video result URLs over generic status URLs", async () => {
  const response = jsonResponse({
    data: [{ url: "https://api.example.test/generated/item-status" }],
    url: "https://api.example.test/generated/status-page",
    video_url: "https://video.example.test/result.mp4",
  });
  const payload = await providerCallInternalsForTests.readProviderJson(response, provider);
  const output = providerCallInternalsForTests.parseProviderOutput(payload);
  assert.equal(output.url, "https://video.example.test/result.mp4");
});

test("provider output prefers nested video media URL over nested proxy result URL", async () => {
  const response = jsonResponse({
    status: "completed",
    data: {
      data: {
        result_url: "https://api.example.test/generated/proxy-result.mp4",
      },
      video_url: "https://video.example.test/direct-result.mp4",
    },
  });
  const payload = await providerCallInternalsForTests.readProviderJson(response, provider);
  const output = providerCallInternalsForTests.parseProviderOutput(payload);
  assert.equal(output.url, "https://video.example.test/direct-result.mp4");
});

test("provider output does not treat status_url as media output", async () => {
  const response = jsonResponse({
    status_url: "https://provider.example.test/tasks/task-id",
    data: {
      image_url: "https://cdn.example.test/result.png",
    },
  });
  const payload = await providerCallInternalsForTests.readProviderJson(response, provider);
  const output = providerCallInternalsForTests.parseProviderOutput(payload);
  assert.equal(output.url, "https://cdn.example.test/result.png");
  assert.equal(output.statusUrl, "https://provider.example.test/tasks/task-id");
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

test("img2 special request format is only used for legacy image4k models", () => {
  assert.equal(providerCallInternalsForTests.isImg2ImageProvider({
    ...provider,
    id: "image-img2-4k",
    model: "gpt-image-2",
  }), false);
  assert.equal(providerCallInternalsForTests.isImg2ImageProvider({
    ...provider,
    id: "image-img2-4k",
    model: "image4k",
  }), true);
});

test("OpenAI-compatible image edits send every reference as image[]", async () => {
  const originalFetch = globalThis.fetch;
  const captured: { body?: FormData } = {};
  globalThis.fetch = (async (_url, init) => {
    captured.body = init?.body as FormData;
    return jsonResponse({ data: [{ url: "https://cdn.example.test/merged.png" }] });
  }) as typeof fetch;
  try {
    await providerCallInternalsForTests.callImageProviderOnce({
      provider: {
        ...provider,
        apiUrl: "https://provider.example.test/v1/images/generations",
        model: "banana-img2",
      },
      prompt: "place the product into the scene",
      ratio: "4:3",
      quality: "1k",
      files: [
        { bytes: Buffer.from("product"), mimeType: "image/png", fileName: "product.png" },
        { bytes: Buffer.from("scene"), mimeType: "image/png", fileName: "scene.png" },
      ],
      count: 1,
    });
    assert.equal(captured.body?.getAll("image[]").length, 2);
    assert.equal(captured.body?.has("image"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GetToken Banana2 submits and polls the documented task endpoints", async () => {
  const getTokenProvider = {
    ...provider,
    id: "image-gettoken-banana::model::banana2",
    apiUrl: "https://nb.gettoken.cn/openapi/v1",
    model: "banana2",
    endpointType: "gettoken-banana",
  } as const;
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: Record<string, unknown>; authorization: string }> = [];
  globalThis.fetch = (async (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body || "{}")),
      authorization: new Headers(init?.headers).get("authorization") || "",
    });
    if (requests.length === 1) return jsonResponse({ taskId: "banana-task-1", status: "RUNNING", results: null });
    return jsonResponse({
      taskId: "banana-task-1",
      status: "SUCCESS",
      results: [{ url: "https://cdn.example.test/banana2.png", outputType: "png" }],
    });
  }) as typeof fetch;
  try {
    const outputs = await providerCallInternalsForTests.callGetTokenBananaProvider({
      provider: getTokenProvider,
      prompt: "green product on white background",
      ratio: "1:1",
      quality: "1k",
      files: [],
      count: 1,
    });
    assert.equal(outputs[0]?.url, "https://cdn.example.test/banana2.png");
    assert.equal(outputs[0]?.jobId, "banana-task-1");
    assert.equal(requests[0]?.url, "https://nb.gettoken.cn/openapi/v1/banana2/text-to-image");
    assert.equal(requests[1]?.url, "https://nb.gettoken.cn/openapi/v1/query");
    assert.equal(requests[0]?.body.resolution, "1k");
    assert.equal(requests[0]?.body.aspectRatio, "1:1");
    assert.equal(requests[1]?.body.taskId, "banana-task-1");
    assert.equal(requests[0]?.authorization, "Bearer masked-test-key");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GetToken Banana Pro image edit sends 4K and reference data URIs", async () => {
  const getTokenProvider = {
    ...provider,
    id: "image-gettoken-banana::model::banana-pro",
    apiUrl: "https://nb.gettoken.cn/openapi/v1",
    model: "banana-pro",
    endpointType: "gettoken-banana",
  } as const;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (url, init) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(String(init?.body || "{}"));
    return jsonResponse({
      taskId: "banana-pro-task-1",
      status: "SUCCESS",
      results: [{ url: "https://cdn.example.test/banana-pro.png", outputType: "png" }],
    });
  }) as typeof fetch;
  try {
    const outputs = await providerCallInternalsForTests.callGetTokenBananaProvider({
      provider: getTokenProvider,
      prompt: "keep composition and improve materials",
      ratio: "16:9",
      quality: "4k",
      files: [{ bytes: Buffer.from("image-bytes"), mimeType: "image/png", fileName: "reference.png" }],
      count: 1,
    });
    assert.equal(outputs[0]?.url, "https://cdn.example.test/banana-pro.png");
    assert.equal(requestedUrl, "https://nb.gettoken.cn/openapi/v1/banana_pro/image-to-image");
    assert.equal(requestedBody.resolution, "4k");
    assert.deepEqual(requestedBody.imageUrls, [`data:image/png;base64,${Buffer.from("image-bytes").toString("base64")}`]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GetToken retries only the failed image when upstream capacity is temporarily unavailable", async () => {
  const getTokenProvider = {
    ...provider,
    id: "image-gettoken-banana::model::banana2",
    apiUrl: "https://nb.gettoken.cn/openapi/v1",
    model: "banana2",
    endpointType: "gettoken-banana",
  } as const;
  const originalFetch = globalThis.fetch;
  let submitCount = 0;
  globalThis.fetch = (async (url) => {
    if (String(url).endsWith("/banana2/text-to-image")) {
      submitCount += 1;
      if (submitCount === 1) {
        return jsonResponse({
          taskId: "banana-capacity-failure",
          status: "FAILED",
          failedReason: { message: "all channels failed: status 599 No available account" },
        });
      }
      return jsonResponse({
        taskId: "banana-retry-success",
        status: "SUCCESS",
        results: [{ url: "https://cdn.example.test/banana-retry.png" }],
      });
    }
    throw new Error(`Unexpected URL: ${String(url)}`);
  }) as typeof fetch;
  try {
    const outputs = await providerCallInternalsForTests.callGetTokenBananaProvider({
      provider: getTokenProvider,
      prompt: "retry capacity test",
      ratio: "1:1",
      quality: "1k",
      files: [],
      count: 1,
    });
    assert.equal(outputs[0]?.url, "https://cdn.example.test/banana-retry.png");
    assert.equal(submitCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("batch image generation retries once when upstream returns fewer outputs than requested", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return jsonResponse({
        data: [
          { url: "https://cdn.example.test/result-1.png" },
          { url: "https://cdn.example.test/result-2.png" },
          { url: "https://cdn.example.test/result-3.png" },
        ],
      });
    }
    return jsonResponse({
      data: [
        { url: "https://cdn.example.test/result-4.png" },
      ],
    });
  }) as typeof fetch;
  try {
    const outputs = await providerCallInternalsForTests.collectImageProviderOutputs({
      provider,
      prompt: "test prompt",
      ratio: "1:1",
      quality: "1k",
      files: [],
      count: 4,
    });
    assert.equal(callCount, 2);
    assert.equal(outputs.length, 4);
    assert.deepEqual(outputs.map((item) => item.url), [
      "https://cdn.example.test/result-1.png",
      "https://cdn.example.test/result-2.png",
      "https://cdn.example.test/result-3.png",
      "https://cdn.example.test/result-4.png",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image generation retries transient failures without switching to fallback credentials", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  const authorizationHeaders: string[] = [];
  globalThis.fetch = (async (_input, init) => {
    callCount += 1;
    authorizationHeaders.push(new Headers(init?.headers).get("authorization") || "");
    return jsonResponse({ error: { message: "primary unavailable" } }, { status: 503 });
  }) as typeof fetch;
  try {
    await assert.rejects(() => providerCallInternalsForTests.collectImageProviderOutputs({
      provider: {
        ...provider,
        fallbackApiKey: "fallback-key-should-not-be-used",
      },
      prompt: "test prompt",
      ratio: "1:1",
      quality: "1k",
      files: [],
      count: 1,
    }));
    assert.equal(callCount, 2);
    assert.deepEqual(authorizationHeaders, [
      "Bearer masked-test-key",
      "Bearer masked-test-key",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("image generation retries once when upstream stalls before generation starts", async () => {
  const originalFetch = globalThis.fetch;
  let callCount = 0;
  globalThis.fetch = (async () => {
    callCount += 1;
    if (callCount === 1) {
      return jsonResponse({
        error: {
          message: "pre_resolve_stall_timeout: no image_ref_resolve_start",
        },
      }, { status: 504 });
    }
    return jsonResponse({
      data: [{ url: "https://cdn.example.test/retried-result.png" }],
    });
  }) as typeof fetch;
  try {
    const outputs = await providerCallInternalsForTests.collectImageProviderOutputs({
      provider,
      prompt: "retry test",
      ratio: "1:1",
      quality: "1k",
      files: [],
      count: 1,
    });
    assert.equal(callCount, 2);
    assert.equal(outputs[0]?.url, "https://cdn.example.test/retried-result.png");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("local Grok video provider sends reference images through the NewAPI videos endpoint", async () => {
  assert.equal(providerCallInternalsForTests.isLocalOpenAiCompatibleEndpoint("http://127.0.0.1:3000/v1/videos"), true);
  assert.equal(providerCallInternalsForTests.isLocalOpenAiCompatibleEndpoint("https://api.manxiaobai.online/v1/videos"), false);

  const videoProvider = {
    ...provider,
    id: "video-grok",
    kind: "video",
    apiUrl: "http://127.0.0.1:3000/v1/videos",
    model: "grok-video-1.5",
    endpointType: "grok-videos",
  } as const;
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedBody: Record<string, unknown> = {};
  globalThis.fetch = (async (url, init) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(String(init?.body || "{}"));
    return jsonResponse({ data: [{ url: "https://cdn.example.test/video.mp4" }] });
  }) as typeof fetch;
  try {
    const output = await providerCallInternalsForTests.callOpenAiCompatibleGrokVideoProvider(videoProvider, {
      mode: "image-to-video",
      prompt: "test prompt",
      ratio: "16:9",
      duration: 6,
      files: [{ bytes: Buffer.from("image-bytes"), mimeType: "image/png", fileName: "首帧.png" }],
    });
    assert.equal(requestedUrl, "http://127.0.0.1:3000/v1/videos");
    assert.equal(requestedBody.model, "grok-video-1.5");
    assert.equal(requestedBody.prompt, "test prompt");
    assert.equal(requestedBody.seconds, "6");
    assert.equal("duration" in requestedBody, false);
    assert.equal(requestedBody.aspect_ratio, "16:9");
    assert.equal(typeof requestedBody.image, "string");
    assert.match(requestedBody.image as string, /^data:image\/png;base64,/);
    assert.equal(output.url, "https://cdn.example.test/video.mp4");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("grok video validation keeps model-specific duration rules", () => {
  assert.doesNotThrow(() => providerCallInternalsForTests.validateGrokVideoInput({
    ...provider,
    id: "video-grok-10",
    kind: "video",
    apiUrl: "https://provider.example.test/v1/videos",
    model: "grok-video-1.0",
    endpointType: "grok-videos",
  }, {
    mode: "text-to-video",
    ratio: "16:9",
    duration: 6,
    files: [],
  }));
  assert.doesNotThrow(() => providerCallInternalsForTests.validateGrokVideoInput({
    ...provider,
    id: "video-grok-10-valid-six-seconds",
    kind: "video",
    apiUrl: "https://provider.example.test/v1/videos",
    model: "grok-video-1.0",
    endpointType: "grok-videos",
  }, {
    mode: "text-to-video",
    ratio: "16:9",
    duration: 6,
    files: [],
  }));

  assert.throws(() => providerCallInternalsForTests.validateGrokVideoInput({
    ...provider,
    id: "video-grok-15",
    kind: "video",
    apiUrl: "https://provider.example.test/v1/videos",
    model: "grok-video-1.5",
    endpointType: "grok-videos",
  }, {
    mode: "image-to-video",
    ratio: "16:9",
    duration: 5,
    files: [{ bytes: Buffer.from("image-bytes"), mimeType: "image/png", fileName: "frame.png" }],
  }));

  assert.throws(() => providerCallInternalsForTests.validateGrokVideoInput({
    ...provider,
    id: "video-grok-15-four-seconds",
    kind: "video",
    apiUrl: "https://provider.example.test/v1/videos",
    model: "grok-video-1.5",
    endpointType: "grok-videos",
  }, {
    mode: "image-to-video",
    ratio: "16:9",
    duration: 4,
    files: [{ bytes: Buffer.from("image-bytes"), mimeType: "image/png", fileName: "frame.png" }],
  }));

  assert.throws(() => providerCallInternalsForTests.validateGrokVideoInput({
    ...provider,
    id: "video-grok-10-five-seconds",
    kind: "video",
    apiUrl: "https://provider.example.test/v1/videos",
    model: "grok-video-1.0",
    endpointType: "grok-videos",
  }, {
    mode: "text-to-video",
    ratio: "16:9",
    duration: 5,
    files: [],
  }));
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
