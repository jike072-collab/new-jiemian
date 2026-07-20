import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeCanvasDocument, normalizeCanvasTitle, removeLibraryItemsFromCanvasDocument } from "@/lib/canvas/document";
import { mergeCanvasWorkspace } from "@/lib/canvas/merge";
import type { CanvasProject, CanvasProjectDocument } from "@/lib/canvas/types";
import { applicationQuery, withApplicationTransaction } from "@/lib/server/database";

type CanvasProjectRow = {
  id: string;
  title: string;
  document: unknown;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export type CanvasProjectScope = "personal" | "shared";

function normalizeScope(scope: CanvasProjectScope | undefined): CanvasProjectScope {
  return scope === "shared" ? "shared" : "personal";
}

export class CanvasProjectError extends Error {
  constructor(
    readonly code: "CANVAS_PROJECT_LIMIT" | "CANVAS_PROJECT_NOT_FOUND" | "CANVAS_PROJECT_CONFLICT",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "CanvasProjectError";
  }
}

export async function listCanvasProjects(userId: string, scope?: CanvasProjectScope) {
  const workspaceScope = normalizeScope(scope);
  const result = await applicationQuery<CanvasProjectRow>(
    `select id, title, document, version, created_at, updated_at
       from canvas_projects
      where user_id = $1 and workspace_scope = $2
      order by updated_at desc`,
    [userId, workspaceScope],
  );
  return result.rows.map(mapCanvasProject);
}

export async function getCanvasProject(id: string, userId: string, scope?: CanvasProjectScope) {
  const workspaceScope = normalizeScope(scope);
  const result = await applicationQuery<CanvasProjectRow>(
    `select id, title, document, version, created_at, updated_at
       from canvas_projects
      where id = $1 and user_id = $2 and workspace_scope = $3`,
    [id, userId, workspaceScope],
  );
  return result.rows[0] ? mapCanvasProject(result.rows[0]) : null;
}

export async function createCanvasProject(input: {
  userId: string;
  scope?: CanvasProjectScope;
  title: unknown;
  document: unknown;
}) {
  const workspaceScope = normalizeScope(input.scope);
  const count = await applicationQuery<{ count: string }>(
    "select count(*)::text as count from canvas_projects where user_id = $1 and workspace_scope = $2",
    [input.userId, workspaceScope],
  );
  if (Number(count.rows[0]?.count || 0) >= 100) {
    throw new CanvasProjectError("CANVAS_PROJECT_LIMIT", "每个账号最多可以创建 100 个画布。", 409);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = normalizeCanvasTitle(input.title);
  const document = normalizeCanvasDocument(input.document);
  const result = await applicationQuery<CanvasProjectRow>(
    `insert into canvas_projects(id, user_id, workspace_scope, title, document, version, created_at, updated_at)
     values ($1, $2, $3, $4, $5::jsonb, 1, $6, $6)
     returning id, title, document, version, created_at, updated_at`,
    [id, input.userId, workspaceScope, title, JSON.stringify(document), now],
  );
  return mapCanvasProject(result.rows[0]);
}

export async function updateCanvasProject(input: {
  id: string;
  userId: string;
  scope?: CanvasProjectScope;
  title: unknown;
  document: unknown;
  version: unknown;
  baseTitle?: unknown;
  baseDocument?: unknown;
  sourceId?: unknown;
}) {
  const workspaceScope = normalizeScope(input.scope);
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new CanvasProjectError("CANVAS_PROJECT_CONFLICT", "画布版本无效，请刷新后重试。", 409);
  }
  const title = normalizeCanvasTitle(input.title);
  const document = normalizeCanvasDocument(input.document);
  const sourceId = normalizeSourceId(input.sourceId);
  const direct = await writeCanvasProject({ ...input, scope: workspaceScope, title, document, expectedVersion: version, sourceId });
  if (direct) return { project: direct, merged: false, conflictCount: 0 };

  let existing = await getCanvasProject(input.id, input.userId, workspaceScope);
  if (!existing) {
    throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
  }
  if (version > existing.version || input.baseTitle === undefined || input.baseDocument === undefined) {
    throw new CanvasProjectError("CANVAS_PROJECT_CONFLICT", "画布已在其他页面被修改，请刷新后重试。", 409);
  }

  const base = {
    title: normalizeCanvasTitle(input.baseTitle),
    document: normalizeCanvasDocument(input.baseDocument),
  };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const merged = mergeCanvasWorkspace(base, { title, document }, existing);
    const mergedTitle = normalizeCanvasTitle(merged.title);
    const mergedDocument = normalizeCanvasDocument(merged.document);
    const updated = await writeCanvasProject({
      ...input,
      scope: workspaceScope,
      title: mergedTitle,
      document: mergedDocument,
      expectedVersion: existing.version,
      sourceId,
    });
    if (updated) return { project: updated, merged: true, conflictCount: merged.conflictCount };
    const latest = await getCanvasProject(input.id, input.userId, workspaceScope);
    if (!latest) throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
    existing = latest;
  }
  throw new CanvasProjectError("CANVAS_PROJECT_CONFLICT", "画布更新过于频繁，请稍后重试。", 409);
}

export async function deleteCanvasProject(id: string, userId: string, scope?: CanvasProjectScope, sourceIdValue?: unknown) {
  const workspaceScope = normalizeScope(scope);
  const sourceId = normalizeSourceId(sourceIdValue);
  const deletedId = await withApplicationTransaction(async (client) => {
    const result = await client.query<{ id: string }>(
      "delete from canvas_projects where id = $1 and user_id = $2 and workspace_scope = $3 returning id",
      [id, userId, workspaceScope],
    );
    if (!result.rows[0]) return "";
    await client.query("select pg_notify('canvas_project_events', $1)", [JSON.stringify({ type: "deleted", projectId: id, sourceId })]);
    return result.rows[0].id;
  });
  if (!deletedId) {
    throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
  }
  return deletedId;
}

export async function removeLibraryItemsFromCanvasProjects(libraryItemIds: string[]) {
  const ids = Array.from(new Set(libraryItemIds.map((id) => id.trim()).filter(Boolean)));
  if (!ids.length) return { projectsUpdated: 0, nodesRemoved: 0 };

  return withApplicationTransaction(async (client) => {
    const candidates = await client.query<{ id: string; document: unknown; version: number }>(
      `select id, document, version
         from canvas_projects
        where exists (
          select 1
            from jsonb_array_elements(document->'nodes') as node
           where node->'data'->>'libraryItemId' = any($1::text[])
        )
        for update`,
      [ids],
    );
    let projectsUpdated = 0;
    let nodesRemoved = 0;
    for (const candidate of candidates.rows) {
      const result = removeLibraryItemsFromCanvasDocument(candidate.document, ids);
      if (!result.removedNodeIds.length) continue;
      const updated = await client.query<{ version: number }>(
        `update canvas_projects
            set document = $2::jsonb,
                version = version + 1,
                updated_at = $3
          where id = $1 and version = $4
          returning version`,
        [candidate.id, JSON.stringify(result.document), new Date().toISOString(), candidate.version],
      );
      const version = updated.rows[0]?.version;
      if (!version) continue;
      await client.query("select pg_notify('canvas_project_events', $1)", [JSON.stringify({
        type: "project",
        projectId: candidate.id,
        version: Number(version),
      })]);
      projectsUpdated += 1;
      nodesRemoved += result.removedNodeIds.length;
    }
    return { projectsUpdated, nodesRemoved };
  });
}

async function writeCanvasProject(input: {
  id: string;
  userId: string;
  scope?: CanvasProjectScope;
  title: string;
  document: CanvasProjectDocument;
  expectedVersion: number;
  sourceId: string;
}) {
  const workspaceScope = normalizeScope(input.scope);
  const row = await withApplicationTransaction(async (client) => {
    const result = await client.query<CanvasProjectRow>(
      `update canvas_projects
          set title = $4,
              document = $5::jsonb,
              version = version + 1,
              updated_at = $6
        where id = $1 and user_id = $2 and workspace_scope = $3 and version = $7
        returning id, title, document, version, created_at, updated_at`,
      [input.id, input.userId, workspaceScope, input.title, JSON.stringify(input.document), new Date().toISOString(), input.expectedVersion],
    );
    if (!result.rows[0]) return null;
    await client.query("select pg_notify('canvas_project_events', $1)", [JSON.stringify({
      type: "project",
      projectId: input.id,
      version: Number(result.rows[0].version),
      sourceId: input.sourceId,
    })]);
    return result.rows[0];
  });
  return row ? mapCanvasProject(row) : null;
}

function normalizeSourceId(value: unknown) {
  return typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : "";
}

function mapCanvasProject(row: CanvasProjectRow): CanvasProject {
  return {
    id: row.id,
    title: row.title,
    document: normalizeCanvasDocument(row.document),
    version: Number(row.version),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export type { CanvasProjectDocument };
