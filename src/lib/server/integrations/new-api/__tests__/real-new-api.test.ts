import assert from "node:assert/strict";
import { test } from "node:test";

import { adminGetUsers } from "../admin";
import { newApiAdminContext } from "../auth";
import { NewApiHttpClient } from "../client";
import { getNewApiConfig } from "../config";
import { NewApiError } from "../errors";
import { checkNewApiHealth } from "../health";

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
