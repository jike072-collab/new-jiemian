import { NewApiHttpClient, newApiAdminRequestContext } from "./client";
import { adminGetNewApiUser, type NewApiUserSelf } from "./user";

function isNewApiUserSelf(value: unknown): value is NewApiUserSelf {
  return Boolean(value && typeof value === "object" && "id" in value && typeof value.id === "number");
}

function extractUser(payload: { data?: NewApiUserSelf; user?: NewApiUserSelf } | NewApiUserSelf): NewApiUserSelf | null {
  if (!payload || typeof payload !== "object") return null;
  if (isNewApiUserSelf(payload)) return payload;
  if ("data" in payload && isNewApiUserSelf(payload.data)) return payload.data;
  if ("user" in payload && isNewApiUserSelf(payload.user)) return payload.user;
  return null;
}

export async function adminSetNewApiUserQuota(input: {
  newApiUserId: number;
  quota: number;
}, client = new NewApiHttpClient()) {
  return client.request<{ success?: boolean; data?: NewApiUserSelf; user?: NewApiUserSelf; message?: string }>({
    method: "PUT",
    path: "/api/user/",
    context: newApiAdminRequestContext(client.config),
    body: {
      id: input.newApiUserId,
      quota: input.quota,
    },
    retry: false,
  });
}

export async function adminCreditNewApiUserQuota(input: {
  newApiUserId: number;
  quotaDelta: number;
}, client = new NewApiHttpClient()) {
  const current = await adminGetNewApiUser({ newApiUserId: input.newApiUserId }, client);
  const user = extractUser(current.data);
  if (!user) {
    throw new Error("New API user quota could not be read before credit.");
  }
  const currentQuota = Number(user.quota || 0);
  if (!Number.isFinite(currentQuota)) {
    throw new Error("New API user quota is invalid before credit.");
  }
  return adminSetNewApiUserQuota({
    newApiUserId: input.newApiUserId,
    quota: currentQuota + input.quotaDelta,
  }, client);
}
