export const whiteBackgroundFourViewPresetId = "white-background-four-view";
export const whiteBackgroundFourViewReferenceCount = 4;
export const whiteBackgroundFourViewRatio = "1:1";
export const whiteBackgroundFourViewQuality = "1k";
export const whiteBackgroundFourViewCount = 1;

export const whiteBackgroundFourViewPrompt = [
  "根据提供的 4 张同一双鞋参考图，生成一张专业电商鞋子四视图展示图。",
  "参考图顺序固定：第 1 张为外侧视图，第 2 张为内侧视图，第 3 张为顶部视图，第 4 张为鞋底视图。",
  "排版固定：左上展示第 1 张外侧视图，鞋头朝左；右上展示第 2 张内侧视图，鞋头朝右；左下展示第 3 张顶部视图；右下展示第 4 张鞋底视图。",
  "严格还原颜色、材质、鞋型、结构、鞋带、鞋面纹理、鞋底造型和花纹细节。内侧与外侧的差异必须以各自对应参考图为准，不得镜像复制或混用。",
  "纯白背景 #FFFFFF，四个视图完整清晰、间距均匀、比例协调；使用柔和均匀布光和轻微自然阴影，保持真实产品质感。",
  "不得添加道具、文字、水印、装饰元素，也不得脑补新的花纹、结构或配色。",
].join("\n");

export function isWhiteBackgroundFourViewPreset(value: string | null | undefined) {
  return value === whiteBackgroundFourViewPresetId;
}
