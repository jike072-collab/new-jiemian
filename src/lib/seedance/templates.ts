export type SeedanceTemplate = {
  id: string;
  name: string;
  description: string;
  prompt: string;
};

export const seedanceTemplates: SeedanceTemplate[] = [
  {
    id: "product-demo",
    name: "产品演示",
    description: "展示真实使用动作和结果反馈",
    prompt: "产品主体保持结构、颜色和数量不变。先展示产品在干净环境中的初始状态，再用一个连续的真实使用动作突出核心功能，镜头围绕动作做一次克制的推进或跟拍，最后回到完整产品和清晰结果。只加入与使用动作直接相关的声音，不新增未要求的文字、Logo 或功能。",
  },
  {
    id: "ugc-hook",
    name: "UGC 开场",
    description: "先呈现结果，再交代动作过程",
    prompt: "真实生活环境中的单人短视频。开头立即呈现一个可见结果或核心动作，人物表情和手势自然克制，镜头保持稳定并只做一次服务于信息传达的移动，随后用连续动作交代过程，结尾停在清楚可读的结果画面，不凭空增加促销信息。",
  },
  {
    id: "cinematic-beat",
    name: "叙事单镜头",
    description: "一个目标、一个动作、一个运镜",
    prompt: "围绕一个明确的叙事意图组织单段视频。主体先处于清楚的起始状态，然后完成一个有因果关系的主要动作，镜头只使用一个与动作一致的运镜，光线来自画面内可见光源，结尾保留动作后的实际状态，不添加无关人物、道具或转场。",
  },
  {
    id: "motion-design",
    name: "动态图形",
    description: "控制元素出现、变形和收束",
    prompt: "动态图形短片。明确主要图形元素的出现顺序、形变路径、层级关系和最终收束位置，保持统一的运动规律和节奏，镜头只做一次必要的平移或推进，背景和光线服务于图形可读性，不新增未要求的文字内容。",
  },
  {
    id: "first-last-frame",
    name: "首尾帧过渡",
    description: "锁定起点和终点的连续变化",
    prompt: "@Image1 作为首帧，@Image2 作为尾帧。保持主体身份、产品结构和画面方向稳定，描述从首帧到尾帧之间一个连续的变化过程，运动方向清楚，避免跳切、无依据的场景替换和新增主体。",
  },
  {
    id: "sequence-shot",
    name: "连续分镜",
    description: "把故事拆成可独立生成的镜头",
    prompt: "请先按镜头目标拆分连续故事，每个镜头只写一个主要动作和一个主要运镜，并记录角色、场景、道具、引用职责和实际结束状态。后续镜头必须从上一镜头已确认的结束状态继续，不重复已完成动作，也不提前泄露后续情节。",
  },
];

export function seedanceTemplateById(id: string) {
  return seedanceTemplates.find((template) => template.id === id);
}
