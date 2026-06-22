import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { AdminProvidersClient } from "@/components/admin-providers-client";
import { AUTH_SESSION_COOKIE, getAuthService } from "@/lib/server/auth";

export default async function AdminProvidersPage() {
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
  if (!canAccessAdmin) redirect("/?preview=1");

  return <AdminProvidersClient />;
}
