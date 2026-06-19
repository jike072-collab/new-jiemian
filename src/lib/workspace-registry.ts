import {
  Film,
  FolderOpen,
  Image as ImageIcon,
  Settings,
  Sparkles,
  Wand2,
} from "lucide-react";

export type WorkspaceToolGroup = "创作工具" | "增强工具" | "作品" | "系统";

export type WorkspaceToolId =
  | "video"
  | "image"
  | "image-editor"
  | "image-upscale"
  | "video-upscale"
  | "library"
  | "admin-settings";

export type WorkspaceBusinessToolId = Exclude<WorkspaceToolId, "image-editor" | "admin-settings">;
export type WorkspaceImageMode = "text-to-image" | "image-to-image";
export type WorkspaceVideoMode = "text-to-video" | "image-to-video";

export type WorkspaceAction =
  | {
      kind: "workspace";
      toolId: WorkspaceBusinessToolId;
      mode?: WorkspaceImageMode | WorkspaceVideoMode;
    }
  | {
      kind: "route";
      href: string;
    };

export type WorkspaceToolEntry = {
  id: WorkspaceToolId;
  label: string;
  description: string;
  icon: typeof ImageIcon;
  group: WorkspaceToolGroup;
  action: WorkspaceAction;
  visible: boolean;
  requiresAuth: boolean;
};

export type WorkspaceAccountEntry = {
  id: string;
  label: string;
  description: string;
  action?: WorkspaceAction;
  visible: boolean;
  requiresAuth: boolean;
  featureFlag?: string;
};

export const workspaceToolGroups: Array<{ title: WorkspaceToolGroup; items: WorkspaceToolId[] }> = [
  { title: "创作工具", items: ["video", "image", "image-editor"] },
  { title: "增强工具", items: ["image-upscale", "video-upscale"] },
  { title: "作品", items: ["library"] },
  { title: "系统", items: ["admin-settings"] },
];

export const workspaceToolEntries: WorkspaceToolEntry[] = [
  {
    id: "video",
    label: "AI 视频生成器",
    description: "描述镜头，可选首帧图片",
    icon: Film,
    group: "创作工具",
    action: { kind: "workspace", toolId: "video", mode: "text-to-video" },
    visible: true,
    requiresAuth: false,
  },
  {
    id: "image",
    label: "AI 图像生成器",
    description: "描述画面，可选参考图片",
    icon: ImageIcon,
    group: "创作工具",
    action: { kind: "workspace", toolId: "image", mode: "text-to-image" },
    visible: true,
    requiresAuth: false,
  },
  {
    id: "image-editor",
    label: "AI 图片编辑器",
    description: "上传参考图进行编辑",
    icon: Wand2,
    group: "创作工具",
    action: { kind: "workspace", toolId: "image", mode: "image-to-image" },
    visible: true,
    requiresAuth: false,
  },
  {
    id: "image-upscale",
    label: "图片高清",
    description: "放大图片清晰度",
    icon: Sparkles,
    group: "增强工具",
    action: { kind: "workspace", toolId: "image-upscale" },
    visible: true,
    requiresAuth: false,
  },
  {
    id: "video-upscale",
    label: "视频高清",
    description: "放大视频清晰度",
    icon: Sparkles,
    group: "增强工具",
    action: { kind: "workspace", toolId: "video-upscale" },
    visible: true,
    requiresAuth: false,
  },
  {
    id: "library",
    label: "作品库",
    description: "历史结果与下载",
    icon: FolderOpen,
    group: "作品",
    action: { kind: "workspace", toolId: "library" },
    visible: true,
    requiresAuth: false,
  },
  {
    id: "admin-settings",
    label: "后台设置",
    description: "供应商与本机配置",
    icon: Settings,
    group: "系统",
    action: { kind: "route", href: "/admin/providers" },
    visible: true,
    requiresAuth: false,
  },
];

export const workspaceAccountMenu: WorkspaceAccountEntry[] = [
  {
    id: "account-center",
    label: "账户中心",
    description: "查看账户资料",
    visible: false,
    requiresAuth: true,
    featureFlag: "new-api-account-menu",
  },
  {
    id: "balance-topup",
    label: "余额与充值",
    description: "查看余额和充值入口",
    visible: false,
    requiresAuth: true,
    featureFlag: "new-api-account-menu",
  },
  {
    id: "recharge-records",
    label: "充值记录",
    description: "查看充值明细",
    visible: false,
    requiresAuth: true,
    featureFlag: "new-api-account-menu",
  },
  {
    id: "logout",
    label: "退出登录",
    description: "结束当前会话",
    visible: false,
    requiresAuth: true,
    featureFlag: "new-api-account-menu",
  },
];

export function workspaceToolById(id: WorkspaceToolId) {
  return workspaceToolEntries.find((item) => item.id === id) || null;
}

export function workspaceToolGroupFor(id: WorkspaceToolId) {
  return workspaceToolById(id)?.group || "创作工具";
}

export function workspaceToolIdForImageMode(mode: WorkspaceImageMode): WorkspaceToolId {
  return mode === "image-to-image" ? "image-editor" : "image";
}
