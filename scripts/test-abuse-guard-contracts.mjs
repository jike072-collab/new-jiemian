#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const source = {
  libraryRoute: read("src/app/api/library/route.ts"),
  filesRoute: read("src/app/api/files/[name]/route.ts"),
  jobsRoute: read("src/app/api/jobs/[id]/route.ts"),
  quotaRoute: read("src/app/api/quota/route.ts"),
  quotaPrecheckRoute: read("src/app/api/quota/precheck/route.ts"),
  usageRoute: read("src/app/api/usage/route.ts"),
  billingOrdersRoute: read("src/app/api/billing/orders/route.ts"),
  billingOrderRoute: read("src/app/api/billing/orders/[id]/route.ts"),
  adminProvidersRoute: read("src/app/api/admin/providers/route.ts"),
  adminProviderHealthRoute: read("src/app/api/admin/provider-health/route.ts"),
  adminModelsHealthRoute: read("src/app/api/admin/models/health/route.ts"),
  adminUsersRoute: read("src/app/api/admin/users/route.ts"),
  adminUserRoute: read("src/app/api/admin/users/[id]/route.ts"),
  adminUserStatusRoute: read("src/app/api/admin/users/[id]/status/route.ts"),
  adminUserQuotaRoute: read("src/app/api/admin/users/[id]/quota/route.ts"),
  adminMappingsRoute: read("src/app/api/admin/mappings/route.ts"),
  adminMappingRepairRoute: read("src/app/api/admin/mappings/[id]/repair/route.ts"),
  adminBillingOrdersRoute: read("src/app/api/admin/billing/orders/route.ts"),
  adminBillingOrderRoute: read("src/app/api/admin/billing/orders/[id]/route.ts"),
  adminBillingReviewRoute: read("src/app/api/admin/billing/orders/[id]/review/route.ts"),
  adminTaskBillingRoute: read("src/app/api/admin/task-billing/records/route.ts"),
  generateImageRoute: read("src/app/api/generate/image/route.ts"),
  generateVideoRoute: read("src/app/api/generate/video/route.ts"),
  upscaleImageRoute: read("src/app/api/upscale/image/route.ts"),
  upscaleVideoRoute: read("src/app/api/upscale/video/route.ts"),
  promptOptimizeRoute: read("src/app/api/prompts/optimize/route.ts"),
  loginRoute: read("src/app/api/auth/login/route.ts"),
  registerRoute: read("src/app/api/auth/register/route.ts"),
  logoutRoute: read("src/app/api/auth/logout/route.ts"),
  sessionRoute: read("src/app/api/auth/session/route.ts"),
  csrfRoute: read("src/app/api/auth/csrf/route.ts"),
  healthRoute: read("src/app/api/health/backend/route.ts"),
  providersEnabledRoute: read("src/app/api/providers/enabled/route.ts"),
  billingConfigRoute: read("src/app/api/billing/config/route.ts"),
  webhookSandboxRoute: read("src/app/api/billing/webhooks/sandbox/route.ts"),
  webhookProductionRoute: read("src/app/api/billing/webhooks/production/route.ts"),
  quotaHttp: read("src/lib/server/quota/http.ts"),
  billingHttp: read("src/lib/server/billing/http.ts"),
  billingService: read("src/lib/server/billing/service.ts"),
  paymentAdapters: read("src/lib/server/billing/payment-adapters.ts"),
  adminHttp: read("src/lib/server/admin/http.ts"),
  authHttp: read("src/lib/server/auth/http.ts"),
  authService: read("src/lib/server/auth/service.ts"),
  promptHttp: read("src/lib/server/prompts/http.ts"),
  tunneltestLimits: readOptional("src/lib/server/tunneltest-limits.ts"),
  packageJson: read("package.json"),
};

checkUserResourceAuth();
checkWriteCsrf();
checkExistingAbuseGuards();
checkPublicRouteWhitelist();
checkWebhookSignatureAndIdempotency();
checkSelfIsStaticOnly();

console.log(JSON.stringify({
  ok: true,
  userResourceAuthChecked: [
    "library",
    "files",
    "jobs",
    "quota",
    "usage",
    "billing orders",
    "admin",
  ],
  csrfWriteOperationsChecked: [
    "generate",
    "upscale",
    "quota precheck",
    "billing orders",
    "auth mutations",
    "admin mutations",
    "prompt optimize",
  ],
  existingRateLimitGuardsChecked: true,
  publicWhitelistChecked: [
    "csrf GET",
    "backend health",
    "enabled providers",
    "billing config",
    "billing webhooks",
  ],
  webhookSignatureAndIdempotencyChecked: true,
  tunneltestLimitGuardsChecked: Boolean(source.tunneltestLimits),
  productionDbConnected: false,
  providerCalled: false,
  serviceStarted: false,
}, null, 2));

function checkUserResourceAuth() {
  assertSequence("/api/library auth before owner work", source.libraryRoute, [
    "const session = await requireAuthSession(request)",
    "if (!session.ok) return authResultResponse(request, session)",
    "readLibraryForOwner(session.user.local_user_id)",
  ]);
  assertSequence("/api/library delete auth before owner work", source.libraryRoute, [
    "const session = await requireAuthSession(request)",
    "if (!session.ok) return authResultResponse(request, session)",
    "deleteLibraryItemForOwner(body.id, session.user.local_user_id)",
  ]);
  assert(!source.libraryRoute.includes("readLibrary()"), "/api/library must not list ownerless library data");
  assert(!source.libraryRoute.includes("deleteLibraryItem(body.id)"), "/api/library must not delete ownerless library data");

  assertSequence("/api/files auth before file owner read", source.filesRoute, [
    "const session = await requireAuthSession(request)",
    "if (!session.ok) return authResultResponse(request, session)",
    "readStoredFileForOwner(name, session.user.local_user_id)",
  ]);

  assertSequence("/api/jobs auth before owner job refresh", source.jobsRoute, [
    "const session = await requireAuthSession(request)",
    "if (!session.ok) return authResultResponse(request, session)",
    "refreshVideoJob(id, session.user.local_user_id)",
  ]);

  assert(source.quotaRoute.includes("quotaSnapshotResponse(request)"), "/api/quota must delegate to quotaSnapshotResponse");
  assert(source.usageRoute.includes("usagePageResponse(request)"), "/api/usage must delegate to usagePageResponse");
  assertSequence("quota helper requires local user", source.quotaHttp, [
    "async function requireLocalUser(request: NextRequest)",
    "const session = await requireAuthSession(request)",
    "if (!session.ok)",
  ]);
  for (const helper of ["quotaSnapshotResponse", "usagePageResponse", "precheckResponse"]) {
    assertFunctionIncludes(source.quotaHttp, helper, "const auth = await requireLocalUser(request)", `${helper} must require a local user`);
    assertFunctionIncludes(source.quotaHttp, helper, "if (!auth.ok) return auth.response", `${helper} must stop on auth failure`);
  }

  assert(source.billingOrdersRoute.includes("createBillingOrderResponse(request)"), "/api/billing/orders POST must delegate to billing helper");
  assert(source.billingOrdersRoute.includes("listBillingOrdersResponse(request)"), "/api/billing/orders GET must delegate to billing helper");
  assert(source.billingOrderRoute.includes("getBillingOrderResponse(request, id)"), "/api/billing/orders/[id] must delegate to billing helper");
  assertSequence("billing helper requires local user", source.billingHttp, [
    "async function requireLocalUser(request: NextRequest)",
    "const session = await requireAuthSession(request)",
    "if (!session.ok)",
  ]);
  for (const helper of ["createBillingOrderResponse", "listBillingOrdersResponse", "getBillingOrderResponse"]) {
    assertFunctionIncludes(source.billingHttp, helper, "const auth = await requireLocalUser(request)", `${helper} must require a local user`);
    assertFunctionIncludes(source.billingHttp, helper, "if (!auth.ok) return auth.response", `${helper} must stop on auth failure`);
  }
  assertFunctionIncludes(source.billingService, "getOrderForUser", "order.local_user_id !== localUserId", "billing order reads must be owner-scoped");
  assertFunctionIncludes(source.billingService, "listOrdersForUser", "localUserId: input.localUserId", "billing order lists must be owner-scoped");

  const adminRoutes = [
    ["src/app/api/admin/providers/route.ts", source.adminProvidersRoute],
    ["src/app/api/admin/provider-health/route.ts", source.adminProviderHealthRoute],
    ["src/app/api/admin/models/health/route.ts", source.adminModelsHealthRoute],
    ["src/app/api/admin/users/route.ts", source.adminUsersRoute],
    ["src/app/api/admin/users/[id]/route.ts", source.adminUserRoute],
    ["src/app/api/admin/users/[id]/status/route.ts", source.adminUserStatusRoute],
    ["src/app/api/admin/users/[id]/quota/route.ts", source.adminUserQuotaRoute],
    ["src/app/api/admin/mappings/route.ts", source.adminMappingsRoute],
    ["src/app/api/admin/mappings/[id]/repair/route.ts", source.adminMappingRepairRoute],
    ["src/app/api/admin/billing/orders/route.ts", source.adminBillingOrdersRoute],
    ["src/app/api/admin/billing/orders/[id]/route.ts", source.adminBillingOrderRoute],
    ["src/app/api/admin/billing/orders/[id]/review/route.ts", source.adminBillingReviewRoute],
    ["src/app/api/admin/task-billing/records/route.ts", source.adminTaskBillingRoute],
  ];
  for (const [file, route] of adminRoutes) {
    assert(
      route.includes("adminResponse") || route.includes("adminList") || route.includes("adminGet") || route.includes("adminUpdate") || route.includes("adminAdjust") || route.includes("adminRepair") || route.includes("adminReview"),
      `${file} must delegate to admin auth helper`,
    );
  }
  assertSequence("admin helper requires admin session", source.adminHttp, [
    "export async function adminResponse(request: NextRequest, handler: AdminHandler)",
    "getAdminService().requireAdmin(sessionTokenFromRequest(request), context)",
    "if (!admin.ok) return json(admin)",
  ]);
}

function checkWriteCsrf() {
  for (const [name, route, providerToken] of [
    ["image generation", source.generateImageRoute, "generateImage"],
    ["video generation", source.generateVideoRoute, "submitVideo"],
    ["image upscale", source.upscaleImageRoute, "runUpscaleImage"],
    ["video upscale", source.upscaleVideoRoute, "runSubmitVideoUpscale"],
  ]) {
    assertSequence(`${name} requires CSRF and auth before provider work`, route, [
      "export async function POST(request: NextRequest)",
      "if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())",
      "const session = await requireAuthSession(request)",
      "if (!session.ok) return authResultResponse(request, session)",
      providerToken,
    ]);
  }

  assertSequence("quota precheck route requires CSRF before helper", source.quotaPrecheckRoute, [
    "export async function POST(request: NextRequest)",
    "if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())",
    "return precheckResponse(request)",
  ]);
  assertFunctionIncludes(source.quotaHttp, "precheckResponse", "const auth = await requireLocalUser(request)", "quota precheck helper must require auth");

  assertFunctionIncludes(source.billingHttp, "createBillingOrderResponse", "if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())", "billing order creation must require CSRF");
  assertFunctionIncludes(source.billingHttp, "createBillingOrderResponse", "const auth = await requireLocalUser(request)", "billing order creation must require auth");

  for (const [name, route] of [
    ["auth login", source.loginRoute],
    ["auth register", source.registerRoute],
    ["auth logout", source.logoutRoute],
  ]) {
    assertSequence(`${name} mutation requires CSRF`, route, [
      "export async function POST(request: NextRequest)",
      "if (!requireCsrf(request))",
    ]);
  }
  assertSequence("auth session refresh requires CSRF", source.sessionRoute, [
    "export async function PATCH(request: NextRequest)",
    "if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())",
  ]);

  assertSequence("prompt optimize route delegates to protected helper", source.promptOptimizeRoute, [
    "export async function POST(request: NextRequest)",
    "return optimizePromptResponse(request)",
  ]);
  assertSequence("prompt optimize helper requires CSRF and auth", source.promptHttp, [
    "export async function optimizePromptResponse(request: NextRequest)",
    "if (!requireCsrf(request)) return authResultResponse(request, csrfFailure())",
    "const session = await requireAuthSession(request)",
    "if (!session.ok)",
  ]);

  assertSequence("admin provider PUT requires CSRF before admin update", source.adminProvidersRoute, [
    "export async function PUT(request: NextRequest)",
    "if (!requireCsrf(request))",
    "return adminResponse(request",
    "updateProviders(body.providers)",
  ]);
  for (const helper of [
    "adminUpdateUserStatusResponse",
    "adminRepairMappingResponse",
    "adminAdjustQuotaResponse",
    "adminReviewOrderResponse",
  ]) {
    assertFunctionIncludes(source.adminHttp, helper, "if (!requireCsrf(request)) return json(csrfFailureForAdmin())", `${helper} must require CSRF`);
    assertFunctionIncludes(source.adminHttp, helper, "return adminResponse(request", `${helper} must still require admin auth`);
  }
}

function checkExistingAbuseGuards() {
  assert(source.authService.includes("loginLimiter?: InMemoryRateLimiter"), "auth service must support a login rate limiter");
  assert(source.authService.includes("registerLimiter?: InMemoryRateLimiter"), "auth service must support a register rate limiter");
  assert(source.authService.includes("this.loginLimiter = dependencies.loginLimiter || new InMemoryRateLimiter(5, 10 * 60 * 1000)"), "auth login limiter defaults must remain wired");
  assert(source.authService.includes("this.registerLimiter = dependencies.registerLimiter || new InMemoryRateLimiter(3, 60 * 60 * 1000)"), "auth register limiter defaults must remain wired");
  assertFunctionIncludes(source.authService, "login", "const rate = this.loginLimiter.consume(limitKey, this.now())", "login must consume the login limiter");
  assertFunctionIncludes(source.authService, "register", "const rate = this.registerLimiter.consume(limitKey, this.now())", "register must consume the register limiter");
  assert(source.authService.includes("status: 429"), "auth limiter failures must return 429");

  assert(source.promptHttp.includes("const limiter = new InMemoryRateLimiter"), "prompt optimizer limiter must remain wired");
  assertFunctionIncludes(source.promptHttp, "optimizePromptResponse", "const rate = limiter.consume(rateKey)", "prompt optimizer must consume limiter");
  assertFunctionIncludes(source.promptHttp, "optimizePromptResponse", "status: 429", "prompt optimizer limiter must return 429");

  if (source.tunneltestLimits) {
    for (const [name, route, operation] of [
      ["image generation", source.generateImageRoute, "cloud_image_generation"],
      ["video generation", source.generateVideoRoute, "cloud_video_generation"],
      ["image upscale", source.upscaleImageRoute, "cloud_image_upscale"],
      ["video upscale", source.upscaleVideoRoute, "cloud_video_upscale"],
    ]) {
      assertSequence(`${name} tunneltest limit`, route, [
        "const tunneltest = await claimTunneltestLimit({",
        `operation: "${operation}"`,
        "idempotencyKey",
        "if (tunneltest && !tunneltest.ok) return tunneltestLimitResponse(tunneltest)",
      ]);
    }
    for (const operation of ["cloud_image_generation", "cloud_video_generation", "cloud_image_upscale", "cloud_video_upscale"]) {
      assert(source.tunneltestLimits.includes(`${operation}: {`), `tunneltest policy must include ${operation}`);
    }
    assertFunctionIncludes(source.quotaHttp, "precheckResponse", "precheckTunneltestLimit", "quota precheck must consult tunneltest limits");
  }
}

function checkPublicRouteWhitelist() {
  const publicGetRoutes = [
    ["csrf token", source.csrfRoute, "csrfResponse(request)"],
    ["backend health", source.healthRoute, "backendHealthHttpReport"],
    ["enabled providers", source.providersEnabledRoute, "readFrontendProviders"],
    ["billing config", source.billingConfigRoute, "paymentConfigResponse()"],
  ];
  for (const [name, route, token] of publicGetRoutes) {
    assert(route.includes("export async function GET"), `${name} public route must be GET-only`);
    assert(route.includes(token), `${name} public route must expose only the expected helper`);
    assert(!route.includes("export async function POST"), `${name} public route must not expose POST`);
    assert(!route.includes("export async function PUT"), `${name} public route must not expose PUT`);
    assert(!route.includes("export async function DELETE"), `${name} public route must not expose DELETE`);
  }

  assert(source.webhookSandboxRoute.includes("sandboxWebhookResponse(request)"), "sandbox webhook route must delegate only to webhook helper");
  assert(source.webhookProductionRoute.includes("productionWebhookResponse(request)"), "production webhook route must delegate only to webhook helper");
  assert(!source.webhookSandboxRoute.includes("requireAuthSession"), "sandbox webhook must not fake user auth");
  assert(!source.webhookProductionRoute.includes("requireAuthSession"), "production webhook must not fake user auth");
}

function checkWebhookSignatureAndIdempotency() {
  for (const helper of ["sandboxWebhookResponse", "productionWebhookResponse"]) {
    assertFunctionIncludes(source.billingHttp, helper, "const rawBody = await request.text()", `${helper} must verify the raw body`);
    assertFunctionIncludes(source.billingHttp, helper, "signature: request.headers.get(\"x-payment-signature\")", `${helper} must pass signature header`);
    assertFunctionIncludes(source.billingHttp, helper, "timestamp: request.headers.get(\"x-payment-timestamp\")", `${helper} must pass timestamp header`);
  }
  assertFunctionIncludes(source.billingService, "handleSandboxWebhook", "return this.handlePaymentWebhook(\"sandbox_alipay\"", "sandbox webhook must share verification path");
  assertFunctionIncludes(source.billingService, "handleProductionWebhook", "return this.handlePaymentWebhook(\"production_generic\"", "production webhook must share verification path");
  assertFunctionIncludes(source.billingService, "handlePaymentWebhook", "verifyWebhook({", "webhooks must call adapter verification");
  assert(source.paymentAdapters.includes("signature: input.signature"), "payment adapter verification must receive the signature");
  assert(source.paymentAdapters.includes("verifySandboxWebhook({"), "sandbox adapter must verify webhook signatures");
  assertFunctionIncludes(source.billingService, "applyWebhookPayload", "appendWebhookEvent(payload.order_id, payload.event_id", "webhooks must record event ids");
  assertFunctionIncludes(source.billingService, "applyWebhookPayload", "if (wasCompleted)", "webhooks must detect completed duplicate events");
  assertFunctionIncludes(source.billingService, "applyWebhookPayload", "action: \"idempotent\"", "webhooks must return idempotent duplicate actions");
}

function checkSelfIsStaticOnly() {
  const self = read("scripts/test-abuse-guard-contracts.mjs");
  for (const token of [
    ["node", "http"].join(":"),
    ["node", "https"].join(":"),
    ["node", "child_process"].join(":"),
    ["un", "dici"].join(""),
    ["fetch", "("].join(""),
  ]) {
    assert(!self.includes(token), `test must not have network/process capability: ${token}`);
  }
  assert(source.packageJson.includes("\"test:abuse-guard-contracts\""), "package.json must expose test:abuse-guard-contracts");
  assert(source.packageJson.includes("npm run test:abuse-guard-contracts"), "npm run check must include test:abuse-guard-contracts");
}

function read(file) {
  return readFileSync(join(root, file), "utf8");
}

function readOptional(file) {
  const path = join(root, file);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function assertSequence(name, body, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = body.indexOf(token, cursor + 1);
    assert(index > cursor, `${name} missing or reordered token: ${token}`);
    cursor = index;
  }
}

function assertFunctionIncludes(body, functionName, token, message) {
  const functionBody = extractFunctionBody(body, functionName);
  assert(functionBody.includes(token), message);
}

function extractFunctionBody(body, functionName) {
  const escaped = escapeRegExp(functionName);
  const pattern = new RegExp(
    `(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\s*\\(|(?:^|[\\n\\r]\\s*)(?:async\\s+)?${escaped}\\s*\\(`,
    "m",
  );
  const match = pattern.exec(body);
  assert(match, `missing function ${functionName}`);
  const open = findFunctionBodyOpen(body, match.index);
  assert(open >= 0, `missing function body for ${functionName}`);
  let depth = 0;
  for (let index = open; index < body.length; index += 1) {
    const char = body[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return body.slice(open, index + 1);
    }
  }
  assert.fail(`unterminated function body for ${functionName}`);
}

function findFunctionBodyOpen(body, start) {
  let parenDepth = 0;
  let angleDepth = 0;
  for (let index = body.indexOf("(", start); index < body.length; index += 1) {
    const char = body[index];
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth -= 1;
    if (parenDepth <= 0 && char === "<") angleDepth += 1;
    if (parenDepth <= 0 && char === ">" && angleDepth > 0) angleDepth -= 1;
    if (parenDepth <= 0 && angleDepth <= 0 && char === "{") return index;
  }
  return -1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
