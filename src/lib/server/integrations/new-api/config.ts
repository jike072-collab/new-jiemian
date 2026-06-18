import { randomUUID } from "node:crypto";

import { NewApiError } from "./errors";
import { type NewApiConfig, type NewApiEnvironment } from "./types";

function env(name: string) {
  return process.env[name]?.trim() || "";
}

function parseBoolean(value: string) {
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseNumber(value: string, fallback: number, min: number, max: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function parseOptionalPositiveInt(value: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return undefined;
  return parsed;
}

function parseEnvironment(value: string): NewApiEnvironment {
  if (value === "production" || value === "staging" || value === "test") return value;
  return "test";
}

export function normalizeNewApiBaseUrl(value: string, requestId: string = randomUUID()) {
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("invalid protocol");
    }
    parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    throw new NewApiError({
      code: "NEW_API_CONFIG_INVALID",
      message: "New API base URL must be a valid http or https URL.",
      status: 500,
      requestId,
      safeDetails: { env: "NEW_API_BASE_URL" },
    });
  }
}

export function getNewApiConfig(requestId: string = randomUUID()): NewApiConfig {
  const enabled = parseBoolean(env("NEW_API_ENABLED"));
  if (!enabled) {
    return {
      enabled: false,
      baseUrl: "",
      timeoutMs: parseNumber(env("NEW_API_TIMEOUT_MS"), 10000, 1000, 60000),
      maxResponseBytes: parseNumber(env("NEW_API_MAX_RESPONSE_BYTES"), 1048576, 1024, 5242880),
      environment: parseEnvironment(env("NEW_API_ENVIRONMENT")),
    };
  }

  const baseUrl = env("NEW_API_BASE_URL");
  if (!baseUrl) {
    throw new NewApiError({
      code: "NEW_API_CONFIG_MISSING",
      message: "New API base URL is required when New API integration is enabled.",
      status: 500,
      requestId,
      safeDetails: { env: "NEW_API_BASE_URL" },
    });
  }

  return {
    enabled,
    baseUrl: normalizeNewApiBaseUrl(baseUrl, requestId),
    timeoutMs: parseNumber(env("NEW_API_TIMEOUT_MS"), 10000, 1000, 60000),
    maxResponseBytes: parseNumber(env("NEW_API_MAX_RESPONSE_BYTES"), 1048576, 1024, 5242880),
    environment: parseEnvironment(env("NEW_API_ENVIRONMENT")),
    adminAccessToken: env("NEW_API_ADMIN_ACCESS_TOKEN") || undefined,
    adminUserId: parseOptionalPositiveInt(env("NEW_API_ADMIN_USER_ID")),
  };
}
