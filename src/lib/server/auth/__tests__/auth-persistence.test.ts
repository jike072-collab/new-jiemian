import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { after, test } from "node:test";

import { applicationQuery, closeApplicationDatabasePool } from "../../database";
import { createMemoryNewApiUserMappingRepository, type NewApiUserSyncProfile, type NewApiUserSyncResult } from "../../integrations/new-api";
import { createPostgresNewApiUserMappingRepository } from "../../integrations/new-api/postgres-user-mapping";
import { AuthPersistenceConfigError, createAuthPersistenceRepositories, getAuthPersistenceMode } from "../persistence";
import { createPostgresAuthRepository } from "../postgres-repository";
import { AuthService } from "../service";

const passwordHash = "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
const hasDatabase = Boolean(process.env.APP_DATABASE_URL && process.env.APP_DATABASE_EXPECTED_NAME);
const dbTest = hasDatabase ? test : test.skip;

function setNodeEnv(value: string | undefined) {
  if (value === undefined) delete (process.env as Record<string, string | undefined>).NODE_ENV;
  else (process.env as Record<string, string | undefined>).NODE_ENV = value;
}

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

function serviceWithPostgresMapping() {
  const repository = createPostgresAuthRepository();
  const mappingRepository = createPostgresNewApiUserMappingRepository();
  return new AuthService({
    repository,
    mappingRepository,
    userSyncService: {
      ensureMapped: async (profile: NewApiUserSyncProfile) => {
        const result = activeMapping(profile.localUserId);
        await mappingRepository.createPending({
          localUserId: result.mapping.local_user_id,
          idempotencyKey: result.mapping.idempotency_key,
        });
        await mappingRepository.markActive({
          localUserId: result.mapping.local_user_id,
          newApiUserId: result.mapping.new_api_user_id!,
        });
        return result;
      },
    },
  });
}

test("production auth persistence mode fails closed when missing or invalid", () => {
  const previousMode = process.env.APP_AUTH_PERSISTENCE_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.APP_AUTH_PERSISTENCE_MODE;
    setNodeEnv("production");
    assert.throws(() => getAuthPersistenceMode(), AuthPersistenceConfigError);

    process.env.APP_AUTH_PERSISTENCE_MODE = "sqlite";
    assert.throws(() => getAuthPersistenceMode(), AuthPersistenceConfigError);
  } finally {
    if (previousMode === undefined) delete process.env.APP_AUTH_PERSISTENCE_MODE;
    else process.env.APP_AUTH_PERSISTENCE_MODE = previousMode;
    setNodeEnv(previousNodeEnv);
  }
});

test("json mode remains the non-production default", () => {
  const previousMode = process.env.APP_AUTH_PERSISTENCE_MODE;
  const previousNodeEnv = process.env.NODE_ENV;
  try {
    delete process.env.APP_AUTH_PERSISTENCE_MODE;
    setNodeEnv("development");
    assert.equal(getAuthPersistenceMode(), "json");
    assert.equal(createAuthPersistenceRepositories().mode, "json");
  } finally {
    if (previousMode === undefined) delete process.env.APP_AUTH_PERSISTENCE_MODE;
    else process.env.APP_AUTH_PERSISTENCE_MODE = previousMode;
    setNodeEnv(previousNodeEnv);
  }
});

dbTest("postgres auth repository supports user, session, audit, and duplicate protection", async () => {
  await applicationQuery("truncate table audit_events, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
  const repository = createPostgresAuthRepository();
  const user = await repository.createUser({
    localUserId: randomUUID(),
    email: "pg-customer@example.com",
    username: "pg-customer",
    displayName: "PG Customer",
    passwordHash,
    now: new Date("2026-06-18T00:00:00.000Z"),
  });

  assert.equal((await repository.getUserByIdentifier("PG-CUSTOMER@example.com"))?.local_user_id, user.local_user_id);
  await assert.rejects(() => repository.createUser({
    localUserId: randomUUID(),
    email: "pg-customer@example.com",
    username: "other-pg-customer",
    displayName: "Duplicate",
    passwordHash,
  }));

  const session = await repository.createSession({
    session_id: randomUUID(),
    local_user_id: user.local_user_id,
    token_hash: "a".repeat(64),
    session_version: 1,
    created_at: "2026-06-18T00:00:00.000Z",
    updated_at: "2026-06-18T00:00:00.000Z",
    last_seen_at: "2026-06-18T00:00:00.000Z",
    idle_expires_at: "2026-06-18T01:00:00.000Z",
    expires_at: "2026-06-19T00:00:00.000Z",
    revoked_at: null,
    user_agent_hash: null,
    ip_hash: null,
  });
  assert.equal((await repository.getSessionByTokenHash("a".repeat(64)))?.session_id, session.session_id);
  assert.equal((await repository.revokeSession(session.session_id))?.revoked_at !== null, true);

  await repository.appendAudit({
    id: randomUUID(),
    event: "auth.test",
    local_user_id: user.local_user_id,
    created_at: "2026-06-18T00:00:00.000Z",
    request_id: "req-test",
    ip_hash: null,
    user_agent_hash: null,
    details: { safe: true },
  });
  assert.equal((await repository.listAuditEvents()).length, 1);
});

dbTest("postgres mapping repository preserves state transitions and optimistic version checks", async () => {
  await applicationQuery("truncate table audit_events, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
  const auth = createPostgresAuthRepository();
  const user = await auth.createUser({
    localUserId: randomUUID(),
    email: "mapping-owner@example.com",
    username: "mapping-owner",
    displayName: "Mapping Owner",
    passwordHash,
  });
  const repository = createPostgresNewApiUserMappingRepository();
  const pending = await repository.createPending({
    localUserId: user.local_user_id,
    idempotencyKey: `register:${user.local_user_id}`,
  });
  const active = await repository.markActive({
    localUserId: user.local_user_id,
    newApiUserId: 101,
    expectedVersion: pending.version,
  });
  assert.equal(active.sync_status, "active");
  assert.equal(active.new_api_user_id, "101");

  await assert.rejects(() => repository.markFailed({
    localUserId: user.local_user_id,
    code: "STALE",
    message: "stale version",
    retryable: true,
    expectedVersion: pending.version,
  }));
});

dbTest("auth service can register, login, refresh, and logout on postgres repositories", async () => {
  await applicationQuery("truncate table audit_events, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
  const auth = serviceWithPostgresMapping();
  const registered = await auth.register({
    email: "service-pg@example.com",
    username: "service-pg",
    password: "StrongPass123",
    displayName: "Service PG",
  });
  assert.equal(registered.ok, true);
  if (!registered.ok) return;
  assert.equal(registered.mappingStatus, "active");

  const login = await auth.login({
    identifier: "service-pg",
    password: "StrongPass123",
    existingSessionToken: registered.session?.token,
  });
  assert.equal(login.ok, true);
  if (!login.ok) return;

  const current = await auth.currentUser(login.session?.token);
  assert.equal(current.ok, true);
  const refreshed = await auth.refreshSession(login.session?.token);
  assert.equal(refreshed.ok, true);
  await auth.logout(login.session?.token);
  assert.equal((await auth.currentUser(login.session?.token)).ok, false);
});

dbTest("postgres unique constraints serialize concurrent duplicate registration", async () => {
  await applicationQuery("truncate table audit_events, new_api_user_mappings, auth_sessions, app_users restart identity cascade");
  const mappingRepository = createMemoryNewApiUserMappingRepository();
  const auth = new AuthService({
    repository: createPostgresAuthRepository(),
    mappingRepository,
    userSyncService: {
      ensureMapped: async (profile: NewApiUserSyncProfile) => {
        const result = activeMapping(profile.localUserId);
        await mappingRepository.createPending({ localUserId: profile.localUserId });
        await mappingRepository.markActive({ localUserId: profile.localUserId, newApiUserId: result.mapping.new_api_user_id! });
        return result;
      },
    },
  });

  const results = await Promise.all(Array.from({ length: 5 }, () => auth.register({
    email: "race-pg@example.com",
    username: "race-pg",
    password: "StrongPass123",
  })));
  assert.equal(results.filter((result) => result.ok).length, 1);
  assert.equal(results.filter((result) => !result.ok && result.status === 409).length, 4);
});

dbTest("auth data migration dry-run, apply, idempotency, and verify keep redacted output", async () => {
  const sourceDir = await mkdtemp(join(tmpdir(), "auth-migration-"));
  try {
    const localUserId = randomUUID();
    const sessionId = randomUUID();
    await writeFile(join(sourceDir, "auth-store.json"), JSON.stringify({
      users: [{
        local_user_id: localUserId,
        email: "migrate@example.com",
        username: "migrate-user",
        display_name: "Migrate User",
        password_hash: passwordHash,
        status: "active",
        role: "user",
        session_version: 1,
        created_at: "2026-06-18T00:00:00.000Z",
        updated_at: "2026-06-18T00:00:00.000Z",
        last_login_at: null,
      }],
      sessions: [{
        session_id: sessionId,
        local_user_id: localUserId,
        token_hash: "b".repeat(64),
        session_version: 1,
        created_at: "2026-06-18T00:00:00.000Z",
        updated_at: "2026-06-18T00:00:00.000Z",
        last_seen_at: "2026-06-18T00:00:00.000Z",
        idle_expires_at: "2026-06-18T01:00:00.000Z",
        expires_at: "2026-06-19T00:00:00.000Z",
        revoked_at: null,
        user_agent_hash: null,
        ip_hash: null,
      }],
      audit: [],
    }), "utf8");
    await writeFile(join(sourceDir, "new-api-user-mappings.json"), JSON.stringify([{
      local_user_id: localUserId,
      new_api_user_id: "200",
      sync_status: "active",
      created_at: "2026-06-18T00:00:00.000Z",
      updated_at: "2026-06-18T00:00:00.000Z",
      last_sync_at: "2026-06-18T00:00:00.000Z",
      last_error_code: null,
      last_error_message: null,
      retry_count: 0,
      version: 2,
      idempotency_key: `register:${localUserId}`,
    }]), "utf8");

    const env = { ...process.env, APP_AUTH_MIGRATION_DATA_DIR: sourceDir };
    for (const args of [
      ["scripts/database/auth-data-migration.mjs", "dry-run"],
      ["scripts/database/auth-data-migration.mjs", "apply", "--confirm-apply"],
      ["scripts/database/auth-data-migration.mjs", "apply", "--confirm-apply"],
      ["scripts/database/auth-data-migration.mjs", "verify"],
      ["scripts/database/verify-auth-persistence.mjs"],
    ]) {
      const result = spawnSync("node", args, { cwd: process.cwd(), env, encoding: "utf8", shell: process.platform === "win32" });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stdout.includes(localUserId), false);
      assert.equal(result.stdout.includes("b".repeat(64)), false);
      assert.equal(result.stdout.includes("StrongPass123"), false);
    }
  } finally {
    await rm(sourceDir, { recursive: true, force: true });
  }
});

after(async () => {
  await closeApplicationDatabasePool();
});
