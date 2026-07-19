import "@xyflow/react/dist/style.css";
import "./canvas.css";

import type { Metadata } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { CanvasWorkspace } from "@/components/canvas/canvas-workspace";
import { AUTH_SESSION_COOKIE, getAuthService } from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata: Metadata = {
  title: "创作画布 | 奥皇 AI",
  description: "奥皇 AI 内部图片与视频创作画布。",
};

export default async function CanvasPage() {
  const sessionToken = (await cookies()).get(AUTH_SESSION_COOKIE)?.value || null;
  if (!sessionToken) redirect("/login");

  const session = await getAuthService().currentUser(sessionToken).catch(() => null);
  if (!session?.ok) redirect("/login");
  return <CanvasWorkspace accountName={session.user.display_name || session.user.username} isTeamOwner={!session.user.account_owner_id} />;
}
