import "server-only";

import { extname } from "node:path";

import {
  mediaUploadPolicies,
  normalizeMimeType,
  publicLimit,
  remoteMediaDownloadPolicies,
  resolveLoweredUploadLimitBytes,
  type MediaUploadKind,
  type PublicUploadLimits,
  type RemoteMediaKind,
} from "../upload-limits";

import { GenerationDiagnosticError } from "./error-diagnostics";

const headerReadBytes = 64;

export function currentUploadLimitBytes(kind: MediaUploadKind) {
  const policy = mediaUploadPolicies[kind];
  const envName = kind === "video-upscale" || kind === "reference-video"
    ? "MEDIA_VIDEO_UPLOAD_LIMIT_MIB"
    : kind === "reference-audio"
      ? "MEDIA_AUDIO_UPLOAD_LIMIT_MIB"
    : "MEDIA_IMAGE_UPLOAD_LIMIT_MIB";
  return resolveLoweredUploadLimitBytes(process.env[envName], policy);
}

export function currentRemoteMediaLimitBytes(kind: RemoteMediaKind) {
  const policy = remoteMediaDownloadPolicies[kind];
  const envName = kind === "video"
    ? "MEDIA_VIDEO_UPLOAD_LIMIT_MIB"
    : "MEDIA_IMAGE_UPLOAD_LIMIT_MIB";
  return resolveLoweredUploadLimitBytes(process.env[envName], policy);
}

export function publicUploadLimits(): PublicUploadLimits {
  return {
    referenceImage: publicLimit(currentUploadLimitBytes("reference-image")),
    referenceVideo: publicLimit(currentUploadLimitBytes("reference-video")),
    referenceAudio: publicLimit(currentUploadLimitBytes("reference-audio")),
    imageUpscale: publicLimit(currentUploadLimitBytes("image-upscale")),
    videoUpscale: publicLimit(currentUploadLimitBytes("video-upscale")),
  };
}

export function assertFileSizeAllowed(file: File, kind: MediaUploadKind) {
  const limit = currentUploadLimitBytes(kind);
  if (file.size > limit) {
    const publicLimitValue = publicLimit(limit);
    throw new GenerationDiagnosticError({
      code: "INPUT_FILE_TOO_LARGE",
      publicMessage: mediaUploadPolicies[kind].serverSizeMessage(publicLimitValue.label),
      safeDetails: {
        kind,
        size: file.size,
        limit,
        nginxClientMaxBodySize: publicLimitValue.nginxClientMaxBodySize,
      },
    });
  }
  return limit;
}

export function assertContentLengthAllowed(value: string | null, kind: RemoteMediaKind) {
  const limit = currentRemoteMediaLimitBytes(kind);
  const contentLength = Number(value || 0);
  if (Number.isFinite(contentLength) && contentLength > limit) {
    throw new GenerationDiagnosticError({
      code: "INPUT_FILE_TOO_LARGE",
      publicMessage: `${kind === "video" ? "视频" : "图片"}不能超过${publicLimit(limit).label}。`,
      safeDetails: { kind, limit, contentLength },
    });
  }
  return limit;
}

export function assertBufferLengthAllowed(size: number, kind: RemoteMediaKind) {
  const limit = currentRemoteMediaLimitBytes(kind);
  if (size > limit) {
    throw new GenerationDiagnosticError({
      code: "INPUT_FILE_TOO_LARGE",
      publicMessage: `${kind === "video" ? "视频" : "图片"}不能超过${publicLimit(limit).label}。`,
      safeDetails: { kind, limit, size },
    });
  }
}

export async function assertFileFormatAllowed(file: File, kind: MediaUploadKind) {
  const policy = mediaUploadPolicies[kind];
  const mimeType = normalizeMimeType(file.type);
  const extension = extname(file.name || "").toLowerCase();
  if (!policy.allowedMimeTypes.includes(mimeType)) {
    throw unsupportedFormat(kind, mimeType, extension);
  }
  if (!policy.allowedExtensions.includes(extension)) {
    throw unsupportedFormat(kind, mimeType, extension);
  }
  const header = Buffer.from(await file.slice(0, headerReadBytes).arrayBuffer());
  if (!isSignatureAllowed(header, mimeType)) {
    throw unsupportedFormat(kind, mimeType, extension);
  }
  return mimeType;
}

function unsupportedFormat(kind: MediaUploadKind, mimeType: string, extension: string) {
  return new GenerationDiagnosticError({
    code: "INPUT_UNSUPPORTED_FORMAT",
    publicMessage: mediaUploadPolicies[kind].formatMessage,
    safeDetails: {
      kind,
      mimeType,
      extension,
    },
  });
}

function isSignatureAllowed(header: Buffer, mimeType: string) {
  if (mimeType === "image/png") return hasPngSignature(header);
  if (mimeType === "image/jpeg") return hasJpegSignature(header);
  if (mimeType === "image/webp") return hasWebpSignature(header);
  if (mimeType === "video/mp4" || mimeType === "video/quicktime") return hasIsoBaseMediaSignature(header);
  if (mimeType === "video/webm") return hasWebmSignature(header);
  if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a") return hasIsoBaseMediaSignature(header);
  if (mimeType === "audio/mpeg") return hasMp3Signature(header);
  if (mimeType === "audio/wav" || mimeType === "audio/x-wav") return hasWavSignature(header);
  return false;
}

function hasPngSignature(header: Buffer) {
  return header.length >= 8
    && header[0] === 0x89
    && header.toString("ascii", 1, 4) === "PNG"
    && header[4] === 0x0d
    && header[5] === 0x0a
    && header[6] === 0x1a
    && header[7] === 0x0a;
}

function hasJpegSignature(header: Buffer) {
  return header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
}

function hasWebpSignature(header: Buffer) {
  return header.length >= 12
    && header.toString("ascii", 0, 4) === "RIFF"
    && header.toString("ascii", 8, 12) === "WEBP";
}

function hasIsoBaseMediaSignature(header: Buffer) {
  return header.length >= 12 && header.toString("ascii", 4, 8) === "ftyp";
}

function hasWebmSignature(header: Buffer) {
  return header.length >= 4
    && header[0] === 0x1a
    && header[1] === 0x45
    && header[2] === 0xdf
    && header[3] === 0xa3;
}

function hasMp3Signature(header: Buffer) {
  return header.length >= 3 && (
    header.toString("ascii", 0, 3) === "ID3"
    || (header[0] === 0xff && (header[1] & 0xe0) === 0xe0)
  );
}

function hasWavSignature(header: Buffer) {
  return header.length >= 12
    && header.toString("ascii", 0, 4) === "RIFF"
    && header.toString("ascii", 8, 12) === "WAVE";
}
