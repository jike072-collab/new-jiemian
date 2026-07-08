export type PlanStatus =
  | { status: "loading" }
  | { status: "active"; name: string }
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "error" };

export type CheckInStatus = "loading" | "available" | "submitting" | "checked" | "unavailable" | "error";
export type PlanTone = "none" | "basic" | "advanced" | "pro" | "enterprise";

export type AccountStatusDisplay = {
  label: string;
  note: string;
  actionLabel: string;
  actionDisabled: boolean;
};

export function getPlanStatusDisplay(planStatus: PlanStatus): AccountStatusDisplay {
  if (planStatus.status === "loading") {
    return {
      label: "加载中",
      note: "正在同步套餐状态。",
      actionLabel: "查看套餐",
      actionDisabled: false,
    };
  }

  if (planStatus.status === "active") {
    return {
      label: planStatus.name,
      note: "当前套餐状态来自真实账户数据。",
      actionLabel: "查看套餐",
      actionDisabled: false,
    };
  }

  if (planStatus.status === "none") {
    return {
      label: "按需充值",
      note: "当前使用积分模式，可升级会员享受充值加成与每月赠送。",
      actionLabel: "查看会员",
      actionDisabled: false,
    };
  }

  if (planStatus.status === "error") {
    return {
      label: "套餐信息加载失败",
      note: "请稍后重试账户信息。",
      actionLabel: "重试",
      actionDisabled: false,
    };
  }

  return {
    label: "会员未开通",
    note: "当前可购买会员或积分包，图片与视频创作都支持积分消耗。",
    actionLabel: "会员与充值",
    actionDisabled: false,
  };
}

export function getPlanTone(label?: string | null): PlanTone {
  if (!label) return "none";
  if (label.includes("企业")) return "enterprise";
  if (label.includes("专业")) return "pro";
  if (label.includes("进阶")) return "advanced";
  if (label.includes("基础")) return "basic";
  return "none";
}

export function getCheckInStatusDisplay(checkInStatus: CheckInStatus): AccountStatusDisplay {
  if (checkInStatus === "loading") {
    return {
      label: "加载中",
      note: "正在确认签到状态。",
      actionLabel: "签到",
      actionDisabled: true,
    };
  }

  if (checkInStatus === "available") {
    return {
      label: "今日未签到",
      note: "每日签到可领取 200 积分。",
      actionLabel: "签到",
      actionDisabled: false,
    };
  }

  if (checkInStatus === "submitting") {
    return {
      label: "签到中",
      note: "正在提交签到。",
      actionLabel: "签到中",
      actionDisabled: true,
    };
  }

  if (checkInStatus === "checked") {
    return {
      label: "今日已签到",
      note: "今日签到已完成。",
      actionLabel: "已完成",
      actionDisabled: true,
    };
  }

  if (checkInStatus === "error") {
    return {
      label: "签到状态加载失败",
      note: "请稍后重试账户信息。",
      actionLabel: "重试",
      actionDisabled: false,
    };
  }

  return {
    label: "请先登录",
    note: "登录后可每日签到领取积分。",
    actionLabel: "签到",
    actionDisabled: false,
  };
}
