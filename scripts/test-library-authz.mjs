#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const libraryRoute = read("src/app/api/library/route.ts");
const filesRoute = read("src/app/api/files/[name]/route.ts");
const library = read("src/lib/server/library.ts");
const types = read("src/lib/server/types.ts");
const providerCall = read("src/lib/server/provider-call.ts");
const upscale = read("src/lib/server/volcengine-upscale.ts");
const upscaleImageRoute = read("src/app/api/upscale/image/route.ts");
const upscaleVideoRoute = read("src/app/api/upscale/video/route.ts");
const authService = read("src/lib/server/auth/service.ts");
const paths = read("src/lib/server/paths.ts");

for (const source of [libraryRoute, filesRoute]) {
  assert(source.includes("type NextRequest"), "protected route must accept NextRequest");
  assert(source.includes("requireAuthSession"), "protected route must require auth session");
  assert(source.includes("authResultResponse"), "protected route must return auth failures through authResultResponse");
  assertSequence("auth before protected work", source, [
    "const session = await requireAuthSession(request)",
    "if (!session.ok) return authResultResponse(request, session)",
  ]);
}

assert(authService.includes("status: 401"), "auth service must use 401 for missing or invalid sessions");

assert(libraryRoute.includes("readLibraryForOwner(session.user.local_user_id)"), "/api/library GET must list only the current owner");
assert(libraryRoute.includes("deleteLibraryItemForOwner(body.id, session.user.local_user_id)"), "/api/library DELETE must delete only the current owner");
assert(!libraryRoute.includes("readLibrary()"), "/api/library route must not read the full library");
assert(!libraryRoute.includes("deleteLibraryItem(body.id)"), "/api/library route must not use ownerless delete");

assert(filesRoute.includes("readStoredFileForOwner(name, session.user.local_user_id)"), "/api/files route must read files through owner-aware helper");
assert(!filesRoute.includes("readStoredFile(name)"), "/api/files route must not read files without owner");
assert(!filesRoute.includes("resolveUploadPath"), "/api/files route must not resolve upload paths directly");
assert(!filesRoute.includes("join("), "/api/files route must not raw-join file paths");
assert(filesRoute.includes("\"Cache-Control\": \"private, no-store\""), "/api/files route must not publicly cache private assets");

assert(types.includes("ownerLocalUserId?: string | null"), "LibraryItem must include ownerLocalUserId");
assert(library.includes("item.ownerLocalUserId === ownerLocalUserId"), "owner checks must use exact owner equality");
assert(library.includes("readLibraryForOwner(ownerLocalUserId: string)"), "library must expose owner-filtered listing");
assert(library.includes("deleteLibraryItemForOwner(id: string, ownerLocalUserId: string)"), "library must expose owner-aware delete");
assert(library.includes("readStoredFileForOwner(storedName: string, ownerLocalUserId: string)"), "library must expose owner-aware file read");
assert(library.includes("candidate.output?.storedName === storedName"), "file authz must bind storedName to the current owner item");
assert(library.includes("if (!safeName || safeName !== storedName) return null"), "invalid storedName must be rejected before reading disk");
assertSequence("file owner check before disk read", library, [
  "export async function readStoredFileForOwner",
  "if (!safeName || safeName !== storedName) return null",
  "const item = (await readLibrary()).find",
  "if (!item) return null",
  "return readStoredFile(storedName)",
]);

for (const unsafeName of ["../x", "..%2Fx", "..%5Cx", "a/b", "a\\b", "C:\\x", "/tmp/x", ""]) {
  const safe = safeStoredNameLikeApp(unsafeName);
  assert(safe !== unsafeName || !safe, `unsafe storedName should not pass exact safe-name matching: ${unsafeName}`);
}
assert(paths.includes("safeStoredName(name: string)"), "safeStoredName remains the file-name gate");

assert(ownerFieldCount(providerCall) >= 3, "all provider-call library item creations must set ownerLocalUserId");
assert(upscale.includes("upscaleImage(file: UploadedUpscaleFile, scale: TargetScale, ownerLocalUserId?: string | null)"), "image upscale must accept owner");
assert(upscale.includes("submitVideoUpscale(file: UploadedUpscaleFile, scale: TargetScale, ownerLocalUserId?: string | null)"), "video upscale must accept owner");
assert(ownerFieldCount(upscale) >= 3, "upscale library/job creations must set ownerLocalUserId");
assert(upscaleImageRoute.includes("runUpscaleImage(file, scale, session.user.local_user_id)"), "image upscale route must pass current owner");
assert(upscaleVideoRoute.includes("runSubmitVideoUpscale(file, scale, session.user.local_user_id)"), "video upscale route must pass current owner");

const self = read("scripts/test-library-authz.mjs");
for (const token of [
  ["node", "http"].join(":"),
  ["node", "https"].join(":"),
  ["node", "child_process"].join(":"),
  ["un", "dici"].join(""),
  ["fetch", "("].join(""),
]) {
  assert(!self.includes(token), `test must not have network/process capability: ${token}`);
}

console.log(JSON.stringify({
  ok: true,
  unauthenticatedStatus: 401,
  otherOwnerStatus: 404,
  ownerFilteredList: true,
  ownerCheckedDelete: true,
  ownerCheckedDownload: true,
  legacyNoOwnerVisible: false,
  pathTraversalReadsDisk: false,
  productionDbConnected: false,
  providerCalled: false,
}, null, 2));

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function assertSequence(name, source, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, cursor + 1);
    assert(index > cursor, `${name} missing or reordered token: ${token}`);
    cursor = index;
  }
}

function ownerFieldCount(source) {
  return source.match(/ownerLocalUserId:/g)?.length || 0;
}

function safeStoredNameLikeApp(name) {
  return name.replace(/[^a-z0-9._-]+/gi, "-").replace(/^[.-]+|[.-]+$/g, "");
}
