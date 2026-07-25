import { randomUUID } from "node:crypto";

import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { getInternalCanvasAccess } from "@/lib/server/internal-canvas-access";
import { resolveUploadPath, safeStoredName } from "@/lib/server/paths";
import { resolveProviderReference, storeProviderReference } from "@/lib/server/provider-reference";
import { MAX_VIDEO_TRIM_SECONDS, probeVideoDuration, trimAudioToM4a, VideoTrimError } from "@/lib/server/video-trim";

export const runtime = "nodejs";

function canvasReferenceUrl(url: string, baseUrl: string) {
  const parsed = new URL(url, baseUrl);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}

function audioReferenceParts(url: string, baseUrl: string) {
  const parsed = new URL(url, baseUrl);
  const parts = parsed.pathname.split("/");
  if (parts.length !== 6 || parts[1] !== "api" || parts[2] !== "provider-reference") return null;
  try {
    return {
      name: decodeURIComponent(parts[3]),
      expires: parts[4],
      signature: decodeURIComponent(parts[5]),
    };
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  if (!isInternalCanvasHostname(request.headers.get("host"))) {
    return NextResponse.json({ ok: false, message: "Not found." }, { status: 404 });
  }
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const session = await requireAuthSession(request);
  if (!session.ok) return authResultResponse(request, session);
  const access = await getInternalCanvasAccess(session.user.local_user_id);
  if (!access?.enabled) return NextResponse.json({ ok: false, message: "Permission denied." }, { status: 403 });

  try {
    const body = await request.json() as { url?: unknown };
    const url = typeof body.url === "string" ? body.url.trim() : "";
    const parts = url ? audioReferenceParts(url, request.nextUrl.origin) : null;
    if (!parts) return NextResponse.json({ ok: false, message: "音频参考地址无效。" }, { status: 400 });
    const source = await resolveProviderReference(parts.name, parts.expires, parts.signature);
    if (!source) return NextResponse.json({ ok: false, message: "音频参考已失效，请重新上传。" }, { status: 404 });

    const sourceDurationSeconds = await probeVideoDuration(source.path);
    if (sourceDurationSeconds <= MAX_VIDEO_TRIM_SECONDS + 0.001) {
      return NextResponse.json({ ok: true, url: canvasReferenceUrl(url, request.nextUrl.origin), trimmed: false, durationSeconds: sourceDurationSeconds });
    }

    const temporaryOutputPath = resolveUploadPath(safeStoredName(`audio-trim-temp-${randomUUID()}.m4a`));
    const trimmed = await trimAudioToM4a(source.path, temporaryOutputPath, 0, MAX_VIDEO_TRIM_SECONDS);
    const reference = await storeProviderReference({
      bytes: trimmed.bytes,
      mimeType: "audio/mp4",
      fileName: "canvas-audio-trim.m4a",
    });
    return NextResponse.json({
      ok: true,
      url: canvasReferenceUrl(reference.url, request.nextUrl.origin),
      trimmed: true,
      durationSeconds: trimmed.durationSeconds,
    });
  } catch (error) {
    const status = error instanceof VideoTrimError ? error.status : 500;
    const message = error instanceof VideoTrimError
      ? error.message.replaceAll("视频", "音频")
      : "音频裁剪失败，请稍后重试。";
    return NextResponse.json({ ok: false, message }, { status });
  }
}
