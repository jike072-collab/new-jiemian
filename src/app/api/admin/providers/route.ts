import { type NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/admin-auth";
import { readPublicProviders, updateProviders } from "@/lib/server/providers";
import { type ProviderUpdate } from "@/lib/server/types";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const blocked = requireAdmin(request);
  if (blocked) return blocked;
  return NextResponse.json({ providers: await readPublicProviders() });
}

export async function PUT(request: NextRequest) {
  const blocked = requireAdmin(request);
  if (blocked) return blocked;

  try {
    const body = await request.json() as { providers?: ProviderUpdate[] };
    if (!Array.isArray(body.providers)) {
      return NextResponse.json({ error: "提交格式不正确。" }, { status: 400 });
    }
    return NextResponse.json({ providers: await updateProviders(body.providers) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "保存供应商配置失败。",
    }, { status: 400 });
  }
}
