#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const imageRoute = read("src/app/api/upscale/image/route.ts");
const videoRoute = read("src/app/api/upscale/video/route.ts");
const statusRoute = read("src/app/api/upscale/status/route.ts");
const studioApp = read("src/components/studio-app.tsx");
const packageJson = read("package.json");
const ci = read(".github/workflows/ci.yml");

const routeContracts = [
  {
    name: "image upscale route",
    source: imageRoute,
    endpoint: "/api/upscale/image",
    providerTokens: ["uploadedUpscaleFile(form, \"image\")", "runUpscaleImage(file, scale"],
  },
  {
    name: "video upscale route",
    source: videoRoute,
    endpoint: "/api/upscale/video",
    providerTokens: ["uploadedUpscaleFile(form, \"video\")", "runSubmitVideoUpscale(file, scale"],
  },
];

for (const contract of routeContracts) {
  assert(contract.source.includes("type NextRequest"), `${contract.name} must accept NextRequest`);
  for (const token of ["authResultResponse", "csrfFailure", "requireAuthSession", "requireCsrf"]) {
    assert(contract.source.includes(token), `${contract.name} must import/use ${token}`);
  }

  assertSequence(`${contract.name} guard order`, contract.source, [
    "export async function POST(request: NextRequest)",
    "if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())",
    "const session = await requireAuthSession(request)",
    "if (!session.ok) return authResultResponse(request, session)",
    "const form = await request.formData()",
  ]);

  for (const token of contract.providerTokens) {
    assert(
      contract.source.indexOf("if (!session.ok) return authResultResponse(request, session)") < contract.source.indexOf(token),
      `${contract.name} must reject unauthenticated requests before ${token}`,
    );
    assert(
      contract.source.indexOf("if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())") < contract.source.indexOf(token),
      `${contract.name} must reject CSRF failures before ${token}`,
    );
  }

  assert(
    studioApp.includes(`fetchJsonWithCsrf<{ item: LibraryItem; job: JobRecord | null }>("${contract.endpoint}"`),
    `${contract.endpoint} client call must send CSRF`,
  );
}

assert(statusRoute.includes("export async function GET()"), "upscale status route remains read-only GET");
assert(!statusRoute.includes("requireCsrf"), "upscale status GET must not require CSRF");
assert(packageJson.includes("\"test:upscale-auth-csrf\""), "package.json must expose test:upscale-auth-csrf");
assert(packageJson.includes("npm run test:upscale-auth-csrf"), "npm run check must include test:upscale-auth-csrf");
assert(ci.includes("Upscale auth CSRF"), "CI must include upscale auth CSRF checks");

const self = read("scripts/test-upscale-auth-csrf.mjs");
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
  protectedRoutes: 2,
  csrfBeforeFormData: true,
  authBeforeProvider: true,
  generationEndpointsCalled: false,
  newApiCalled: false,
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
