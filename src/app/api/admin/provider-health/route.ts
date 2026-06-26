import { type NextRequest } from "next/server";

import { adminResponse } from "@/lib/server/admin/http";
import { checkProviderHealth, type ProviderHealthMode } from "@/lib/server/provider-health";
import { readProviders } from "@/lib/server/providers";

export const runtime = "nodejs";

const modes = new Set<ProviderHealthMode>(["static", "connectivity", "models"]);

function parseMode(value: string | null): ProviderHealthMode {
  return modes.has(value as ProviderHealthMode) ? value as ProviderHealthMode : "static";
}

export async function GET(request: NextRequest) {
  const mode = parseMode(request.nextUrl.searchParams.get("mode"));
  return adminResponse(request, async () => ({
    ok: true,
    status: 200,
    report: await checkProviderHealth({
      mode,
      providers: await readProviders(),
    }),
  }));
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { mode?: string };
  const mode = parseMode(typeof body.mode === "string" ? body.mode : null);
  return adminResponse(request, async () => ({
    ...(body.mode && !modes.has(body.mode as ProviderHealthMode)
      ? {
          ok: false as const,
          status: 400,
          code: "admin_invalid_request" as const,
          message: "Provider health mode is invalid.",
        }
      : {
          ok: true as const,
          status: 200,
          report: await checkProviderHealth({
            mode,
            providers: await readProviders(),
          }),
        }),
  }));
}
