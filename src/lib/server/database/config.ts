import { randomUUID } from "node:crypto";

export type ApplicationDatabaseConfig = {
  connectionString: string;
  maxConnections: number;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  idleTimeoutMs: number;
  environment: "development" | "test" | "production";
};

function optionalInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return parsed;
}

export function getApplicationDatabaseConfig(): ApplicationDatabaseConfig {
  const environment = (process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test")
    ? process.env.NODE_ENV
    : "development";
  const connectionString = process.env.APP_DATABASE_URL || "";
  if (!connectionString) {
    if (environment === "production") {
      throw new Error("APP_DATABASE_URL is required in production.");
    }
    throw new Error("APP_DATABASE_URL is required for application database operations.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new Error("APP_DATABASE_URL must be a PostgreSQL connection string.");
  }

  return {
    connectionString,
    maxConnections: optionalInt("APP_DATABASE_MAX_CONNECTIONS", 5, 1, 50),
    connectTimeoutMs: optionalInt("APP_DATABASE_CONNECT_TIMEOUT_MS", 5000, 100, 30000),
    queryTimeoutMs: optionalInt("APP_DATABASE_QUERY_TIMEOUT_MS", 10000, 100, 60000),
    idleTimeoutMs: optionalInt("APP_DATABASE_IDLE_TIMEOUT_MS", 30000, 1000, 120000),
    environment,
  };
}

export function safeDatabaseError(error: unknown, requestId: string = randomUUID()) {
  return {
    code: "APP_DATABASE_ERROR",
    message: "Application database operation failed.",
    requestId,
    retryable: true,
    safeDetails: {
      name: error instanceof Error ? error.name : "UnknownError",
    },
  };
}
