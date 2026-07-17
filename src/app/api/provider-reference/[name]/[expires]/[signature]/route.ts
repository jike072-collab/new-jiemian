import { type NextRequest } from "next/server";

import { serveProviderReference } from "../../route";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ name: string; expires: string; signature: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const { name, expires, signature } = await context.params;
  return serveProviderReference(request, name, expires, signature, false);
}

export async function HEAD(request: NextRequest, context: RouteContext) {
  const { name, expires, signature } = await context.params;
  return serveProviderReference(request, name, expires, signature, true);
}
