import { CustomerLogin } from "@/components/customer-login";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isRegistrationAllowedForHost } from "@/lib/server/auth";

export default async function RegisterPage() {
  if (!isRegistrationAllowedForHost((await headers()).get("host"))) redirect("/login");
  return <CustomerLogin initialMode="register" />;
}
