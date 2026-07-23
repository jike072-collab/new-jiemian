#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const client = read("src/lib/server/tiktok/client.ts");
const service = read("src/lib/server/tiktok/service.ts");
const repository = read("src/lib/server/tiktok/repository.ts");
const publishRoute = read("src/app/api/tiktok/publish/route.ts");
const callbackRoute = read("src/app/api/tiktok/oauth/callback/route.ts");
const workerRoute = read("src/app/api/internal/tiktok/publish-due/route.ts");
const publisher = read("src/components/canvas/canvas-tiktok-publisher.tsx");
const copyRules = read("src/lib/tiktok-copy.ts");
const shoeCopyLibrary = read("src/lib/malaysia-shoe-copy-library.ts");
const copyService = read("src/lib/server/tiktok/copy.ts");
const copyRoute = read("src/app/api/tiktok/copy/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const node = read("src/components/canvas/canvas-node.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
const migration = read("db/migrations/020_tiktok_publishing.sql");
const creatorInboxMigration = read("db/migrations/021_tiktok_creator_inbox.sql");
const timer = read("deploy/systemd/aohuang-tiktok-publisher.timer");

assert.match(client, /Authorization: `Bearer \$\{input\.apiKey\}`/);
assert.match(client, /"x-request-id": input\.requestId/);
assert.match(client, /video_made_with_ai: true/);
assert.match(client, /content_preview_confirmed: true/);
assert.match(client, /express_consent_given: true/);
assert.match(client, /publishNow: true/);
assert.match(client, /draft: input\.deliveryMode === "creator_inbox"/);
assert.match(client, /presignZernioVideoUpload/);
assert.match(client, /createReadStream\(input\.filePath\)/);
assert.match(client, /"Content-Length": String\(input\.fileSize\)/);
assert.match(service, /uploadZernioVideo\(\{[^}]*fileSize: video\.size/s);
assert.doesNotMatch(client, /console\.(log|error).*apiKey/i);

assert.match(service, /state\.userId !== input\.userId/);
assert.match(service, /getTikTokConnectionByAccountId/);
assert.match(service, /TIKTOK_ACCOUNT_ALREADY_CLAIMED/);
assert.doesNotMatch(service, /disconnectZernioAccount/);
assert.match(service, /profile\.zernioProfileId !== input\.profileId/);
assert.match(service, /sourceOwnerId/);
assert.match(service, /readLibraryMetadataForOwners\(ownerIds\)/);
assert.match(service, /scheduledAt <= new Date\(now\.getTime\(\) \+ 15_000\)/);
assert.match(service, /deliveryMode === "direct"[^\n]*!creator\.canPostMore/);
assert.match(service, /job\.deliveryMode === "direct"[^\n]*!creator\.canPostMore/);
assert.match(service, /TIKTOK_DRAFT_SCHEDULE_UNAVAILABLE/);
assert.match(service, /deliveryMode: job\.deliveryMode/);
assert.match(service, /statusPollDelayMs/);

assert.match(publishRoute, /requireAuthSession/);
assert.match(publishRoute, /requireCsrf/);
assert.match(publishRoute, /getInternalCanvasWorkspaceMemberIds/);
assert.match(publishRoute, /deliveryMode: String\(body\.deliveryMode \|\| "direct"\)/);
assert.match(repository, /where id = \$1 and user_id = \$2/);
assert.match(repository, /where zernio_account_id = \$1/);
assert.match(repository, /on conflict \(user_id, idempotency_key\)/);
assert.equal((repository.match(/greatest\(\$14::timestamptz, now\(\)\)/g) || []).length, 2, "immediate TikTok jobs must not predate their database creation time");
assert.match(migration, /unique index.*tiktok_connections_zernio_account_unique_idx/is);
assert.match(creatorInboxMigration, /add column if not exists delivery_mode text not null default 'direct'/);
assert.match(creatorInboxMigration, /check \(delivery_mode in \('direct', 'creator_inbox'\)\)/);
assert.match(callbackRoute, /safeTikTokSecretEqual\(state, cookieState\)/);
assert.match(workerRoute, /safeTikTokSecretEqual\(authorization, expected\)/);
assert.match(timer, /OnUnitInactiveSec=20s/);

assert.match(workspace, /CanvasTikTokPublisher/);
assert.match(node, /发布到 TikTok/);
assert.match(publisher, /immediateLimitReached/);
assert.match(publisher, /availableAccounts/);
assert.match(publisher, /\/api\/tiktok\/copy/);
assert.match(publisher, /正在分析视频并生成马来西亚文案/);
assert.match(publisher, /malaysiaTikTokCopyAngles\.map/);
assert.match(publisher, /composeTikTokCaption/);
assert.match(publisher, /if \(initialCopy\) return;/);
assert.match(publisher, /onCopyChange\(`\$\{scope\}:\$\{item\.id\}`/);
assert.doesNotMatch(publisher, /setCopyAngle\(option\.id\);\s*void generateCopy\(option\.id\)/);
assert.doesNotMatch(publisher, /item\.prompt \|\| item\.title/);
assert.match(publisher, /mode === "scheduled" \? "加入定时发布"/);
assert.match(publisher, /TikTok 热门英文音乐/);
assert.match(publisher, /发送到 TikTok 草稿箱/);
assert.match(publisher, /setDeliveryMode\("creator_inbox"\)/);
assert.match(publisher, /disabled=\{deliveryMode === "creator_inbox"\}/);
assert.match(publisher, /job\.deliveryMode === "creator_inbox"/);
assert.match(copyService, /buildCanvasAssistantVisualEvidence/);
assert.match(copyService, /不得使用素材的生成提示词代替发布文案/);
assert.match(copyService, /注意、兴趣与欲望、信任、行动/);
assert.match(copyService, /功能演示、真实场景、可比较的前后变化、商品细节/);
assert.match(copyService, /不要为了蹭热度加入无关总榜话题/);
assert.match(copyService, /马来鞋类文案库/);
assert.match(copyService, /caption 只写 1-2 句/);
assert.match(copyService, /只有视频画面或可信上下文明确支持时/);
assert.doesNotMatch(copyService, /item\.prompt/);
assert.match(copyRoute, /isInternalCanvasHostname/);
assert.match(copyRoute, /requireCsrf/);
assert.match(copyRoute, /requireAuthSession/);
assert.match(copyRoute, /getInternalCanvasWorkspaceMemberIds/);
assert.match(copyRoute, /InMemoryRateLimiter/);
assert.doesNotMatch(copyRules, /TikTokShopMalaysia|KasutMalaysia|OOTDMalaysia/);
assert.match(shoeCopyLibrary, /sports:[\s\S]*women:[\s\S]*men:[\s\S]*kids:[\s\S]*safety:[\s\S]*outdoor:[\s\S]*casual:/);
assert.match(shoeCopyLibrary, /evidenceOnlyClaims/);
assert.match(shoeCopyLibrary, /do not add #fyp by default/);
assert.match(canvasCss, /canvas-tiktok-panel/);
assert.match(canvasCss, /canvas-tiktok-copy__angles/);
assert.match(canvasCss, /canvas-tiktok-form__music/);

const {
  composeTikTokCaption,
  normalizeTikTokCopyDraft,
  normalizeTikTokHashtags,
  parseTikTokCopyResponse,
} = await import("../src/lib/tiktok-copy.ts");
const { tiktokShopVideoTiming } = await import("../src/lib/tiktok-shop-video-guidance.ts");
const {
  malaysiaShoeCopyCategories,
  malaysiaShoeCopyHashtagPool,
  malaysiaShoeCopyPromptLibrary,
} = await import("../src/lib/malaysia-shoe-copy-library.ts");

const parsedCopy = parseTikTokCopyResponse(`\`\`\`json
{"title":"Warna yang terus mencuri perhatian #fyp","caption":"Satu langkah, terus nampak lain. #kasut","hashtags":["#kasutsukan","kasutsukan","#sportshoes"],"angle":"transformation","category":"sports"}
\`\`\``);
assert.equal(parsedCopy.angle, "transformation");
assert.equal(parsedCopy.category, "sports");
assert.equal(parsedCopy.title, "Warna yang terus mencuri perhatian");
assert.doesNotMatch(parsedCopy.caption, /#/);
assert.equal(new Set(parsedCopy.hashtags.map((value) => value.toLowerCase())).size, parsedCopy.hashtags.length);
assert.ok(parsedCopy.hashtags.length >= 4 && parsedCopy.hashtags.length <= 7);

const explicitAngle = normalizeTikTokCopyDraft({
  title: "Lihat lebih dekat",
  caption: "Perincian warna yang jelas dalam setiap langkah.",
  hashtags: ["#DetailKasut"],
  angle: "auto",
}, "detail");
assert.equal(explicitAngle.angle, "detail");
const composed = composeTikTokCaption({ ...explicitAngle, hashtags: ["#DetailKasut"] });
assert.match(composed, /^Lihat lebih dekat\n\n/);
assert.match(composed, /\n\n#DetailKasut$/);
assert.equal(normalizeTikTokHashtags(["#KasutMalaysia", "KasutMalaysia"], "auto", false).length, 1);
assert.deepEqual(normalizeTikTokHashtags(["#rainbowpfp", "#spain", "#final", "#kasutwanita"], "auto", false), ["#kasutwanita"]);
assert.ok(!normalizeTikTokHashtags([], "auto").some((value) => value.toLowerCase() === "#fyp"));
assert.ok(normalizeTikTokHashtags([], "auto", true, "kids").includes("#kasutkanakkanak"));
assert.equal(malaysiaShoeCopyCategories.length, 8);
assert.deepEqual(tiktokShopVideoTiming(10).map((line) => line.match(/^\d+-\d+/)?.[0]), ["0-2", "2-6", "6-9", "9-10"]);
assert.deepEqual(tiktokShopVideoTiming(25).map((line) => line.match(/^\d+-\d+/)?.[0]), ["0-3", "3-13", "13-20", "20-25"]);
assert.ok(malaysiaShoeCopyHashtagPool("safety").includes("kasutsafety"));
const promptLibrary = malaysiaShoeCopyPromptLibrary();
for (const category of ["sports", "women", "men", "kids", "safety", "outdoor", "casual"]) assert.match(promptLibrary, new RegExp(`"id":"${category}"`));
for (const claim of ["price", "discount", "stock or sold-out status", "comfort", "anti-slip, waterproof or protective performance"]) assert.match(promptLibrary, new RegExp(claim));

console.log("TikTok publishing contracts passed without creating a post");
