import assert from "node:assert/strict";
import { test } from "node:test";

import { adminGetUsers } from "../admin";
import { newApiAdminContext } from "../auth";
import { NewApiHttpClient } from "../client";
import { getNewApiConfig } from "../config";
import { NewApiError } from "../errors";
import { checkNewApiHealth } from "../health";
import { createMemoryNewApiUserMappingRepository } from "../user-mapping";
import { NewApiUserSyncService } from "../user-sync";

test("connects to the B05 New API test service and checks health", async () => {
  const response = await checkNewApiHealth();
  assert.equal(response.upstreamStatus, 200);
  assert.equal(typeof response.data, "object");
});

test("rejects unauthenticated admin requests", async () => {
  const config = getNewApiConfig("123e4567-e89b-12d3-a456-426614174001");
  const client = new NewApiHttpClient({ ...config, adminAccessToken: undefined, adminUserId: undefined });

  await assert.rejects(
    () => client.request({
      path: "/api/user/",
      context: newApiAdminContext({ newApiUserId: 0, accessToken: "" }),
    }),
    (error) => error instanceof NewApiError && error.code === "NEW_API_AUTH_FORBIDDEN",
  );
});

test("authorizes admin client against the real test service", async () => {
  const response = await adminGetUsers();
  assert.equal(response.upstreamStatus, 200);
  assert.equal(typeof response.data, "object");
});

test("creates and activates a real New API user mapping", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({ repository });
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const result = await service.ensureMapped({
    localUserId: `local-real-${suffix}`,
    email: `local-real-${suffix}@example.test`,
    displayName: "B08 Real Mapping Test",
    initialQuota: 0,
  }, {
    idempotencyKey: `b08-real:${suffix}`,
    passwordSeed: suffix,
  });

  assert.equal(
    result.mapping.sync_status,
    "active",
    JSON.stringify({
      action: result.action,
      last_error_code: result.mapping.last_error_code,
      last_error_message: result.mapping.last_error_message,
      retry_count: result.mapping.retry_count,
    }),
  );
  assert.match(result.mapping.new_api_user_id || "", /^\d+$/);
  assert.equal((await repository.getByLocalUserId(`local-real-${suffix}`))?.new_api_user_id, result.mapping.new_api_user_id);
});
