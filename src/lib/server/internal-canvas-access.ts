import "server-only";

import type { QueryResultRow } from "pg";

import { normalizeIdentifier } from "./auth/normalize";

async function applicationQuery<T extends QueryResultRow>(text: string, values: unknown[] = []) {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- the standalone auth test compiler requires explicit extensions for this lazy server import.
  const database = await import("./database");
  const query = database.applicationQuery as <Row extends QueryResultRow>(sql: string, params: unknown[]) => Promise<{ rows: Row[] }>;
  return query<T>(text, values);
}

export type InternalCanvasAccessRole = "owner" | "member";

export type InternalCanvasAccess = {
  localUserId: string;
  role: InternalCanvasAccessRole;
  enabled: boolean;
};

export type InternalCanvasAccessCandidate = {
  localUserId: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
  role: InternalCanvasAccessRole | null;
  enabled: boolean;
};

type AccessRow = {
  local_user_id: string;
  access_role: InternalCanvasAccessRole;
  enabled: boolean;
};

export class InternalCanvasAccessError extends Error {
  constructor(
    readonly code: "INTERNAL_ACCESS_FORBIDDEN" | "INTERNAL_ACCESS_NOT_FOUND" | "INTERNAL_ACCESS_INVALID",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "InternalCanvasAccessError";
  }
}

export async function getInternalCanvasAccess(localUserId: string) {
  const result = await applicationQuery<AccessRow>(`
    select local_user_id, access_role, enabled
    from internal_canvas_access
    where local_user_id = $1
  `, [localUserId.trim()]);
  const row = result.rows[0];
  return row ? { localUserId: row.local_user_id, role: row.access_role, enabled: row.enabled } satisfies InternalCanvasAccess : null;
}

export async function canIdentifierAccessInternalCanvas(identifier: string) {
  const normalized = normalizeIdentifier(identifier);
  if (!normalized) return false;
  const result = await applicationQuery<{ allowed: boolean }>(`
    select true as allowed
    from app_users u
    join internal_canvas_access access on access.local_user_id = u.local_user_id
    where (u.email = $1 or u.username = $1 or u.phone = $1)
      and u.status = 'active'
      and access.enabled = true
    limit 1
  `, [normalized]);
  return Boolean(result.rows[0]?.allowed);
}

export async function requireInternalCanvasOwner(localUserId: string) {
  const access = await getInternalCanvasAccess(localUserId);
  if (!access?.enabled || access.role !== "owner") {
    throw new InternalCanvasAccessError("INTERNAL_ACCESS_FORBIDDEN", "只有内部画布所有者可以管理准入账号。", 403);
  }
  return access;
}

export async function listInternalCanvasAccessCandidates(ownerId: string, query = "") {
  await requireInternalCanvasOwner(ownerId);
  const normalizedQuery = normalizeIdentifier(query);
  const pattern = normalizedQuery ? `%${normalizedQuery}%` : "%";
  const result = await applicationQuery<{
    local_user_id: string;
    email: string;
    username: string;
    display_name: string;
    status: string;
    access_role: InternalCanvasAccessRole | null;
    enabled: boolean | null;
  }>(`
    select u.local_user_id, u.email, u.username, u.display_name, u.status,
      access.access_role, access.enabled
    from app_users u
    left join internal_canvas_access access on access.local_user_id = u.local_user_id
    where (u.email like $1 or u.username like $1 or u.display_name like $1)
      and u.status in ('active', 'disabled')
    order by
      case when access.access_role = 'owner' and access.enabled then 0 when access.enabled then 1 else 2 end,
      u.created_at desc
    limit 200
  `, [pattern]);
  return result.rows.map((row) => ({
    localUserId: row.local_user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    status: row.status,
    role: row.access_role,
    enabled: Boolean(row.enabled),
  } satisfies InternalCanvasAccessCandidate));
}

export async function setInternalCanvasAccess(input: {
  ownerId: string;
  targetUserId: string;
  enabled: boolean;
}) {
  await requireInternalCanvasOwner(input.ownerId);
  if (input.ownerId === input.targetUserId && !input.enabled) {
    throw new InternalCanvasAccessError("INTERNAL_ACCESS_INVALID", "不能取消所有者自己的内部画布权限。", 400);
  }
  const target = await applicationQuery<{ local_user_id: string; status: string }>(
    "select local_user_id, status from app_users where local_user_id = $1",
    [input.targetUserId],
  );
  if (!target.rows[0]) throw new InternalCanvasAccessError("INTERNAL_ACCESS_NOT_FOUND", "账号不存在。", 404);
  if (target.rows[0].status !== "active" && input.enabled) {
    throw new InternalCanvasAccessError("INTERNAL_ACCESS_INVALID", "只能授权正常状态的账号。", 400);
  }
  const now = new Date().toISOString();
  const result = await applicationQuery<AccessRow>(`
    insert into internal_canvas_access(local_user_id, access_role, enabled, granted_by, created_at, updated_at)
    values ($1, 'member', $2, $3, $4, $4)
    on conflict (local_user_id) do update
      set enabled = excluded.enabled,
          granted_by = excluded.granted_by,
          updated_at = excluded.updated_at
    returning local_user_id, access_role, enabled
  `, [input.targetUserId, input.enabled, input.ownerId, now]);
  const row = result.rows[0];
  return { localUserId: row.local_user_id, role: row.access_role, enabled: row.enabled } satisfies InternalCanvasAccess;
}
