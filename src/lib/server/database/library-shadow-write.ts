import "server-only";

import { type LibraryItem } from "../types";
import {
  createStage9cbLibraryDatabaseAdapter,
  type Stage9cbLibraryDatabaseAdapter,
} from "./library-jobs-adapter";

const DEFAULT_LIBRARY_SHADOW_WRITE_TIMEOUT_MS = 2000;

export type LibraryShadowWriteOperation = "addLibraryItem" | "updateLibraryItem" | "softDeleteLibraryItem";

export type LibraryShadowWriteInput =
  | { operation: "addLibraryItem"; item: LibraryItem }
  | { operation: "updateLibraryItem"; id: string; patch: Partial<LibraryItem>; nextItem: LibraryItem }
  | { operation: "softDeleteLibraryItem"; id: string };

export type LibraryShadowWriteStatus = {
  ok: boolean;
  operation: LibraryShadowWriteOperation;
  idempotencyKey: string;
  failureCategory?: "configuration" | "connection" | "query_timeout" | "timeout" | "unique_constraint" | "unknown";
  errorName?: string;
};

type ShadowWriteLogger = Pick<typeof console, "warn">;

type ShadowWriteOptions = {
  adapter?: Stage9cbLibraryDatabaseAdapter;
  timeoutMs?: number;
  logger?: ShadowWriteLogger;
};

class LibraryShadowWriteTimeoutError extends Error {
  constructor() {
    super("Library shadow write timed out.");
    this.name = "LibraryShadowWriteTimeoutError";
  }
}

export function libraryShadowWriteIdempotencyKey(input: LibraryShadowWriteInput) {
  switch (input.operation) {
    case "addLibraryItem":
      return `library:${input.item.id}:add`;
    case "updateLibraryItem":
      return `library:${input.id}:update`;
    case "softDeleteLibraryItem":
      return `library:${input.id}:soft-delete`;
  }
}

function databaseErrorCode(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return "";
  return String((error as { code?: unknown }).code || "");
}

function failureCategory(error: unknown): NonNullable<LibraryShadowWriteStatus["failureCategory"]> {
  if (error instanceof LibraryShadowWriteTimeoutError) return "timeout";
  if (error instanceof Error && (
    error.name === "ApplicationDatabaseConfigError"
    || error.name === "ApplicationDatabaseIdentityError"
  )) {
    return "configuration";
  }

  const code = databaseErrorCode(error);
  if (code === "23505") return "unique_constraint";
  if (code === "57014") return "query_timeout";
  if (["ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "ECONNRESET", "57P01", "57P02", "57P03"].includes(code)) {
    return "connection";
  }
  return "unknown";
}

function errorName(error: unknown) {
  if (error instanceof Error && error.name) return error.name;
  return "UnknownError";
}

function timeoutMs(value: number | undefined) {
  if (!Number.isFinite(value) || !value) return DEFAULT_LIBRARY_SHADOW_WRITE_TIMEOUT_MS;
  return Math.max(1, Math.trunc(value));
}

async function runWithTimeout(action: () => Promise<unknown>, limitMs: number) {
  let timeout: NodeJS.Timeout | undefined;
  const operation = action();
  const limit = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new LibraryShadowWriteTimeoutError()), limitMs);
  });

  try {
    await Promise.race([operation, limit]);
  } finally {
    if (timeout) clearTimeout(timeout);
    operation.catch(() => undefined);
  }
}

async function applyShadowWrite(adapter: Stage9cbLibraryDatabaseAdapter, input: LibraryShadowWriteInput) {
  switch (input.operation) {
    case "addLibraryItem":
      await adapter.addLibraryItem(input.item);
      return;
    case "updateLibraryItem":
      await adapter.updateLibraryItem(input.id, input.patch, input.nextItem);
      return;
    case "softDeleteLibraryItem":
      await adapter.softDeleteLibraryItem(input.id);
      return;
  }
}

function logShadowFailure(status: LibraryShadowWriteStatus, logger: ShadowWriteLogger) {
  logger.warn("library_shadow_write_failed", {
    operation: status.operation,
    idempotencyKey: status.idempotencyKey,
    failureCategory: status.failureCategory,
    errorName: status.errorName,
  });
}

export async function executeLibraryShadowWrite(
  input: LibraryShadowWriteInput,
  options: ShadowWriteOptions = {},
): Promise<LibraryShadowWriteStatus> {
  const operation = input.operation;
  const idempotencyKey = libraryShadowWriteIdempotencyKey(input);
  const adapter = options.adapter || createStage9cbLibraryDatabaseAdapter();

  try {
    await runWithTimeout(() => applyShadowWrite(adapter, input), timeoutMs(options.timeoutMs));
    return { ok: true, operation, idempotencyKey };
  } catch (error) {
    return {
      ok: false,
      operation,
      idempotencyKey,
      failureCategory: failureCategory(error),
      errorName: errorName(error),
    };
  }
}

export function scheduleLibraryShadowWrite(input: LibraryShadowWriteInput, options: ShadowWriteOptions = {}) {
  return executeLibraryShadowWrite(input, options).then((status) => {
    if (!status.ok) logShadowFailure(status, options.logger || console);
    return status;
  });
}
