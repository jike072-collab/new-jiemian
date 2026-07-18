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
  "石墨黑、亮青柠与白色，高对比硬光、精准速度线，强运动广告张力",
  "钴蓝、珊瑚红与白色，明亮日光、粗体几何排版，东南亚街头活力",
  "深红、拉丝银、炭黑与白色，受控硬光、模块化科技图形，高级工程感",
  "天空蓝、向日葵黄与暖白，自然日光、开放构图，年轻城市运动感",
  "洋红、近黑与象牙白，聚焦闪光灯、克制相机框，社交时尚质感",
  "祖母绿、鲜橙与白色，明亮户外光、节奏图形，校园到街头的活力",
  "黑、白、水泥灰与少量信号红，戏剧性方向光、强网格排版，现代编辑感",
  "浅蓝、樱桃红与白色，柔和棚拍日光、活泼剪纸形状，友好零售质感",
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
  { text: "MOVE WITH ENERGY | Sport Style Sneakers | Lightweight Feel / Street Ready / Daily Comfort", visual: "爆款首图；低机位大主体、能量背景、速度线和强光效，主推真实配色" },
  { text: "BUILT FOR EVERYDAY MOVE | Comfort. Grip. Style. | Soft Step / Breathable Look / Stable Grip", visual: "痛点解决信息图；卖点卡片、箭头、气流线和缓震波纹，只表达图片可见的视觉感受" },
  { text: "MADE TO MOVE | Run. Walk. Train. | Daily Run / Gym Fit / Street Style", visual: "TikTok 原生运动场景；东南亚街头、校园、健身房门口或通勤动态，年轻真实" },
  { text: "BREATHABLE UPPER LOOK | Flexible. Light. Clean. | Texture Detail / Airflow Visual / Soft Touch Look", visual: "鞋面细节页；忠实微距、放大圆框、真实纹理标注和干净科技感" },
  { text: "SOFT STEP ENERGY | Cushion Feel for Daily Motion | Impact Wave / Forward Push / Comfort Ride", visual: "中底结构页；真实侧面、分层中底、缓震波纹和推进箭头，不虚构内部科技" },
  { text: "OUTSOLE GRIP | Heel Detail / Lace Structure / Side Texture", visual: "硬核细节拼贴；分别取真实鞋底纹理、后跟、鞋带与侧边特写，不重画结构" },
  { text: "MATCH YOUR MOVE | Sport Meets Street | OOTD / Daily Fit / Hot Pick", visual: "社交穿搭杂志页；年轻街头穿搭、朋友氛围，少量相机框和贴纸" },
  { text: "ALL DAY COMFORT | Easy Walk / Daily Wear / Relaxed Fit", visual: "日常舒适生活方式；咖啡店、校园、通勤或运动后休息，阳光与柔和阴影" },
  { text: "CHOOSE YOUR COLOR | One Style. More Energy.", visual: "完整配色陈列；每个已上传真实配色独立展示，整齐卡片、色点与干净高级背景" },
  { text: "READY FOR YOUR NEXT MOVE | Size Options Available | Hot Pick / Daily Training Ready / Street Style / Choose Your Color", visual: "买家秀与 CTA 收尾；生活方式拼贴、产品主图、通用尺码信息卡和按钮，不编造折扣或评价" },
] as const;

export function ecommerceTenPagePrompt(
  pageIndex: number,
  ratio: string,
  pageCount = ecommerceTenPageCount,
  batchStyleIndex = 0,
  colorwayCount = 1,
) {
  const normalizedPageCount = Math.min(Math.max(Math.trunc(pageCount), 1), ecommerceTenPageCount);
  const index = Math.min(Math.max(Math.trunc(pageIndex) - 1, 0), ecommerceTenPageCount - 1);
  const normalizedBatchStyleIndex = Math.min(Math.max(Math.trunc(batchStyleIndex), 0), ecommerceTenPageBatchStyleCount - 1);
  const normalizedColorwayCount = Math.min(Math.max(Math.trunc(colorwayCount), 1), ecommerceTenPageMaxReferenceCount - 1);
  const pageTitle = ecommerceTenPageTitles[index];
  const direction = ecommerceTenPageDirections[index];
  const batchStyle = ecommerceTenPageBatchStyles[normalizedBatchStyleIndex];
  const primaryColorwayIndex = (index % normalizedColorwayCount) + 1;
  return [
    `任务：生成 ${normalizedPageCount} 张独立 TikTok 鞋类电商套图中的第 ${index + 1} 张（${pageTitle}），画幅 ${ratio}。`,
    `先在内部分析全部上传图，不输出分析文字：第 1 张仅是原始品牌 Logo；第 2 张起每张分别是一款真实配色的四视图白底板，共 ${normalizedColorwayCount} 款。识别每款鞋型、真实颜色、鞋面纹理、侧边图案、中底、鞋底、后跟和鞋带结构，再按分析结果生成。`,
    `统一视觉：${batchStyle}；sporty、energetic、premium、youthful、TikTok-native，面向 Southeast Asia。整套字体与品牌感统一，但本页构图、场景、信息密度、角度和光影须与其他页明显不同。`,
    `本页方向：${direction.visual}。主参考第 ${primaryColorwayIndex + 1} 张上传图所示配色；可按页面需要展示一款或多款，第 9 页必须展示全部 ${normalizedColorwayCount} 款真实配色。每只鞋只能完整复现某一张配色板，严禁混合不同鞋款细节、改色、镜像、补画花纹或创造未上传配色。`,
    `画面可见文字只能从以下英文原文中选用并准确拼写：${direction.text}。中文提示仅是操作指令，绝不能出现在画面；宁可减少文字或不放小字，也不要中文、乱码、随机字母或错误品牌名。`,
    "Logo 必须使用第 1 张原图，固定左上角，宽度约画布 5%-8%，不得拉伸、重绘、改色或印到鞋上。不得虚构认证、医学功效、材料、参数、真实评价、折扣和促销；不得扭曲鞋型、鞋底或缺失鞋带。",
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
