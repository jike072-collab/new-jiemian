import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, requireAuthSession } from "@/lib/server/auth";
import { readStoredFileForOwner } from "@/lib/server/library";

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

function isImageMime(mimeType: string) {
  return mimeType === "image/png" || mimeType === "image/jpeg" || mimeType === "image/webp";
}

async function createThumbnail(bytes: Buffer, mimeType: string) {
  if (!isImageMime(mimeType)) return null;

  try {
    const sharp = (await import("sharp")).default;
    return await sharp(bytes)
      .rotate()
      .resize({ width: 520, height: 520, fit: "inside", withoutEnlargement: true })
      .webp({ quality: 62, effort: 3 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ name: string }> },
) {
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);

  const { name } = await context.params;
  const bytes = await readStoredFileForOwner(name, session.user.local_user_id);
  if (!bytes) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const mimeType = mimeFromName(name);
  const thumbnail = request.nextUrl.searchParams.get("view") === "thumb"
    ? await createThumbnail(bytes, mimeType)
    : null;
  if (thumbnail) {
    return new NextResponse(new Uint8Array(thumbnail), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": `inline; filename="${name}.thumb.webp"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  return new NextResponse(bytes, {
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": `inline; filename="${name}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
