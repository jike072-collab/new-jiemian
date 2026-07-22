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
const copyService = read("src/lib/server/tiktok/copy.ts");
const copyRoute = read("src/app/api/tiktok/copy/route.ts");
const workspace = read("src/components/canvas/canvas-workspace.tsx");
const node = read("src/components/canvas/canvas-node.tsx");
const canvasCss = read("src/app/canvas/canvas.css");
const migration = read("db/migrations/020_tiktok_publishing.sql");
const timer = read("deploy/systemd/aohuang-tiktok-publisher.timer");

assert.match(client, /Authorization: `Bearer \$\{input\.apiKey\}`/);
assert.match(client, /"x-request-id": input\.requestId/);
assert.match(client, /video_made_with_ai: true/);
assert.match(client, /content_preview_confirmed: true/);
assert.match(client, /express_consent_given: true/);
assert.match(client, /publishNow: true/);
assert.match(client, /presignZernioVideoUpload/);
assert.match(client, /createReadStream\(input\.filePath\)/);
assert.doesNotMatch(client, /console\.(log|error).*apiKey/i);

assert.match(service, /state\.userId !== input\.userId/);
assert.match(service, /getTikTokConnectionByAccountId/);
assert.match(service, /TIKTOK_ACCOUNT_ALREADY_CLAIMED/);
assert.doesNotMatch(service, /disconnectZernioAccount/);
assert.match(service, /profile\.zernioProfileId !== input\.profileId/);
assert.match(service, /sourceOwnerId/);
assert.match(service, /readLibraryMetadataForOwners\(ownerIds\)/);
assert.match(service, /scheduledAt <= new Date\(now\.getTime\(\) \+ 15_000\)/);
assert.match(service, /if \(!creator\.canPostMore\)/);
assert.match(service, /statusPollDelayMs/);

assert.match(publishRoute, /requireAuthSession/);
assert.match(publishRoute, /requireCsrf/);
assert.match(publishRoute, /getInternalCanvasWorkspaceMemberIds/);
assert.match(repository, /where id = \$1 and user_id = \$2/);
assert.match(repository, /where zernio_account_id = \$1/);
assert.match(repository, /on conflict \(user_id, idempotency_key\)/);
assert.match(migration, /unique index.*tiktok_connections_zernio_account_unique_idx/is);
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
assert.doesNotMatch(publisher, /item\.prompt \|\| item\.title/);
assert.match(publisher, /mode === "scheduled" \? "加入定时发布"/);
assert.match(copyService, /buildCanvasAssistantVisualEvidence/);
assert.match(copyService, /不得使用素材的生成提示词代替发布文案/);
assert.match(copyService, /不要为了蹭热度加入无关总榜话题/);
assert.doesNotMatch(copyService, /item\.prompt/);
assert.match(copyRoute, /isInternalCanvasHostname/);
assert.match(copyRoute, /requireCsrf/);
assert.match(copyRoute, /requireAuthSession/);
assert.match(copyRoute, /getInternalCanvasWorkspaceMemberIds/);
assert.match(copyRoute, /InMemoryRateLimiter/);
assert.match(copyRules, /TikTokShopMalaysia/);
assert.match(canvasCss, /canvas-tiktok-panel/);
assert.match(canvasCss, /canvas-tiktok-copy__angles/);

const {
  composeTikTokCaption,
  normalizeTikTokCopyDraft,
  normalizeTikTokHashtags,
  parseTikTokCopyResponse,
} = await import("../src/lib/tiktok-copy.ts");

const parsedCopy = parseTikTokCopyResponse(`\`\`\`json
{"title":"Warna yang terus mencuri perhatian #fyp","caption":"Satu langkah, terus nampak lain. #kasut","hashtags":["#KasutMalaysia","KasutMalaysia","#OOTDMalaysia"],"angle":"transformation"}
\`\`\``);
assert.equal(parsedCopy.angle, "transformation");
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

console.log("TikTok publishing contracts passed without creating a post");
