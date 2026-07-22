import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { getInternalCanvasAccess, getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import {
  addLibraryItem,
  LibraryOperationError,
  readLibraryMetadataForOwners,
  resolveLibraryMediaForOwners,
  storeBytes,
} from "@/lib/server/library";
import { ensureRuntimeDirs, resolveUploadPath, safeStoredName } from "@/lib/server/paths";
import { trimVideoToMp4, VideoTrimError } from "@/lib/server/video-trim";

export const runtime = "nodejs";

type VideoTrimRequest = {
  libraryItemId?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
  scope?: unknown;
};

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
    const body = await request.json() as VideoTrimRequest;
    const libraryItemId = typeof body.libraryItemId === "string" ? body.libraryItemId.trim() : "";
    const scope = body.scope === "personal" ? "personal" : body.scope === "shared" ? "shared" : "";
    if (!libraryItemId || !scope) {
      return NextResponse.json({ ok: false, message: "裁剪素材或画布范围无效。" }, { status: 400 });
    }

    const ownerIds = scope === "shared"
      ? (await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)).memberIds
      : [session.user.local_user_id];
    const source = (await readLibraryMetadataForOwners(ownerIds)).find((item) => item.id === libraryItemId && item.type === "video");
    if (!source) throw new LibraryOperationError(404, "Video not found.");

    const media = await resolveLibraryMediaForOwners(libraryItemId, ownerIds);
    if (!media.storedName) throw new LibraryOperationError(404, "Video file not found.");
    await ensureRuntimeDirs();
    const temporaryOutputPath = resolveUploadPath(safeStoredName(`video-trim-temp-${crypto.randomUUID()}.mp4`));
    const trimmed = await trimVideoToMp4(
      resolveUploadPath(media.storedName),
      temporaryOutputPath,
      body.startSeconds,
      body.endSeconds,
    );
    const output = await storeBytes(trimmed.bytes, "video/mp4", "canvas-video-trim");
    const item = await addLibraryItem({
      ownerLocalUserId: session.user.local_user_id,
      type: "video",
      mode: "video-trim",
      title: `裁剪 · ${source.title}`.slice(0, 120),
      prompt: source.prompt,
      providerId: "canvas-video-trim",
      model: "ffmpeg",
      status: "done",
      output,
      params: {
        sourceLibraryItemId: source.id,
        startSeconds: Number(trimmed.startSeconds.toFixed(3)),
        endSeconds: Number(trimmed.endSeconds.toFixed(3)),
        durationSeconds: Number(trimmed.durationSeconds.toFixed(3)),
      },
    });
    const responseItem = scope === "shared" && item.output ? {
      ...item,
      output: { ...item.output, url: `/api/library/${encodeURIComponent(item.id)}/media?scope=shared` },
    } : item;
    return NextResponse.json({ ok: true, item: responseItem });
  } catch (error) {
    const status = error instanceof VideoTrimError || error instanceof LibraryOperationError ? error.status : 500;
    const message = error instanceof VideoTrimError
      ? error.message
      : status === 404
        ? "视频不存在或无权访问。"
        : "视频裁剪失败，请稍后重试。";
    return NextResponse.json({ ok: false, message }, { status });
  }
}
