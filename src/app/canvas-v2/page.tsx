import "@xyflow/react/dist/style.css";

import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import "../canvas/canvas.css";
import "./canvas-v2.css";

import { CanvasWorkspace } from "@/components/canvas/canvas-workspace";
import { AUTH_SESSION_COOKIE, getAuthService, isInternalCanvasHostname } from "@/lib/server/auth";
import { getInternalCanvasAccess } from "@/lib/server/internal-canvas-access";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "无限画布新版 | 奥皇 AI",
  description: "基于 VOZEB 工作台布局的奥皇 AI 内部创作画布。",
};

export default async function CanvasV2Page() {
  const sessionToken = (await cookies()).get(AUTH_SESSION_COOKIE)?.value || null;
  if (!sessionToken) redirect("/login");

  const session = await getAuthService().currentUser(sessionToken).catch(() => null);
  if (!session?.ok) redirect("/login");

  const host = (await headers()).get("host");
  const isInternal = isInternalCanvasHostname(host);
  const access = isInternal ? await getInternalCanvasAccess(session.user.local_user_id) : null;
  if (isInternal && !access?.enabled) redirect("/login");

  return (
    <CanvasWorkspace
      accountName={session.user.display_name || session.user.username}
      isTeamOwner={isInternal ? access?.role === "owner" : !session.user.account_owner_id}
      isInternalCanvas={isInternal}
      presentation="vozeb"
    />
  );
}
