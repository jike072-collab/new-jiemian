import "server-only";

import type { NextRequest } from "next/server";

import { isInternalCanvasHostname } from "@/lib/server/auth";
import { getInternalCanvasAccess, getInternalCanvasWorkspaceOwner, InternalCanvasAccessError } from "@/lib/server/internal-canvas-access";

export type CanvasWorkspaceScope = "personal" | "shared";

export async function resolveCanvasWorkspace(request: NextRequest, localUserId: string) {
  if (!isInternalCanvasHostname(request.headers.get("host"))) {
    return { ownerId: localUserId, scope: "personal" as const };
  }
  const access = await getInternalCanvasAccess(localUserId);
  if (!access?.enabled) throw new InternalCanvasAccessError("INTERNAL_ACCESS_FORBIDDEN", "当前账号没有内部画布权限。", 403);
  const scope: CanvasWorkspaceScope = request.nextUrl.searchParams.get("scope") === "personal" ? "personal" : "shared";
  return {
    ownerId: scope === "personal" ? localUserId : await getInternalCanvasWorkspaceOwner(localUserId),
    scope,
  };
}

export async function resolveCanvasWorkspaceOwner(request: NextRequest, localUserId: string) {
  return (await resolveCanvasWorkspace(request, localUserId)).ownerId;
}
