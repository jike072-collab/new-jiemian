export type PlanStatus =
  | { status: "loading" }
  | { status: "active"; name: string }
  | { status: "none" }
  | { status: "unavailable" }
  | { status: "error" };

export type CheckInStatus = "loading" | "available" | "submitting" | "checked" | "unavailable" | "error";

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
      label: "暂未开通",
      note: "当前使用按次积分模式。",
      actionLabel: "查看套餐",
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
    label: "套餐信息暂不可用",
    note: "当前仅支持查看可购买套餐。",
    actionLabel: "查看套餐",
    actionDisabled: false,
  };
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
      note: "可签到时将使用真实签到接口。",
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
    label: "签到功能暂未开放",
    note: "开放后会在这里显示每日签到状态。",
    actionLabel: "签到",
    actionDisabled: false,
  };
}
