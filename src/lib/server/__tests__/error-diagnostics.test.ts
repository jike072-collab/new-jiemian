import assert from "node:assert/strict";
import test from "node:test";

import { errorDiagnosticCatalog, type ErrorDiagnosticCode } from "../../error-diagnostic-catalog";
import {
  codeForThrownError,
  codeForUpstreamStatus,
  createErrorDiagnostic,
  GenerationDiagnosticError,
  redactDiagnosticPayload,
  redactSensitiveText,
} from "../error-diagnostics";

const requiredCodes: ErrorDiagnosticCode[] = [
  "PROVIDER_NOT_CONFIGURED",
  "PROVIDER_DISABLED",
  "PROVIDER_MISSING_ENDPOINT",
  "PROVIDER_INVALID_ENDPOINT",
  "PROVIDER_MISSING_API_KEY",
  "PROVIDER_HEALTH_CHECK_FAILED",
  "MODEL_MISSING_IMAGE",
  "MODEL_MISSING_IMAGE_EDIT",
  "MODEL_MISSING_VIDEO",
  "MODEL_MISSING_IMAGE_UPSCALE",
  "MODEL_MISSING_VIDEO_UPSCALE",
  "MODEL_NOT_FOUND",
  "MODEL_UNAVAILABLE",
  "INPUT_MISSING_PROMPT",
  "INPUT_MISSING_IMAGE",
  "INPUT_INVALID_IMAGE",
  "INPUT_INVALID_PARAMETERS",
  "INPUT_FILE_TOO_LARGE",
  "INPUT_UNSUPPORTED_FORMAT",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NETWORK_ERROR",
  "PROVIDER_AUTH_FAILED",
  "PROVIDER_FORBIDDEN",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_BAD_REQUEST",
  "PROVIDER_UPSTREAM_4XX",
  "PROVIDER_UPSTREAM_5XX",
  "PROVIDER_NON_JSON_RESPONSE",
  "PROVIDER_BAD_RESPONSE",
  "PROVIDER_EMPTY_RESPONSE",
  "TASK_CREATE_FAILED",
  "TASK_POLL_FAILED",
  "TASK_FAILED",
  "TASK_TIMEOUT",
  "TASK_CANCELLED",
  "TASK_UNKNOWN_STATUS",
  "LIBRARY_SAVE_FAILED",
  "UPLOAD_NOT_FOUND",
  "UPLOAD_READ_FAILED",
  "UPLOAD_WRITE_FAILED",
  "RESULT_ASSET_MISSING",
  "INTERNAL_ERROR",
  "UNKNOWN_ERROR",
];

test("catalog covers every Stage 5 diagnostic code with display metadata", () => {
  assert.deepEqual(Object.keys(errorDiagnosticCatalog).sort(), [...requiredCodes].sort());
  for (const code of requiredCodes) {
    const meta = errorDiagnosticCatalog[code];
    assert.equal(meta.code, code);
    assert.ok(meta.category);
    assert.ok(meta.message);
    assert.ok(meta.action);
    assert.ok(meta.adminNote);
    assert.equal(typeof meta.retryable, "boolean");
    assert.equal(typeof meta.status, "number");
    assert(meta.status >= 400);
  }
});

test("upstream status maps to stable provider codes", () => {
  assert.equal(codeForUpstreamStatus(400), "PROVIDER_BAD_REQUEST");
  assert.equal(codeForUpstreamStatus(401), "PROVIDER_AUTH_FAILED");
  assert.equal(codeForUpstreamStatus(403), "PROVIDER_FORBIDDEN");
  assert.equal(codeForUpstreamStatus(404), "MODEL_NOT_FOUND");
  assert.equal(codeForUpstreamStatus(429), "PROVIDER_RATE_LIMITED");
  assert.equal(codeForUpstreamStatus(500), "PROVIDER_UPSTREAM_5XX");
});

test("thrown errors are classified without leaking raw provider details", () => {
  assert.equal(codeForThrownError(new Error("fetch failed ECONNRESET")), "PROVIDER_NETWORK_ERROR");
  assert.equal(codeForThrownError(new Error("request timeout")), "PROVIDER_TIMEOUT");
  assert.equal(codeForThrownError(new Error("API Key is invalid")), "PROVIDER_AUTH_FAILED");
  assert.equal(codeForThrownError(new Error("请上传参考图片")), "INPUT_MISSING_IMAGE");
  assert.equal(codeForThrownError(new Error("文件不能超过 10MB")), "INPUT_FILE_TOO_LARGE");
});

test("explicit diagnostic errors preserve code and safe context", () => {
  const diagnostic = createErrorDiagnostic(new GenerationDiagnosticError({
    code: "PROVIDER_AUTH_FAILED",
    message: "Authorization: Bearer sk-secret-token",
    upstreamStatus: 401,
    providerId: "image-main",
    model: "image-model",
    safeDetails: {
      Authorization: "Bearer sk-secret-token",
      endpoint: "https://example.test/v1/images",
    },
  }), {
    requestId: "req-stage5",
    tool: "image",
    operation: "generate-image",
  });
  assert.equal(diagnostic.code, "PROVIDER_AUTH_FAILED");
  assert.equal(diagnostic.requestId, "req-stage5");
  assert.equal(diagnostic.providerId, "image-main");
  assert.equal(diagnostic.model, "image-model");
  assert.equal(diagnostic.upstreamStatus, 401);
  assert.match(diagnostic.technicalMessage, /\[redacted\]/);
  assert.equal(diagnostic.safeDetails.Authorization, "[redacted]");
  assert.equal(diagnostic.safeDetails.tool, "image");
  assert.equal(diagnostic.safeDetails.operation, "generate-image");
});

test("redaction removes secrets from text and nested payloads", () => {
  const raw = [
    "Authorization: Bearer sk-real-secret",
    "Cookie: session=hidden",
    "APP_DATABASE_URL=postgresql://user:pass@127.0.0.1/app?token=abc",
    "ADMIN_PASSWORD=secret-password",
    "https://example.test/callback?token=abc&password=def",
  ].join(" ");
  const redacted = redactSensitiveText(raw);
  assert(!redacted.includes("sk-real-secret"));
  assert(!redacted.includes("session=hidden"));
  assert(!redacted.includes("user:pass"));
  assert(!redacted.includes("secret-password"));
  assert(!redacted.includes("token=abc"));
  assert.match(redacted, /\[redacted\]/);

  const payload = redactDiagnosticPayload({
    headers: {
      Authorization: "Bearer sk-real-secret",
      Cookie: "session=hidden",
    },
    body: {
      apiKey: "sk-real-secret",
      nested: ["password=secret-password"],
    },
  }) as { headers: Record<string, unknown>; body: Record<string, unknown> };
  assert.equal(payload.headers.Authorization, "[redacted]");
  assert.equal(payload.headers.Cookie, "[redacted]");
  assert.equal(payload.body.apiKey, "[redacted]");
  assert.deepEqual(payload.body.nested, ["password=[redacted]"]);
});

test("unknown errors produce a traceable fallback diagnostic", () => {
  const diagnostic = createErrorDiagnostic("boom", {
    requestId: "req-unknown",
    defaultCode: "UNKNOWN_ERROR",
  });
  assert.equal(diagnostic.code, "UNKNOWN_ERROR");
  assert.equal(diagnostic.requestId, "req-unknown");
  assert.ok(diagnostic.occurredAt);
  assert.equal(diagnostic.retryable, true);
});
