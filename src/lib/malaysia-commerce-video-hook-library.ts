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

type ScenePattern = {
  id: string;
  label: string;
  directions: readonly CanvasCommerceDirection[];
  setting: string;
  localDetails: string;
  movementBoundary: string;
  safety: string;
};

type ShotPattern = {
  id: string;
  label: string;
  directions: readonly CanvasCommerceDirection[];
  beats: readonly [string, string, string, string];
  cameraRhythm: string;
  transitionRule: string;
};

type PerformancePattern = {
  id: string;
  label: string;
  directions: readonly CanvasCommerceDirection[];
  emotionArc: string;
  performance: string;
  realism: string;
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
    directions: ["human-wear", "sport-motion", "daily-style", "product-asmr", "handheld"],
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
    directions: [...humanDirections, "handheld"],
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
    directions: ["human-wear", "daily-style", "product-asmr", "handheld", "malay-review"],
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
    directions: [...humanDirections, "product-asmr", "handheld"],
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

export const malaysiaCommerceScenePatterns: readonly ScenePattern[] = [
  { id: "condo-entry-mirror", label: "公寓玄关镜前", directions: humanDirections, setting: "马来西亚城市公寓玄关或全身镜旁", localDetails: "热带日常穿搭、鞋架、钥匙和自然窗光", movementBoundary: "只做拿鞋、穿鞋、镜前检查和出门动作", safety: "地面干燥整洁，不制造摔倒或赶时间事故" },
  { id: "covered-lrt-walkway", label: "轻轨站遮雨连廊", directions: ["human-wear", "sport-motion", "daily-style", "malay-review"], setting: "马来西亚城市轻轨站外的遮雨步行连廊", localDetails: "自然通勤人流、湿润但安全的远景环境、无可识别品牌", movementBoundary: "普通鞋只快走，明显跑鞋才允许短距离轻慢跑", safety: "不阻挡人流，不在湿滑边缘做动作" },
  { id: "mall-mirror-corridor", label: "商场镜面走廊", directions: humanDirections, setting: "现代商场的镜面走廊或扶梯平台外侧", localDetails: "冷暖混合室内光、自然周末穿搭、背景人物虚化", movementBoundary: "镜前转身、两步走动或侧面展示", safety: "远离扶梯入口，不做奔跑和逆行" },
  { id: "campus-arcade", label: "校园有顶走廊", directions: ["human-wear", "sport-motion", "daily-style"], setting: "马来西亚校园或创意园区的有顶走廊", localDetails: "背包、开放式廊柱、明亮热带日光", movementBoundary: "快走、轻松转身、坐姿系带", safety: "只使用成年人物，不拍摄可识别学校标志" },
  { id: "park-covered-path", label: "公园遮雨步道", directions: ["human-wear", "sport-motion", "daily-style", "malay-review"], setting: "城市公园的铺装遮雨步道", localDetails: "热带绿植、清晨或傍晚柔光、普通休闲人群", movementBoundary: "普通鞋快走；明显跑鞋可轻慢跑；不进入泥地", safety: "平整路面，无危险跨越或追逐" },
  { id: "lakeside-paved-track", label: "湖边铺装步道", directions: ["sport-motion", "human-wear"], setting: "马来西亚城市湖边的平整铺装跑道", localDetails: "晨间暖光、树影和自然运动氛围", movementBoundary: "仅明显跑鞋使用轻慢跑，否则使用有节奏快走", safety: "不写专业成绩、训练性能或极限动作" },
  { id: "kopitiam-exterior", label: "咖啡店外廊", directions: ["daily-style", "human-wear", "malay-review", "handheld"], setting: "本地咖啡店外的有顶步行廊", localDetails: "自然桌椅、热带街区光线、无可识别商标", movementBoundary: "落座、起身、朋友视角观察或手持展示", safety: "不打扰店员和路人，不占用通道" },
  { id: "weekend-retail-entry", label: "周末商场入口", directions: ["daily-style", "human-wear", "handheld"], setting: "商场室内入口或静态展示区", localDetails: "玻璃反射、自然周末人流、简洁穿搭", movementBoundary: "两三步入场、手持揭示或搭配反差", safety: "不使用门口冲突、保安或虚假促销情节" },
  { id: "travel-packing-bench", label: "旅行收纳长椅", directions: ["daily-style", "handheld", "product-asmr"], setting: "室内旅行收纳区或安静长椅", localDetails: "小型旅行包、折叠衣物、自然侧光", movementBoundary: "拿起鞋、放入或取出旅行包、展示搭配", safety: "没有包装证据时不写开箱，不虚构旅行性能" },
  { id: "studio-tactile-table", label: "自然光细节桌面", directions: ["product-asmr", "handheld"], setting: "靠窗的简洁产品桌面", localDetails: "中性背景、柔和自然光、真实手部和轻微桌面纹理", movementBoundary: "轻触、系带、转动和后拉展示", safety: "不做弯折、泼水、刮擦或破坏性测试" },
  { id: "stationary-car-passenger", label: "静止车辆乘客视角", directions: ["handheld", "daily-style", "malay-review"], setting: "完全静止车辆的乘客座或车窗旁", localDetails: "窗上雨滴或水汽、自然阴天光、车外安全步行区", movementBoundary: "擦开水汽、友好轻敲或从车外举起产品", safety: "车辆熄火停稳，无投掷、辱骂、拦车或惊吓" },
  { id: "shoe-rack-choice", label: "鞋架选择瞬间", directions: ["human-wear", "daily-style", "malay-review", "handheld"], setting: "整洁鞋架或衣帽区", localDetails: "两套低风险穿搭选择、自然室内光、日常生活感", movementBoundary: "犹豫、拿错、换成目标鞋并完成搭配", safety: "不贬低其他产品，不制造疼痛或健康焦虑" },
  { id: "window-light-pedestal", label: "窗边自然光台面", directions: ["product-asmr", "handheld"], setting: "靠近百叶窗或纱帘的低台面", localDetails: "热带午后自然光缓慢移动，背景保持真实居家质感", movementBoundary: "光线扫过、轻抬鞋头和稳定转动", safety: "不用高速闪光，不把光影写成材料性能" },
  { id: "fabric-backdrop-sweep", label: "织物背景揭示", directions: ["product-asmr", "handheld"], setting: "中性织物铺面的产品展示区", localDetails: "布料褶皱、自然侧光和真实手部阴影", movementBoundary: "拉开布料、轻放鞋子和微距触碰", safety: "布料只作背景，不声称鞋面材质与背景相同" },
  { id: "shelf-detail-selection", label: "陈列架细节选择", directions: ["product-asmr", "handheld", "daily-style"], setting: "无品牌标识的简洁鞋履陈列架", localDetails: "不同高度层板、柔和顶光和浅景深", movementBoundary: "从层板抽出目标鞋、转向镜头和放回", safety: "不出现虚假商店价格、折扣牌或库存信息" },
  { id: "courtyard-shadow-table", label: "庭院光影桌面", directions: ["product-asmr", "handheld", "daily-style"], setting: "有遮阴的热带庭院或门廊桌面", localDetails: "叶影缓慢移动、自然环境声和干燥安全台面", movementBoundary: "手持转动、鞋带轻摆和完整鞋型展示", safety: "不把普通鞋放入泥地、积水或极端户外环境" },
] as const;

export const malaysiaCommerceShotPatterns: readonly ShotPattern[] = [
  { id: "problem-reveal-proof-result", label: "问题-揭示-证据-结果", directions: humanDirections, beats: ["第一帧呈现可见小问题", "通过穿鞋或踩点揭示产品", "动作与不同景别证明核心卖点", "完整穿搭结果和自然 CTA"], cameraRhythm: "中近景建立问题，匹配剪辑揭示，低机位跟拍证明，稳定全身镜头收束", transitionRule: "只使用一次明确揭示转场，其余靠动作连续性衔接" },
  { id: "action-reveal-follow-detail", label: "动作中-揭示-跟拍-细节", directions: ["human-wear", "sport-motion", "daily-style"], beats: ["从系带或起步动作中切入", "动作完成时看到完整鞋型", "侧向或低机位跟拍", "细节回切后人物结果收束"], cameraRhythm: "近景快速进入，中景揭示，动态跟拍，近景到全身收束", transitionRule: "用脚步落点或人物经过前景完成动感转场" },
  { id: "clue-approach-reveal-reaction", label: "线索-靠近-揭示-反应", directions: ["daily-style", "handheld", "product-asmr", "malay-review"], beats: ["安全线索制造信息缺口", "镜头靠近或手移开遮挡", "完整产品出现并展示一个细节", "人物自然反应或产品英雄镜头"], cameraRhythm: "远或特写异常起步，连续推进，微距证据，稳定中景收束", transitionRule: "揭示前不切断靠近动作，揭示后用声音节拍切换景别" },
  { id: "macro-pullback-rotate-hero", label: "微距-后拉-转动-英雄镜头", directions: ["product-asmr", "handheld"], beats: ["细节和触感声直接开场", "缓快结合后拉展示鞋型", "手部转动展示第二处结构", "稳定产品英雄镜头和字幕 CTA"], cameraRhythm: "极近景、快速后拉、中近景环绕、稳定正侧面收束", transitionRule: "依靠声音和手部动作衔接，不使用无意义炫技特效" },
  { id: "pov-interrupt-reveal-reaction", label: "POV打断-揭示-展示-反应", directions: ["daily-style", "handheld", "malay-review"], beats: ["屏障或前景动作打断视线", "打开视线并揭示鞋子", "人物或手部展示核心细节", "友好反应和 CTA"], cameraRhythm: "主观近景、短推进、中景展示、轻后退收束", transitionRule: "用擦拭、开门或移开前景完成物理转场" },
  { id: "before-after-match-proof", label: "前后匹配剪辑-证据", directions: ["human-wear", "daily-style", "malay-review"], beats: ["未穿目标鞋的可见搭配问题", "同构图踩点换鞋", "侧面或全身动作证明变化", "镜前确认和 CTA"], cameraRhythm: "同机位中景建立前后，再切低机位或侧向证据，最后全身定住", transitionRule: "前后镜头保持身体位置一致，以踩点或手遮镜完成匹配剪辑" },
  { id: "two-detail-payoff", label: "两项细节逐项兑现", directions: ["daily-style", "product-asmr", "handheld"], beats: ["数字 2 和第一项线索同时出现", "明确展示第一项细节", "明确展示第二项细节", "完整鞋型把两项结果合并"], cameraRhythm: "首帧特写，两个不同角度分别证明，稳定英雄镜头收束", transitionRule: "第一与第二项使用一致声音标记，禁止把同一细节重复算两次" },
  { id: "handoff-wear-move-cta", label: "递入-上脚-移动-收束", directions: ["human-wear", "sport-motion", "daily-style"], beats: ["鞋从前景递入形成视觉打断", "人物接住并完成上脚揭示", "一个主要移动动作展示鞋子", "人物停下给自然表情和 CTA"], cameraRhythm: "前景特写、中景接鞋、低机位动态、全身或半身收束", transitionRule: "用递入遮挡和脚步落点完成两次自然转场" },
  { id: "light-sweep-detail-reveal", label: "光影扫过-细节揭示", directions: ["product-asmr", "handheld"], beats: ["移动光影露出第一处轮廓", "手部顺光线抬起产品", "换角度展示第二处结构", "光线稳定后完整英雄镜头"], cameraRhythm: "固定极近景、慢速侧移、中近景短环绕、稳定正侧面收束", transitionRule: "每次切镜由光影经过边缘触发，不使用闪白" },
  { id: "lace-rhythm-structure-hero", label: "鞋带节奏-结构-英雄镜头", directions: ["product-asmr", "handheld"], beats: ["鞋带穿孔或轻摆建立节奏", "手指顺鞋带移动到鞋面结构", "转到鞋底轮廓或侧面拼接", "落放产品并完整收束"], cameraRhythm: "极近景跟随、中近景后拉、侧面特写、稳定俯拍或正侧面", transitionRule: "用鞋带声、轻触声和落放声分别触发三个切点" },
  { id: "motion-pulse-detail-result", label: "运动脉冲-细节-结果", directions: ["sport-motion", "human-wear"], beats: ["系带或重心前移动作开场", "一个短距离主要移动动作", "脚步落点和鞋型细节证据", "人物减速停稳并自然收束"], cameraRhythm: "动作近景、低机位跟拍、脚步特写、半身或全身稳定镜头", transitionRule: "用起步、落点和减速三个运动节拍切镜，避免随机快切" },
] as const;

export const malaysiaCommercePerformancePatterns: readonly PerformancePattern[] = [
  { id: "candid-curiosity", label: "自然好奇", directions: humanDirections, emotionArc: "注意到问题 → 好奇靠近 → 发现细节 → 克制满意", performance: "眼神先落在问题上，再看产品，反应比台词慢半拍", realism: "保留一次呼吸、眨眼或手部微调，不直视镜头背稿", prohibited: "夸张瞪眼、尖叫、持续大笑或广告式点头" },
  { id: "mild-friction-relief", label: "轻微困扰到释然", directions: ["human-wear", "daily-style", "malay-review"], emotionArc: "轻微犹豫 → 作出选择 → 看到变化 → 放松确认", performance: "皱眉或停顿很轻，换鞋后通过肩膀放松和短笑表达结果", realism: "困扰只来自当前搭配选择，动作像真实出门准备", prohibited: "疼痛、受伤、崩溃、虚假退货或戏剧化哭泣" },
  { id: "playful-confidence", label: "轻松自信", directions: ["human-wear", "sport-motion", "daily-style", "malay-review"], emotionArc: "俏皮发问 → 利落揭示 → 自信移动 → 轻松邀请", performance: "用短眼神交流、自然半笑和一次有节奏的转身", realism: "表演保持生活化，不连续摆拍，不夸张模特步", prohibited: "挑衅、炫耀财富、过度性感化或命令观众" },
  { id: "focused-movement", label: "专注运动状态", directions: ["sport-motion", "human-wear"], emotionArc: "专注准备 → 启动 → 进入节奏 → 平稳满足", performance: "呼吸、系带和起步动作连贯，视线主要看前方和脚下", realism: "只展示低强度真实移动，身体重心和脚步符合速度", prohibited: "专业竞速、极限训练、夸张汗水或性能背书" },
  { id: "friend-to-friend", label: "朋友式推荐", directions: ["human-wear", "sport-motion", "daily-style", "malay-review", "handheld"], emotionArc: "分享发现 → 邀请看细节 → 给出可见理由 → 询问选择", performance: "像对朋友说话，偶尔看产品，句间留自然停顿", realism: "最多三句短话，不连续指镜头，不伪装真实买家评价", prohibited: "专家口吻、长期使用证言、强迫购买或虚假社会证明" },
  { id: "quiet-tactile-focus", label: "安静触感专注", directions: ["product-asmr", "handheld"], emotionArc: "细节吸引 → 触摸探索 → 结构确认 → 视觉满足", performance: "手部力度轻且稳定，每次只触碰一个可见结构", realism: "保留真实摩擦、鞋带和落放声，不用合成破坏测试", prohibited: "捏压变形、暴力弯折、泼水、刮擦或虚构材料性能" },
  { id: "surprised-restraint", label: "克制惊喜", directions: ["human-wear", "sport-motion", "daily-style", "malay-review", "handheld"], emotionArc: "预期普通 → 发现差异 → 再看确认 → 真诚认可", performance: "眉眼和短句表达意外，随后用手或脚验证同一个细节", realism: "惊喜只落在画面可见的配色、轮廓或拼接", prohibited: "不可置信尖叫、效果奇迹、价格震惊或虚假比较" },
  { id: "style-self-check", label: "镜前穿搭确认", directions: ["human-wear", "daily-style", "malay-review"], emotionArc: "检查整体 → 发现不协调 → 换鞋调整 → 满意离开", performance: "身体先看镜中全身，再低头看鞋，最后整理衣角或拿起包", realism: "用微动作表达审美判断，不用旁白解释所有动作", prohibited: "外貌羞辱、显高显瘦承诺或贬低人物原本穿搭" },
  { id: "precision-inspection", label: "精细检查", directions: ["product-asmr", "handheld"], emotionArc: "锁定细节 → 沿结构观察 → 换角度确认 → 完整展示", performance: "手指沿一条可见拼接或轮廓缓慢移动，到关键处停半拍", realism: "手部压力、阴影和鞋子重量感自然，不使用机械匀速", prohibited: "实验室检测、专业鉴定或材料性能结论" },
  { id: "rhythmic-hand-choreo", label: "节奏化手部编排", directions: ["product-asmr", "handheld"], emotionArc: "声音吸引 → 动作跟拍 → 节奏加深 → 平稳落放", performance: "每个节拍只做一次轻触、拉动或转动，手部动作有起止", realism: "节奏来自真实鞋带、布面和桌面声音，不做漂浮产品", prohibited: "无接触自动旋转、过快手法或破坏性弯折" },
  { id: "light-led-discovery", label: "光线引导发现", directions: ["product-asmr", "handheld"], emotionArc: "轮廓初现 → 光线引导 → 细节确认 → 外观满足", performance: "手部在光线经过后再进入，顺着阴影边缘转动产品", realism: "光源方向和产品阴影连续，亮度变化缓慢自然", prohibited: "频闪、霓虹特效堆叠或用光线伪造产品颜色" },
] as const;

const visualPatternsById = new Map(malaysiaCommerceVisualHookPatterns.map((pattern) => [pattern.id, pattern]));
const copyPatternsById = new Map(malaysiaCommerceCopyHookPatterns.map((pattern) => [pattern.id, pattern]));
const scenePatternsById = new Map(malaysiaCommerceScenePatterns.map((pattern) => [pattern.id, pattern]));
const shotPatternsById = new Map(malaysiaCommerceShotPatterns.map((pattern) => [pattern.id, pattern]));
const performancePatternsById = new Map(malaysiaCommercePerformancePatterns.map((pattern) => [pattern.id, pattern]));

export function malaysiaCommerceVisualHookPattern(id: string) {
  return visualPatternsById.get(id);
}

export function malaysiaCommerceCopyHookPattern(id: string) {
  return copyPatternsById.get(id);
}

export function malaysiaCommerceScenePattern(id: string) {
  return scenePatternsById.get(id);
}

export function malaysiaCommerceShotPattern(id: string) {
  return shotPatternsById.get(id);
}

export function malaysiaCommercePerformancePattern(id: string) {
  return performancePatternsById.get(id);
}

export function isMalaysiaCommerceHookPairCompatible(visualPatternId: string, copyPatternId: string, direction: CanvasCommerceDirection) {
  return Boolean(
    visualPatternsById.get(visualPatternId)?.directions.includes(direction)
    && copyPatternsById.get(copyPatternId)?.directions.includes(direction),
  );
}

export function isMalaysiaCommerceProductionRecipeCompatible(scenePatternId: string, shotPatternId: string, performancePatternId: string, direction: CanvasCommerceDirection) {
  return Boolean(
    scenePatternsById.get(scenePatternId)?.directions.includes(direction)
    && shotPatternsById.get(shotPatternId)?.directions.includes(direction)
    && performancePatternsById.get(performancePatternId)?.directions.includes(direction),
  );
}

export function malaysiaCommerceHookPromptLibrary(directions?: readonly CanvasCommerceDirection[]) {
  const selectedDirections = directions?.length ? new Set(directions) : null;
  const matches = (pattern: { directions: readonly CanvasCommerceDirection[] }) => !selectedDirections
    || pattern.directions.some((direction) => selectedDirections.has(direction));
  return JSON.stringify({
    visualPatterns: malaysiaCommerceVisualHookPatterns.filter(matches).map((pattern) => ({
      id: pattern.id, directions: pattern.directions, mechanism: pattern.mechanism, firstFrame: pattern.firstFrame,
    })),
    copyPatterns: malaysiaCommerceCopyHookPatterns.filter(matches).map((pattern) => ({
      id: pattern.id, directions: pattern.directions, formula: pattern.formula,
    })),
    scenePatterns: malaysiaCommerceScenePatterns.filter(matches).map((pattern) => ({
      id: pattern.id, directions: pattern.directions, setting: pattern.setting,
    })),
    shotPatterns: malaysiaCommerceShotPatterns.filter(matches).map((pattern) => ({
      id: pattern.id, directions: pattern.directions, beats: pattern.beats,
    })),
    performancePatterns: malaysiaCommercePerformancePatterns.filter(matches).map((pattern) => ({
      id: pattern.id, directions: pattern.directions, performance: pattern.performance,
    })),
    globalRules: [
      "自动为每个方向选择一个兼容视觉模式和一个兼容话术模式",
      "同时选择兼容的马来西亚场景、四镜头节奏和人物表演模式",
      "批量方案尽量不重复五维组合；重新分析依次轮换话术、视觉、镜头节奏、场景和表演模式",
      "只使用图片和已确认卖点可以证明的事实",
      "没有价格和促销字段时禁止任何价格、折扣、库存或退货话术",
      "保留注意力机制，不照搬危险、欺骗或虚假证言情节",
    ],
  });
}
