export const whiteBackgroundFourViewPresetId = "white-background-four-view";
export const whiteBackgroundFourViewReferenceCount = 4;
export const whiteBackgroundFourViewRatio = "1:1";
export const whiteBackgroundFourViewQuality = "1k";
export const whiteBackgroundFourViewCount = 1;

export const ecommerceTenPagePresetId = "ecommerce-shoe-ten-page";
export const ecommerceTenPageCount = 10;
export const ecommerceTenPageMinReferenceCount = 2;
export const ecommerceTenPageMaxReferenceCount = 10;
export const ecommerceTenPageDefaultRatio = "1:1";
export const ecommerceTenPageDefaultQuality = "1k";
export const ecommerceTenPageBatchStyles = [
  "Electric sport campaign: graphite and bright lime backgrounds, crisp white type, sharp studio lighting, precise motion accents, and high-energy athletic art direction.",
  "Coastal pop campaign: cobalt blue, coral, and clean white environments, sunlit editorial lighting, bold geometric type, and an upbeat Southeast Asian street mood.",
  "Technical performance campaign: deep red, brushed silver, charcoal, and white, controlled hard light, modular technical graphics, and a premium engineered mood.",
  "Fresh city campaign: sky cyan, sunflower yellow, warm white, natural daylight, open compositions, and youthful urban movement with clean retail typography.",
  "Night social campaign: magenta, near-black, ivory, focused flash lighting, restrained camera-frame accents, and a polished social-first fashion mood.",
  "Tropical active campaign: emerald green, vivid orange, and white, bright outdoor light, rhythmic shapes, and energetic campus-to-street art direction.",
  "Modern monochrome campaign: black, white, concrete gray, and small signal-red accents, dramatic directional light, bold grid typography, and a confident editorial mood.",
  "Playful retail campaign: light blue, cherry red, white, soft studio daylight, lively cut-paper shapes, and friendly conversion-focused product styling.",
] as const;
export const ecommerceTenPageBatchStyleCount = ecommerceTenPageBatchStyles.length;
export const ecommerceTenPageTitles = [
  "Hero Visual Impact",
  "Pain Point Solution",
  "Native Movement Scene",
  "Upper Detail Focus",
  "Midsole Structure",
  "Outsole and Hard Details",
  "Social Outfit Style",
  "Daily Comfort Lifestyle",
  "Full Color Lineup",
  "Buyer Show and CTA",
] as const;

const ecommerceTenPageDirections = [
  "Create a high-impact hero product poster with the main shoe colorway centered, energetic motion lines, premium lighting, and a clean conversion-ready composition.",
  "Create a clear e-commerce pain-point solution page with visual callouts for comfort, grip, everyday movement, and breathable visual texture. Do not invent technical certifications.",
  "Create a TikTok-native movement scene showing the shoe in a believable Southeast Asia street, gym, campus, or commute setting with youthful everyday energy.",
  "Create a macro upper-material detail page with texture close-ups, airflow-inspired visual lines, and clean premium product annotation without changing the shoe surface.",
  "Create a side-focused midsole structure page with layered product detail, soft impact waves, and forward-motion graphics while preserving the real midsole shape.",
  "Create a hard-detail collage focused on outsole grip, heel construction, lace structure, and side texture using only details visible in the references.",
  "Create a sporty streetwear outfit page with a believable young social setting, product-focused framing, and restrained TikTok-native sticker or camera-frame accents.",
  "Create a warm daily-comfort lifestyle page for commuting, campus, coffee, or post-workout rest with natural light and a relaxed premium e-commerce mood.",
  "Create a clean full color lineup page showing every uploaded shoe colorway as separate real options, aligned consistently and never blending colors between shoes.",
  "Create a final buyer-show and CTA conversion page with the shoe, size information placeholder only when supplied, and general calls to action without inventing discounts or reviews.",
] as const;

export function ecommerceTenPagePrompt(pageIndex: number, ratio: string, pageCount = ecommerceTenPageCount, batchStyleIndex = 0) {
  const normalizedPageCount = Math.min(Math.max(Math.trunc(pageCount), 1), ecommerceTenPageCount);
  const index = Math.min(Math.max(Math.trunc(pageIndex) - 1, 0), ecommerceTenPageCount - 1);
  const normalizedBatchStyleIndex = Math.min(Math.max(Math.trunc(batchStyleIndex), 0), ecommerceTenPageBatchStyleCount - 1);
  const pageTitle = ecommerceTenPageTitles[index];
  const direction = ecommerceTenPageDirections[index];
  const batchStyle = ecommerceTenPageBatchStyles[normalizedBatchStyleIndex];
  return [
    `Create page ${index + 1} of a ${normalizedPageCount}-image TikTok shoe e-commerce detail series. Page concept: ${pageTitle}.`,
    `Canvas ratio: ${ratio}. Target market: Southeast Asia. All visible text must be English only.`,
    "The first uploaded reference image is the original brand logo. Place it in the top-left corner of this page, small and clear at about 5% to 8% of the canvas width. Preserve it exactly: do not stretch, redraw, recolor, redesign, or print it on the shoe.",
    "Every remaining uploaded reference image is one completed four-view white-background board for one real shoe colorway. Preserve the shoe shape, proportions, material appearance, side details, top view, outsole, and each original colorway. Never invent, merge, mirror, or recolor a colorway.",
    `Batch visual direction: ${batchStyle}`,
    `Apply this exact visual direction consistently across all ${normalizedPageCount} images in this batch. Keep the palette, typography family, lighting language, graphic treatment, and overall brand mood cohesive. Do not change or recolor the referenced shoes to match the campaign palette. This page must still use a clearly different composition, scene, product angle, information density, and visual emphasis from every other page; do not repeat a layout.`,
    direction,
    "Use short, legible English product copy only when it is supported by the references. Do not add fake certifications, medical claims, fake reviews, fake discounts, or unsupported performance promises.",
    "Negative prompt: no Chinese text, no unreadable text, no random letters, no distorted logo, no redesigned logo, no wrong shoe shape, no wrong colorway, no mismatched left and right shoes, no extra shoes, no broken outsole, no cluttered layout, no low-resolution product.",
  ].join("\n\n");
}

export const whiteBackgroundFourViewPrompt = [
  "根据提供的 4 张同一双鞋参考图，生成一张专业电商鞋子四视图展示图；四个视图必须是同一只实际鞋子的不同观察角度。",
  "第 1 张外侧图是整双鞋的外观主锚点：优先锁定它的真实鞋型、比例、颜色、材质、鞋面纹理、鞋带、鞋底造型和全部原有花纹，并将这些身份特征一致地延续到其他三个视图；不要预设或替换任何颜色、品牌或装饰。",
  "参考图规则：前两张图片分别是同一双鞋的外侧视图和内侧视图，但上传先后顺序不固定；必须根据鞋面结构、花纹、鞋底外露和各自视角判断哪张是外侧、哪张是内侧，不得把第一张默认当作外侧。第 3 张为顶部视图，第 4 张为鞋底视图；每个格子只放一只鞋，不要生成鞋子对、额外鞋子或重复鞋子。",
  "排版固定：左上展示识别出的外侧视图，右上展示识别出的内侧视图，左下展示第 3 张顶部视图，右下展示第 4 张鞋底视图。每个视图必须保持对应参考图的原始朝向，严禁为了统一鞋头方向而镜像、水平翻转或重新绘制鞋面花纹。",
  "内侧与外侧必须分别遵循各自参考图的真实结构；两侧的花纹线条、镂空、面板布局和细节必须保持不同，不得把外侧花纹复制到内侧，也不得把内侧花纹复制到外侧，不得镜像复制或混用面板。顶部必须保持同一双鞋的鞋头、鞋舌、鞋带和鞋口比例；鞋底必须保持同一双鞋的轮廓、镂空、纹路和配色。",
  "纯白背景 #FFFFFF，四个视图完整清晰、间距均匀、比例协调；使用柔和均匀布光和轻微自然阴影，保持真实产品质感。",
  "这是严格的商品图抠图、白底整理和排版任务，不是重新设计鞋子。不得添加道具、人物、文字、水印或装饰元素，不得改变品牌纹样、颜色、结构和材质，不得脑补或重绘新的花纹、鞋底或配色。",
].join("\n");

export function isWhiteBackgroundFourViewPreset(value: string | null | undefined) {
  return value === whiteBackgroundFourViewPresetId;
}

export function isEcommerceTenPagePreset(value: string | null | undefined) {
  return value === ecommerceTenPagePresetId;
}
