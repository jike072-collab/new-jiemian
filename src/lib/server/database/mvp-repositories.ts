import "server-only";

import { randomUUID } from "node:crypto";

import { type QueryResult, type QueryResultRow } from "pg";

import { redactJson, redactSecret } from "../integrations/new-api/redaction";
import { applicationQuery } from "./client";

export type DatabaseMvpJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type DatabaseMvpAsset = {
  id: string;
  kind: string;
  storage_type: string;
  path_or_url: string;
  mime_type: string | null;
  size_bytes: number | null;
  sha256: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  created_at: string;
  deleted_at: string | null;
};

export type DatabaseMvpGenerationJob = {
  id: string;
  user_id: string | null;
  kind: string;
  status: DatabaseMvpJobStatus;
  prompt: string;
  input_asset_id: string | null;
  output_asset_id: string | null;
  provider: string | null;
  provider_model: string | null;
  request_hash: string | null;
  error_code: string | null;
  user_visible_error: string | null;
  internal_error_masked: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
};

export type DatabaseMvpLibraryItem = {
  id: string;
  asset_id: string;
  generation_job_id: string | null;
  user_id: string | null;
  title: string | null;
  kind: string;
  source: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type DatabaseMvpProviderModelSnapshot = {
  id: string;
  provider: string;
  model_id: string;
  display_name: string | null;
  capability: string;
  raw_response_masked: unknown;
  checked_at: string;
  created_at: string;
};

export type DatabaseMvpApiCallLog = {
  id: string;
  provider: string;
  endpoint_kind: string;
  generation_job_id: string | null;
  status: string;
  latency_ms: number | null;
  request_id: string | null;
  error_code: string | null;
  error_masked: string | null;
  created_at: string;
};

export type DatabaseMvpErrorEvent = {
  id: string;
  scope: string;
  severity: string;
  code: string | null;
  message_masked: string;
  context_masked: unknown;
  created_at: string;
};

export type CreateDatabaseMvpAssetInput = Omit<DatabaseMvpAsset, "id" | "created_at" | "deleted_at"> & {
  id?: string;
  created_at?: string | Date;
  deleted_at?: string | Date | null;
};

export type CreateDatabaseMvpGenerationJobInput = Omit<DatabaseMvpGenerationJob, "id" | "status" | "created_at" | "updated_at" | "started_at" | "completed_at" | "error_code" | "user_visible_error" | "internal_error_masked"> & {
  id?: string;
  status?: DatabaseMvpJobStatus;
  created_at?: string | Date;
  updated_at?: string | Date;
  started_at?: string | Date | null;
  completed_at?: string | Date | null;
  error_code?: string | null;
  user_visible_error?: string | null;
  internal_error_masked?: string | null;
};

export type UpdateDatabaseMvpGenerationJobInput = Partial<Pick<
  DatabaseMvpGenerationJob,
  "status" | "input_asset_id" | "output_asset_id" | "provider" | "provider_model" | "error_code" | "user_visible_error" | "internal_error_masked"
>> & {
  updated_at?: string | Date;
  started_at?: string | Date | null;
  completed_at?: string | Date | null;
};

export type CreateDatabaseMvpLibraryItemInput = Omit<DatabaseMvpLibraryItem, "id" | "is_deleted" | "created_at" | "updated_at" | "deleted_at"> & {
  id?: string;
  is_deleted?: boolean;
  created_at?: string | Date;
  updated_at?: string | Date;
  deleted_at?: string | Date | null;
};

export type UpdateDatabaseMvpLibraryItemInput = Partial<Pick<
  DatabaseMvpLibraryItem,
  "asset_id" | "generation_job_id" | "user_id" | "title" | "kind" | "source" | "is_deleted"
>> & {
  updated_at?: string | Date;
  deleted_at?: string | Date | null;
};

export type CreateDatabaseMvpProviderModelSnapshotInput = Omit<DatabaseMvpProviderModelSnapshot, "id" | "created_at" | "checked_at" | "raw_response_masked"> & {
  id?: string;
  raw_response_masked?: unknown;
  checked_at?: string | Date;
  created_at?: string | Date;
};

export type CreateDatabaseMvpApiCallLogInput = Omit<DatabaseMvpApiCallLog, "id" | "created_at" | "error_masked"> & {
  id?: string;
  error_masked?: string | null;
  created_at?: string | Date;
};

export type CreateDatabaseMvpErrorEventInput = Omit<DatabaseMvpErrorEvent, "id" | "created_at" | "message_masked" | "context_masked"> & {
  id?: string;
  message_masked: string;
  context_masked?: unknown;
  created_at?: string | Date;
};

export type DatabaseMvpListGenerationJobsFilter = {
  user_id?: string | null;
  status?: DatabaseMvpJobStatus;
  kind?: string;
  limit?: number;
};

export type DatabaseMvpListLibraryItemsFilter = {
  user_id?: string | null;
  kind?: string;
  include_deleted?: boolean;
  limit?: number;
};

export type DatabaseMvpQuery = <T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
) => Promise<QueryResult<T>>;

type AssetRow = QueryResultRow & DatabaseMvpAsset;
type GenerationJobRow = QueryResultRow & Omit<DatabaseMvpGenerationJob, "status"> & { status: DatabaseMvpJobStatus };
type LibraryItemRow = QueryResultRow & DatabaseMvpLibraryItem;
type ProviderModelSnapshotRow = QueryResultRow & DatabaseMvpProviderModelSnapshot;
type ApiCallLogRow = QueryResultRow & DatabaseMvpApiCallLog;
type ErrorEventRow = QueryResultRow & DatabaseMvpErrorEvent;

function iso(value: Date | string) {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

function isoOrNull(value: Date | string | null) {
  return value === null ? null : iso(value);
}

function timestamp(value?: Date | string) {
  return value ? iso(value) : new Date().toISOString();
}

function optionalTimestamp(value?: Date | string | null) {
  return value === undefined ? null : isoOrNull(value);
}

function optionalText(value: string | null | undefined) {
  const trimmed = String(value || "").trim();
  return trimmed || null;
}

function redactOptionalText(value: string | null | undefined) {
  const trimmed = optionalText(value);
  return trimmed ? redactSecret(trimmed) : null;
}

function redactOptionalJson(value: unknown) {
  if (value === undefined || value === null) return null;
  return redactJson(value);
}

function jsonbParam(value: unknown) {
  const redacted = redactOptionalJson(value);
  return redacted === null ? null : JSON.stringify(redacted);
}

function positiveLimit(value: number | undefined, fallback = 50, max = 200) {
  if (value === undefined) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(value)));
}

function assetFromRow(row: AssetRow): DatabaseMvpAsset {
  return {
    ...row,
    size_bytes: row.size_bytes === null ? null : Number(row.size_bytes),
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    duration_ms: row.duration_ms === null ? null : Number(row.duration_ms),
    created_at: iso(row.created_at),
    deleted_at: isoOrNull(row.deleted_at),
  };
}

function generationJobFromRow(row: GenerationJobRow): DatabaseMvpGenerationJob {
  return {
    ...row,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    started_at: isoOrNull(row.started_at),
    completed_at: isoOrNull(row.completed_at),
  };
}

function libraryItemFromRow(row: LibraryItemRow): DatabaseMvpLibraryItem {
  return {
    ...row,
    is_deleted: Boolean(row.is_deleted),
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    deleted_at: isoOrNull(row.deleted_at),
  };
}

function providerModelSnapshotFromRow(row: ProviderModelSnapshotRow): DatabaseMvpProviderModelSnapshot {
  return {
    ...row,
    checked_at: iso(row.checked_at),
    created_at: iso(row.created_at),
  };
}

function apiCallLogFromRow(row: ApiCallLogRow): DatabaseMvpApiCallLog {
  return {
    ...row,
    latency_ms: row.latency_ms === null ? null : Number(row.latency_ms),
    created_at: iso(row.created_at),
  };
}

function errorEventFromRow(row: ErrorEventRow): DatabaseMvpErrorEvent {
  return {
    ...row,
    created_at: iso(row.created_at),
  };
}

export class DatabaseMvpRepositoryError extends Error {
  constructor(readonly code: "DATABASE_MVP_NOT_FOUND" | "DATABASE_MVP_DUPLICATE", message: string) {
    super(message);
    this.name = "DatabaseMvpRepositoryError";
  }
}

export class PostgresDatabaseMvpRepository {
  constructor(private readonly query: DatabaseMvpQuery = applicationQuery) {}

  async createAsset(input: CreateDatabaseMvpAssetInput) {
    const result = await this.query<AssetRow>(`
      insert into assets(
        id, kind, storage_type, path_or_url, mime_type, size_bytes, sha256,
        width, height, duration_ms, created_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      returning *
    `, [
      input.id || randomUUID(),
      input.kind.trim(),
      input.storage_type.trim(),
      input.path_or_url.trim(),
      optionalText(input.mime_type),
      input.size_bytes ?? null,
      optionalText(input.sha256),
      input.width ?? null,
      input.height ?? null,
      input.duration_ms ?? null,
      timestamp(input.created_at),
      optionalTimestamp(input.deleted_at),
    ]);
    return assetFromRow(result.rows[0]);
  }

  async getAsset(id: string) {
    const result = await this.query<AssetRow>("select * from assets where id = $1", [id.trim()]);
    return result.rows[0] ? assetFromRow(result.rows[0]) : null;
  }

  async createGenerationJob(input: CreateDatabaseMvpGenerationJobInput) {
    const now = timestamp(input.created_at);
    const result = await this.query<GenerationJobRow>(`
      insert into generation_jobs(
        id, user_id, kind, status, prompt, input_asset_id, output_asset_id,
        provider, provider_model, request_hash, error_code, user_visible_error,
        internal_error_masked, created_at, updated_at, started_at, completed_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      returning *
    `, [
      input.id || randomUUID(),
      optionalText(input.user_id),
      input.kind.trim(),
      input.status || "queued",
      input.prompt,
      optionalText(input.input_asset_id),
      optionalText(input.output_asset_id),
      optionalText(input.provider),
      optionalText(input.provider_model),
      optionalText(input.request_hash),
      optionalText(input.error_code),
      redactOptionalText(input.user_visible_error),
      redactOptionalText(input.internal_error_masked),
      now,
      input.updated_at ? timestamp(input.updated_at) : now,
      optionalTimestamp(input.started_at),
      optionalTimestamp(input.completed_at),
    ]);
    return generationJobFromRow(result.rows[0]);
  }

  async getGenerationJob(id: string) {
    const result = await this.query<GenerationJobRow>("select * from generation_jobs where id = $1", [id.trim()]);
    return result.rows[0] ? generationJobFromRow(result.rows[0]) : null;
  }

  async updateGenerationJob(id: string, patch: UpdateDatabaseMvpGenerationJobInput) {
    const values: unknown[] = [id.trim()];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (patch.status !== undefined) add("status", patch.status);
    if (patch.input_asset_id !== undefined) add("input_asset_id", optionalText(patch.input_asset_id));
    if (patch.output_asset_id !== undefined) add("output_asset_id", optionalText(patch.output_asset_id));
    if (patch.provider !== undefined) add("provider", optionalText(patch.provider));
    if (patch.provider_model !== undefined) add("provider_model", optionalText(patch.provider_model));
    if (patch.error_code !== undefined) add("error_code", optionalText(patch.error_code));
    if (patch.user_visible_error !== undefined) add("user_visible_error", redactOptionalText(patch.user_visible_error));
    if (patch.internal_error_masked !== undefined) add("internal_error_masked", redactOptionalText(patch.internal_error_masked));
    if (patch.started_at !== undefined) add("started_at", optionalTimestamp(patch.started_at));
    if (patch.completed_at !== undefined) add("completed_at", optionalTimestamp(patch.completed_at));
    add("updated_at", timestamp(patch.updated_at));

    const result = await this.query<GenerationJobRow>(`
      update generation_jobs
      set ${assignments.join(", ")}
      where id = $1
      returning *
    `, values);
    if (!result.rows[0]) {
      throw new DatabaseMvpRepositoryError("DATABASE_MVP_NOT_FOUND", "Generation job was not found.");
    }
    return generationJobFromRow(result.rows[0]);
  }

  async listGenerationJobs(filter: DatabaseMvpListGenerationJobsFilter = {}) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (filter.user_id !== undefined) {
      if (filter.user_id === null) clauses.push("user_id is null");
      else {
        values.push(filter.user_id.trim());
        clauses.push(`user_id = $${values.length}`);
      }
    }
    if (filter.status) {
      values.push(filter.status);
      clauses.push(`status = $${values.length}`);
    }
    if (filter.kind) {
      values.push(filter.kind.trim());
      clauses.push(`kind = $${values.length}`);
    }
    values.push(positiveLimit(filter.limit));
    const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await this.query<GenerationJobRow>(`
      select *
      from generation_jobs
      ${whereClause}
      order by created_at desc, id desc
      limit $${values.length}
    `, values);
    return result.rows.map(generationJobFromRow);
  }

  async createLibraryItem(input: CreateDatabaseMvpLibraryItemInput) {
    const createdAt = timestamp(input.created_at);
    const result = await this.query<LibraryItemRow>(`
      insert into library_items(
        id, asset_id, generation_job_id, user_id, title, kind, source,
        is_deleted, created_at, updated_at, deleted_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      returning *
    `, [
      input.id || randomUUID(),
      input.asset_id.trim(),
      optionalText(input.generation_job_id),
      optionalText(input.user_id),
      optionalText(input.title),
      input.kind.trim(),
      input.source.trim(),
      Boolean(input.is_deleted),
      createdAt,
      input.updated_at ? timestamp(input.updated_at) : createdAt,
      optionalTimestamp(input.deleted_at),
    ]);
    return libraryItemFromRow(result.rows[0]);
  }

  async listLibraryItems(filter: DatabaseMvpListLibraryItemsFilter = {}) {
    const values: unknown[] = [];
    const clauses: string[] = [];
    if (!filter.include_deleted) clauses.push("is_deleted = false");
    if (filter.user_id !== undefined) {
      if (filter.user_id === null) clauses.push("user_id is null");
      else {
        values.push(filter.user_id.trim());
        clauses.push(`user_id = $${values.length}`);
      }
    }
    if (filter.kind) {
      values.push(filter.kind.trim());
      clauses.push(`kind = $${values.length}`);
    }
    values.push(positiveLimit(filter.limit));
    const whereClause = clauses.length ? `where ${clauses.join(" and ")}` : "";
    const result = await this.query<LibraryItemRow>(`
      select *
      from library_items
      ${whereClause}
      order by created_at desc, id desc
      limit $${values.length}
    `, values);
    return result.rows.map(libraryItemFromRow);
  }

  async getLibraryItem(id: string) {
    const result = await this.query<LibraryItemRow>("select * from library_items where id = $1", [id.trim()]);
    return result.rows[0] ? libraryItemFromRow(result.rows[0]) : null;
  }

  async updateLibraryItem(id: string, patch: UpdateDatabaseMvpLibraryItemInput) {
    const values: unknown[] = [id.trim()];
    const assignments: string[] = [];
    const add = (column: string, value: unknown) => {
      values.push(value);
      assignments.push(`${column} = $${values.length}`);
    };

    if (patch.asset_id !== undefined) add("asset_id", patch.asset_id.trim());
    if (patch.generation_job_id !== undefined) add("generation_job_id", optionalText(patch.generation_job_id));
    if (patch.user_id !== undefined) add("user_id", optionalText(patch.user_id));
    if (patch.title !== undefined) add("title", optionalText(patch.title));
    if (patch.kind !== undefined) add("kind", patch.kind.trim());
    if (patch.source !== undefined) add("source", patch.source.trim());
    if (patch.is_deleted !== undefined) add("is_deleted", Boolean(patch.is_deleted));
    if (patch.deleted_at !== undefined) add("deleted_at", optionalTimestamp(patch.deleted_at));
    add("updated_at", timestamp(patch.updated_at));

    const result = await this.query<LibraryItemRow>(`
      update library_items
      set ${assignments.join(", ")}
      where id = $1
      returning *
    `, values);
    if (!result.rows[0]) {
      throw new DatabaseMvpRepositoryError("DATABASE_MVP_NOT_FOUND", "Library item was not found.");
    }
    return libraryItemFromRow(result.rows[0]);
  }

  async softDeleteLibraryItem(id: string, deletedAt: string | Date = new Date()) {
    return this.updateLibraryItem(id, {
      is_deleted: true,
      deleted_at: deletedAt,
      updated_at: deletedAt,
    });
  }

  async appendProviderModelSnapshot(input: CreateDatabaseMvpProviderModelSnapshotInput) {
    const createdAt = timestamp(input.created_at);
    const result = await this.query<ProviderModelSnapshotRow>(`
      insert into provider_model_snapshots(
        id, provider, model_id, display_name, capability, raw_response_masked, checked_at, created_at
      ) values ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
      returning *
    `, [
      input.id || randomUUID(),
      input.provider.trim(),
      input.model_id.trim(),
      optionalText(input.display_name),
      input.capability.trim(),
      jsonbParam(input.raw_response_masked),
      input.checked_at ? timestamp(input.checked_at) : createdAt,
      createdAt,
    ]);
    return providerModelSnapshotFromRow(result.rows[0]);
  }

  async listProviderModelSnapshots(provider: string, limit = 50) {
    const result = await this.query<ProviderModelSnapshotRow>(`
      select *
      from provider_model_snapshots
      where provider = $1
      order by checked_at desc, id desc
      limit $2
    `, [provider.trim(), positiveLimit(limit)]);
    return result.rows.map(providerModelSnapshotFromRow);
  }

  async appendApiCallLog(input: CreateDatabaseMvpApiCallLogInput) {
    const result = await this.query<ApiCallLogRow>(`
      insert into api_call_logs(
        id, provider, endpoint_kind, generation_job_id, status, latency_ms,
        request_id, error_code, error_masked, created_at
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      returning *
    `, [
      input.id || randomUUID(),
      input.provider.trim(),
      input.endpoint_kind.trim(),
      optionalText(input.generation_job_id),
      input.status.trim(),
      input.latency_ms ?? null,
      optionalText(input.request_id),
      optionalText(input.error_code),
      redactOptionalText(input.error_masked),
      timestamp(input.created_at),
    ]);
    return apiCallLogFromRow(result.rows[0]);
  }

  async listApiCallLogsForJob(generationJobId: string, limit = 50) {
    const result = await this.query<ApiCallLogRow>(`
      select *
      from api_call_logs
      where generation_job_id = $1
      order by created_at desc, id desc
      limit $2
    `, [generationJobId.trim(), positiveLimit(limit)]);
    return result.rows.map(apiCallLogFromRow);
  }

  async appendErrorEvent(input: CreateDatabaseMvpErrorEventInput) {
    const result = await this.query<ErrorEventRow>(`
      insert into error_events(
        id, scope, severity, code, message_masked, context_masked, created_at
      ) values ($1,$2,$3,$4,$5,$6::jsonb,$7)
      returning *
    `, [
      input.id || randomUUID(),
      input.scope.trim(),
      input.severity.trim(),
      optionalText(input.code),
      redactSecret(input.message_masked),
      jsonbParam(input.context_masked),
      timestamp(input.created_at),
    ]);
    return errorEventFromRow(result.rows[0]);
  }

  async listErrorEvents(scope: string, limit = 50) {
    const result = await this.query<ErrorEventRow>(`
      select *
      from error_events
      where scope = $1
      order by created_at desc, id desc
      limit $2
    `, [scope.trim(), positiveLimit(limit)]);
    return result.rows.map(errorEventFromRow);
  }
}

export function createPostgresDatabaseMvpRepository(query?: DatabaseMvpQuery) {
  return new PostgresDatabaseMvpRepository(query);
}
