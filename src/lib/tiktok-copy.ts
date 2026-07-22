export const malaysiaTikTokCopyAngles = [
  { id: "auto", label: "AI 精选", prompt: "根据视频最有吸引力的可见内容选择一个清晰角度。" },
  { id: "transformation", label: "前后反差", prompt: "突出鞋子出现前后的视觉变化和第一眼反差，不虚构效果。" },
  { id: "daily", label: "日常穿搭", prompt: "突出适合马来西亚日常出街和穿搭的视觉感受。" },
  { id: "style", label: "潮流种草", prompt: "用自然、有记忆点的马来语表达颜色搭配和造型吸引力。" },
  { id: "detail", label: "商品细节", prompt: "聚焦视频中真实可见的鞋面、鞋底、配色和细节。" },
] as const;

export type MalaysiaTikTokCopyAngle = (typeof malaysiaTikTokCopyAngles)[number]["id"];

export type TikTokCopyDraft = {
  title: string;
  caption: string;
  hashtags: string[];
  angle: MalaysiaTikTokCopyAngle;
};

const commonHashtags = [
  "KasutMalaysia",
  "KasutSukan",
  "OOTDMalaysia",
  "GayaHarian",
  "TikTokShopMalaysia",
];

const angleHashtags: Record<MalaysiaTikTokCopyAngle, string[]> = {
  auto: ["KasutMalaysia", "OOTDMalaysia"],
  transformation: ["TransformasiGaya", "SebelumSelepas"],
  daily: ["GayaHarian", "OOTDMalaysia"],
  style: ["StreetStyleMY", "GayaMalaysia"],
  detail: ["DetailKasut", "KasutSukan"],
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function malaysiaTikTokCopyAngle(value: unknown): MalaysiaTikTokCopyAngle {
  return malaysiaTikTokCopyAngles.some((item) => item.id === value) ? value as MalaysiaTikTokCopyAngle : "auto";
}

export function malaysiaTikTokCopyAnglePrompt(angle: MalaysiaTikTokCopyAngle) {
  return malaysiaTikTokCopyAngles.find((item) => item.id === angle)?.prompt || malaysiaTikTokCopyAngles[0].prompt;
}

export function normalizeTikTokHashtags(value: unknown, angle: MalaysiaTikTokCopyAngle = "auto", supplement = true) {
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
    if (!normalized || seen.has(key)) return;
    seen.add(key);
    hashtags.push(`#${normalized}`);
  };
  source.forEach(add);
  if (supplement) {
    [...angleHashtags[angle], ...commonHashtags].forEach((candidate) => {
      if (hashtags.length < 5) add(candidate);
    });
  }
  return hashtags.slice(0, 7);
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
  return {
    title: withoutHashtags(record.title, 80),
    caption: withoutHashtags(record.caption, 1_200),
    hashtags: normalizeTikTokHashtags(record.hashtags, angle),
    angle,
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
