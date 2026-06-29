import { type NextRequest, NextResponse } from "next/server";

import { readTunneltestReferenceImage } from "@/lib/server/tunneltest-reference-images";

export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  const file = await readTunneltestReferenceImage(name, request.nextUrl.searchParams.get("sig"));
  if (!file) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return new NextResponse(file.bytes, {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, no-store",
    },
  });
}
