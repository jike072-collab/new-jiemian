import { type NextRequest } from "next/server";

import { adminResponse } from "@/lib/server/admin/http";
import { checkProviderHealth } from "@/lib/server/provider-health";
import { readProviders } from "@/lib/server/providers";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminResponse(request, async () => ({
    ok: true,
    status: 200,
    report: await checkProviderHealth({
      mode: "models",
      providers: await readProviders(),
    }),
  }));
}
