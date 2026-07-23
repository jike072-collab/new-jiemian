import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";

import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, isInternalCanvasHostname, requireAuthSession } from "@/lib/server/auth";
import { getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import { resolveStoredFileForOwner, resolveStoredFileForOwners } from "@/lib/server/library";

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

function mediaEtag(name: string, size: number, modifiedAtMs: number, variant: "original" | "thumb") {
  return `W/"${variant}-${encodeURIComponent(name)}-${size}-${Math.round(modifiedAtMs)}"`;
}

const thumbnailCache = new Map<string, Buffer>();
const thumbnailCacheLimit = 80;

function cachedThumbnail(key: string) {
  const cached = thumbnailCache.get(key);
  if (!cached) return null;
  thumbnailCache.delete(key);
  thumbnailCache.set(key, cached);
  return cached;
}

function rememberThumbnail(key: string, thumbnail: Buffer) {
  thumbnailCache.delete(key);
  thumbnailCache.set(key, thumbnail);
  while (thumbnailCache.size > thumbnailCacheLimit) {
    const oldest = thumbnailCache.keys().next().value;
    if (!oldest) break;
    thumbnailCache.delete(oldest);
  }
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
  const shared = isInternalCanvasHostname(request.headers.get("host")) && request.nextUrl.searchParams.get("scope") === "shared";
  const storedFile = shared
    ? await resolveStoredFileForOwners(name, (await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)).memberIds, "shared")
    : await resolveStoredFileForOwner(name, session.user.local_user_id, "personal");
  if (!storedFile) return NextResponse.json({ error: "File not found." }, { status: 404 });
  const mimeType = mimeFromName(name);
  const cacheControl = mediaCacheControl(604800);
  const wantsThumbnail = request.nextUrl.searchParams.get("view") === "thumb";
  const thumbnailEtag = mediaEtag(name, storedFile.size, storedFile.modifiedAtMs, "thumb");
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

  const thumbnailKey = `${name}:${storedFile.size}:${Math.round(storedFile.modifiedAtMs)}`;
  let thumbnail = wantsThumbnail && isImageMime(mimeType) ? cachedThumbnail(thumbnailKey) : null;
  if (wantsThumbnail && isImageMime(mimeType) && !thumbnail) {
    thumbnail = await createThumbnail(await readFile(storedFile.path), mimeType);
    if (thumbnail) rememberThumbnail(thumbnailKey, thumbnail);
  }
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

  const originalEtag = mediaEtag(name, storedFile.size, storedFile.modifiedAtMs, "original");
  const baseHeaders = {
    "Content-Type": mimeType,
    "Content-Disposition": `inline; filename="${name}"`,
    "Cache-Control": cacheControl,
    "Content-Length": String(storedFile.size),
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

  const range = parseRangeHeader(request.headers.get("range"), storedFile.size);
  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: {
        ...baseHeaders,
        "Content-Range": `bytes */${storedFile.size}`,
      },
    });
  }
  if (range) {
    const stream = Readable.toWeb(createReadStream(storedFile.path, { start: range.start, end: range.end, highWaterMark: 1024 * 1024 }));
    return new NextResponse(stream as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${storedFile.size}`,
        "X-Accel-Buffering": "no",
      },
    });
  }

  const stream = Readable.toWeb(createReadStream(storedFile.path, { highWaterMark: 1024 * 1024 }));
  return new NextResponse(stream as ReadableStream, {
    headers: {
      ...baseHeaders,
      "X-Accel-Buffering": "no",
    },
  });
}
