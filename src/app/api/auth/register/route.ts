import { type NextRequest } from "next/server";

import {
  authRequestContext,
  authResultResponse,
  csrfFailure,
  getAuthService,
  readJsonBody,
  redirectFromBody,
  requireCsrf,
} from "@/lib/server/auth";
import { requireTestInviteCode } from "@/lib/server/auth/invite-code";
import { tunneltestRegistrationMaxUsers } from "@/lib/server/auth/tunneltest-registration-limit";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!requireCsrf(request)) return authResultResponse(request, csrfFailure());
  const body = await readJsonBody(request);
  const inviteFailure = requireTestInviteCode(body.inviteCode);
  if (inviteFailure) return authResultResponse(request, inviteFailure);
  const result = await getAuthService().register({
    email: String(body.email || ""),
    username: body.username === undefined ? undefined : String(body.username),
    password: String(body.password || ""),
    displayName: body.displayName === undefined ? undefined : String(body.displayName),
    redirectTo: redirectFromBody(body),
    maxUsers: await tunneltestRegistrationMaxUsers(),
  }, authRequestContext(request));
  return authResultResponse(request, result);
}
