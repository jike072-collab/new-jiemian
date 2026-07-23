export type TikTokShopVideoGuidanceInput = {
  prompt: string;
  duration?: number;
  targetPlatform?: string;
  videoType?: string;
};

export function isTikTokShopVideoRequest(input: TikTokShopVideoGuidanceInput) {
  const context = `${input.targetPlatform || ""}\n${input.videoType || ""}\n${input.prompt || ""}`;
  return /tiktok\s*shop|tiktok|抖音海外|tk\s*(?:带货|短视频)/iu.test(context)
    || /(?:带货|电商|商品推广|转化).{0,10}(?:短视频|视频)|(?:短视频|视频).{0,10}(?:带货|电商|商品推广|转化)/u.test(context);
}

export function tiktokShopVideoTiming(durationSeconds = 15) {
  const duration = Math.min(60, Math.max(3, Math.round(Number(durationSeconds) || 15)));
  if (duration <= 7) {
    const hookEnd = 1;
    const actionStart = Math.max(hookEnd + 1, duration - 1);
    return [
      `0-${hookEnd} 秒：用痛点、可见结果、效果反差、利益点或反常识画面抓住注意`,
      `${hookEnd}-${actionStart} 秒：完成一个核心价值演示，并把真实细节作为信任证据`,
      `${actionStart}-${duration} 秒：收束结果并给出一个明确行动指令`,
    ];
  }

  const shortForm = duration <= 15;
  const hookEnd = shortForm ? 2 : Math.min(3, Math.max(2, Math.round(duration * 0.12)));
  const valueEnd = Math.max(hookEnd + 2, Math.round(duration * (shortForm ? 0.6 : 0.52)));
  const trustEnd = shortForm
    ? Math.max(valueEnd + 1, duration - (duration >= 12 ? 2 : 1))
    : Math.max(valueEnd + 1, Math.round(duration * 0.8));
  return [
    `0-${hookEnd} 秒：用痛点、可见结果、效果反差、利益点或反常识画面抓住注意`,
    `${hookEnd}-${valueEnd} 秒：通过功能演示、使用场景或可比较的前后变化呈现一个核心价值`,
    `${valueEnd}-${trustEnd} 秒：用真实商品细节、连续使用结果或已有可信证据建立信任`,
    `${trustEnd}-${duration} 秒：收束结果并给出一个明确行动指令`,
  ];
}

export function tiktokShopVideoGuidance(input: TikTokShopVideoGuidanceInput) {
  if (!isTikTokShopVideoRequest(input)) return [];
  return [
    "TikTok Shop 转化结构：按注意、兴趣与欲望、信任、行动组织内容；时长较短时可以合并价值与信任，但不能省略开场钩子和结尾行动。",
    ...tiktokShopVideoTiming(input.duration),
    "整条视频只讲一个最强且可见的商品价值，动作和镜头服务于这个价值，不要同时堆多个卖点。",
    "功能演示、场景展示、效果对比和用户证言只能使用素材或用户要求能够支持的事实；不得虚构功效、价格、折扣、销量或社会证明。",
    "行动指令保持简短明确；用户没有要求画面文字时，不要让生成模型新增促销字样、价格、Logo 或商品标签。",
  ];
}
