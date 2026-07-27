import { ecommerceTenPageBatchStyles, ecommerceTenPageCount, ecommerceTenPageMaxReferenceCount, ecommerceTenPagePrompt, ecommerceTenPageTitles } from "../../image-presets";
import { providerById } from "../providers";

type EcommerceReference = {
  bytes: Buffer;
  mimeType: string;
  fileName: string;
};

type EcommercePromptRequest = {
  ownerLocalUserId: string;
  batchId: string;
  pageCount: number;
  pageIndex: number;
  ratio: string;
  batchStyleIndex: number;
  references: EcommerceReference[];
};

type EcommercePromptBundle = {
  prompts: string[];
};

const ecommercePromptCacheTtlMs = 10 * 60 * 1000;
const ecommercePromptTimeoutMs = 120 * 1000;
const ecommercePromptCache = new Map<string, {
  expiresAt: number;
  promise: Promise<EcommercePromptBundle>;
}>();

const pageDirections = [
  "Hero Visual Impact: 爆款首图，主推真实配色，低机位、能量背景、速度线。画面英文：MOVE WITH ENERGY | Sport Style Sneakers | Lightweight Feel / Street Ready / Daily Comfort",
  "Pain Point Solution: 用信息图表达可见的舒适、透气、抓地视觉。画面英文：BUILT FOR EVERYDAY MOVE | Comfort. Grip. Style. | Soft Step / Breathable Look / Stable Grip",
  "Native Movement Scene: 东南亚街头、校园、健身房或通勤动态。画面英文：MADE TO MOVE | Run. Walk. Train. | Daily Run / Gym Fit / Street Style",
  "Upper Detail Focus: 忠实展示鞋面纹理和透气视觉的微距细节。画面英文：BREATHABLE UPPER LOOK | Flexible. Light. Clean. | Texture Detail / Airflow Visual / Soft Touch Look",
  "Midsole Structure: 真实侧面、中底层次和缓震视觉，不虚构内部科技。画面英文：SOFT STEP ENERGY | Cushion Feel for Daily Motion | Impact Wave / Forward Push / Comfort Ride",
  "Outsole and Hard Details: 鞋底纹理、后跟、鞋带和侧边真实细节拼贴。画面英文：OUTSOLE GRIP | Heel Detail / Lace Structure / Side Texture",
  "Social Outfit Style: 年轻街头穿搭和社交氛围，少量相机框。画面英文：MATCH YOUR MOVE | Sport Meets Street | OOTD / Daily Fit / Hot Pick",
  "Daily Comfort Lifestyle: 咖啡店、校园、通勤或运动后休息。画面英文：ALL DAY COMFORT | Easy Walk / Daily Wear / Relaxed Fit",
  "Full Color Lineup: 展示全部已上传真实配色，每个配色独立陈列。画面英文：CHOOSE YOUR COLOR | One Style. More Energy.",
  "Buyer Show and CTA: 买家秀拼贴、产品主图、通用尺码卡和 CTA，不编造折扣评价。画面英文：READY FOR YOUR NEXT MOVE | Size Options Available | Hot Pick / Daily Training Ready / Street Style / Choose Your Color",
] as const;

function fallbackPrompts(input: EcommercePromptRequest) {
  const colorwayCount = Math.min(Math.max(input.references.length - 1, 1), ecommerceTenPageMaxReferenceCount - 1);
  return Array.from({ length: input.pageCount }, (_, index) => ecommerceTenPagePrompt(
    index + 1,
    input.ratio,
    input.pageCount,
    input.batchStyleIndex,
    colorwayCount,
  ));
}

function cleanJsonText(value: string) {
  const withoutFence = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = withoutFence.indexOf("{");
  const end = withoutFence.lastIndexOf("}");
  return start >= 0 && end > start ? withoutFence.slice(start, end + 1) : withoutFence;
}

function responseText(payload: unknown) {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const choices = Array.isArray(root.choices) ? root.choices : [];
  const first = choices[0] && typeof choices[0] === "object" ? choices[0] as Record<string, unknown> : {};
  const message = first.message && typeof first.message === "object" ? first.message as Record<string, unknown> : {};
  return typeof message.content === "string"
    ? message.content
    : typeof root.output_text === "string" ? root.output_text : "";
}

async function imageDataUrl(reference: EcommerceReference) {
  let bytes = reference.bytes;
  let mimeType = reference.mimeType || "image/jpeg";
  try {
    const sharp = (await import("sharp")).default;
    bytes = await sharp(reference.bytes)
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toBuffer();
    mimeType = "image/jpeg";
  } catch {
    // The original upload is still a valid vision input if image compression is unavailable.
  }
  return `data:${mimeType};base64,${bytes.toString("base64")}`;
}

function analysisSystemPrompt() {
  return [
    "你是 TikTok 东南亚鞋类电商套图的视觉分析与提示词生成器。你能看懂用户上传的图片。",
    "第 1 张图片固定是原始品牌 Logo，只用于每页左上角；第 2 张及之后每张图片分别是一款真实鞋子配色的四视图白底板。先识别真实鞋型、配色、鞋面纹理、侧边图案、中底、鞋底、后跟和鞋带，不得混合不同配色，也不得创造图片中没有的颜色、结构、材质、参数、认证、评价或折扣。",
    "图片顺序就是语义顺序，必须使用图1、图2、图3等名称理解引用关系：图1只负责Logo，图2起分别负责各自真实配色。不能发明角色名、隐藏标签或根据文件名猜测内容。",
    "请严格按照《10 套图》文档生成每页提示词：10 个页面用途必须分别是 Hero、Pain Point、Movement、Upper Detail、Midsole、Outsole、Outfit、Comfort、Color Lineup、Buyer Show + CTA。统一品牌视觉但每页构图、场景、信息密度和角度必须有变化。",
    "所有最终画面可见文字只能是英文。提示词本身可以使用简体中文，但必须明确要求模型只渲染指定英文短文案，不能出现中文、乱码或随机字母。",
    "只输出 JSON，不要 Markdown，不要解释，格式必须是：{\"productAnalysis\":\"简短中文分析\",\"pages\":[{\"page\":1,\"prompt\":\"可直接提交给图片模型的中文提示词\"}]}。每页 prompt 控制在 900 个中文字符以内，必须包含真实参考图约束、该页用途、指定英文文案、Logo 左上角和禁止臆造规则。",
  ].join("\n");
}

async function callVisionPromptProvider(input: EcommercePromptRequest): Promise<EcommercePromptBundle> {
  const provider = await providerById("prompt-optimizer");
  if (!provider?.apiKey || provider.endpointType !== "chat-completions") throw new Error("vision prompt provider unavailable");
  const content = [
    {
      type: "text",
      text: [
        `本批次生成 ${input.pageCount} 张，画幅 ${input.ratio}，统一风格：${ecommerceTenPageBatchStyles[input.batchStyleIndex] || ecommerceTenPageBatchStyles[0]}。`,
        `上传图片共 ${input.references.length} 张，其中第 1 张是 Logo，第 2 张起是 ${Math.max(input.references.length - 1, 1)} 款鞋子配色。`,
        "请先在内部完成 Product Image Analysis，再为以下页面输出可直接提交的提示词：",
        pageDirections.slice(0, input.pageCount).map((direction, index) => `第 ${index + 1} 页 ${ecommerceTenPageTitles[index]}：${direction}`).join("\n"),
      ].join("\n"),
    },
    ...(await Promise.all(input.references.map(async (reference, index) => ([
      {
        type: "text",
        text: index === 0 ? "图1：原始品牌 Logo。" : `图${index + 1}：第 ${index} 款真实鞋子配色四视图白底板。`,
      },
      {
        type: "image_url",
        image_url: { url: await imageDataUrl(reference) },
      },
    ])))).flat(),
  ];
  const response = await fetch(provider.apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-5.6-sol",
      temperature: 0.2,
      max_tokens: 6000,
      messages: [
        { role: "system", content: analysisSystemPrompt() },
        { role: "user", content },
      ],
    }),
    signal: AbortSignal.timeout(ecommercePromptTimeoutMs),
  });
  if (!response.ok) throw new Error(`vision prompt provider returned HTTP ${response.status}`);
  const payload = await response.json() as unknown;
  const parsed = JSON.parse(cleanJsonText(responseText(payload))) as { pages?: unknown };
  const pages = Array.isArray(parsed.pages) ? parsed.pages : [];
  const prompts = Array.from({ length: input.pageCount }, () => "");
  pages.forEach((page) => {
    if (!page || typeof page !== "object") return "";
    const pageNumber = Number((page as Record<string, unknown>).page);
    const value = (page as Record<string, unknown>).prompt;
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > input.pageCount || typeof value !== "string") return;
    const prompt = value.trim().slice(0, 6000);
    if (prompt.length < 80 || !/(鞋|产品|主体)/u.test(prompt) || !/(英文|English)/i.test(prompt)) return;
    prompts[pageNumber - 1] = prompt;
  });
  if (prompts.some((prompt) => !prompt)) {
    throw new Error("vision prompt provider returned incomplete page prompts");
  }
  return { prompts: prompts.slice(0, input.pageCount) };
}

export async function ecommerceTenPagePromptForPage(input: EcommercePromptRequest) {
  const pageCount = Math.min(Math.max(Math.trunc(input.pageCount), 1), ecommerceTenPageCount);
  const pageIndex = Math.min(Math.max(Math.trunc(input.pageIndex), 1), pageCount);
  if (!input.batchId.trim()) {
    return (await callVisionPromptProvider({ ...input, pageCount, pageIndex }).catch(() => ({ prompts: fallbackPrompts({ ...input, pageCount, pageIndex }) }))).prompts[pageIndex - 1];
  }
  const cacheKey = `${input.ownerLocalUserId}:${input.batchId}`;
  const cached = ecommercePromptCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return (await cached.promise).prompts[pageIndex - 1];
  }
  const request = { ...input, pageCount, pageIndex };
  const promise = callVisionPromptProvider(request).catch(() => ({ prompts: fallbackPrompts(request) }));
  ecommercePromptCache.set(cacheKey, { expiresAt: Date.now() + ecommercePromptCacheTtlMs, promise });
  return (await promise).prompts[pageIndex - 1];
}
