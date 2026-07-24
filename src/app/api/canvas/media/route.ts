import { createHash } from "node:crypto";
import { extname } from "node:path";

import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { normalizeCanvasLibraryScope } from "@/lib/canvas/library-scope";
import { getInternalCanvasAccess, getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import { addLibraryItem, readLibraryMetadataForOwners, storeBytes } from "@/lib/server/library";
import { uploadedMediaFromForm } from "@/lib/server/provider-call";
import type { MediaType } from "@/lib/server/types";

export const runtime = "nodejs";
const inFlightUploads = new Map<string, Promise<Awaited<ReturnType<typeof addLibraryItem>>>>();

function uploadType(file: File): MediaType | null {
  const extension = extname(file.name).toLowerCase();
  if (file.type.startsWith("image/") || [".png", ".jpg", ".jpeg", ".webp"].includes(extension)) return "image";
  if (file.type.startsWith("video/") || [".mp4", ".webm", ".mov"].includes(extension)) return "video";
  return null;
}

function uploadTitle(fileName: string, type: MediaType) {
  return fileName.replace(/\.[^.]+$/, "").trim().slice(0, 120) || (type === "image" ? "上传图片" : "上传视频");
}

function uploadFingerprint(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function scopedCanvasItem(item: Awaited<ReturnType<typeof addLibraryItem>>, scope: "personal" | "shared") {
  if (scope !== "shared" || !item.output) return item;
  return {
    ...item,
    output: { ...item.output, url: `/api/library/${encodeURIComponent(item.id)}/media?scope=shared` },
  };
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
    const form = await request.formData();
    const canvasScope = normalizeCanvasLibraryScope(form.get("canvasScope"));
    const input = form.get("file");
    if (!(input instanceof File) || input.size <= 0) {
      return NextResponse.json({ ok: false, message: "请选择图片或视频文件。" }, { status: 400 });
    }
    const type = uploadType(input);
    if (!type) return NextResponse.json({ ok: false, message: "仅支持 PNG、JPEG、WebP、MP4、WebM 和 MOV。" }, { status: 400 });
    const uploaded = await uploadedMediaFromForm(form, "file", type === "image" ? "reference-image-upload" : "video-reference-upload");
    const file = uploaded[0];
    if (!file) return NextResponse.json({ ok: false, message: "无法读取上传文件。" }, { status: 400 });
    const fingerprint = uploadFingerprint(file.bytes);
    const workspace = canvasScope === "shared"
      ? await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)
      : undefined;
    const ownerIds = workspace?.memberIds || [session.user.local_user_id];
    const existing = (await readLibraryMetadataForOwners(ownerIds)).find((item) => (
      item.type === type
      && item.mode === "canvas-upload"
      && item.status === "done"
      && item.params.canvasScope === canvasScope
      && item.params.contentSha256 === fingerprint
    ));
    if (existing) return NextResponse.json({ ok: true, item: scopedCanvasItem(existing, canvasScope), reused: true });

    const uploadScopeId = workspace?.ownerId || session.user.local_user_id;
    const key = `${canvasScope}:${uploadScopeId}:${type}:${fingerprint}`;
    let job = inFlightUploads.get(key);
    let created = false;
    if (!job) {
      created = true;
      job = (async () => {
        const output = await storeBytes(file.bytes, file.mimeType, `canvas-upload-${type}`);
        return addLibraryItem({
          ownerLocalUserId: session.user.local_user_id,
          type,
          mode: "canvas-upload",
          title: uploadTitle(file.fileName, type),
          prompt: "",
          providerId: "canvas-upload",
          model: "local-upload",
          status: "done",
          output,
          params: { source: "canvas-upload", canvasScope, contentSha256: fingerprint },
        });
      })().finally(() => { inFlightUploads.delete(key); });
      inFlightUploads.set(key, job);
    }
    const item = await job;
    return NextResponse.json({ ok: true, item: scopedCanvasItem(item, canvasScope), reused: !created });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "素材上传失败。" }, { status: 400 });
  }
}
