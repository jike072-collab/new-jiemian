import { type NextRequest, NextResponse } from "next/server";

import { authResultResponse, csrfFailure, isInternalCanvasHostname, readJsonBody, requireAuthSession, requireCsrf } from "@/lib/server/auth";
import { getInternalCanvasWorkspaceMemberIds } from "@/lib/server/internal-canvas-access";
import { tikTokErrorResponse } from "@/lib/server/tiktok/http";
import { cancelTikTokPublish, getTikTokPublishJobs, manualTikTokUploadUrl, scheduleTikTokPublish } from "@/lib/server/tiktok/service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    return NextResponse.json({
      jobs: await getTikTokPublishJobs(session.user.local_user_id),
      manualUploadUrl: manualTikTokUploadUrl(),
    });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-publish-list");
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await readJsonBody(request);
    const shared = isInternalCanvasHostname(request.headers.get("host")) && request.nextUrl.searchParams.get("scope") === "shared";
    const scope = shared ? "shared" as const : "personal" as const;
    const ownerIds = shared
      ? (await getInternalCanvasWorkspaceMemberIds(session.user.local_user_id)).memberIds
      : [session.user.local_user_id];
    const job = await scheduleTikTokPublish({
      userId: session.user.local_user_id,
      ownerIds,
      scope,
      libraryItemId: String(body.libraryItemId || ""),
      idempotencyKey: String(body.idempotencyKey || ""),
      caption: String(body.caption || ""),
      privacyLevel: String(body.privacyLevel || ""),
      disableComment: Boolean(body.disableComment),
      disableDuet: Boolean(body.disableDuet),
      disableStitch: Boolean(body.disableStitch),
      brandContentToggle: Boolean(body.brandContentToggle),
      brandOrganicToggle: Boolean(body.brandOrganicToggle),
      scheduledAt: typeof body.scheduledAt === "string" ? body.scheduledAt : undefined,
    });
    return NextResponse.json({ ok: true, job }, { status: 201 });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-publish-create");
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
    const session = await requireAuthSession(request);
    if (!session.ok) return authResultResponse(request, session);
    const body = await readJsonBody(request);
    return NextResponse.json({
      ok: true,
      job: await cancelTikTokPublish(session.user.local_user_id, String(body.jobId || "")),
    });
  } catch (error) {
    return tikTokErrorResponse(request, error, "tiktok-publish-cancel");
  }
}
