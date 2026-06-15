import { NextResponse } from "next/server";

import { readStoredFile } from "@/lib/server/library";

export const runtime = "nodejs";

function mimeFromName(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".mov")) return "video/quicktime";
  if (lower.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  const bytes = await readStoredFile(name);
  if (!bytes) return NextResponse.json({ error: "文件不存在。" }, { status: 404 });
  const mimeType = mimeFromName(name);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
