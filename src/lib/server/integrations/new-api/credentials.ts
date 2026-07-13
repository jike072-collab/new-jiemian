import { randomUUID } from "node:crypto";

import { getNewApiConfig } from "./config";
import { NewApiError } from "./errors";

export type NewApiPasswordLoginUser = {
  id: number;
  username: string;
  display_name?: string;
  role?: number | string;
  status?: number | string;
  group?: string;
  email?: string;
  quota?: number;
  used_quota?: number;
  [key: string]: unknown;
};

export type NewApiPasswordLoginPayload = {
  success?: boolean;
  message?: string;
  data?: NewApiPasswordLoginUser | {
    require_2fa?: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

function isUserPayload(value: unknown): value is NewApiPasswordLoginUser {
  return Boolean(value && typeof value === "object" && typeof (value as { id?: unknown }).id === "number");
}

export function extractNewApiPasswordLoginUser(payload: NewApiPasswordLoginPayload) {
  return isUserPayload(payload.data) ? payload.data : null;
}

export async function loginNewApiWithPassword(input: {
  username: string;
  password: string;
}, requestId: string = randomUUID()) {
  const config = getNewApiConfig(requestId);
  if (!config.enabled) {
    throw new NewApiError({
      code: "NEW_API_DISABLED",
      message: "New API integration is disabled.",
      status: 503,
      requestId,
    });
  }

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/api/user/login`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Request-Id": requestId,
      },
      body: JSON.stringify({
        username: input.username,
        password: input.password,
      }),
      signal: AbortSignal.timeout(config.timeoutMs),
    });
  } catch {
    throw new NewApiError({
      code: "NEW_API_NETWORK",
      message: "New API login request failed.",
      status: 502,
      requestId,
    });
  }

  const payload = await response.json().catch(() => null) as NewApiPasswordLoginPayload | null;
  if (!response.ok || !payload) {
    throw new NewApiError({
      code: "NEW_API_UPSTREAM_ERROR",
      message: "New API login returned an invalid response.",
      status: response.status >= 500 ? 502 : response.status,
      requestId,
      upstreamStatus: response.status,
    });
  }

  return payload;
}
