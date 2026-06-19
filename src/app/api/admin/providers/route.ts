import { type NextRequest } from "next/server";

import { adminResponse } from "@/lib/server/admin/http";
import { authRequestContext, csrfFailure, readJsonBody, requireCsrf } from "@/lib/server/auth";
import { readPublicProviders, updateProviders } from "@/lib/server/providers";
import { type ProviderUpdate } from "@/lib/server/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  return adminResponse(request, async () => ({
    ok: true,
    status: 200,
    providers: await readPublicProviders(),
  }));
}

export async function PUT(request: NextRequest) {
  if (!requireCsrf(request)) {
    const failure = csrfFailure();
    return Response.json({ ok: false, code: failure.code, message: failure.message }, { status: failure.status });
  }
  const body = await readJsonBody(request) as { providers?: ProviderUpdate[] };
  return adminResponse(request, async () => {
    if (!Array.isArray(body.providers)) {
      return {
        ok: false,
        status: 400,
        code: "admin_invalid_request",
        message: "Provider payload is invalid.",
      };
    }
    return {
      ok: true,
      status: 200,
      providers: await updateProviders(body.providers),
      request_id: authRequestContext(request).requestId || null,
    };
  });
}
