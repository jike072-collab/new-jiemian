import "server-only";

import { createHash } from "node:crypto";

import {
  createPostgresDatabaseMvpRepository,
  type DatabaseMvpAsset,
  type DatabaseMvpGenerationJob,
  type DatabaseMvpJobStatus,
  type DatabaseMvpLibraryItem,
  DatabaseMvpRepositoryError,
  type PostgresDatabaseMvpRepository,
} from "./mvp-repositories";
import { type JobRecord, type LibraryItem } from "../types";

const JOB_REF_PREFIX = "stage9cb-job-ref:";
const FALLBACK_ASSET_PREFIX = "stage9cb-library-metadata:";
const EXPIRED_ASSET_PREFIX = "stage9cb-library-expired:";
const EXPIRATION_PENDING_ASSET_PREFIX = "stage9cb-library-expiration-pending:";
const UPLOADS_ASSET_PREFIX = "uploads";
const DB_ID_NAMESPACE = "8b7f2345-3a2a-4b6b-a0a8-111111111111";

export type Stage9cbDatabaseRepository = Pick<
  PostgresDatabaseMvpRepository,
  | "createAsset"
  | "getAsset"
  | "createGenerationJob"
  | "getGenerationJob"
  | "updateGenerationJob"
  | "listGenerationJobs"
  | "createLibraryItem"
  | "getLibraryItem"
  | "updateLibraryItem"
  | "softDeleteLibraryItem"
  | "listLibraryItems"
>;

export type Stage9cbLibraryDatabaseAdapter = ReturnType<typeof createStage9cbLibraryDatabaseAdapter>;

function sha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function encodeJobRef(job: JobRecord) {
  const payload = JSON.stringify({
    id: job.id,
    libraryItemId: job.libraryItemId,
    statusUrlHash: sha256(job.statusUrl),
    sourceUrlHash: job.sourceUrl ? sha256(job.sourceUrl) : null,
    billing_task_id: job.billing_task_id || null,
    billing_local_user_id: job.billing_local_user_id || null,
    billing_idempotency_key: job.billing_idempotency_key || null,
    billing_estimated_quota_units: job.billing_estimated_quota_units ?? null,
    billing_state: job.billing_state || null,
    billing_last_error: job.billing_last_error || null,
  });
  return `${JOB_REF_PREFIX}${Buffer.from(payload, "utf8").toString("base64url")}`;
}

function decodeJobRef(asset: DatabaseMvpAsset | null) {
  if (!asset?.path_or_url.startsWith(JOB_REF_PREFIX)) return null;
  try {
    const decoded = Buffer.from(asset.path_or_url.slice(JOB_REF_PREFIX.length), "base64url").toString("utf8");
    const parsed = JSON.parse(decoded) as Partial<JobRecord>;
    return {
      id: String(parsed.id || ""),
      libraryItemId: String(parsed.libraryItemId || ""),
      statusUrl: "",
      sourceUrl: undefined,
      billing_task_id: typeof parsed.billing_task_id === "string" ? parsed.billing_task_id : null,
      billing_local_user_id: typeof parsed.billing_local_user_id === "string" ? parsed.billing_local_user_id : null,
      billing_idempotency_key: typeof parsed.billing_idempotency_key === "string" ? parsed.billing_idempotency_key : null,
      billing_estimated_quota_units: typeof parsed.billing_estimated_quota_units === "number" ? parsed.billing_estimated_quota_units : null,
      billing_state: typeof parsed.billing_state === "string" ? parsed.billing_state : null,
      billing_last_error: typeof parsed.billing_last_error === "string" ? parsed.billing_last_error : null,
    };
  } catch {
    return null;
  }
}

function uuidFromStableText(text: string) {
  const hash = createHash("sha256").update(`${DB_ID_NAMESPACE}:${text}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-${(parseInt(hash.slice(16, 18), 16) & 0x3f | 0x80).toString(16).padStart(2, "0")}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function jsonStatusToDatabase(status: LibraryItem["status"] | JobRecord["status"]): DatabaseMvpJobStatus {
  if (status === "generating") return "running";
  if (status === "done") return "succeeded";
  if (status === "failed") return "failed";
  return "queued";
}

function databaseStatusToJson(status: DatabaseMvpJobStatus): JobRecord["status"] {
  if (status === "running") return "generating";
  if (status === "succeeded") return "done";
  if (status === "failed" || status === "canceled") return "failed";
  return "queued";
}

function kindFromLibraryItem(item: Pick<LibraryItem, "type" | "mode">) {
  return item.mode || item.type;
}

function sourceFromLibraryItem(item: LibraryItem) {
  if (item.mode.includes("upscale")) return "generation";
  return item.providerId ? "generation" : "import";
}

function pathOrUrlFromLibraryItem(item: LibraryItem) {
  if (item.expirationPending) {
    const payload = Buffer.from(JSON.stringify({
      id: item.id,
      stage: item.expirationStage || "pending",
      storedName: item.expirationPendingStoredName || item.output?.storedName || null,
      quarantineName: item.expirationQuarantineName || null,
      at: item.expirationPendingAt || item.updatedAt,
    }), "utf8").toString("base64url");
    return `${EXPIRATION_PENDING_ASSET_PREFIX}${payload}`;
  }
  if (item.output?.storedName) return [UPLOADS_ASSET_PREFIX, item.output.storedName].join("/");
  if (item.output?.sourceUrl) return item.output.sourceUrl;
  if (item.output?.url) return item.output.url;
  if (item.expired) {
    const expiredAt = Buffer.from(item.expiredAt || item.updatedAt, "utf8").toString("base64url");
    return `${EXPIRED_ASSET_PREFIX}${item.id}:${expiredAt}`;
  }
  return `${FALLBACK_ASSET_PREFIX}${item.id}`;
}

function assetIdForLibraryItem(item: LibraryItem) {
  if (item.expirationPending) {
    return uuidFromStableText([
      "asset:expiration-pending",
      item.id,
      item.expirationStage || "pending",
      item.expirationPendingAt || item.updatedAt,
      item.expirationPendingStoredName || item.output?.storedName || "",
      item.expirationQuarantineName || "",
    ].join(":"));
  }
  if (item.output?.storedName) return uuidFromStableText(`asset:stored:${item.output.storedName}`);
  if (item.expired) return uuidFromStableText(`asset:expired:${item.id}:${item.expiredAt || item.updatedAt}`);
  return uuidFromStableText(`asset:library:${item.id}`);
}

function jobDbId(jobId: string) {
  return uuidFromStableText(`job:${jobId}`);
}

function jobRefAssetId(jobId: string) {
  return uuidFromStableText(`job-ref:${jobId}`);
}

function outputFromAsset(asset: DatabaseMvpAsset | null): LibraryItem["output"] | undefined {
  if (!asset) return undefined;
  if (
    asset.path_or_url.startsWith(JOB_REF_PREFIX)
    || asset.path_or_url.startsWith(FALLBACK_ASSET_PREFIX)
    || asset.path_or_url.startsWith(EXPIRED_ASSET_PREFIX)
    || asset.path_or_url.startsWith(EXPIRATION_PENDING_ASSET_PREFIX)
  ) return undefined;
  const storedPrefix = `${UPLOADS_ASSET_PREFIX}/`;
  const storedName = asset.path_or_url.startsWith(storedPrefix) ? asset.path_or_url.slice(storedPrefix.length) : undefined;
  return {
    url: storedName ? `/api/files/${encodeURIComponent(storedName)}` : asset.path_or_url,
    mimeType: asset.mime_type || "application/octet-stream",
    ...(storedName ? { storedName } : {}),
    ...(asset.size_bytes === null ? {} : { size: asset.size_bytes }),
    ...(!storedName ? { sourceUrl: asset.path_or_url } : {}),
  };
}

function expiredFromAsset(asset: DatabaseMvpAsset | null) {
  if (!asset?.path_or_url.startsWith(EXPIRED_ASSET_PREFIX)) return {};
  const [, encoded] = asset.path_or_url.slice(EXPIRED_ASSET_PREFIX.length).split(":");
  if (!encoded) return { expired: true as const };
  try {
    return {
      expired: true as const,
      expiredAt: Buffer.from(encoded, "base64url").toString("utf8"),
    };
  } catch {
    return { expired: true as const };
  }
}

function expirationPendingFromAsset(
  asset: DatabaseMvpAsset | null,
): Pick<LibraryItem, "expirationPending" | "expirationStage" | "expirationPendingAt" | "expirationPendingStoredName" | "expirationQuarantineName"> | Record<string, never> {
  if (!asset?.path_or_url.startsWith(EXPIRATION_PENDING_ASSET_PREFIX)) return {};
  const encoded = asset.path_or_url.slice(EXPIRATION_PENDING_ASSET_PREFIX.length);
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
      stage?: unknown;
      storedName?: unknown;
      quarantineName?: unknown;
      at?: unknown;
    };
    return {
      expirationPending: true as const,
      ...(isExpirationStage(parsed.stage) ? { expirationStage: parsed.stage } : {}),
      ...(typeof parsed.at === "string" ? { expirationPendingAt: parsed.at } : {}),
      ...(typeof parsed.storedName === "string" ? { expirationPendingStoredName: parsed.storedName } : {}),
      ...(typeof parsed.quarantineName === "string" ? { expirationQuarantineName: parsed.quarantineName } : {}),
    };
  } catch {
    return { expirationPending: true as const };
  }
}

function isExpirationStage(value: unknown): value is LibraryItem["expirationStage"] {
  return value === "pending" || value === "quarantined" || value === "fileDeleted";
}

function libraryItemFromDatabase(row: DatabaseMvpLibraryItem, asset: DatabaseMvpAsset | null, job: DatabaseMvpGenerationJob | null): LibraryItem {
  const output = outputFromAsset(asset);
  const expired = expiredFromAsset(asset);
  const expirationPending = expirationPendingFromAsset(asset);
  return {
    id: row.id,
    type: row.kind.includes("video") ? "video" : "image",
    mode: row.kind,
    title: row.title || row.kind,
    prompt: job?.prompt || "",
    providerId: job?.provider || "",
    model: job?.provider_model || "",
    status: job ? databaseStatusToJson(job.status) : "done",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(job?.completed_at ? { completedAt: job.completed_at } : {}),
    ...(output ? { output } : {}),
    params: {},
    ...(job?.user_visible_error ? { error: job.user_visible_error } : {}),
    ...expired,
    ...expirationPending,
    fileAvailable: expired.expired || expirationPending.expirationPending ? false : Boolean(output?.storedName || output?.sourceUrl || output?.url),
  };
}

async function upsertAsset(repository: Stage9cbDatabaseRepository, item: LibraryItem) {
  const id = assetIdForLibraryItem(item);
  const existing = await repository.getAsset(id);
  if (existing) return existing;
  return repository.createAsset({
    id,
    kind: item.type,
    storage_type: item.output?.storedName ? "local" : item.output?.url || item.output?.sourceUrl ? "remote_url" : "external",
    path_or_url: pathOrUrlFromLibraryItem(item),
    mime_type: item.output?.mimeType || null,
    size_bytes: item.output?.size ?? null,
    sha256: null,
    width: null,
    height: null,
    duration_ms: null,
    created_at: item.createdAt,
  });
}

async function ensureJobRefAsset(repository: Stage9cbDatabaseRepository, job: JobRecord) {
  const id = jobRefAssetId(job.id);
  const existing = await repository.getAsset(id);
  if (existing) return existing;
  return repository.createAsset({
    id,
    kind: "job-ref",
    storage_type: "external",
    path_or_url: encodeJobRef(job),
    mime_type: "application/json",
    size_bytes: null,
    sha256: null,
    width: null,
    height: null,
    duration_ms: null,
    created_at: job.createdAt,
  });
}

export function createStage9cbLibraryDatabaseAdapter(repository: Stage9cbDatabaseRepository = createPostgresDatabaseMvpRepository()) {
  return {
    async readLibrary() {
      const rows = await repository.listLibraryItems({ include_deleted: false, limit: 200 });
      const items = await Promise.all(rows.map(async (row) => {
        const [asset, job] = await Promise.all([
          repository.getAsset(row.asset_id),
          row.generation_job_id ? repository.getGenerationJob(row.generation_job_id) : Promise.resolve(null),
        ]);
        return libraryItemFromDatabase(row, asset, job);
      }));
      return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },

    async addLibraryItem(item: LibraryItem) {
      const asset = await upsertAsset(repository, item);
      const dbJobId = item.status === "done" && !item.error ? null : jobDbId(`library:${item.id}`);
      if (dbJobId && !await repository.getGenerationJob(dbJobId)) {
        await repository.createGenerationJob({
          id: dbJobId,
          user_id: null,
          kind: kindFromLibraryItem(item),
          status: jsonStatusToDatabase(item.status),
          prompt: item.prompt,
          input_asset_id: null,
          output_asset_id: item.output ? asset.id : null,
          provider: item.providerId || null,
          provider_model: item.model || null,
          request_hash: null,
          error_code: item.error ? "LIBRARY_ITEM_FAILED" : null,
          user_visible_error: item.error || null,
          internal_error_masked: item.error || null,
          created_at: item.createdAt,
          updated_at: item.updatedAt,
          completed_at: item.status === "done" || item.status === "failed" ? item.completedAt || item.updatedAt : null,
        });
      }
      const existing = await repository.getLibraryItem(item.id);
      if (existing) {
        await repository.updateLibraryItem(item.id, {
          asset_id: asset.id,
          generation_job_id: dbJobId,
          title: item.title,
          kind: kindFromLibraryItem(item),
          source: sourceFromLibraryItem(item),
          updated_at: item.updatedAt,
          is_deleted: false,
          deleted_at: null,
        });
        return item;
      }
      await repository.createLibraryItem({
        id: item.id,
        asset_id: asset.id,
        generation_job_id: dbJobId,
        user_id: null,
        title: item.title,
        kind: kindFromLibraryItem(item),
        source: sourceFromLibraryItem(item),
        created_at: item.createdAt,
        updated_at: item.updatedAt,
      });
      return item;
    },

    async updateLibraryItem(id: string, patch: Partial<LibraryItem>, nextItem?: LibraryItem | null) {
      const current = await repository.getLibraryItem(id);
      if (!current) return null;
      let assetId = current.asset_id;
      if (nextItem) {
        const asset = await upsertAsset(repository, nextItem);
        assetId = asset.id;
      }
      if (current.generation_job_id) {
        await repository.updateGenerationJob(current.generation_job_id, {
          status: jsonStatusToDatabase(nextItem?.status || patch.status || "queued"),
          output_asset_id: nextItem ? (nextItem.output ? assetId : null) : undefined,
          provider: nextItem?.providerId,
          provider_model: nextItem?.model,
          user_visible_error: nextItem?.error || patch.error || null,
          internal_error_masked: nextItem?.error || patch.error || null,
          completed_at: nextItem?.status === "done" || nextItem?.status === "failed" ? nextItem.completedAt || nextItem.updatedAt : undefined,
          updated_at: nextItem?.updatedAt,
        });
      }
      await repository.updateLibraryItem(id, {
        asset_id: assetId,
        title: nextItem?.title || patch.title,
        kind: nextItem ? kindFromLibraryItem(nextItem) : undefined,
        source: nextItem ? sourceFromLibraryItem(nextItem) : undefined,
        updated_at: nextItem?.updatedAt,
      });
      return nextItem || null;
    },

    async softDeleteLibraryItem(id: string) {
      try {
        await repository.softDeleteLibraryItem(id);
      } catch (error) {
        if (error instanceof DatabaseMvpRepositoryError && error.code === "DATABASE_MVP_NOT_FOUND") {
          return { deleted: false };
        }
        throw error;
      }
      return { deleted: true };
    },

    async readJobs() {
      const rows = await repository.listGenerationJobs({ limit: 200 });
      const jobs = await Promise.all(rows.map(async (row): Promise<JobRecord | null> => {
        const ref = decodeJobRef(row.input_asset_id ? await repository.getAsset(row.input_asset_id) : null);
        if (!ref?.id || !ref.libraryItemId) return null;
        return {
          id: ref.id,
          libraryItemId: ref.libraryItemId,
          type: "video",
          ownerLocalUserId: row.user_id,
          providerId: row.provider || "",
          status: databaseStatusToJson(row.status),
          statusUrl: ref.statusUrl,
          sourceUrl: ref.sourceUrl,
          billing_task_id: ref.billing_task_id,
          billing_local_user_id: ref.billing_local_user_id,
          billing_idempotency_key: ref.billing_idempotency_key,
          billing_estimated_quota_units: ref.billing_estimated_quota_units,
          billing_state: ref.billing_state,
          billing_last_error: ref.billing_last_error,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          ...(row.user_visible_error ? { error: row.user_visible_error } : {}),
        };
      }));
      return jobs.filter((job): job is JobRecord => Boolean(job));
    },

    async addJob(job: JobRecord) {
      let linkedLibraryItem: DatabaseMvpLibraryItem | null = null;
      try {
        linkedLibraryItem = await repository.getLibraryItem(job.libraryItemId);
      } catch {
        linkedLibraryItem = null;
      }
      const dbId = linkedLibraryItem?.generation_job_id || jobDbId(job.id);
      const inputAsset = await ensureJobRefAsset(repository, job);
      const existing = await repository.getGenerationJob(dbId);
      if (existing) {
        await repository.updateGenerationJob(dbId, {
          status: jsonStatusToDatabase(job.status),
          input_asset_id: inputAsset.id,
          provider: job.providerId,
          error_code: job.error ? "GENERATION_JOB_FAILED" : null,
          user_visible_error: job.error || null,
          internal_error_masked: job.error || null,
          completed_at: job.status === "done" || job.status === "failed" ? job.updatedAt : null,
          updated_at: job.updatedAt,
        });
      } else {
        await repository.createGenerationJob({
          id: dbId,
          user_id: job.ownerLocalUserId || job.billing_local_user_id || null,
          kind: job.type,
          status: jsonStatusToDatabase(job.status),
          prompt: job.libraryItemId,
          input_asset_id: inputAsset.id,
          output_asset_id: null,
          provider: job.providerId,
          provider_model: null,
          request_hash: sha256(job.libraryItemId),
          error_code: job.error ? "GENERATION_JOB_FAILED" : null,
          user_visible_error: job.error || null,
          internal_error_masked: job.error || null,
          created_at: job.createdAt,
          updated_at: job.updatedAt,
          completed_at: job.status === "done" || job.status === "failed" ? job.updatedAt : null,
        });
      }
      try {
        await repository.updateLibraryItem(job.libraryItemId, {
          generation_job_id: dbId,
          updated_at: job.updatedAt,
        });
      } catch {
        // The jobs adapter can be tested independently from library dual-write.
      }
      return job;
    },

    async updateJob(job: JobRecord) {
      let linkedLibraryItem: DatabaseMvpLibraryItem | null = null;
      try {
        linkedLibraryItem = await repository.getLibraryItem(job.libraryItemId);
      } catch {
        linkedLibraryItem = null;
      }
      const dbId = linkedLibraryItem?.generation_job_id || jobDbId(job.id);
      const existing = await repository.getGenerationJob(dbId);
      if (!existing) return null;
      await repository.updateGenerationJob(dbId, {
        status: jsonStatusToDatabase(job.status),
        error_code: job.error ? "GENERATION_JOB_FAILED" : null,
        user_visible_error: job.error || null,
        internal_error_masked: job.error || null,
        completed_at: job.status === "done" || job.status === "failed" ? job.updatedAt : null,
        updated_at: job.updatedAt,
      });
      return job;
    },
  };
}
