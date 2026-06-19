import { NewApiHttpClient } from "./client";
import { newApiUserContext } from "./auth";
import { newApiAdminRequestContext } from "./client";

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

export type NewApiLogRecord = {
  id?: number | string;
  user_id?: number | string;
  username?: string;
  model_name?: string;
  model?: string;
  channel_id?: number | string;
  token_id?: number | string;
  token_name?: string;
  quota?: number | string;
  prompt_tokens?: number | string;
  completion_tokens?: number | string;
  created_at?: number | string;
  createdAt?: string;
  request_id?: string;
  task_id?: string;
  type?: number | string;
  is_stream?: boolean;
  [key: string]: unknown;
};

export type NewApiLogListPayload = {
  success?: boolean;
  data?: NewApiLogRecord[] | {
    items?: NewApiLogRecord[];
    logs?: NewApiLogRecord[];
    rows?: NewApiLogRecord[];
    records?: NewApiLogRecord[];
    total?: number;
    [key: string]: unknown;
  };
  logs?: NewApiLogRecord[];
  items?: NewApiLogRecord[];
  total?: number;
  [key: string]: unknown;
};

export async function adminGetNewApiUser(input: {
  newApiUserId: number;
}, client = new NewApiHttpClient()) {
  return client.request<{ data?: NewApiUserSelf; user?: NewApiUserSelf } | NewApiUserSelf>({
    path: `/api/user/${input.newApiUserId}`,
    context: newApiAdminRequestContext(client.config),
  });
}

export async function adminGetNewApiLogs(input: {
  userId?: number;
  page?: number;
  pageSize?: number;
  taskId?: string;
}, client = new NewApiHttpClient()) {
  return client.request<NewApiLogListPayload>({
    path: "/api/log/",
    query: {
      p: input.page,
      page: input.page,
      page_size: input.pageSize,
      pageSize: input.pageSize,
      user_id: input.userId,
      userId: input.userId,
      task_id: input.taskId,
    },
    context: newApiAdminRequestContext(client.config),
  });
}
