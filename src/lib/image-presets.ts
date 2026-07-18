export const whiteBackgroundFourViewPresetId = "white-background-four-view";
export const whiteBackgroundFourViewReferenceCount = 4;
export const whiteBackgroundFourViewRatio = "1:1";
export const whiteBackgroundFourViewQuality = "1k";
export const whiteBackgroundFourViewCount = 1;

export const whiteBackgroundFourViewPrompt = [
  "根据提供的 4 张同一双鞋参考图，生成一张专业电商鞋子四视图展示图；四个视图必须是同一只实际鞋子的不同观察角度。",
  "第 1 张外侧图是整双鞋的外观主锚点：优先锁定它的真实鞋型、比例、颜色、材质、鞋面纹理、鞋带、鞋底造型和全部原有花纹，并将这些身份特征一致地延续到其他三个视图；不要预设或替换任何颜色、品牌或装饰。",
  "参考图顺序固定：第 1 张为外侧视图，第 2 张为内侧视图，第 3 张为顶部视图，第 4 张为鞋底视图；每个格子只放一只鞋，不要生成鞋子对、额外鞋子或重复鞋子。",
  "排版固定：左上展示第 1 张外侧视图，鞋头朝左；右上展示第 2 张内侧视图，鞋头朝右；左下展示第 3 张顶部视图；右下展示第 4 张鞋底视图。",
  "内侧与外侧必须分别遵循各自参考图的真实结构；两侧的花纹线条、镂空、面板布局和细节必须保持不同，不得把外侧花纹复制到内侧，也不得把内侧花纹复制到外侧，不得镜像复制或混用面板。顶部必须保持同一双鞋的鞋头、鞋舌、鞋带和鞋口比例；鞋底必须保持同一双鞋的轮廓、镂空、纹路和配色。",
  "纯白背景 #FFFFFF，四个视图完整清晰、间距均匀、比例协调；使用柔和均匀布光和轻微自然阴影，保持真实产品质感。",
  "不得添加道具、人物、文字、水印或装饰元素，不得改变品牌纹样、颜色、结构和材质，不得脑补新的花纹、鞋底或配色。",
].join("\n");

export function isWhiteBackgroundFourViewPreset(value: string | null | undefined) {
  return value === whiteBackgroundFourViewPresetId;
}
