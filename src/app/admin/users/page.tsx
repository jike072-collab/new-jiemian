import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminUsersClient } from "@/components/admin-users-client";
import { AUTH_SESSION_COOKIE, getAuthService } from "@/lib/server/auth";

export default async function AdminUsersPage() {
  const sessionToken = (await cookies()).get(AUTH_SESSION_COOKIE)?.value || null;
  if (!sessionToken) {
    redirect("/?preview=1");
  }

  let canAccessAdmin = false;
  try {
    const session = await getAuthService().currentUser(sessionToken);
    canAccessAdmin = session.ok && session.user.role === "admin";
  } catch {
    canAccessAdmin = false;
  }

  if (canAccessAdmin) {
    return <AdminUsersClient />;
  }
  redirect("/?preview=1");
}
