export const tiktokPrivacyLevels = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;

export type TikTokPrivacyLevel = (typeof tiktokPrivacyLevels)[number];
export type TikTokPublishStatus = "scheduled" | "queued" | "uploading" | "processing" | "published" | "failed" | "canceled";

export type TikTokConnectionRecord = {
  userId: string;
  zernioProfileId: string;
  zernioAccountId?: string;
  displayName?: string;
  avatarUrl?: string;
  creatorUsername?: string;
  connectedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type TikTokConnectionSummary = {
  connected: true;
  displayName: string;
  avatarUrl?: string;
  creatorUsername?: string;
  zernioAccountId: string;
};

export type TikTokAvailableAccount = {
  zernioProfileId: string;
  zernioAccountId: string;
  displayName: string;
  avatarUrl?: string;
  creatorUsername?: string;
};

export type TikTokCreatorInfo = {
  creatorUsername: string;
  creatorNickname: string;
  privacyLevelOptions: TikTokPrivacyLevel[];
  commentDisabled: boolean;
  duetDisabled: boolean;
  stitchDisabled: boolean;
  maxVideoPostDurationSec: number;
  canPostMore: boolean;
};

export type TikTokPublishJob = {
  id: string;
  userId: string;
  sourceOwnerId: string;
  libraryItemId: string;
  idempotencyKey: string;
  caption: string;
  privacyLevel: TikTokPrivacyLevel;
  disableComment: boolean;
  disableDuet: boolean;
  disableStitch: boolean;
  brandContentToggle: boolean;
  brandOrganicToggle: boolean;
  isAigc: boolean;
  status: TikTokPublishStatus;
  scheduledAt: string;
  nextAttemptAt: string;
  attempts: number;
  zernioPostId?: string;
  uploadedBytes: number;
  tiktokPostId?: string;
  postUrl?: string;
  errorCode?: string;
  errorMessage?: string;
  lockedAt?: string;
  lockedBy?: string;
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
};

export type TikTokPublicPublishJob = Omit<TikTokPublishJob, "userId" | "sourceOwnerId" | "idempotencyKey" | "lockedAt" | "lockedBy">;
