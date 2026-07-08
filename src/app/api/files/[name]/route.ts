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

function mediaCacheControl(maxAgeSeconds: number) {
  return `private, max-age=${maxAgeSeconds}, stale-while-revalidate=86400`;
}

function mediaEtag(name: string, size: number, variant: "original" | "thumb") {
  return `W/"${variant}-${encodeURIComponent(name)}-${size}"`;
}

function hasMatchingEtag(request: NextRequest, etag: string) {
  const header = request.headers.get("if-none-match");
  if (!header) return false;
  return header.split(",").map((value) => value.trim()).includes(etag);
}

function parseRangeHeader(rangeHeader: string | null, size: number) {
  if (!rangeHeader) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim());
  if (!match) return "invalid" as const;

  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "invalid" as const;

  if (!rawStart) {
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return "invalid" as const;
    const start = Math.max(size - suffixLength, 0);
    return { start, end: size - 1 };
  }

  const start = Number(rawStart);
  const end = rawEnd ? Number(rawEnd) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return "invalid" as const;
  }
  return { start, end: Math.min(end, size - 1) };
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
  const cacheControl = mediaCacheControl(604800);
  const wantsThumbnail = request.nextUrl.searchParams.get("view") === "thumb";
  const thumbnailEtag = mediaEtag(name, bytes.length, "thumb");
  if (wantsThumbnail && isImageMime(mimeType) && hasMatchingEtag(request, thumbnailEtag)) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        "Cache-Control": cacheControl,
        ETag: thumbnailEtag,
        Vary: "Cookie",
      },
    });
  }

  const thumbnail = wantsThumbnail
    ? await createThumbnail(bytes, mimeType)
    : null;
  if (thumbnail) {
    return new NextResponse(new Uint8Array(thumbnail), {
      headers: {
        "Content-Type": "image/webp",
        "Content-Disposition": `inline; filename="${name}.thumb.webp"`,
        "Cache-Control": cacheControl,
        "Content-Length": String(thumbnail.length),
        ETag: thumbnailEtag,
        Vary: "Cookie",
      },
    });
  }

  const originalEtag = mediaEtag(name, bytes.length, "original");
  const baseHeaders = {
    "Content-Type": mimeType,
    "Content-Disposition": `inline; filename="${name}"`,
    "Cache-Control": cacheControl,
    "Content-Length": String(bytes.length),
    "Accept-Ranges": "bytes",
    ETag: originalEtag,
    Vary: "Cookie",
  };
  if (hasMatchingEtag(request, originalEtag)) {
    return new NextResponse(null, {
      status: 304,
      headers: baseHeaders,
    });
  }

  const range = parseRangeHeader(request.headers.get("range"), bytes.length);
  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${bytes.length}`,
      },
    });
  }
  if (range) {
    const chunk = bytes.subarray(range.start, range.end + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(chunk.length),
        "Content-Range": `bytes ${range.start}-${range.end}/${bytes.length}`,
      },
    });
  }

  return new NextResponse(bytes, {
    headers: {
      ...baseHeaders,
    },
  });
}
