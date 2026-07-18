import "server-only";

import { randomUUID } from "node:crypto";

import { normalizeCanvasDocument, normalizeCanvasTitle } from "@/lib/canvas/document";
import type { CanvasProject, CanvasProjectDocument } from "@/lib/canvas/types";
import { applicationQuery } from "@/lib/server/database";

type CanvasProjectRow = {
  id: string;
  title: string;
  document: unknown;
  version: number;
  created_at: string | Date;
  updated_at: string | Date;
};

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

export async function listCanvasProjects(userId: string) {
  const result = await applicationQuery<CanvasProjectRow>(
    `select id, title, document, version, created_at, updated_at
       from canvas_projects
      where user_id = $1
      order by updated_at desc`,
    [userId],
  );
  return result.rows.map(mapCanvasProject);
}

export async function getCanvasProject(id: string, userId: string) {
  const result = await applicationQuery<CanvasProjectRow>(
    `select id, title, document, version, created_at, updated_at
       from canvas_projects
      where id = $1 and user_id = $2`,
    [id, userId],
  );
  return result.rows[0] ? mapCanvasProject(result.rows[0]) : null;
}

export async function createCanvasProject(input: {
  userId: string;
  title: unknown;
  document: unknown;
}) {
  const count = await applicationQuery<{ count: string }>(
    "select count(*)::text as count from canvas_projects where user_id = $1",
    [input.userId],
  );
  if (Number(count.rows[0]?.count || 0) >= 100) {
    throw new CanvasProjectError("CANVAS_PROJECT_LIMIT", "每个账号最多可以创建 100 个画布。", 409);
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  const title = normalizeCanvasTitle(input.title);
  const document = normalizeCanvasDocument(input.document);
  const result = await applicationQuery<CanvasProjectRow>(
    `insert into canvas_projects(id, user_id, title, document, version, created_at, updated_at)
     values ($1, $2, $3, $4::jsonb, 1, $5, $5)
     returning id, title, document, version, created_at, updated_at`,
    [id, input.userId, title, JSON.stringify(document), now],
  );
  return mapCanvasProject(result.rows[0]);
}

export async function updateCanvasProject(input: {
  id: string;
  userId: string;
  title: unknown;
  document: unknown;
  version: unknown;
}) {
  const version = Number(input.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new CanvasProjectError("CANVAS_PROJECT_CONFLICT", "画布版本无效，请刷新后重试。", 409);
  }
  const title = normalizeCanvasTitle(input.title);
  const document = normalizeCanvasDocument(input.document);
  const result = await applicationQuery<CanvasProjectRow>(
    `update canvas_projects
        set title = $3,
            document = $4::jsonb,
            version = version + 1,
            updated_at = $5
      where id = $1 and user_id = $2 and version = $6
      returning id, title, document, version, created_at, updated_at`,
    [input.id, input.userId, title, JSON.stringify(document), new Date().toISOString(), version],
  );
  if (result.rows[0]) return mapCanvasProject(result.rows[0]);
  const existing = await getCanvasProject(input.id, input.userId);
  if (!existing) {
    throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
  }
  throw new CanvasProjectError("CANVAS_PROJECT_CONFLICT", "画布已在其他页面被修改，请刷新后重试。", 409);
}

export async function deleteCanvasProject(id: string, userId: string) {
  const result = await applicationQuery<{ id: string }>(
    "delete from canvas_projects where id = $1 and user_id = $2 returning id",
    [id, userId],
  );
  if (!result.rows[0]) {
    throw new CanvasProjectError("CANVAS_PROJECT_NOT_FOUND", "未找到画布。", 404);
  }
  return result.rows[0].id;
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
