import assert from "node:assert/strict";
import { test } from "node:test";

import { adminGetNewApiUser, createMemoryNewApiUserMappingRepository, type NewApiUserSyncProfile, type NewApiUserSyncResult } from "../../integrations/new-api";
import { createCsrfToken, verifyCsrfToken } from "../csrf";
import { hashPassword, validatePasswordStrength, verifyPassword } from "../password";
import { InMemoryRateLimiter } from "../rate-limit";
import { createMemoryAuthRepository, type AuthRepository } from "../repository";
import { AuthService } from "../service";
import { AUTH_SESSION_TTL_SECONDS, type AuthUser, type AuthVerificationPurpose } from "../types";

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
  profiles?: NewApiUserSyncProfile[];
  now?: () => Date;
  loginLimiter?: InMemoryRateLimiter;
  adminPasswordLimiter?: InMemoryRateLimiter;
  registerLimiter?: InMemoryRateLimiter;
  verificationLimiter?: InMemoryRateLimiter;
  getNewApiUser?: typeof adminGetNewApiUser;
} = {}) {
  const repository = overrides.repository || createMemoryAuthRepository();
  const mappingRepository = createMemoryNewApiUserMappingRepository();
  const sentCodes: Array<{ destination: string; purpose: AuthVerificationPurpose; code: string }> = [];
  return {
    repository,
    mappingRepository,
    sentCodes,
    service: new AuthService({
      repository,
      mappingRepository,
      loginLimiter: overrides.loginLimiter,
      adminPasswordLimiter: overrides.adminPasswordLimiter,
      registerLimiter: overrides.registerLimiter,
      verificationLimiter: overrides.verificationLimiter,
      getNewApiUser: overrides.getNewApiUser,
      verificationSender: async (payload) => {
        sentCodes.push(payload);
      },
      now: overrides.now,
      userSyncService: {
        ensureMapped: async (profile: NewApiUserSyncProfile) => {
          overrides.profiles?.push(profile);
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

async function registerActiveAccount(harness = service()) {
  const requested = await harness.service.requestVerificationCode({
    identifier: "customer@example.com",
    purpose: "register",
  }, { ip: "127.0.0.1", userAgent: "test" });
  assert.equal(requested.ok, true);
  const verificationCode = harness.sentCodes.at(-1)?.code || "";
  return harness.service.register({
    email: "customer@example.com",
    username: "cust01",
    password: "StrongPass123",
    verificationCode,
    displayName: "Customer",
  }, { ip: "127.0.0.1", userAgent: "test" });
}

test("registers a real local user, hashes password, maps through B08, and creates a session", async () => {
  const harness = service();
  const result = await registerActiveAccount(harness);

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

test("requires an explicit username during registration", async () => {
  const harness = service();
  const requested = await harness.service.requestVerificationCode({
    identifier: "nousername@example.com",
    purpose: "register",
  });
  assert.equal(requested.ok, true);
  const verificationCode = harness.sentCodes.at(-1)?.code || "";

  const result = await harness.service.register({
    email: "nousername@example.com",
    password: "StrongPass123",
    verificationCode,
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.uiState, "validation_error");
});

test("register seeds new users with trial credits for New API sync", async () => {
  const profiles: NewApiUserSyncProfile[] = [];
  const harness = service({ profiles });
  const previous = process.env.NEW_USER_INITIAL_CREDITS;
  process.env.NEW_USER_INITIAL_CREDITS = "";
  try {
    const result = await registerActiveAccount(harness);
    assert.equal(result.ok, true);
    assert.equal(profiles[0]?.initialQuota, 500);
  } finally {
    if (previous === undefined) delete process.env.NEW_USER_INITIAL_CREDITS;
    else process.env.NEW_USER_INITIAL_CREDITS = previous;
  }
});

test("register keeps the 500 credit signup grant when env is set to zero", async () => {
  const profiles: NewApiUserSyncProfile[] = [];
  const harness = service({ profiles });
  const previous = process.env.NEW_USER_INITIAL_CREDITS;
  process.env.NEW_USER_INITIAL_CREDITS = "0";
  try {
    const result = await registerActiveAccount(harness);
    assert.equal(result.ok, true);
    assert.equal(profiles[0]?.initialQuota, 500);
  } finally {
    if (previous === undefined) delete process.env.NEW_USER_INITIAL_CREDITS;
    else process.env.NEW_USER_INITIAL_CREDITS = previous;
  }
});

test("rejects duplicate registration without creating another account", async () => {
  const harness = service();
  await registerActiveAccount(harness);
  const duplicate = await harness.service.register({
    email: "customer@example.com",
    username: "cust01",
    password: "StrongPass123",
    verificationCode: "000000",
  });

  assert.equal(duplicate.ok, false);
  if (duplicate.ok) return;
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.uiState, "validation_error");
});

test("registration reuses an email after the mapped upstream account was cancelled", async () => {
  const harness = service({
    getNewApiUser: async () => ({
      data: { data: { id: 100, username: "cust01", status: 3 } },
      requestId: "test-upstream-deleted",
      upstreamStatus: 200,
    }),
    sync: (localUserId) => ({
      ...activeMapping(localUserId),
      mapping: {
        ...activeMapping(localUserId).mapping,
        new_api_user_id: "101",
      },
    }),
  });
  const first = await registerActiveAccount(harness);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const requested = await harness.service.requestVerificationCode({
    identifier: "customer@example.com",
    purpose: "register",
  });
  assert.equal(requested.ok, true);
  assert.equal(await harness.repository.getUserByIdentifier("customer@example.com"), null);
  assert.equal(await harness.repository.getUserByIdentifier("cust01"), null);

  const second = await harness.service.register({
    email: "customer@example.com",
    username: "cust01",
    password: "StrongPass123",
    verificationCode: harness.sentCodes.at(-1)?.code || "",
    displayName: "Customer Again",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.notEqual(second.user.local_user_id, first.user.local_user_id);

  const audit = await harness.repository.listAuditEvents();
  assert.equal(audit.some((event) => event.event === "auth.register.identity_released"), true);
});

test("registration reuses an email after New API reports the old account missing", async () => {
  const harness = service({
    getNewApiUser: async () => ({
      data: { success: false, message: "record not found" },
      requestId: "test-upstream-missing",
      upstreamStatus: 200,
    }),
    sync: (localUserId) => ({
      ...activeMapping(localUserId),
      mapping: {
        ...activeMapping(localUserId).mapping,
        new_api_user_id: "102",
      },
    }),
  });
  const first = await registerActiveAccount(harness);
  assert.equal(first.ok, true);
  if (!first.ok) return;

  const requested = await harness.service.requestVerificationCode({
    identifier: "customer@example.com",
    purpose: "register",
  });
  assert.equal(requested.ok, true);

  const second = await harness.service.register({
    email: "customer@example.com",
    username: "cust01",
    password: "StrongPass123",
    verificationCode: harness.sentCodes.at(-1)?.code || "",
    displayName: "Customer Again",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.notEqual(second.user.local_user_id, first.user.local_user_id);

  const audit = await harness.repository.listAuditEvents();
  assert.equal(audit.some((event) => event.event === "auth.register.identity_released" && event.details.reason === "upstream_missing"), true);
});

test("registration releases unmapped New API create-rejected identity", async () => {
  const harness = service();
  const first = await harness.repository.createUser({
    localUserId: "create-rejected-local",
    email: "customer@example.com",
    username: "cust01",
    displayName: "Customer",
    passwordHash: await hashPassword("StrongPass123"),
    status: "active",
    role: "user",
    now: new Date("2026-06-19T00:00:00.000Z"),
  });

  await harness.mappingRepository.createPending({
    localUserId: first.local_user_id,
    idempotencyKey: "register:create-rejected-local",
  });
  await harness.mappingRepository.scheduleRepair({
    localUserId: first.local_user_id,
    code: "NEW_API_USER_CREATE_REJECTED",
    message: "duplicate upstream username",
  });

  const requested = await harness.service.requestVerificationCode({
    identifier: "customer@example.com",
    purpose: "register",
  });
  assert.equal(requested.ok, true);

  const second = await harness.service.register({
    email: "customer@example.com",
    username: "cust01",
    password: "StrongPass123",
    verificationCode: harness.sentCodes.at(-1)?.code || "",
    displayName: "Customer Again",
  });
  assert.equal(second.ok, true);
  if (!second.ok) return;
  assert.notEqual(second.user.local_user_id, first.local_user_id);

  const audit = await harness.repository.listAuditEvents();
  assert.equal(audit.some((event) => event.event === "auth.register.identity_released" && event.details.reason === "mapping_unmapped_create_rejected"), true);
});

test("registration does not release administrator identity from New API status", async () => {
  const harness = service({
    getNewApiUser: async () => ({
      data: { success: false, message: "record not found" },
      requestId: "test-admin-upstream-missing",
      upstreamStatus: 200,
    }),
  });
  const admin = await harness.repository.createUser({
    localUserId: "admin-local",
    email: "admin@example.com",
    username: "admin1",
    displayName: "Admin",
    passwordHash: "hash",
    role: "admin",
    now: new Date("2026-06-19T00:00:00.000Z"),
  });
  await harness.mappingRepository.createPending({
    localUserId: admin.local_user_id,
    idempotencyKey: "register:admin-local",
  });
  await harness.mappingRepository.markActive({
    localUserId: admin.local_user_id,
    newApiUserId: "100",
  });

  const requested = await harness.service.requestVerificationCode({
    identifier: "admin@example.com",
    purpose: "register",
  });
  assert.equal(requested.ok, false);
  if (requested.ok) return;
  assert.equal(requested.status, 409);
  assert.equal((await harness.repository.getUserByIdentifier("admin@example.com"))?.local_user_id, "admin-local");
});

test("rejects phone-only registration until SMS verification is enabled", async () => {
  const harness = service();
  const requested = await harness.service.requestVerificationCode({
    identifier: "13800138000",
    purpose: "register",
  });
  assert.equal(requested.ok, false);
  if (requested.ok) return;
  assert.equal(requested.status, 400);
  assert.equal(requested.uiState, "validation_error");

  const registered = await harness.service.register({
    identifier: "13800138000",
    password: "StrongPass123",
    verificationCode: "000000",
  });
  assert.equal(registered.ok, false);
  if (registered.ok) return;
  assert.equal(registered.status, 400);
  assert.equal(registered.uiState, "validation_error");
});

test("rejects weak password and invalid input", async () => {
  assert(validatePasswordStrength("weak").length > 0);
  assert.deepEqual(validatePasswordStrength("Aa1"), []);
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

test("rejects registration usernames longer than six characters", async () => {
  const result = await service().service.register({
    email: "customer@example.com",
    username: "toolong",
    password: "StrongPass123",
    verificationCode: "000000",
  });

  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 400);
  assert.equal(result.uiState, "validation_error");
});

test("resets a password with a verification code and expires old sessions", async () => {
  const harness = service();
  const registered = await registerActiveAccount(harness);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  const oldToken = registered.session?.token || "";

  const requested = await harness.service.requestVerificationCode({
    identifier: "customer@example.com",
    purpose: "password_reset",
  });
  assert.equal(requested.ok, true);
  const reset = await harness.service.resetPassword({
    identifier: "customer@example.com",
    verificationCode: harness.sentCodes.at(-1)?.code || "",
    password: "NewStrongPass123",
  });
  assert.equal(reset.ok, true);

  const oldSession = await harness.service.currentUser(oldToken);
  assert.equal(oldSession.ok, false);
  const oldLogin = await harness.service.login({
    identifier: "customer@example.com",
    password: "StrongPass123",
  });
  assert.equal(oldLogin.ok, false);
  const newLogin = await harness.service.login({
    identifier: "customer@example.com",
    password: "NewStrongPass123",
  });
  assert.equal(newLogin.ok, true);
});

test("serializes concurrent duplicate registration to one local account", async () => {
  const harness = service();
  const codes: string[] = [];
  for (let index = 0; index < 3; index += 1) {
    const requested = await harness.service.requestVerificationCode({
      identifier: "customer@example.com",
      purpose: "register",
    });
    assert.equal(requested.ok, true);
    codes.push(harness.sentCodes.at(-1)?.code || "");
  }
  const results = await Promise.all(codes.map((verificationCode) => harness.service.register({
    email: "customer@example.com",
    username: "cust01",
    password: "StrongPass123",
    verificationCode,
  })));
  const successCount = results.filter((result) => result.ok).length;
  const failureCount = results.filter((result) => !result.ok).length;

  assert.equal(successCount, 1);
  assert.equal(failureCount, 2);
  assert(await harness.repository.getUserByIdentifier("customer@example.com"));
});

test("returns mapping_pending when B08 sync records retryable mapping failure", async () => {
  const harness = service({ sync: failedMapping });
  const result = await registerActiveAccount(harness);

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.status, 202);
  assert.equal(result.uiState, "mapping_pending");
  assert.equal(result.mappingStatus, "failed");
});

test("logs in with email or username and rotates any existing session", async () => {
  const harness = service();
  const registered = await registerActiveAccount(harness);
  assert.equal(registered.ok, true);
  if (!registered.ok) return;

  const firstSession = registered.session?.token || "";
  const login = await harness.service.login({
    identifier: "cust01",
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

test("logs in with an email verification code", async () => {
  const harness = service();
  await registerActiveAccount(harness);
  const requested = await harness.service.requestVerificationCode({
    identifier: "customer@example.com",
    purpose: "login",
  }, { ip: "127.0.0.1", userAgent: "test" });
  assert.equal(requested.ok, true);
  assert.equal(harness.sentCodes.at(-1)?.purpose, "login");

  const login = await harness.service.login({
    identifier: "customer@example.com",
    verificationCode: harness.sentCodes.at(-1)?.code || "",
    loginMethod: "verification_code",
    rememberMe: true,
  });

  assert.equal(login.ok, true);
  if (!login.ok) return;
  assert.equal(login.uiState, "success");
  assert(login.session?.token);
  assert.equal(login.session?.cookieMaxAgeSeconds, AUTH_SESSION_TTL_SECONDS);
});

test("remember-me login keeps the session cookie for the full session TTL", async () => {
  const harness = service();
  await registerActiveAccount(harness);
  const login = await harness.service.login({
    identifier: "customer@example.com",
    password: "StrongPass123",
    rememberMe: true,
  });

  assert.equal(login.ok, true);
  if (!login.ok) return;
  assert.equal(login.session?.cookieMaxAgeSeconds, AUTH_SESSION_TTL_SECONDS);
});

test("normalizes unsafe redirects to the app root", async () => {
  const harness = service();
  const codeRequest = await harness.service.requestVerificationCode({
    identifier: "redirect@example.com",
    purpose: "register",
  });
  assert.equal(codeRequest.ok, true);
  const registered = await harness.service.register({
    email: "redirect@example.com",
    username: "redir1",
    password: "StrongPass123",
    verificationCode: harness.sentCodes.at(-1)?.code || "",
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
  await registerActiveAccount(harness);

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
  await registerActiveAccount(harness);
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
  await registerActiveAccount(harness);
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

test("rate limits failed login attempts by IP, not identifier", async () => {
  const harness = service({ loginLimiter: new InMemoryRateLimiter(1, 60_000) });
  const first = await harness.service.login({
    identifier: "missing-one@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.44" });
  const second = await harness.service.login({
    identifier: "missing-two@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.44" });

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.status, 429);
  assert.equal(second.retryAfterSeconds, 60);
});

test("successful login does not consume failed-login budget", async () => {
  const harness = service({ loginLimiter: new InMemoryRateLimiter(1, 60_000) });
  await registerActiveAccount(harness);

  const success = await harness.service.login({
    identifier: "customer@example.com",
    password: "StrongPass123",
  }, { ip: "192.0.2.45" });
  const failure = await harness.service.login({
    identifier: "missing@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.45" });

  assert.equal(success.ok, true);
  assert.equal(failure.ok, false);
  if (failure.ok) return;
  assert.equal(failure.status, 401);
});

test("administrator password failures use the stricter limiter", async () => {
  const harness = service({
    adminPasswordLimiter: new InMemoryRateLimiter(1, 60_000),
    loginLimiter: new InMemoryRateLimiter(5, 60_000),
  });
  await harness.repository.createUser({
    email: "admin@example.com",
    username: "admin",
    displayName: "Admin",
    passwordHash: await hashPassword("StrongPass123"),
    status: "active",
    role: "admin",
  });

  const first = await harness.service.login({
    identifier: "admin@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.46" });
  const second = await harness.service.login({
    identifier: "admin@example.com",
    password: "WrongPass123",
  }, { ip: "192.0.2.46" });

  assert.equal(first.ok, false);
  assert.equal(second.ok, false);
  if (second.ok) return;
  assert.equal(second.status, 429);
  assert.equal(second.message, "Too many administrator password attempts.");
});

test("expires sessions by idle timeout and logs out server side", async () => {
  let now = new Date("2026-06-18T00:00:00.000Z");
  const harness = service({ now: () => now });
  const registered = await registerActiveAccount(harness);
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

  const registered = await registerActiveAccount(harness);
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
  const registered = await registerActiveAccount(harness);
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
