#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Pool } = pg;
const root = fileURLToPath(new URL("../..", import.meta.url));
const version = "013_auth_verification_login_purpose";
const migrationPath = join(root, "db", "migrations", `${version}.sql`);

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const databaseUrl = requiredEnvironment("APP_DATABASE_URL");
const expectedDatabase = requiredEnvironment("APP_DATABASE_EXPECTED_NAME");
const sql = await readFile(migrationPath, "utf8");
const checksum = createHash("sha256").update(sql).digest("hex");
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 5000,
  statement_timeout: 15000,
  query_timeout: 15000,
  application_name: "aohuang_apply_auth_verification_login_013",
});

const client = await pool.connect();
try {
  const identity = await client.query("select current_database() as database_name");
  if (identity.rows[0]?.database_name !== expectedDatabase) {
    throw new Error("Connected database does not match APP_DATABASE_EXPECTED_NAME.");
  }
  const existing = await client.query(
    "select checksum from schema_migrations where version = $1",
    [version],
  );
  if (existing.rows[0]) {
    if (existing.rows[0].checksum !== checksum) throw new Error("Migration 013 checksum mismatch.");
    console.log(`already applied ${version}`);
  } else {
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query(
        "insert into schema_migrations(version, checksum) values ($1, $2)",
        [version, checksum],
      );
      await client.query("commit");
      console.log(`applied ${version}`);
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    }
  }
} finally {
  client.release();
  await pool.end();
}
