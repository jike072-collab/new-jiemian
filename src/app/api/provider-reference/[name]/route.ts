import { createReadStream } from "node:fs";
import { Readable } from "node:stream";

import { type NextRequest, NextResponse } from "next/server";

import { providerReferenceMimeType, resolveProviderReference } from "@/lib/server/provider-reference";

export const runtime = "nodejs";

function parseRange(value: string | null, size: number) {
  const match = value ? /^bytes=(\d*)-(\d*)$/.exec(value.trim()) : null;
  if (!value) return null;
  if (!match || (!match[1] && !match[2])) return "invalid" as const;
  const start = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
  const end = match[1] ? (match[2] ? Number(match[2]) : size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size) return "invalid" as const;
  return { start, end: Math.min(end, size - 1) };
}

async function serve(request: NextRequest, context: { params: Promise<{ name: string }> }, headOnly: boolean) {
  const { name } = await context.params;
  const reference = await resolveProviderReference(
    name,
    request.nextUrl.searchParams.get("expires"),
    request.nextUrl.searchParams.get("signature"),
  );
  if (!reference) return NextResponse.json({ error: "Reference not found." }, { status: 404 });
  const baseHeaders = {
    "Content-Type": providerReferenceMimeType(name),
    "Content-Disposition": `inline; filename="reference${name.match(/\.[a-z0-9]+\.tmp$/i)?.[0].replace(/\.tmp$/i, "") || ""}"`,
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
    "Content-Length": String(reference.size),
  };
  if (headOnly) return new NextResponse(null, { headers: baseHeaders });
  const range = parseRange(request.headers.get("range"), reference.size);
  if (range === "invalid") {
    return new NextResponse(null, { status: 416, headers: { ...baseHeaders, "Content-Range": `bytes */${reference.size}` } });
  }
  if (range) {
    const stream = Readable.toWeb(createReadStream(reference.path, { start: range.start, end: range.end }));
    return new NextResponse(stream as ReadableStream, {
      status: 206,
      headers: {
        ...baseHeaders,
        "Content-Length": String(range.end - range.start + 1),
        "Content-Range": `bytes ${range.start}-${range.end}/${reference.size}`,
      },
    });
  }
  return new NextResponse(Readable.toWeb(createReadStream(reference.path)) as ReadableStream, { headers: baseHeaders });
}

export async function GET(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  return serve(request, context, false);
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ name: string }> }) {
  return serve(request, context, true);
}
