import "server-only";

import type { NextRequest } from "next/server";

import { isInternalCanvasHostname } from "@/lib/server/auth";
import { getInternalCanvasAccess, getInternalCanvasWorkspaceOwner, InternalCanvasAccessError } from "@/lib/server/internal-canvas-access";

export async function resolveCanvasWorkspaceOwner(request: NextRequest, localUserId: string) {
  if (!isInternalCanvasHostname(request.headers.get("host"))) return localUserId;
  const access = await getInternalCanvasAccess(localUserId);
  if (!access?.enabled) throw new InternalCanvasAccessError("INTERNAL_ACCESS_FORBIDDEN", "当前账号没有内部画布权限。", 403);
  return request.nextUrl.searchParams.get("scope") === "personal"
    ? localUserId
    : getInternalCanvasWorkspaceOwner(localUserId);
}
