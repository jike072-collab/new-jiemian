import { randomUUID } from "node:crypto";
import pg, { type Pool as PgPool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

import { getApplicationDatabaseConfig, safeDatabaseError, type ApplicationDatabaseConfig } from "./config";

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
      migration_count: string;
    }>(
      "select now()::text as server_time, current_database() as database_name, (select count(*)::text from schema_migrations) as migration_count",
    );
    return {
      ok: true,
      requestId,
      database: result.rows[0]?.database_name || "",
      serverTime: result.rows[0]?.server_time || "",
      migrationCount: Number(result.rows[0]?.migration_count || 0),
    };
  } catch (error) {
    return {
      ok: false,
      requestId,
      error: safeDatabaseError(error, requestId),
    };
  }
}
