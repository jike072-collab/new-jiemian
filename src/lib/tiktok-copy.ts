import {
  malaysiaShoeCopyCategory,
  malaysiaShoeCopyHashtagPool,
  type MalaysiaShoeCopyCategory,
} from "#malaysia-shoe-copy-library";

export const malaysiaTikTokCopyAngles = [
  { id: "auto", label: "转化精选", prompt: "根据视频最强的可见钩子、核心价值和可信证据选择一个清晰角度。" },
  { id: "transformation", label: "效果对比", prompt: "突出鞋子出现前后的视觉变化和第一眼反差，不虚构效果。" },
  { id: "daily", label: "场景展示", prompt: "突出视频中真实可见的日常使用或穿搭场景，以及它带来的一个明确价值。" },
  { id: "style", label: "视觉钩子", prompt: "用自然、有记忆点的马来语表达视频中最抓眼的配色、造型或反差。" },
  { id: "detail", label: "可信细节", prompt: "聚焦视频中真实可见的鞋面、鞋底、配色、结构或连续使用细节，用事实建立信任。" },
] as const;

export type MalaysiaTikTokCopyAngle = (typeof malaysiaTikTokCopyAngles)[number]["id"];

export type TikTokCopyDraft = {
  title: string;
  caption: string;
  hashtags: string[];
  angle: MalaysiaTikTokCopyAngle;
  category: MalaysiaShoeCopyCategory;
};

const commonHashtags = ["kasut", "kasutviral", "shoes", "kasutviralmy"];

const angleHashtags: Record<MalaysiaTikTokCopyAngle, string[]> = {
  auto: [],
  transformation: ["kasutviral"],
  daily: ["kasutharian", "gayakasual"],
  style: ["sneakers", "streetwear"],
  detail: ["kasut", "shoes"],
};

const unrelatedTrendHashtags = new Set(["fyp", "rainbowpfp", "spain", "final"]);

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function malaysiaTikTokCopyAngle(value: unknown): MalaysiaTikTokCopyAngle {
  return malaysiaTikTokCopyAngles.some((item) => item.id === value) ? value as MalaysiaTikTokCopyAngle : "auto";
}

export function malaysiaTikTokCopyAnglePrompt(angle: MalaysiaTikTokCopyAngle) {
  return malaysiaTikTokCopyAngles.find((item) => item.id === angle)?.prompt || malaysiaTikTokCopyAngles[0].prompt;
}

export function normalizeTikTokHashtags(
  value: unknown,
  angle: MalaysiaTikTokCopyAngle = "auto",
  supplement = true,
  category: MalaysiaShoeCopyCategory = "auto",
) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[\s,，]+/u)
      : [];
  const hashtags: string[] = [];
  const seen = new Set<string>();
  const add = (candidate: unknown) => {
    const normalized = text(candidate, 80)
      .replace(/^#+/u, "")
      .replace(/[^\p{L}\p{N}_]/gu, "");
    const key = normalized.toLocaleLowerCase("ms-MY");
    if (!normalized || seen.has(key) || unrelatedTrendHashtags.has(key)) return;
    seen.add(key);
    hashtags.push(`#${normalized}`);
  };
  source.forEach(add);
  if (supplement) {
    [...malaysiaShoeCopyHashtagPool(category), ...angleHashtags[angle], ...commonHashtags].forEach((candidate) => {
      if (hashtags.length < 4) add(candidate);
    });
  }
  return hashtags.slice(0, 6);
}

function withoutHashtags(value: unknown, maxLength: number) {
  return text(value, maxLength)
    .replace(/(^|\s)#[\p{L}\p{N}_]+/gu, " ")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeTikTokCopyDraft(value: unknown, requestedAngle: MalaysiaTikTokCopyAngle = "auto"): TikTokCopyDraft {
  const record = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const angle = requestedAngle === "auto" ? malaysiaTikTokCopyAngle(record.angle) : requestedAngle;
  const category = malaysiaShoeCopyCategory(record.category);
  return {
    title: withoutHashtags(record.title, 80),
    caption: withoutHashtags(record.caption, 1_200),
    hashtags: normalizeTikTokHashtags(record.hashtags, angle, true, category),
    angle,
    category,
  };
}

export function parseTikTokCopyResponse(value: string, requestedAngle: MalaysiaTikTokCopyAngle = "auto") {
  const cleaned = value.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
  const draft = normalizeTikTokCopyDraft(JSON.parse(cleaned), requestedAngle);
  if (!draft.title || !draft.caption) throw new Error("TikTok copy response is incomplete.");
  return draft;
}

export function composeTikTokCaption(input: Pick<TikTokCopyDraft, "title" | "caption" | "hashtags">) {
  const title = withoutHashtags(input.title, 80);
  const caption = withoutHashtags(input.caption, 1_200);
  const hashtags = normalizeTikTokHashtags(input.hashtags, "auto", false).join(" ");
  return [title, caption, hashtags].filter(Boolean).join("\n\n").slice(0, 2_200);
}
