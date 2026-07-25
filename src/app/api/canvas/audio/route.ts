import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { getInternalCanvasAccess } from "@/lib/server/internal-canvas-access";
import { uploadedMediaFromForm } from "@/lib/server/provider-call";
import { storeProviderReference } from "@/lib/server/provider-reference";

export const runtime = "nodejs";

function canvasReferenceUrl(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
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
    const uploaded = await uploadedMediaFromForm(form, "file", "audio-reference-upload");
    const file = uploaded[0];
    if (!file) return NextResponse.json({ ok: false, message: "请选择音频文件。" }, { status: 400 });
    const reference = await storeProviderReference({ bytes: file.bytes, mimeType: file.mimeType, fileName: file.fileName });
    return NextResponse.json({
      ok: true,
      title: file.fileName,
      url: canvasReferenceUrl(reference.url),
      mimeType: file.mimeType,
      size: file.bytes.length,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, message: error instanceof Error ? error.message : "音频上传失败。" }, { status: 400 });
  }
}
