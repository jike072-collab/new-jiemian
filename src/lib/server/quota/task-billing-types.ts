import { type BillableOperation, type QuotaErrorCode, type UsageLogEntry } from "./types";

export type TaskBillingState =
  | "prechecked"
  | "dispatching"
  | "provider_started"
  | "accepted"
  | "settled"
  | "failed"
  | "cancelled"
  | "reconciliation_required";

export type TaskBillingAction =
  | "prechecked"
  | "dispatching"
  | "provider_started"
  | "accepted"
  | "settled"
  | "failed"
  | "cancelled"
  | "refunded"
  | "idempotent"
  | "reconciliation_required";

export type TaskBillingErrorCode =
  | QuotaErrorCode
  | "invalid_task_billing_request"
  | "task_billing_not_found"
  | "task_billing_conflict"
  | "task_billing_unavailable";

export type TaskBillingRecord = {
  id: string;
  local_user_id: string;
  task_id: string;
  new_api_task_id: string | null;
  usage_record_id: string | null;
  idempotency_key: string;
  request_fingerprint: string | null;
  billing_state: TaskBillingState;
  estimated_quota_units: number;
  final_quota_units: number | null;
  created_at: string;
  updated_at: string;
  settled_at: string | null;
  refunded_at: string | null;
  last_error: string | null;
  version: number;
};

export type TaskBillingFailure = {
  ok: false;
  status: number;
  code: TaskBillingErrorCode;
  message: string;
  retryable: boolean;
};

export type TaskBillingSuccess = {
  ok: true;
  status: number;
  action: TaskBillingAction;
  record: TaskBillingRecord;
  usage?: UsageLogEntry;
};

export type TaskBillingResult = TaskBillingSuccess | TaskBillingFailure;

export type TaskBillingPrecheckInput = {
  localUserId: string;
  taskId: string;
  operation: BillableOperation;
  estimatedQuotaUnits: number;
  idempotencyKey: string;
  requestFingerprint?: string | null;
};

export type TaskBillingVerifyPrecheckInput = {
  localUserId: string;
  taskId: string;
  estimatedQuotaUnits: number;
  idempotencyKey: string;
  requestFingerprint?: string | null;
};

export type TaskBillingAcceptInput = {
  localUserId: string;
  taskId: string;
  newApiTaskId?: string | null;
  upstreamRequestId?: string | null;
  upstreamModel?: string | null;
};

export type TaskBillingSettleInput = {
  localUserId: string;
  taskId: string;
  actualQuotaUnits: number;
  newApiTaskId?: string | null;
  upstreamLogId?: string | null;
  upstreamRequestId?: string | null;
  upstreamModel?: string | null;
};

export type TaskBillingFailInput = {
  localUserId: string;
  taskId: string;
  reason?: string | null;
  newApiTaskId?: string | null;
  upstreamRequestId?: string | null;
  upstreamModel?: string | null;
};
