import "server-only";

import { randomUUID } from "node:crypto";
import pg, { type Pool as PgPool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import {
  ApplicationDatabaseIdentityError,
  getApplicationDatabaseConfig,
  safeDatabaseError,
  type ApplicationDatabaseConfig,
} from "./config";

const { Pool } = pg;

let sharedPool: PgPool | null = null;

function createPool(config: ApplicationDatabaseConfig) {
  return new Pool({
    connectionString: config.connectionString,
    max: config.maxConnections,
    connectionTimeoutMillis: config.connectTimeoutMs,
    idleTimeoutMillis: config.idleTimeoutMs,
    statement_timeout: config.queryTimeoutMs,
    query_timeout: config.queryTimeoutMs,
    application_name: "aohuang_app",
  });
}

export function getApplicationDatabasePool() {
  if (!sharedPool) {
    sharedPool = createPool(getApplicationDatabaseConfig());
  }
  return sharedPool;
}

export async function closeApplicationDatabasePool() {
  if (!sharedPool) return;
  const pool = sharedPool;
  sharedPool = null;
  await pool.end();
}

export async function applicationQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  return getApplicationDatabasePool().query<T>(text, values);
}

export async function withApplicationTransaction<T>(
  operation: (client: PoolClient) => Promise<T>,
) {
  const client = await getApplicationDatabasePool().connect();
  try {
    await client.query("begin");
    const result = await operation(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function assertApplicationDatabaseIdentity(
  client: Pick<PoolClient, "query">,
  expectedDatabaseName = getApplicationDatabaseConfig().expectedDatabaseName,
) {
  const result = await client.query<{ database_name: string }>("select current_database() as database_name");
  const actualDatabaseName = result.rows[0]?.database_name || "";
  if (actualDatabaseName !== expectedDatabaseName) {
    throw new ApplicationDatabaseIdentityError(expectedDatabaseName, actualDatabaseName);
  }
  return actualDatabaseName;
}

export type ApplicationDatabaseHealth =
  | {
      ok: true;
      requestId: string;
      database: string;
      serverTime: string;
      migrationCount: number;
    }
  | {
      ok: false;
      requestId: string;
      error: ReturnType<typeof safeDatabaseError>;
    };

export async function checkApplicationDatabaseHealth(requestId: string = randomUUID()): Promise<ApplicationDatabaseHealth> {
  try {
    const result = await applicationQuery<{
      server_time: string;
      database_name: string;
      migrations_table: string | null;
    }>(
      "select now()::text as server_time, current_database() as database_name, to_regclass('public.schema_migrations') as migrations_table",
    );
    const config = getApplicationDatabaseConfig();
    if (result.rows[0]?.database_name !== config.expectedDatabaseName) {
      throw new ApplicationDatabaseIdentityError(config.expectedDatabaseName, result.rows[0]?.database_name || "");
    }
    const migrationCount = result.rows[0]?.migrations_table
      ? await applicationQuery<{ count: string }>("select count(*)::text as count from schema_migrations")
      : { rows: [{ count: "0" }] };
    return {
      ok: true,
      requestId,
      database: result.rows[0]?.database_name || "",
      serverTime: result.rows[0]?.server_time || "",
      migrationCount: Number(migrationCount.rows[0]?.count || 0),
    };
  } catch (error) {
    return {
      ok: false,
      requestId,
      error: safeDatabaseError(error, requestId),
    };
  }
}
