import { NewApiHttpClient, newApiAdminRequestContext } from "./client";

export type NewApiUserCreateInput = {
  username: string;
  password?: string;
  display_name?: string;
  email?: string;
  quota?: number;
  group?: string;
};

export type NewApiUserRecord = {
  id: number;
  username: string;
  display_name?: string;
  email?: string;
  status?: number;
  quota?: number;
  used_quota?: number;
  request_count?: number;
  [key: string]: unknown;
};

export async function adminGetUsers(client = new NewApiHttpClient()) {
  return client.request<{ data?: NewApiUserRecord[]; users?: NewApiUserRecord[] }>({
    path: "/api/user/",
    context: newApiAdminRequestContext(client.config),
  });
}

export async function adminCreateUser(input: NewApiUserCreateInput, client = new NewApiHttpClient()) {
  return client.request<{ success?: boolean; data?: NewApiUserRecord; message?: string }>({
    method: "POST",
    path: "/api/user/",
    context: newApiAdminRequestContext(client.config),
    body: input,
    retry: false,
  });
}

export async function adminGetModels(client = new NewApiHttpClient()) {
  return client.request<{ data?: unknown[]; models?: unknown[] }>({
    path: "/api/models/",
    context: newApiAdminRequestContext(client.config),
  });
}
