import { CustomerLogin } from "@/components/customer-login";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function LoginPage() {
  return <CustomerLogin />;
}
