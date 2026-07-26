import type { CanvasCommerceDirection } from "@/lib/canvas/types";

type VisualHookPattern = {
  id: string;
  label: string;
  directions: readonly CanvasCommerceDirection[];
  mechanism: string;
  firstFrame: string;
  reveal: string;
  spokenRule: string;
  textRule: string;
  audio: string;
  evidence: string;
  safety: string;
  prohibited: string;
};

type CopyHookPattern = {
  id: string;
  label: string;
  directions: readonly CanvasCommerceDirection[];
  formula: string;
  firstFrame: string;
  spokenRule: string;
  textRule: string;
  audio: string;
  evidence: string;
  safety: string;
  prohibited: string;
};

const humanDirections = ["human-wear", "sport-motion", "daily-style", "malay-review"] as const;
const allDirections = [...humanDirections, "product-asmr", "handheld"] as const;

export const malaysiaCommerceVisualHookPatterns: readonly VisualHookPattern[] = [
  {
    id: "visible-problem-contrast",
    label: "可见问题与换鞋反差",
    directions: humanDirections,
    mechanism: "先展示未穿目标鞋时具体、轻微且可见的穿搭或出门选择问题，再用换鞋动作解决。",
    firstFrame: "人物已在镜前、鞋架旁或出门前犹豫，问题在第一帧即可理解。",
    reveal: "通过穿鞋、踩点或遮挡切换揭示目标鞋，随后看到完整人物反馈。",
    spokenRule: "首句只描述第一帧可见的穿搭或选择问题。",
    textRule: "屏幕短字点出同一个外观问题，不补充性能结论。",
    audio: "第 0 秒使用短问句或轻微犹豫声，揭示时用清楚节拍或脚步声。",
    evidence: "问题只能来自配色、轮廓、搭配或合理场景，不得来自性能和身体感受。",
    safety: "困扰保持日常、低风险，不制造羞辱、事故或健康焦虑。",
    prohibited: "脚痛、崴脚、受伤、防滑、耐磨、透气、舒适等未经证明的前后变化。",
  },
  {
    id: "middle-of-action",
    label: "动作进行中开场",
    directions: ["human-wear", "sport-motion", "daily-style", "handheld"],
    mechanism: "第一帧已在系鞋带、拿起鞋、起步或完成穿搭切换，观众直接进入动作中段。",
    firstFrame: "手或脚正在进入画面，主体动作清楚，不用欢迎语和准备动作。",
    reveal: "动作顺势完成后立即看到鞋子完整轮廓和当前场景。",
    spokenRule: "首句跟随正在发生的动作，不使用欢迎语。",
    textRule: "短字概括动作目的或可见结果。",
    audio: "从动作本身的鞋带声、落地声或节拍开始，口播同步进入。",
    evidence: "动作和场景必须与鞋型可见结构匹配。",
    safety: "只使用稳定站立、坐姿穿鞋、快走或轻慢跑等低风险动作。",
    prohibited: "跳椅、跌落、假装崴脚、危险台阶动作或专业运动性能暗示。",
  },
  {
    id: "occluded-discovery",
    label: "遮挡发现与产品揭示",
    directions: ["daily-style", "product-asmr", "handheld", "malay-review"],
    mechanism: "让鞋子被布料、购物袋或安全道具局部遮挡，人物或镜头主动发现并揭示。",
    firstFrame: "遮挡物明确是普通物件，露出足够产品线索形成信息缺口。",
    reveal: "掀开、抽出或移开遮挡物，鞋子以近景完整出现。",
    spokenRule: "用发现式短句建立信息缺口，不伪装救助或事故。",
    textRule: "短字只提示发现和可见细节。",
    audio: "轻触、布料摩擦或提示音先于揭示，揭示时音乐抬升。",
    evidence: "只能揭示真实产品外观；没有包装时不得写开箱。",
    safety: "遮挡物从一开始就是商品或普通物件，不误导为动物、儿童或受困者。",
    prohibited: "假装遗弃生命、救助动物、发现伤者或其他虚假求助情节。",
  },
  {
    id: "ground-clue-approach",
    label: "地面线索与靠近揭示",
    directions: ["daily-style", "product-asmr", "handheld"],
    mechanism: "远景先出现安全摆放的鞋盒外普通物件或鞋子局部，镜头靠近后拿起产品。",
    firstFrame: "地面或长椅上的物件摆放形成视觉异常，但没有人倒地或交通风险。",
    reveal: "镜头连续靠近，手从安全位置拿起鞋子进入产品特写。",
    spokenRule: "可用一句自然疑问，但不得暗示有人受伤。",
    textRule: "短字提示地面线索或产品发现。",
    audio: "环境声配合逐步增强的节奏，拿起产品时给一个清楚音效。",
    evidence: "场景必须允许安全摆放和拿取产品。",
    safety: "使用长椅、室内地毯、门廊或静态展示区。",
    prohibited: "人物躺街、假装昏迷、散落事故现场、车道或人行通道阻塞。",
  },
  {
    id: "barrier-pov",
    label: "车窗或屏障 POV",
    directions: ["daily-style", "handheld", "malay-review"],
    mechanism: "从玻璃、门框或展示窗内侧观察人物靠近，轻敲或擦开水汽后展示鞋子。",
    firstFrame: "屏障上的雨滴、水汽或反射先形成视觉层次，人物安全靠近。",
    reveal: "擦开小区域或打开静止的窗门，人物把鞋子举到清楚位置。",
    spokenRule: "人物隔着屏障说一句友好发现或穿搭观察。",
    textRule: "短字概括玻璃后出现的产品线索。",
    audio: "雨声、轻敲声或玻璃擦拭声与首句同步。",
    evidence: "只传递产品外观和人物动作，不生成品牌或促销信息。",
    safety: "车辆必须静止，互动友好，没有冲突和惊吓。",
    prohibited: "向车内人员投掷液体、辱骂、拦车、砸窗或街头骚扰。",
  },
  {
    id: "forced-perspective",
    label: "安全强制透视",
    directions: ["human-wear", "daily-style", "product-asmr", "handheld"],
    mechanism: "利用前景鞋子与远处人物的大小关系制造短暂尺度错觉，再移动镜头解释真实比例。",
    firstFrame: "鞋子靠近镜头形成夸张但明显是摄影错觉的构图。",
    reveal: "镜头侧移或人物伸手接住鞋子，恢复真实尺度并进入展示。",
    spokenRule: "口播指出视觉反差，不把尺度错觉写成产品事实。",
    textRule: "短字提示镜头错觉后的真实外观发现。",
    audio: "短促转场音配合镜头侧移，随后进入自然环境声。",
    evidence: "鞋子形状、配色和细节必须保持与参考图一致。",
    safety: "人物始终稳定站立或坐着，不依靠跳跃完成错觉。",
    prohibited: "从高处跳下、踩空、假摔或把危险动作伪装成透视效果。",
  },
  {
    id: "product-asmr-detail",
    label: "产品细节 ASMR",
    directions: ["product-asmr", "handheld"],
    mechanism: "用鞋带、缝线、鞋面层次或鞋底轮廓的微距动作直接形成首帧停留。",
    firstFrame: "第一帧已有手部轻触、鞋带穿孔或光线扫过可见细节。",
    reveal: "微距后拉到完整鞋型，再转到另一处可见结构。",
    spokenRule: "默认无口播；需要文字钩子时只作为同步字幕。",
    textRule: "短字点名当前微距能证明的一个细节。",
    audio: "从第 0 秒开始使用轻触、鞋带、布料或桌面落放声，不使用突然口播。",
    evidence: "只表现图片能够核对的结构、颜色和材质视觉。",
    safety: "动作轻缓且真实，不做破坏性压力、弯折或性能测试。",
    prohibited: "防水、防割、防滑、耐磨测试和无法从图片确认的材料声明。",
  },
  {
    id: "harmless-prop-mismatch",
    label: "无伤害道具错配",
    directions: ["human-wear", "daily-style", "handheld", "malay-review"],
    mechanism: "用鞋带勾住安全小物、错误配色道具或拿错鞋的轻微尴尬制造第一秒问题。",
    firstFrame: "手或鞋带被普通轻质道具短暂阻住，人物表情自然。",
    reveal: "人物松开道具、换成目标鞋或重新搭配，画面顺畅进入产品展示。",
    spokenRule: "人物只描述眼前轻微错配，不渲染受困或疼痛。",
    textRule: "短字提示拿错、配错或轻微卡顿。",
    audio: "轻微卡顿声或人物短句后立刻解决，不渲染危险。",
    evidence: "问题必须能通过画面当场解决并与核心卖点相关。",
    safety: "道具柔软、轻质，不涉及身体受困或疼痛。",
    prohibited: "手被危险夹住、无法拔出、受伤、窒息或暴力挣脱。",
  },
  {
    id: "local-reaction-reveal",
    label: "当地人物自然反应",
    directions: humanDirections,
    mechanism: "马来西亚当地成年人物看到鞋子的一个可见细节后给出克制、可信的第一反应。",
    firstFrame: "人物和产品同时在画面内，表情与短句同步发生。",
    reveal: "人物将鞋子转向镜头或穿上后展示该可见细节。",
    spokenRule: "使用克制的第一反应，只评价当前可见外观。",
    textRule: "短字压缩人物正在表达的同一个外观点。",
    audio: "自然马来语短句从第 0 秒开始，配轻音乐和动作声。",
    evidence: "反应只能针对配色、轮廓、拼接或当前穿搭结果。",
    safety: "不把 AI 人物包装成真实买家或专家。",
    prohibited: "虚假购买经历、长期使用证言、专业背书或夸张族群刻板印象。",
  },
] as const;

export const malaysiaCommerceCopyHookPatterns: readonly CopyHookPattern[] = [
  {
    id: "expectation-gap",
    label: "预期落差",
    directions: allDirections,
    formula: "先表达对一个可见细节的意外，再在后续画面解释为什么醒目。",
    firstFrame: "第一帧必须已出现引发意外的产品线索或人物反应。",
    spokenRule: "用自然马来语写 5-10 个词，只点名配色、轮廓、拼接或穿搭变化。",
    textRule: "3-7 个词压缩意外点，不重复整句口播。",
    audio: "首句或同步字幕从第 0 秒开始，揭示时音乐轻抬。",
    evidence: "意外必须由当前图片和后续镜头直接证明。",
    safety: "把惊讶落在外观事实，不落在价格、促销或功效。",
    prohibited: "便宜、打折、效果惊人、销量、评价和没有证据的品牌比较。",
  },
  {
    id: "negative-setup-reversal",
    label: "负面开场后反转",
    directions: ["human-wear", "daily-style", "malay-review"],
    formula: "先说差点放弃当前穿搭或出门选择，随后用鞋子的可见外观完成反转。",
    firstFrame: "人物正在面对当前穿搭选择，负面预期能从动作理解。",
    spokenRule: "负面只描述当前场景中的选择，不伪造退货、投诉或售后。",
    textRule: "用短语提示选择反转，不使用退款或促销词。",
    audio: "先用轻微犹豫语气，产品揭示时节拍转亮。",
    evidence: "后续必须出现清楚的换鞋或搭配结果。",
    safety: "反转保持轻松，不制造品牌危机和消费者证言。",
    prohibited: "退货、退款、清仓、促销、假差评或故意误导购买原因。",
  },
  {
    id: "avoidance-reminder",
    label: "避免与提醒",
    directions: ["human-wear", "sport-motion", "daily-style", "malay-review"],
    formula: "提醒观众不要忽略一个可见的搭配或场景选择问题，并立即展示替代方案。",
    firstFrame: "第一帧直接出现被提醒的搭配或场景选择。",
    spokenRule: "直接但不恐吓，不使用疾病、疼痛或事故后果。",
    textRule: "3-7 个词指出一个具体可见错误。",
    audio: "直接提醒从第 0 秒进入，语气清楚但不恐吓。",
    evidence: "问题和解决结果都必须在时间轴中出现。",
    safety: "只讨论外观、搭配和合理场景。",
    prohibited: "健康风险、受伤、脚痛、防滑、耐磨、透气和性能警告。",
  },
  {
    id: "contrarian-reframe",
    label: "反常识重构",
    directions: ["human-wear", "daily-style", "product-asmr", "malay-review"],
    formula: "挑战一个低风险穿搭常识，再用可见细节证明更准确的说法。",
    firstFrame: "第一帧同时给出常见搭配线索和可推翻它的产品细节。",
    spokenRule: "反常识必须具体、克制，不能使用权威口吻或无法证明的结论。",
    textRule: "用简短对比表达常见看法和当前发现。",
    audio: "首句使用克制的反问或否定，证据出现时给轻提示音。",
    evidence: "后续必须展示反例或细节证据。",
    safety: "不攻击人群，不贬低其他品牌或产品。",
    prohibited: "科学、健康、专业运动、材料性能和绝对化比较。",
  },
  {
    id: "relatable-moment",
    label: "场景故事与共鸣",
    directions: ["human-wear", "sport-motion", "daily-style", "malay-review"],
    formula: "从人物此刻正在经历的一个短场景困扰切入，第二句立即进入产品。",
    firstFrame: "人物正在经历可见且低风险的日常小困扰。",
    spokenRule: "只描述当前画面，不声称长期使用、真实购买或他人评价。",
    textRule: "用一个场景词和一个困扰词建立共鸣。",
    audio: "环境声与首句同时开始，不使用回忆旁白。",
    evidence: "故事动作必须在画面中发生。",
    safety: "人物是剧情角色，不包装成真实消费者证言。",
    prohibited: "长期体验、亲测有效、专家身份、真实买家或虚构社会证明。",
  },
  {
    id: "numbered-specificity",
    label: "可兑现数字",
    directions: ["daily-style", "product-asmr", "handheld"],
    formula: "用 2 或 3 个可见角度、细节或搭配结果建立具体预期，并在 15 秒内逐项展示。",
    firstFrame: "第一帧直接显示数字 2 或 3，并露出第一项视觉证据。",
    spokenRule: "数字只表示视频真实展示的项目数量，不使用比例、人数或统计结论。",
    textRule: "包含数字 2 或 3 以及被展示的具体对象。",
    audio: "首句报出数量，后续每项使用一致的短提示音分隔。",
    evidence: "时间轴必须明确兑现相同数量的项目。",
    safety: "每个项目仍围绕同一个核心卖点。",
    prohibited: "百分比、销量、排名、用户人数、成功率和虚假专业数据。",
  },
  {
    id: "conditional-visible-result",
    label: "条件与可见结果",
    directions: ["human-wear", "daily-style", "handheld", "malay-review"],
    formula: "说明完成一个简单动作后会得到一个可见的穿搭或展示结果。",
    firstFrame: "第一帧已经开始条件动作，结果尚未完全出现。",
    spokenRule: "条件和结果都短且能当场看到，不承诺身体感受或长期效果。",
    textRule: "用动作加可见结果的短结构。",
    audio: "动作声从第 0 秒开始，结果出现时用一次清楚节拍。",
    evidence: "后续镜头必须直接完成动作并呈现结果。",
    safety: "不使用保证、必然或人人适用的绝对表达。",
    prohibited: "舒适、显高、瘦身、防滑、耐用、治疗或保证转化。",
  },
  {
    id: "direct-problem-question",
    label: "直接场景提问",
    directions: humanDirections,
    formula: "询问观众是否遇到当前画面中的具体搭配或出门选择问题。",
    firstFrame: "第一帧必须清楚呈现问句所指的问题。",
    spokenRule: "问题在 2 秒内说完，并与人物第一帧动作完全一致。",
    textRule: "压缩成 3-7 个词的问题或场景标签。",
    audio: "问句在 2 秒内完整说完，并与第一帧动作同步。",
    evidence: "提问的问题必须在第一帧可见，后续给出画面答案。",
    safety: "不诊断身体、心理或财务问题。",
    prohibited: "脚痛、受伤、焦虑、贫穷、外貌羞辱或其他敏感痛点。",
  },
] as const;

const visualPatternsById = new Map(malaysiaCommerceVisualHookPatterns.map((pattern) => [pattern.id, pattern]));
const copyPatternsById = new Map(malaysiaCommerceCopyHookPatterns.map((pattern) => [pattern.id, pattern]));

export function malaysiaCommerceVisualHookPattern(id: string) {
  return visualPatternsById.get(id);
}

export function malaysiaCommerceCopyHookPattern(id: string) {
  return copyPatternsById.get(id);
}

export function isMalaysiaCommerceHookPairCompatible(visualPatternId: string, copyPatternId: string, direction: CanvasCommerceDirection) {
  return Boolean(
    visualPatternsById.get(visualPatternId)?.directions.includes(direction)
    && copyPatternsById.get(copyPatternId)?.directions.includes(direction),
  );
}

export function malaysiaCommerceHookPromptLibrary(directions?: readonly CanvasCommerceDirection[]) {
  const selectedDirections = directions?.length ? new Set(directions) : null;
  const matches = (pattern: VisualHookPattern | CopyHookPattern) => !selectedDirections
    || pattern.directions.some((direction) => selectedDirections.has(direction));
  return JSON.stringify({
    visualPatterns: malaysiaCommerceVisualHookPatterns.filter(matches),
    copyPatterns: malaysiaCommerceCopyHookPatterns.filter(matches),
    globalRules: [
      "自动为每个方向选择一个兼容视觉模式和一个兼容话术模式",
      "批量方案尽量不重复；重新分析优先避开已使用模式",
      "只使用图片和已确认卖点可以证明的事实",
      "没有价格和促销字段时禁止任何价格、折扣、库存或退货话术",
      "保留注意力机制，不照搬危险、欺骗或虚假证言情节",
    ],
  });
}
