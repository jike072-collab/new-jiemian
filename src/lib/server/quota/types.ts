export type QuotaErrorCode =
  | "invalid_quota_request"
  | "quota_unavailable"
  | "insufficient_quota"
  | "usage_unavailable"
  | "upstream_unavailable"
  | "mapping_pending"
  | "permission_denied"
  | "rate_limited";

export type UsageStatus =
  | "prechecked"
  | "accepted"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "refunded"
  | "reconciliation_required";

export type BillableOperation =
  | "cloud_image_generation"
  | "cloud_video_generation"
  | "cloud_image_upscale"
  | "cloud_video_upscale";

export type QuotaSnapshot = {
  local_user_id: string;
  new_api_user_id: string;
  quota_units: number;
  used_quota_units: number;
  available_quota_units: number;
  display_unit: "credits";
  source: "new_api";
  fetched_at: string;
  cached: boolean;
  cache_expires_at: string;
};

export type UsageLogEntry = {
  id: string;
  local_user_id: string;
  new_api_user_id: string | null;
  task_id: string;
  operation: BillableOperation;
  status: UsageStatus;
  estimated_quota_units: number;
  actual_quota_units: number | null;
  upstream_log_id: string | null;
  upstream_request_id: string | null;
  upstream_model: string | null;
  upstream_created_at: string | null;
  created_at: string;
  updated_at: string;
  idempotency_key: string;
  error_code: string | null;
  error_message: string | null;
};

export type UsagePage = {
  entries: UsageLogEntry[];
  page: number;
  pageSize: number;
  total: number;
};

export type QuotaPrecheckResult =
  | {
      ok: true;
      snapshot: QuotaSnapshot;
      estimatedQuotaUnits: number;
      usage: UsageLogEntry;
    }
  | {
      ok: false;
      code: QuotaErrorCode;
      status: number;
      message: string;
      retryAfterSeconds?: number;
    };
