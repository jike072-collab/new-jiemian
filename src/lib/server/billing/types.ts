export type BillingOrderStatus =
  | "pending"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled"
  | "review"
  | "refunded";

export type BillingCurrency = "CNY";

export type BillingErrorCode =
  | "billing_disabled"
  | "invalid_billing_request"
  | "payment_channel_unavailable"
  | "mapping_pending"
  | "payment_not_found"
  | "payment_invalid_signature"
  | "payment_replay_detected"
  | "payment_mismatch"
  | "payment_out_of_order"
  | "quota_credit_failed"
  | "permission_denied";

export type BillingDiscount = {
  threshold_amount: number;
  multiplier_basis_points: number;
};

export type PaymentChannelConfig = {
  channel: string;
  name: string;
  display_color: string;
  min_amount: number;
  fixed_amounts: number[];
  custom_amount_range: {
    min_amount: number;
    max_amount: number;
  };
  discounts: BillingDiscount[];
  currency: BillingCurrency;
  enabled: boolean;
  sort_order: number;
  quota_units_per_minor_unit: number;
};

export type PublicPaymentChannelConfig = Omit<PaymentChannelConfig, "quota_units_per_minor_unit"> & {
  estimated_quota_units_per_minor_unit: number;
};

export type BillingAuditEvent = {
  id: string;
  order_id: string | null;
  event: string;
  created_at: string;
  local_user_id: string | null;
  safe_details: Record<string, string | number | boolean | null>;
};

export type BillingOrder = {
  order_id: string;
  local_user_id: string;
  new_api_user_id: string;
  channel: string;
  currency: BillingCurrency;
  requested_amount: number;
  paid_amount: number;
  credited_quota: number;
  status: BillingOrderStatus;
  idempotency_key: string;
  provider_order_id: string;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  last_error: string | null;
  version: number;
  quota_credit_applied_at: string | null;
  refunded_at: string | null;
  webhook_event_ids: string[];
};

export type BillingWebhookProcessingStatus = "received" | "processing" | "completed" | "failed";

export type BillingWebhookEventRecord = {
  event_id: string;
  order_id: string;
  event_type: BillingWebhookEventType;
  status: BillingWebhookProcessingStatus;
  received_at: string;
  occurred_at: string | null;
  safe_error: string | null;
};

export type BillingStore = {
  orders: BillingOrder[];
  webhook_events: BillingWebhookEventRecord[];
  audit: BillingAuditEvent[];
};

export type CreateBillingOrderInput = {
  localUserId: string;
  channel: string;
  currency: BillingCurrency;
  requestedAmount: number;
  idempotencyKey: string;
};

export type BillingRequestContext = {
  requestId?: string;
  ip?: string;
  userAgent?: string;
};

export type BillingFailure = {
  ok: false;
  status: number;
  code: BillingErrorCode;
  message: string;
};

export type CreateBillingOrderSuccess = {
  ok: true;
  status: number;
  order: BillingOrder;
  payment: {
    channel: string;
    provider_order_id: string;
    sandbox_webhook_path: string;
  };
};

export type CreateBillingOrderResult = CreateBillingOrderSuccess | BillingFailure;

export type BillingOrderListResult = {
  ok: true;
  status: number;
  orders: BillingOrder[];
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
} | BillingFailure;

export type BillingWebhookEventType = "payment_succeeded" | "payment_failed" | "payment_cancelled" | "payment_refunded";

export type BillingWebhookPayload = {
  event_id: string;
  event_type: BillingWebhookEventType;
  order_id: string;
  provider_order_id: string;
  local_user_id: string;
  new_api_user_id: string;
  channel: string;
  currency: BillingCurrency;
  paid_amount: number;
  occurred_at: string;
};

export type BillingWebhookSuccess = {
  ok: true;
  status: number;
  order: BillingOrder;
  action: "credited" | "idempotent" | "status_updated" | "review";
};

export type BillingWebhookResult = BillingWebhookSuccess | BillingFailure;

export type PaymentProviderStatus = "pending" | "paid" | "failed" | "cancelled" | "refunded" | "unknown";

export type ReconciliationIssue = {
  order_id: string;
  status: BillingOrderStatus;
  issue: string;
  action: "none" | "marked_review" | "credited" | "status_updated";
};

export type ReconciliationResult = {
  checked: number;
  issues: ReconciliationIssue[];
};
