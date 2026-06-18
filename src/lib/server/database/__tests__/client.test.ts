import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import {
  applicationQuery,
  checkApplicationDatabaseHealth,
  closeApplicationDatabasePool,
  getApplicationDatabaseConfig,
  getApplicationDatabasePool,
  safeDatabaseError,
  withApplicationTransaction,
} from "../index";

const passwordHash = "scrypt$v=1$n=16384$r=8$p=1$len=64$c2FsdA$0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function hasUnsafeDetails(value: unknown) {
  const text = JSON.stringify(value);
  return text.includes("APP_DATABASE_URL")
    || text.includes("postgresql://")
    || text.includes("postgres://")
    || text.includes("super-secret-password")
    || text.includes("db-password");
}

test("withApplicationTransaction commits successful work and releases client", async () => {
  getApplicationDatabaseConfig();
  const pool = getApplicationDatabasePool();
  const originalConnect = pool.connect.bind(pool);
  let releaseCount = 0;
  pool.connect = (async () => {
    const client = await originalConnect();
    const originalRelease = client.release.bind(client);
    client.release = ((...args: Parameters<typeof client.release>) => {
      releaseCount += 1;
      return originalRelease(...args);
    }) as typeof client.release;
    return client;
  }) as typeof pool.connect;

  const localUserId = randomUUID();
  try {
    await withApplicationTransaction(async (client) => {
      await client.query(`
        insert into app_users(
          local_user_id, email, username, display_name, password_hash, status, role,
          session_version, created_at, updated_at
        ) values ($1,$2,$3,'Tx Commit',$4,'active','user',1,now(),now())
      `, [localUserId, `${localUserId}@example.com`, `tx_${localUserId.slice(0, 8)}`, passwordHash]);
    });
    const result = await applicationQuery<{ count: string }>(
      "select count(*)::text as count from app_users where local_user_id = $1",
      [localUserId],
    );
    assert.equal(result.rows[0].count, "1");
    assert.equal(releaseCount, 1);
  } finally {
    pool.connect = originalConnect as typeof pool.connect;
  }
});

test("withApplicationTransaction rolls back failed work and releases client", async () => {
  const pool = getApplicationDatabasePool();
  const originalConnect = pool.connect.bind(pool);
  let releaseCount = 0;
  pool.connect = (async () => {
    const client = await originalConnect();
    const originalRelease = client.release.bind(client);
    client.release = ((...args: Parameters<typeof client.release>) => {
      releaseCount += 1;
      return originalRelease(...args);
    }) as typeof client.release;
    return client;
  }) as typeof pool.connect;

  const localUserId = randomUUID();
  await assert.rejects(async () => {
    try {
      await withApplicationTransaction(async (client) => {
        await client.query(`
          insert into app_users(
            local_user_id, email, username, display_name, password_hash, status, role,
            session_version, created_at, updated_at
          ) values ($1,$2,$3,'Tx Rollback',$4,'active','user',1,now(),now())
        `, [localUserId, `${localUserId}@example.com`, `rb_${localUserId.slice(0, 8)}`, passwordHash]);
        throw new Error("force rollback");
      });
    } finally {
      pool.connect = originalConnect as typeof pool.connect;
    }
  }, /force rollback/);

  const result = await applicationQuery<{ count: string }>(
    "select count(*)::text as count from app_users where local_user_id = $1",
    [localUserId],
  );
  assert.equal(result.rows[0].count, "0");
  assert.equal(releaseCount, 1);
});

test("safeDatabaseError redacts details and classifies retryability", () => {
  const connection = Object.assign(new Error("connect failed postgresql://app:super-secret-password@localhost/db"), {
    code: "ECONNREFUSED",
  });
  const timeout = Object.assign(new Error("canceling statement due to statement timeout"), {
    code: "57014",
  });
  const unique = Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
  const config = Object.assign(new Error("APP_DATABASE_URL is required."), {
    name: "ApplicationDatabaseConfigError",
  });

  const connectionError = safeDatabaseError(connection, "req-connection");
  const timeoutError = safeDatabaseError(timeout, "req-timeout");
  const uniqueError = safeDatabaseError(unique, "req-unique");
  const configError = safeDatabaseError(config, "req-config");

  assert.equal(connectionError.code, "APP_DATABASE_ERROR");
  assert.equal(connectionError.requestId, "req-connection");
  assert.equal(connectionError.retryable, true);
  assert.equal(timeoutError.retryable, true);
  assert.equal(uniqueError.retryable, false);
  assert.equal(configError.retryable, false);
  assert.equal(hasUnsafeDetails(connectionError), false);
  assert.equal(hasUnsafeDetails(timeoutError), false);
  assert.equal(hasUnsafeDetails(uniqueError), false);
  assert.equal(hasUnsafeDetails(configError), false);
});

test("checkApplicationDatabaseHealth returns redacted retryable error when database is unavailable", async () => {
  const previous = {
    url: process.env.APP_DATABASE_URL,
    expected: process.env.APP_DATABASE_EXPECTED_NAME,
    connectTimeout: process.env.APP_DATABASE_CONNECT_TIMEOUT_MS,
    queryTimeout: process.env.APP_DATABASE_QUERY_TIMEOUT_MS,
  };
  await closeApplicationDatabasePool();
  process.env.APP_DATABASE_URL = "postgresql://app:super-secret-password@127.0.0.1:1/aohuang_app_test";
  process.env.APP_DATABASE_EXPECTED_NAME = "aohuang_app_test";
  process.env.APP_DATABASE_CONNECT_TIMEOUT_MS = "100";
  process.env.APP_DATABASE_QUERY_TIMEOUT_MS = "100";

  try {
    const result = await checkApplicationDatabaseHealth("req-health");
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.code, "APP_DATABASE_ERROR");
      assert.equal(result.error.requestId, "req-health");
      assert.equal(result.error.retryable, true);
      assert.equal(hasUnsafeDetails(result.error), false);
    }
  } finally {
    await closeApplicationDatabasePool();
    if (previous.url === undefined) delete process.env.APP_DATABASE_URL;
    else process.env.APP_DATABASE_URL = previous.url;
    if (previous.expected === undefined) delete process.env.APP_DATABASE_EXPECTED_NAME;
    else process.env.APP_DATABASE_EXPECTED_NAME = previous.expected;
    if (previous.connectTimeout === undefined) delete process.env.APP_DATABASE_CONNECT_TIMEOUT_MS;
    else process.env.APP_DATABASE_CONNECT_TIMEOUT_MS = previous.connectTimeout;
    if (previous.queryTimeout === undefined) delete process.env.APP_DATABASE_QUERY_TIMEOUT_MS;
    else process.env.APP_DATABASE_QUERY_TIMEOUT_MS = previous.queryTimeout;
  }
});
