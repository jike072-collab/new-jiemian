import assert from "node:assert/strict";
import { test } from "node:test";

import { NewApiError } from "../errors";
import { type NewApiQuotaDisplayConfig } from "../quota-display";
import { createMemoryNewApiUserMappingRepository } from "../user-mapping";
import { NewApiUserSyncService, type NewApiUserSyncProfile } from "../user-sync";
import { type NewApiResponse } from "../types";
import { type NewApiUserRecord } from "../admin";

function response<T>(data: T): NewApiResponse<T> {
  return {
    data,
    requestId: "test-request",
    upstreamStatus: 200,
  };
}

function profile(overrides: Partial<NewApiUserSyncProfile> = {}): NewApiUserSyncProfile {
  return {
    localUserId: "local-user-1",
    email: "customer@example.com",
    displayName: "Customer",
    ...overrides,
  };
}

function user(overrides: Partial<NewApiUserRecord> = {}): NewApiUserRecord {
  return {
    id: 77,
    username: "customer@example.com",
    email: "customer@example.com",
    status: 1,
    ...overrides,
  };
}

function quotaDisplayConfig(type: NewApiQuotaDisplayConfig["quotaDisplayType"] = "TOKENS"): NewApiQuotaDisplayConfig {
  return {
    quotaPerUnit: 500_000,
    usdExchangeRate: 7.3,
    quotaDisplayType: type,
    customCurrencySymbol: "C",
    customCurrencyExchangeRate: 1,
  };
}

test("creates a pending mapping then activates it after New API user creation", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async (input) => {
      assert.equal(input.username, "customer@example.com");
      assert.equal(input.email, "customer@example.com");
      assert.equal(input.quota, 0);
      assert(String(input.password).length <= 20);
      assert.equal(String(input.password).includes("local-user-1"), false);
      return response({ success: true, data: user() });
    },
    listUsers: async () => response({ data: [] }),
  });

  const result = await service.ensureMapped(profile(), {
    idempotencyKey: "register:local-user-1",
    passwordSeed: "seed",
  });

  assert.equal(result.action, "created_upstream");
  assert.equal(result.mapping.sync_status, "active");
  assert.equal(result.mapping.new_api_user_id, "77");
  assert.equal((await repository.getByLocalUserId("local-user-1"))?.idempotency_key, "register:local-user-1");
});

test("converts initial app credits into New API quota on user creation", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const quotaWrites: Array<{ newApiUserId: number; quota: number }> = [];
  const service = new NewApiUserSyncService({
    repository,
    getQuotaDisplayConfig: async () => quotaDisplayConfig("CNY"),
    createUser: async (input) => {
      assert.equal(input.quota, 1_369_863);
      return response({ success: true, data: user({ quota: 0 }) });
    },
    listUsers: async () => response({ data: [] }),
    setUserQuota: async (input) => {
      quotaWrites.push(input);
      return response({ success: true, data: user({ id: input.newApiUserId, quota: input.quota }) });
    },
  });

  const result = await service.ensureMapped(profile({ initialQuota: 200 }));

  assert.equal(result.action, "created_upstream");
  assert.equal(result.mapping.sync_status, "active");
  assert.deepEqual(quotaWrites, [{ newApiUserId: 77, quota: 1_369_863 }]);
});

test("does not lower existing New API quota when it already exceeds signup credits", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  let quotaWrites = 0;
  const service = new NewApiUserSyncService({
    repository,
    getQuotaDisplayConfig: async () => quotaDisplayConfig("TOKENS"),
    createUser: async () => response({ success: true, data: user({ quota: 900 }) }),
    listUsers: async () => response({ data: [] }),
    setUserQuota: async (input) => {
      quotaWrites += 1;
      return response({ success: true, data: user({ id: input.newApiUserId, quota: input.quota }) });
    },
  });

  const result = await service.ensureMapped(profile({ initialQuota: 500 }));

  assert.equal(result.action, "created_upstream");
  assert.equal(result.mapping.sync_status, "active");
  assert.equal(quotaWrites, 0);
});

test("shortens New API username and display name to official field limits", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async (input) => {
      assert(String(input.username).length <= 20);
      assert(String(input.display_name).length <= 20);
      assert.notEqual(input.username, "very-long-customer-address@example.com");
      return response({
        success: true,
        data: user({
          id: 78,
          username: String(input.username),
          email: "very-long-customer-address@example.com",
        }),
      });
    },
    listUsers: async () => response({ data: [] }),
  });

  const result = await service.ensureMapped(profile({
    localUserId: "local-user-with-a-long-stable-id",
    email: "very-long-customer-address@example.com",
    displayName: "Very Long Customer Display Name For New API",
  }));

  assert.equal(result.mapping.sync_status, "active");
  assert.equal(result.mapping.new_api_user_id, "78");
});

test("does not send overlong local email to New API user creation", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  let upstreamUsername = "";
  const service = new NewApiUserSyncService({
    repository,
    createUser: async (input) => {
      upstreamUsername = String(input.username);
      assert.equal(input.email, undefined);
      assert(upstreamUsername.length <= 20);
      return response({ success: true, message: "" });
    },
    listUsers: async () => response({
      success: true,
      data: {
        items: [user({
          id: 81,
          username: upstreamUsername,
          email: undefined,
        })],
        total: 1,
      },
    }),
  });

  const result = await service.ensureMapped(profile({
    localUserId: "local-user-with-overlong-email",
    email: "very-long-customer-address-for-new-api-field-limit@example.test",
    displayName: "Long Email Customer",
  }));

  assert.equal(result.action, "created_upstream");
  assert.equal(result.mapping.sync_status, "active");
  assert.equal(result.mapping.new_api_user_id, "81");
});

test("confirms created user from New API paginated list when create returns no id", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  let createdUsername = "";
  const service = new NewApiUserSyncService({
    repository,
    createUser: async (input) => {
      createdUsername = String(input.username);
      return response({ success: true, message: "" });
    },
    listUsers: async () => response({
      success: true,
      data: {
        items: [user({ id: 79, username: createdUsername })],
        total: 1,
      },
    }),
  });

  const result = await service.ensureMapped(profile({
    localUserId: "local-user-created-without-id",
    email: "created-without-id@example.com",
  }));

  assert.equal(result.action, "created_upstream");
  assert.equal(result.mapping.sync_status, "active");
  assert.equal(result.mapping.new_api_user_id, "79");
});

test("does not treat New API business rejection as a successful create", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => response({ success: false, message: "invalid password" }),
    listUsers: async () => response({
      success: true,
      data: {
        items: [user({ id: 80 })],
        total: 1,
      },
    }),
  });

  const result = await service.ensureMapped(profile({ localUserId: "local-rejected" }));

  assert.equal(result.action, "repair_required");
  assert.equal(result.mapping.sync_status, "repair_required");
  assert.equal(result.mapping.last_error_code, "NEW_API_USER_CREATE_REJECTED");
});

test("returns existing active mapping without calling New API", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "local-user-1" });
  await repository.markActive({ localUserId: "local-user-1", newApiUserId: 77 });
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      throw new Error("should not create upstream user");
    },
    listUsers: async () => response({ data: [] }),
  });

  const result = await service.ensureMapped(profile());

  assert.equal(result.action, "already_active");
  assert.equal(result.mapping.new_api_user_id, "77");
});

test("links an existing New API user after duplicate create response", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      throw new NewApiError({
        code: "NEW_API_UPSTREAM_ERROR",
        message: "duplicate username",
        status: 502,
        retryable: false,
        requestId: "test",
        upstreamStatus: 409,
      });
    },
    listUsers: async () => response({ data: [user({ id: 88 })] }),
  });

  const result = await service.ensureMapped(profile());

  assert.equal(result.action, "linked_existing");
  assert.equal(result.mapping.sync_status, "active");
  assert.equal(result.mapping.new_api_user_id, "88");
});

test("conflicting duplicate without a confirmable upstream user requires repair", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      throw new NewApiError({
        code: "NEW_API_UPSTREAM_ERROR",
        message: "duplicate username",
        requestId: "test",
        upstreamStatus: 409,
      });
    },
    listUsers: async () => response({ data: [] }),
  });

  const result = await service.ensureMapped(profile());

  assert.equal(result.action, "repair_required");
  assert.equal(result.mapping.sync_status, "repair_required");
});

test("timeout checks upstream before retrying and links if creation actually succeeded", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      throw new NewApiError({
        code: "NEW_API_TIMEOUT",
        message: "request timed out",
        status: 504,
        retryable: true,
        requestId: "test",
      });
    },
    listUsers: async () => response({ data: [user({ id: 99 })] }),
  });

  const result = await service.ensureMapped(profile());

  assert.equal(result.action, "linked_existing");
  assert.equal(result.mapping.sync_status, "active");
  assert.equal(result.mapping.new_api_user_id, "99");
});

test("retryable failure marks failed and later retry can activate", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  let healthy = false;
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      if (!healthy) {
        throw new NewApiError({
          code: "NEW_API_NETWORK",
          message: "network down Authorization=Bearer secret",
          status: 502,
          retryable: true,
          requestId: "test",
        });
      }
      return response({ success: true, data: user({ id: 101 }) });
    },
    listUsers: async () => response({ data: [] }),
  });

  const failed = await service.ensureMapped(profile(), { maxRetryCount: 3 });
  assert.equal(failed.action, "failed_retryable");
  assert.equal(failed.mapping.sync_status, "failed");
  assert.equal(failed.mapping.last_error_message?.includes("secret"), false);

  healthy = true;
  const repaired = await service.ensureMapped(profile(), { maxRetryCount: 3 });
  assert.equal(repaired.action, "created_upstream");
  assert.equal(repaired.mapping.sync_status, "active");
  assert.equal(repaired.mapping.retry_count, 1);
});

test("non retryable New API failure enters repair state", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      throw new NewApiError({
        code: "NEW_API_AUTH_FORBIDDEN",
        message: "admin auth failed token=secret",
        status: 403,
        retryable: false,
        requestId: "test",
      });
    },
    listUsers: async () => response({ data: [] }),
  });

  const result = await service.ensureMapped(profile());

  assert.equal(result.action, "repair_required");
  assert.equal(result.mapping.sync_status, "repair_required");
  assert.equal(result.mapping.last_error_message?.includes("secret"), false);
});

test("local persistence conflict after upstream creation schedules repair without stealing upstream id", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  await repository.createPending({ localUserId: "other-user" });
  await repository.markActive({ localUserId: "other-user", newApiUserId: 77 });
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => response({ success: true, data: user({ id: 77 }) }),
    listUsers: async () => response({ data: [] }),
  });

  const result = await service.ensureMapped(profile());

  assert.equal(result.action, "repair_required");
  assert.equal(result.mapping.sync_status, "repair_required");
  assert.equal(result.mapping.new_api_user_id, null);
  assert.equal(result.mapping.last_error_code, "NEW_API_MAPPING_CONFLICT");
});

test("concurrent sync calls do not create duplicate local mappings", async () => {
  const repository = createMemoryNewApiUserMappingRepository();
  let createCalls = 0;
  const service = new NewApiUserSyncService({
    repository,
    createUser: async () => {
      createCalls += 1;
      return response({ success: true, data: user({ id: 200 }) });
    },
    listUsers: async () => response({ data: [user({ id: 200 })] }),
  });

  const results = await Promise.all(Array.from({ length: 5 }, () => service.ensureMapped(profile())));

  assert.equal((await repository.listByStatus("active")).length, 1);
  assert(results.every((result) => result.mapping.new_api_user_id === "200"));
  assert(createCalls >= 1);
});
