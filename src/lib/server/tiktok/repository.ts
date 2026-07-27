import "server-only";

import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";

import { applicationQuery, withApplicationTransaction } from "@/lib/server/database/client";
import type { TikTokConnectionRecord, TikTokDeliveryMode, TikTokPrivacyLevel, TikTokPublishJob } from "./types";

type ConnectionRow = QueryResultRow & {
  user_id: string;
  zernio_credential_id?: string;
  zernio_profile_id: string;
  zernio_account_id: string | null;
  display_name: string | null;
  avatar_url: string | null;
  creator_username: string | null;
  connected_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
};

type OAuthStateRow = QueryResultRow & { user_id: string; return_to: string; expires_at: string | Date };

type PublishJobRow = QueryResultRow & {
  id: string;
  user_id: string;
  zernio_credential_id?: string;
  zernio_account_id: string | null;
  source_owner_id: string;
  library_item_id: string;
  idempotency_key: string;
  caption: string;
  privacy_level: TikTokPrivacyLevel;
  disable_comment: boolean;
  disable_duet: boolean;
  disable_stitch: boolean;
  brand_content_toggle: boolean;
  brand_organic_toggle: boolean;
  delivery_mode: TikTokDeliveryMode;
  is_aigc: boolean;
  status: TikTokPublishJob["status"];
  scheduled_at: string | Date;
  next_attempt_at: string | Date;
  attempts: number;
  zernio_post_id: string | null;
  uploaded_bytes: string | number;
  tiktok_post_id: string | null;
  post_url: string | null;
  error_code: string | null;
  error_message: string | null;
  locked_at: string | Date | null;
  locked_by: string | null;
  created_at: string | Date;
  updated_at: string | Date;
  published_at: string | Date | null;
};

function iso(value: string | Date) { return value instanceof Date ? value.toISOString() : new Date(value).toISOString(); }
function optionalIso(value: string | Date | null) { return value ? iso(value) : undefined; }

function connectionFromRow(row: ConnectionRow): TikTokConnectionRecord {
  return {
    userId: row.user_id,
    zernioCredentialId: row.zernio_credential_id || "default",
    zernioProfileId: row.zernio_profile_id,
    zernioAccountId: row.zernio_account_id || undefined,
    displayName: row.display_name || undefined,
    avatarUrl: row.avatar_url || undefined,
    creatorUsername: row.creator_username || undefined,
    connectedAt: optionalIso(row.connected_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function jobFromRow(row: PublishJobRow): TikTokPublishJob {
  return {
    id: row.id,
    userId: row.user_id,
    zernioCredentialId: row.zernio_credential_id || "default",
    zernioAccountId: row.zernio_account_id || undefined,
    sourceOwnerId: row.source_owner_id,
    libraryItemId: row.library_item_id,
    idempotencyKey: row.idempotency_key,
    caption: row.caption,
    privacyLevel: row.privacy_level,
    disableComment: row.disable_comment,
    disableDuet: row.disable_duet,
    disableStitch: row.disable_stitch,
    brandContentToggle: row.brand_content_toggle,
    brandOrganicToggle: row.brand_organic_toggle,
    deliveryMode: row.delivery_mode,
    isAigc: row.is_aigc,
    status: row.status,
    scheduledAt: iso(row.scheduled_at),
    nextAttemptAt: iso(row.next_attempt_at),
    attempts: row.attempts,
    zernioPostId: row.zernio_post_id || undefined,
    uploadedBytes: Number(row.uploaded_bytes) || 0,
    tiktokPostId: row.tiktok_post_id || undefined,
    postUrl: row.post_url || undefined,
    errorCode: row.error_code || undefined,
    errorMessage: row.error_message || undefined,
    lockedAt: optionalIso(row.locked_at),
    lockedBy: row.locked_by || undefined,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    publishedAt: optionalIso(row.published_at),
  };
}

export async function getTikTokConnection(userId: string) {
  const result = await applicationQuery<ConnectionRow>("select * from tiktok_connections where user_id = $1", [userId]);
  return result.rows[0] ? connectionFromRow(result.rows[0]) : null;
}

export async function getTikTokConnectionByAccountId(zernioAccountId: string) {
  const result = await applicationQuery<ConnectionRow>("select * from tiktok_account_bindings where zernio_account_id = $1", [zernioAccountId]);
  return result.rows[0] ? connectionFromRow(result.rows[0]) : null;
}

export async function listTikTokConnections(userId: string) {
  const result = await applicationQuery<ConnectionRow>(`
    select * from tiktok_account_bindings
    where user_id = $1
    order by connected_at, zernio_account_id
  `, [userId]);
  return result.rows.map(connectionFromRow);
}

export async function saveTikTokProfile(input: { userId: string; zernioProfileId: string }) {
  const result = await applicationQuery<ConnectionRow>(`
    insert into tiktok_connections(user_id, zernio_profile_id, created_at, updated_at)
    values ($1,$2,now(),now())
    on conflict (user_id) do update set zernio_profile_id = excluded.zernio_profile_id, updated_at = now()
    returning *
  `, [input.userId, input.zernioProfileId]);
  return connectionFromRow(result.rows[0]);
}

export async function saveTikTokConnection(input: {
  userId: string;
  zernioCredentialId: string;
  zernioProfileId: string;
  zernioAccountId: string;
  displayName: string;
  avatarUrl?: string;
  creatorUsername?: string;
}) {
  const result = await applicationQuery<ConnectionRow>(`
    insert into tiktok_account_bindings(
      user_id, zernio_credential_id, zernio_profile_id, zernio_account_id, display_name, avatar_url, creator_username, connected_at, created_at, updated_at
    ) values ($1,$2,$3,$4,$5,$6,$7,now(),now(),now())
    on conflict (zernio_account_id) do update set
      zernio_credential_id = excluded.zernio_credential_id,
      zernio_profile_id = excluded.zernio_profile_id,
      display_name = excluded.display_name,
      avatar_url = excluded.avatar_url,
      creator_username = excluded.creator_username,
      connected_at = now(),
      updated_at = now()
    where tiktok_account_bindings.user_id = excluded.user_id
    returning *
  `, [input.userId, input.zernioCredentialId, input.zernioProfileId, input.zernioAccountId, input.displayName, input.avatarUrl || null, input.creatorUsername || null]);
  if (!result.rows[0]) throw new Error("TikTok account is already bound to another user.");
  return connectionFromRow(result.rows[0]);
}

export async function clearTikTokConnection(userId: string, zernioAccountId: string) {
  return withApplicationTransaction(async (client) => {
    await client.query(
      "update tiktok_publish_jobs set status = 'canceled', locked_at = null, locked_by = null, updated_at = now() where user_id = $1 and zernio_account_id = $2 and status in ('scheduled','queued')",
      [userId, zernioAccountId],
    );
    await client.query(`
      update tiktok_connections
      set zernio_account_id = null, display_name = null, avatar_url = null, creator_username = null, connected_at = null, updated_at = now()
      where user_id = $1 and zernio_account_id = $2
    `, [userId, zernioAccountId]);
    const result = await client.query<ConnectionRow>(`
      delete from tiktok_account_bindings
      where user_id = $1 and zernio_account_id = $2
      returning *
    `, [userId, zernioAccountId]);
    return result.rows[0] ? connectionFromRow(result.rows[0]) : null;
  });
}

export async function createTikTokOAuthState(input: { stateHash: string; userId: string; returnTo: string; expiresAt: string }) {
  await withApplicationTransaction(async (client) => {
    await client.query("delete from tiktok_oauth_states where expires_at <= now() or user_id = $1", [input.userId]);
    await client.query("insert into tiktok_oauth_states(state_hash, user_id, return_to, expires_at, created_at) values ($1,$2,$3,$4,now())", [input.stateHash, input.userId, input.returnTo, input.expiresAt]);
  });
}

export async function consumeTikTokOAuthState(stateHash: string) {
  const result = await applicationQuery<OAuthStateRow>(`
    delete from tiktok_oauth_states where state_hash = $1 and expires_at > now()
    returning user_id, return_to, expires_at
  `, [stateHash]);
  if (!result.rows[0]) return null;
  return { userId: result.rows[0].user_id, returnTo: result.rows[0].return_to, expiresAt: iso(result.rows[0].expires_at) };
}

export async function createTikTokPublishJob(input: {
  userId: string; zernioCredentialId: string; zernioAccountId: string; sourceOwnerId: string; libraryItemId: string; idempotencyKey: string; caption: string;
  privacyLevel: TikTokPrivacyLevel; disableComment: boolean; disableDuet: boolean; disableStitch: boolean;
  brandContentToggle: boolean; brandOrganicToggle: boolean; deliveryMode: TikTokDeliveryMode; scheduledAt: string;
}) {
  return withApplicationTransaction(async (client) => {
    const created = await client.query<PublishJobRow>(`
      insert into tiktok_publish_jobs(
        id, user_id, source_owner_id, library_item_id, idempotency_key, caption, privacy_level,
        disable_comment, disable_duet, disable_stitch, brand_content_toggle, brand_organic_toggle, delivery_mode,
        zernio_credential_id, zernio_account_id, is_aigc, status, scheduled_at, next_attempt_at, attempts, created_at, updated_at
      ) values (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$16,$15,true,
        case when $14::timestamptz > now() + interval '15 seconds' then 'scheduled' else 'queued' end,
        greatest($14::timestamptz, now()),greatest($14::timestamptz, now()),0,now(),now()
      ) on conflict (user_id, idempotency_key) do nothing returning *
    `, [
      randomUUID(), input.userId, input.sourceOwnerId, input.libraryItemId, input.idempotencyKey, input.caption, input.privacyLevel,
      input.disableComment, input.disableDuet, input.disableStitch, input.brandContentToggle, input.brandOrganicToggle, input.deliveryMode, input.scheduledAt,
      input.zernioAccountId, input.zernioCredentialId,
    ]);
    if (created.rows[0]) return jobFromRow(created.rows[0]);
    const existing = await client.query<PublishJobRow>("select * from tiktok_publish_jobs where user_id = $1 and idempotency_key = $2", [input.userId, input.idempotencyKey]);
    if (!existing.rows[0]) throw new Error("TikTok publish job could not be created.");
    return jobFromRow(existing.rows[0]);
  });
}

export async function listTikTokPublishJobs(userId: string, limit = 30) {
  const result = await applicationQuery<PublishJobRow>("select * from tiktok_publish_jobs where user_id = $1 order by created_at desc limit $2", [userId, Math.min(Math.max(Math.floor(limit), 1), 100)]);
  return result.rows.map(jobFromRow);
}

export async function cancelTikTokPublishJob(userId: string, jobId: string) {
  const result = await applicationQuery<PublishJobRow>(`
    update tiktok_publish_jobs set status = 'canceled', locked_at = null, locked_by = null, updated_at = now()
    where id = $1 and user_id = $2 and status in ('scheduled','queued') returning *
  `, [jobId, userId]);
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

export async function claimDueTikTokPublishJobs(workerId: string, limit = 1) {
  return withApplicationTransaction(async (client) => {
    const selected = await client.query<{ id: string }>(`
      select id from tiktok_publish_jobs
      where status in ('scheduled','queued','uploading','processing') and scheduled_at <= now() and next_attempt_at <= now()
        and (locked_at is null or locked_at < now() - interval '5 minutes')
      order by scheduled_at, created_at for update skip locked limit $1
    `, [Math.min(Math.max(Math.floor(limit), 1), 2)]);
    if (!selected.rows.length) return [];
    const ids = selected.rows.map((row) => row.id);
    const claimed = await client.query<PublishJobRow>(`
      update tiktok_publish_jobs
      set locked_at = now(), locked_by = $2, attempts = attempts + case when zernio_post_id is null then 1 else 0 end,
          status = case when status = 'scheduled' then 'queued' else status end, updated_at = now()
      where id = any($1::uuid[]) returning *
    `, [ids, workerId]);
    return claimed.rows.map(jobFromRow);
  });
}

type ClaimedJobPatch = Partial<Pick<TikTokPublishJob,
  "status" | "zernioPostId" | "tiktokPostId" | "postUrl" | "errorCode" | "errorMessage" |
  "nextAttemptAt" | "publishedAt" | "uploadedBytes"
>> & { releaseLock?: boolean };

export async function updateClaimedTikTokPublishJob(jobId: string, workerId: string, patch: ClaimedJobPatch) {
  const values: unknown[] = [jobId, workerId];
  const assignments: string[] = ["updated_at = now()"];
  const add = (column: string, value: unknown) => { values.push(value); assignments.push(`${column} = $${values.length}`); };
  if (patch.status !== undefined) add("status", patch.status);
  if (patch.zernioPostId !== undefined) add("zernio_post_id", patch.zernioPostId || null);
  if (patch.uploadedBytes !== undefined) add("uploaded_bytes", Math.max(0, Math.floor(patch.uploadedBytes)));
  if (patch.tiktokPostId !== undefined) add("tiktok_post_id", patch.tiktokPostId || null);
  if (patch.postUrl !== undefined) add("post_url", patch.postUrl || null);
  if (patch.errorCode !== undefined) add("error_code", patch.errorCode || null);
  if (patch.errorMessage !== undefined) add("error_message", patch.errorMessage || null);
  if (patch.nextAttemptAt !== undefined) add("next_attempt_at", patch.nextAttemptAt);
  if (patch.publishedAt !== undefined) add("published_at", patch.publishedAt || null);
  if (patch.releaseLock) assignments.push("locked_at = null", "locked_by = null");
  const result = await applicationQuery<PublishJobRow>(`update tiktok_publish_jobs set ${assignments.join(", ")} where id = $1 and locked_by = $2 returning *`, values);
  return result.rows[0] ? jobFromRow(result.rows[0]) : null;
}

export async function unlockTikTokPublishJobForRetry(jobId: string, workerId: string, input: { status: "queued" | "processing" | "failed"; nextAttemptAt: string; errorCode?: string; errorMessage?: string }) {
  return updateClaimedTikTokPublishJob(jobId, workerId, {
    status: input.status,
    nextAttemptAt: input.nextAttemptAt,
    errorCode: input.errorCode,
    errorMessage: input.errorMessage,
    releaseLock: true,
  });
}
