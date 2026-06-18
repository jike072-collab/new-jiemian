import { NewApiHttpClient } from "./client";
import { newApiUserContext } from "./auth";

export type NewApiUserSelf = {
  id: number;
  username: string;
  quota?: number;
  used_quota?: number;
  request_count?: number;
  [key: string]: unknown;
};

export async function getNewApiUserSelf(input: {
  newApiUserId: number;
  accessToken: string;
}, client = new NewApiHttpClient()) {
  return client.request<{ data?: NewApiUserSelf; user?: NewApiUserSelf }>({
    path: "/api/user/self",
    context: newApiUserContext(input),
  });
}

export async function getNewApiUserLogs(input: {
  newApiUserId: number;
  accessToken: string;
}, client = new NewApiHttpClient()) {
  return client.request<{ data?: unknown[]; logs?: unknown[] }>({
    path: "/api/log/self",
    context: newApiUserContext(input),
  });
}
