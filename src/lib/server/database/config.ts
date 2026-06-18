import "server-only";

import { randomUUID } from "node:crypto";

export type ApplicationDatabaseConfig = {
  connectionString: string;
  expectedDatabaseName: string;
  maxConnections: number;
  connectTimeoutMs: number;
  queryTimeoutMs: number;
  idleTimeoutMs: number;
  environment: "development" | "test" | "production";
};

export class ApplicationDatabaseConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplicationDatabaseConfigError";
  }
}

function optionalInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new ApplicationDatabaseConfigError(`${name} must be an integer between ${min} and ${max}.`);
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
      throw new ApplicationDatabaseConfigError("APP_DATABASE_URL is required in production.");
    }
    throw new ApplicationDatabaseConfigError("APP_DATABASE_URL is required for application database operations.");
  }
  if (!/^postgres(?:ql)?:\/\//i.test(connectionString)) {
    throw new ApplicationDatabaseConfigError("APP_DATABASE_URL must be a PostgreSQL connection string.");
  }
  const expectedDatabaseName = process.env.APP_DATABASE_EXPECTED_NAME || "";
  if (!expectedDatabaseName) {
    throw new ApplicationDatabaseConfigError("APP_DATABASE_EXPECTED_NAME is required for application database operations.");
  }
  if (!/^[a-zA-Z0-9_][a-zA-Z0-9_-]{0,62}$/.test(expectedDatabaseName)) {
    throw new ApplicationDatabaseConfigError("APP_DATABASE_EXPECTED_NAME must be a valid explicit database name.");
  }

  return {
    connectionString,
    expectedDatabaseName,
    maxConnections: optionalInt("APP_DATABASE_MAX_CONNECTIONS", 5, 1, 50),
    connectTimeoutMs: optionalInt("APP_DATABASE_CONNECT_TIMEOUT_MS", 5000, 100, 30000),
    queryTimeoutMs: optionalInt("APP_DATABASE_QUERY_TIMEOUT_MS", 10000, 100, 60000),
    idleTimeoutMs: optionalInt("APP_DATABASE_IDLE_TIMEOUT_MS", 30000, 1000, 120000),
    environment,
  };
}

export function safeDatabaseError(error: unknown, requestId: string = randomUUID()) {
  const retryable = isRetryableDatabaseError(error);
  return {
    code: "APP_DATABASE_ERROR",
    message: "Application database operation failed.",
    requestId,
    retryable,
    safeDetails: {
      name: error instanceof Error ? error.name : "UnknownError",
      category: databaseErrorCategory(error),
    },
  };
}

function databaseErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return String((error as { code?: unknown }).code || "");
}

function databaseErrorCategory(error: unknown) {
  if (error instanceof Error && error.name === "ApplicationDatabaseConfigError") return "configuration";
  if (error instanceof Error && error.name === "ApplicationDatabaseIdentityError") return "configuration";
  const code = databaseErrorCode(error);
  if (code === "23505") return "unique_constraint";
  if (code === "57014") return "query_timeout";
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "57P01", "57P02", "57P03"].includes(code)) {
    return "connection";
  }
  return "unknown";
}

function isRetryableDatabaseError(error: unknown) {
  const category = databaseErrorCategory(error);
  return category === "connection" || category === "query_timeout" || category === "unknown";
}

export class ApplicationDatabaseIdentityError extends Error {
  constructor(readonly expectedDatabaseName: string, readonly actualDatabaseName: string) {
    super(`Connected to unexpected application database "${actualDatabaseName}".`);
    this.name = "ApplicationDatabaseIdentityError";
  }
}
