import "server-only";

export type WorkloadLimits = {
  userImageTasks: number;
  userImageEditTasks: number;
  userVideoTasks: number;
  userLargeUploads: number;
  userImageUpscaleTasks: number;
  userVideoUpscaleTasks: number;
  failedLoginPerIp: number;
  failedLoginWindowMs: number;
  failedAdminPasswordPerIp: number;
  failedAdminPasswordWindowMs: number;
  registerPerIp: number;
  registerWindowMs: number;
  slotTtlMs: number;
};

export const defaultWorkloadLimits: WorkloadLimits = {
  userImageTasks: 4,
  userImageEditTasks: 1,
  userVideoTasks: 1,
  userLargeUploads: 1,
  userImageUpscaleTasks: 1,
  userVideoUpscaleTasks: 1,
  failedLoginPerIp: 5,
  failedLoginWindowMs: 60_000,
  failedAdminPasswordPerIp: 3,
  failedAdminPasswordWindowMs: 60_000,
  registerPerIp: 3,
  registerWindowMs: 60 * 60_000,
  slotTtlMs: 15 * 60_000,
};

const envKeys = {
  userImageTasks: "WORKLOAD_USER_IMAGE_TASKS",
  userImageEditTasks: "WORKLOAD_USER_IMAGE_EDIT_TASKS",
  userVideoTasks: "WORKLOAD_USER_VIDEO_TASKS",
  userLargeUploads: "WORKLOAD_USER_LARGE_UPLOADS",
  userImageUpscaleTasks: "WORKLOAD_USER_IMAGE_UPSCALE_TASKS",
  userVideoUpscaleTasks: "WORKLOAD_USER_VIDEO_UPSCALE_TASKS",
  failedLoginPerIp: "AUTH_LOGIN_FAILED_PER_IP_PER_MINUTE",
  failedAdminPasswordPerIp: "AUTH_ADMIN_PASSWORD_FAILED_PER_IP_PER_MINUTE",
  registerPerIp: "AUTH_REGISTER_PER_IP_PER_HOUR",
} as const;

function loweredInteger(value: string | undefined, defaultValue: number) {
  if (!value) return defaultValue;
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 1 || candidate > defaultValue) {
    return defaultValue;
  }
  return candidate;
}

export function getWorkloadLimits(env: NodeJS.ProcessEnv = process.env): WorkloadLimits {
  return {
    ...defaultWorkloadLimits,
    userImageTasks: loweredInteger(env[envKeys.userImageTasks], defaultWorkloadLimits.userImageTasks),
    userImageEditTasks: loweredInteger(env[envKeys.userImageEditTasks], defaultWorkloadLimits.userImageEditTasks),
    userVideoTasks: loweredInteger(env[envKeys.userVideoTasks], defaultWorkloadLimits.userVideoTasks),
    userLargeUploads: loweredInteger(env[envKeys.userLargeUploads], defaultWorkloadLimits.userLargeUploads),
    userImageUpscaleTasks: loweredInteger(env[envKeys.userImageUpscaleTasks], defaultWorkloadLimits.userImageUpscaleTasks),
    userVideoUpscaleTasks: loweredInteger(env[envKeys.userVideoUpscaleTasks], defaultWorkloadLimits.userVideoUpscaleTasks),
    failedLoginPerIp: loweredInteger(env[envKeys.failedLoginPerIp], defaultWorkloadLimits.failedLoginPerIp),
    failedAdminPasswordPerIp: loweredInteger(
      env[envKeys.failedAdminPasswordPerIp],
      defaultWorkloadLimits.failedAdminPasswordPerIp,
    ),
    registerPerIp: loweredInteger(env[envKeys.registerPerIp], defaultWorkloadLimits.registerPerIp),
  };
}
