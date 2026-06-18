import assert from "node:assert/strict";
import { test } from "node:test";

import { createMemoryNewApiUserMappingRepository, type NewApiUserSyncProfile, type NewApiUserSyncResult } from "../../integrations/new-api";
import { createCsrfToken, verifyCsrfToken } from "../csrf";
import { validatePasswordStrength, verifyPassword } from "../password";
import { InMemoryRateLimiter } from "../rate-limit";
import { createMemoryAuthRepository, type AuthRepository } from "../repository";
import { AuthService } from "../service";
import { type AuthUser } from "../types";

function activeMapping(localUserId: string): NewApiUserSyncResult {
  const now = new Date().toISOString();
  return {
    action: "created_upstream",
    mapping: {
      local_user_id: localUserId,
      new_api_user_id: "100",
      sync_status: "active",
      created_at: now,
      updated_at: now,
      last_sync_at: now,
      last_error_code: null,
      last_error_message: null,
      retry_count: 0,
      version: 2,
      idempotency_key: `register:${localUserId}`,
    },
  };
}

function failedMapping(localUserId: string): NewApiUserSyncResult {
  const now = new Date().toISOString();
  return {
    action: "failed_retryable",
    mapping: {
      local_user_id: localUserId,
      new_api_user_id: null,
      sync_status: "failed",
      created_at: now,
      updated_at: now,
      last_sync_at: now,
      last_error_code: "NEW_API_NETWORK",
      last_error_message: "network unavailable",
      retry_count: 1,
      version: 2,
      idempotency_key: `register:${localUserId}`,
    },
  };
}

function service(overrides: {
  repository?: AuthRepository;
  sync?: (localUserId: string) => NewApiUserSyncResult | Promise<NewApiUserSyncResult>;
  now?: () => Date;
  loginLimiter?: InMemoryRateLimiter;
  registerLimiter?: InMemoryRateLimiter;
} = {}) {
  const repository = overrides.repository || createMemoryAuthRepository();
  const mappingRepository = createMemoryNewApiUserMappingRepository();
  return {
    repository,
    mappingRepository,
    service: new AuthService({
      repository,
      mappingRepository,
      loginLimiter: overrides.loginLimiter,
      registerLimiter: overrides.registerLimiter,
      now: overrides.now,
      userSyncService: {
        ensureMapped: async (profile: NewApiUserSyncProfile) => {
          const result = await (overrides.sync || activeMapping)(profile.localUserId);
          if (result.mapping.sync_status === "active" && result.mapping.new_api_user_id) {
            await mappingRepository.createPending({
              localUserId: result.mapping.local_user_id,
              idempotencyKey: result.mapping.idempotency_key,
            });
            await mappingRepository.markActive({
              localUserId: result.mapping.local_user_id,
              newApiUserId: result.mapping.new_api_user_id,
            });
          } else {
            await mappingRepository.createPending({
              localUserId: result.mapping.local_user_id,
              idempotencyKey: result.mapping.idempotency_key,
            });
            await mappingRepository.markFailed({
              localUserId: result.mapping.local_user_id,
              code: result.mapping.last_error_code || "UNKNOWN",
              message: result.mapping.last_error_message || "sync failed",
              retryable: true,
            });
          }
          return result;
        },
      } as never,
    }),
  };
}

async function registerActiveAccount(auth = service().service) {
  return auth.register({
    email: "customer@example.com",
    username: "customer",
    password: "StrongPass123",
    displayName: "Customer",
  }, { ip: "127.0.0.1", userAgent: "test" });
}

test("registers a real local user, hashes password, maps through B08, and creates a session", async () => {
  const harness = service();
  const result = await registerActiveAccount(harness.service);

  assert.equal(result.ok, true);
  assert.equal(result.status, 201);
  if (!result.ok) return;
  assert.equal(result.uiState, "success");
  assert.equal(result.mappingStatus, "active");
  assert(result.session?.token);
  assert.equal(result.user.email, "customer@example.com");

  const stored = await harness.repository.getUserByIdentifier("customer@example.com");
  assert(stored);
  assert.notEqual(stored.password_hash, "StrongPass123");
  assert.equal(await verifyPassword("StrongPass123", stored.password_hash), true);
  assert.equal(await verifyPassword("WrongPass123", stored.password_hash), false);
});

test("rejects duplicate registration without creating another account", async () => {
  const harness = service();
  await registerActiveAccount(harness.service);
  const duplicate = await registerActiveAccount(harness.service);

  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.uiState, "validation_error");
});

test("rejects weak password and invalid input", async () => {
  assert(validatePasswordStrength("weak").length > 0);
  const result = await service().service.register({
    email: "not-an-email",
    username: "bad username",
    password: "weak",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.uiState, "validation_error");
});

test("serializes concurrent duplicate registration to one local account", async () => {
  const harness = service();
  const results = await Promise.all(Array.from({ length: 3 }, () => registerActiveAccount(harness.service)));
  const successCount = results.filter((result) => result.ok).length;
  const duplicateCount = results.filter((result) => !result.ok && result.status === 409).length;

  assert.equal(successCount, 1);
  assert.equal(duplicateCount, 2);
  assert(await harness.repository.getUserByIdentifier("customer@example.com"));
});

test("returns mapping_pending when B08 sync records retryable mapping failure", async () => {
  const harness = service({ sync: failedMapping });
  const result = await registerActiveAccount(harness.service);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, 202);
  assert.equal(result.uiState, "mapping_pending");
  assert.equal(result.mappingStatus, "failed");
});

test("logs in with email or username and rotates any existing session", async () => {
  const harness = service();
  const registered = await registerActiveAccount(harness.service);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const firstSession = registered.session?.token || "";
  const login = await harness.service.login({
    identifier: "customer",
    password: "StrongPass123",
    existingSessionToken: firstSession,
  });

  assert.equal(login.ok, true);
  if (!login.ok) return;
  assert.equal(login.uiState, "success");
  assert.notEqual(login.session?.token, firstSession);

  const oldSession = await harness.service.currentUser(firstSession);
  assert.equal(oldSession.ok, false);
  if (oldSession.ok) return;
  assert.equal(oldSession.uiState, "session_expired");
});

test("normalizes unsafe redirects to the app root", async () => {
  const harness = service();
  const registered = await harness.service.register({
    email: "redirect@example.com",
    username: "redirect-user",
    password: "StrongPass123",
    redirectTo: "https://evil.example/phish",
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  assert.equal(registered.redirectTo, "/");

  const login = await harness.service.login({
    identifier: "redirect@example.com",
    password: "StrongPass123",
    redirectTo: "//evil.example/phish",
  });
  assert.equal(login.ok, true);
  if (!login.ok) return;
  assert.equal(login.redirectTo, "/");
});

test("uses one generic invalid credentials error for wrong password and missing users", async () => {
  const harness = service();
  await registerActiveAccount(harness.service);

  const wrongPassword = await harness.service.login({
    identifier: "customer@example.com",
    password: "WrongPass123",
  });
  const missingUser = await harness.service.login({
    identifier: "missing@example.com",
    password: "WrongPass123",
  });

  assert.equal(wrongPassword.ok, false);
  assert.equal(missingUser.ok, false);
  if (wrongPassword.ok || missingUser.ok) return;
  assert.equal(wrongPassword.code, "AUTH_INVALID_CREDENTIALS");
  assert.equal(missingUser.code, "AUTH_INVALID_CREDENTIALS");
  assert.equal(wrongPassword.message, missingUser.message);
});

test("audit records do not store submitted passwords", async () => {
  const harness = service();
  await registerActiveAccount(harness.service);
  await harness.service.login({
    identifier: "customer@example.com",
    password: "WrongPass123-DoNotLog",
  }, { ip: "203.0.113.10", userAgent: "test-agent" });

  const audit = await harness.repository.listAuditEvents();
  const serialized = JSON.stringify(audit);
  assert.equal(serialized.includes("StrongPass123"), false);
  assert.equal(serialized.includes("WrongPass123-DoNotLog"), false);
  assert.equal(serialized.includes("203.0.113.10"), false);
  assert.equal(serialized.includes("test-agent"), false);
});

test("rejects disabled and verification-required users", async () => {
  const harness = service();
  await registerActiveAccount(harness.service);
  const user = await harness.repository.getUserByIdentifier("customer@example.com") as AuthUser;

  await harness.repository.updateUser(user.local_user_id, { status: "disabled" });
  const disabled = await harness.service.login({
    identifier: "customer@example.com",
    password: "StrongPass123",
  });
  assert.equal(disabled.ok, false);
  if (disabled.ok) return;
  assert.equal(disabled.uiState, "account_disabled");

  await harness.repository.updateUser(user.local_user_id, { status: "verification_required" });
  const verification = await harness.service.login({
    identifier: "customer@example.com",
    password: "StrongPass123",
  });
  assert.equal(verification.ok, false);
  if (verification.ok) return;
  assert.equal(verification.uiState, "verification_required");
});

test("rate limits login attempts", async () => {
  const harness = service({ loginLimiter: new InMemoryRateLimiter(1, 60_000) });
  const first = await harness.service.login({
    identifier: "missing@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.1" });
  const second = await harness.service.login({
    identifier: "missing@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.1" });

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.status, 429);
  assert.equal(second.uiState, "rate_limited");
});

test("expires sessions by idle timeout and logs out server side", async () => {
  let now = new Date("2026-06-18T00:00:00.000Z");
  const harness = service({ now: () => now });
  const registered = await registerActiveAccount(harness.service);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const token = registered.session?.token || "";

  now = new Date("2026-06-18T10:00:00.000Z");
  const expired = await harness.service.currentUser(token);
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.uiState, "session_expired");

  now = new Date("2026-06-18T00:00:00.000Z");
  const login = await harness.service.login({
    identifier: "customer@example.com",
    password: "StrongPass123",
  });
  assert.equal(login.ok, true);
  if (!login.ok) return;
  const activeToken = login.session?.token || "";
  assert.equal((await harness.service.currentUser(activeToken)).ok, true);
  await harness.service.logout(activeToken);
  const loggedOut = await harness.service.currentUser(activeToken);
  assert.equal(loggedOut.ok, false);
});

test("current user session helper acts as route protection", async () => {
  const harness = service();
  const missing = await harness.service.currentUser(null);
  assert.equal(missing.ok, false);
  if (missing.ok) return;
  assert.equal(missing.status, 401);
  assert.equal(missing.uiState, "session_expired");

  const registered = await registerActiveAccount(harness.service);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const protectedResult = await harness.service.currentUser(registered.session?.token);
  assert.equal(protectedResult.ok, true);
  if (!protectedResult.ok) return;
  assert.equal(protectedResult.user.email, "customer@example.com");
});

test("refresh extends idle expiry without changing the session truth source", async () => {
  let now = new Date("2026-06-18T00:00:00.000Z");
  const harness = service({ now: () => now });
  const registered = await registerActiveAccount(harness.service);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const token = registered.session?.token || "";

  now = new Date("2026-06-18T07:00:00.000Z");
  const refresh = await harness.service.refreshSession(token);
  assert.equal(refresh.ok, true);

  now = new Date("2026-06-18T12:00:00.000Z");
  assert.equal((await harness.service.currentUser(token)).ok, true);
});

test("CSRF token requires matching header and cookie and rejects tampering", () => {
  const token = createCsrfToken(new Date("2026-06-18T00:00:00.000Z"));
  assert.equal(verifyCsrfToken({
    headerToken: token,
    cookieToken: token,
    now: new Date("2026-06-18T00:01:00.000Z"),
  }), true);
  assert.equal(verifyCsrfToken({
    headerToken: token,
    cookieToken: `${token}x`,
    now: new Date("2026-06-18T00:01:00.000Z"),
  }), false);
  assert.equal(verifyCsrfToken({
    headerToken: token,
    cookieToken: token,
    now: new Date("2026-06-18T02:00:00.000Z"),
  }), false);
});
