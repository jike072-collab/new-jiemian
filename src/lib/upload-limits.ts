export const BYTES_PER_MIB = 1024 * 1024;

export type MediaUploadKind = "reference-image" | "image-upscale" | "video-upscale";
export type RemoteMediaKind = "image" | "video";

export type UploadLimitPolicy = {
  readonly defaultBytes: number;
  readonly hardCapBytes: number;
  readonly allowedMimeTypes: readonly string[];
  readonly allowedExtensions: readonly string[];
  readonly clientSizeMessage: (limitLabel: string) => string;
  readonly serverSizeMessage: (limitLabel: string) => string;
  readonly formatMessage: string;
};

export type PublicUploadLimit = {
  readonly bytes: number;
  readonly label: string;
  readonly nginxClientMaxBodySize: string;
};

export type PublicUploadLimits = {
  readonly referenceImage: PublicUploadLimit;
  readonly imageUpscale: PublicUploadLimit;
  readonly videoUpscale: PublicUploadLimit;
};

export const imageUploadDefaultMiB = 10;
export const videoUploadDefaultMiB = 200;
export const uploadHardCapMiB = 256;

export const allowedImageMimeTypes = ["image/png", "image/jpeg", "image/webp"] as const;
export const allowedImageExtensions = [".png", ".jpg", ".jpeg", ".webp"] as const;
export const allowedVideoMimeTypes = ["video/mp4", "video/webm", "video/quicktime"] as const;
export const allowedVideoExtensions = [".mp4", ".webm", ".mov"] as const;

export function bytesFromMiB(value: number) {
  return value * BYTES_PER_MIB;
}

export function formatByteLimit(bytes: number) {
  const mib = bytes / BYTES_PER_MIB;
  if (Number.isInteger(mib)) return `${mib}MB`;
  return `${Math.floor(mib * 10) / 10}MB`;
}

export function nginxClientMaxBodySize(bytes: number) {
  return `${Math.ceil(bytes / BYTES_PER_MIB)}m`;
}

export const mediaUploadPolicies: Record<MediaUploadKind, UploadLimitPolicy> = {
  "reference-image": {
    defaultBytes: bytesFromMiB(imageUploadDefaultMiB),
    hardCapBytes: bytesFromMiB(uploadHardCapMiB),
    allowedMimeTypes: allowedImageMimeTypes,
    allowedExtensions: allowedImageExtensions,
    clientSizeMessage: (limitLabel) => `单张图像不能超过 ${limitLabel}。`,
    serverSizeMessage: (limitLabel) => `单张参考图片不能超过 ${limitLabel}。`,
    formatMessage: "图像仅支持 PNG、JPEG 和 WebP。",
  },
  "image-upscale": {
    defaultBytes: bytesFromMiB(imageUploadDefaultMiB),
    hardCapBytes: bytesFromMiB(uploadHardCapMiB),
    allowedMimeTypes: allowedImageMimeTypes,
    allowedExtensions: allowedImageExtensions,
    clientSizeMessage: (limitLabel) => `图片高清增强文件不能超过 ${limitLabel}。`,
    serverSizeMessage: (limitLabel) => `图片不能超过${limitLabel}。`,
    formatMessage: "图片高清增强仅支持 PNG、JPEG 和 WebP。",
  },
  "video-upscale": {
    defaultBytes: bytesFromMiB(videoUploadDefaultMiB),
    hardCapBytes: bytesFromMiB(uploadHardCapMiB),
    allowedMimeTypes: allowedVideoMimeTypes,
    allowedExtensions: allowedVideoExtensions,
    clientSizeMessage: (limitLabel) => `视频高清增强文件不能超过 ${limitLabel}。`,
    serverSizeMessage: (limitLabel) => `视频不能超过${limitLabel}。`,
    formatMessage: "视频高清增强仅支持 MP4、WebM 和 MOV。",
  },
};

export const remoteMediaDownloadPolicies: Record<RemoteMediaKind, Pick<UploadLimitPolicy, "defaultBytes" | "hardCapBytes">> = {
  image: {
    defaultBytes: bytesFromMiB(imageUploadDefaultMiB),
    hardCapBytes: bytesFromMiB(uploadHardCapMiB),
  },
  video: {
    defaultBytes: bytesFromMiB(videoUploadDefaultMiB),
    hardCapBytes: bytesFromMiB(uploadHardCapMiB),
  },
};

export const defaultPublicUploadLimits: PublicUploadLimits = {
  referenceImage: publicLimit(mediaUploadPolicies["reference-image"].defaultBytes),
  imageUpscale: publicLimit(mediaUploadPolicies["image-upscale"].defaultBytes),
  videoUpscale: publicLimit(mediaUploadPolicies["video-upscale"].defaultBytes),
};

export const recommendedNginxClientMaxBodySize = nginxClientMaxBodySize(mediaUploadPolicies["video-upscale"].defaultBytes);

export function publicLimit(bytes: number): PublicUploadLimit {
  return {
    bytes,
    label: formatByteLimit(bytes),
    nginxClientMaxBodySize: nginxClientMaxBodySize(bytes),
  };
}

export function uploadSizeLimitMessage(kind: MediaUploadKind, limitBytes = mediaUploadPolicies[kind].defaultBytes) {
  return mediaUploadPolicies[kind].clientSizeMessage(formatByteLimit(limitBytes));
}

export function resolveLoweredUploadLimitBytes(
  rawValue: string | number | null | undefined,
  policy: Pick<UploadLimitPolicy, "defaultBytes" | "hardCapBytes">,
) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return policy.defaultBytes;
  const mib = typeof rawValue === "number" ? rawValue : Number(String(rawValue).trim());
  if (!Number.isFinite(mib) || mib <= 0) return policy.defaultBytes;
  const candidate = Math.floor(mib * BYTES_PER_MIB);
  if (candidate > policy.hardCapBytes) return policy.defaultBytes;
  if (candidate > policy.defaultBytes) return policy.defaultBytes;
  return candidate;
}

export function normalizeMimeType(value: string | null | undefined) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}
