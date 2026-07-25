import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { isCanvasLibraryItemInScope } from "@/lib/canvas/library-scope";
import { getInternalCanvasAccess, getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import {
  addLibraryItem,
  LibraryOperationError,
  readLibraryMetadataForOwners,
  resolveLibraryMediaForOwners,
  storeBytes,
} from "@/lib/server/library";
import { ensureRuntimeDirs, resolveUploadPath, safeStoredName } from "@/lib/server/paths";
import type { LibraryItem, LibraryOutput } from "@/lib/server/types";
import { probeVideoDuration, trimVideoToMp4, VideoTrimError } from "@/lib/server/video-trim";

export const runtime = "nodejs";

const BATCH_TRIM_SECONDS = 14.9;
const MAX_BATCH_VIDEO_TRIMS = 12;

type VideoTrimRequest = {
  libraryItemId?: unknown;
  libraryItemIds?: unknown;
  startSeconds?: unknown;
  endSeconds?: unknown;
  scope?: unknown;
};

async function trimLibraryVideo(input: {
  source: LibraryItem;
  media: LibraryOutput;
  ownerLocalUserId: string;
  scope: "personal" | "shared";
  startSeconds: unknown;
  endSeconds: unknown;
}) {
  if (!input.media.storedName) throw new LibraryOperationError(404, "Video file not found.");
  await ensureRuntimeDirs();
  const temporaryOutputPath = resolveUploadPath(safeStoredName(`video-trim-temp-${crypto.randomUUID()}.mp4`));
  const trimmed = await trimVideoToMp4(
    resolveUploadPath(input.media.storedName),
    temporaryOutputPath,
    input.startSeconds,
    input.endSeconds,
  );
  const output = await storeBytes(trimmed.bytes, "video/mp4", "canvas-video-trim");
  return await addLibraryItem({
    ownerLocalUserId: input.ownerLocalUserId,
    type: "video",
    mode: "video-trim",
    title: `裁剪 · ${input.source.title}`.slice(0, 120),
    prompt: input.source.prompt,
    providerId: "canvas-video-trim",
    model: "ffmpeg",
    status: "done",
    output,
    params: {
      sourceLibraryItemId: input.source.id,
      startSeconds: Number(trimmed.startSeconds.toFixed(3)),
      endSeconds: Number(trimmed.endSeconds.toFixed(3)),
      durationSeconds: Number(trimmed.durationSeconds.toFixed(3)),
      canvasScope: input.scope,
    },
  });
}

function scopedTrimItem(item: LibraryItem, scope: "personal" | "shared") {
  return scope === "shared" && item.output ? {
    ...item,
    output: { ...item.output, url: `/api/library/${encodeURIComponent(item.id)}/media?scope=shared` },
  } : item;
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
    const body = await request.json() as VideoTrimRequest;
    const libraryItemId = typeof body.libraryItemId === "string" ? body.libraryItemId.trim() : "";
    const libraryItemIds = Array.isArray(body.libraryItemIds)
      ? [...new Set(body.libraryItemIds.filter((id): id is string => typeof id === "string").map((id) => id.trim()).filter(Boolean))]
      : [];
    const scope = body.scope === "personal" ? "personal" : body.scope === "shared" ? "shared" : "";
    if ((!libraryItemId && !libraryItemIds.length) || !scope) {
      return NextResponse.json({ ok: false, message: "裁剪素材或画布范围无效。" }, { status: 400 });
    }
    if (libraryItemIds.length > MAX_BATCH_VIDEO_TRIMS) {
      return NextResponse.json({ ok: false, message: `一次最多裁剪 ${MAX_BATCH_VIDEO_TRIMS} 个视频。` }, { status: 400 });
    }

    const ownerIds = scope === "shared"
      ? (await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)).memberIds
      : [session.user.local_user_id];
    const libraryItems = await readLibraryMetadataForOwners(ownerIds);

    if (libraryItemIds.length) {
      const createdItems: LibraryItem[] = [];
      let skipped = 0;
      let failed = 0;
      for (const id of libraryItemIds) {
        const source = libraryItems.find((item) => item.id === id && item.type === "video" && item.status === "done" && isCanvasLibraryItemInScope(item, scope));
        if (!source) {
          skipped += 1;
          continue;
        }
        const existing = libraryItems.find((item) => (
          item.type === "video"
          && item.status === "done"
          && item.mode === "video-trim"
          && item.params.sourceLibraryItemId === source.id
          && Number(item.params.startSeconds) === 0
          && Number(item.params.endSeconds) === BATCH_TRIM_SECONDS
          && item.params.canvasScope === scope
        ));
        if (existing) {
          createdItems.push(existing);
          continue;
        }
        try {
          const media = await resolveLibraryMediaForOwners(source.id, ownerIds, scope);
          if (!media.storedName || await probeVideoDuration(resolveUploadPath(media.storedName)) <= BATCH_TRIM_SECONDS + 0.001) {
            skipped += 1;
            continue;
          }
          createdItems.push(await trimLibraryVideo({
            source,
            media,
            ownerLocalUserId: session.user.local_user_id,
            scope,
            startSeconds: 0,
            endSeconds: BATCH_TRIM_SECONDS,
          }));
        } catch {
          failed += 1;
        }
      }
      return NextResponse.json({ ok: true, items: createdItems.map((item) => scopedTrimItem(item, scope)), skipped, failed });
    }

    const source = libraryItems.find((item) => item.id === libraryItemId && item.type === "video" && isCanvasLibraryItemInScope(item, scope));
    if (!source) throw new LibraryOperationError(404, "Video not found.");

    const media = await resolveLibraryMediaForOwners(libraryItemId, ownerIds, scope);
    const item = await trimLibraryVideo({ source, media, ownerLocalUserId: session.user.local_user_id, scope, startSeconds: body.startSeconds, endSeconds: body.endSeconds });
    return NextResponse.json({ ok: true, item: scopedTrimItem(item, scope) });
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
