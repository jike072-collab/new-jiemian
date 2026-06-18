export type NewApiErrorCode =
  | "NEW_API_CONFIG_MISSING"
  | "NEW_API_CONFIG_INVALID"
  | "NEW_API_DISABLED"
  | "NEW_API_TIMEOUT"
  | "NEW_API_NETWORK"
  | "NEW_API_INVALID_JSON"
  | "NEW_API_INVALID_CONTENT_TYPE"
  | "NEW_API_RESPONSE_TOO_LARGE"
  | "NEW_API_UPSTREAM_ERROR"
  | "NEW_API_AUTH_FORBIDDEN";

export type NewApiSafeDetails = Record<string, string | number | boolean | null>;

export class NewApiError extends Error {
  readonly code: NewApiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId: string;
  readonly upstreamStatus?: number;
  readonly safeDetails?: NewApiSafeDetails;

  constructor(input: {
    code: NewApiErrorCode;
    message: string;
    status?: number;
    retryable?: boolean;
    requestId: string;
    upstreamStatus?: number;
    safeDetails?: NewApiSafeDetails;
  }) {
    super(input.message);
    this.name = "NewApiError";
    this.code = input.code;
    this.status = input.status ?? 500;
    this.retryable = input.retryable ?? false;
    this.requestId = input.requestId;
    this.upstreamStatus = input.upstreamStatus;
    this.safeDetails = input.safeDetails;
  }

  toSafeResponse() {
    return {
      code: this.code,
      message: this.message,
      status: this.status,
      retryable: this.retryable,
      requestId: this.requestId,
      upstreamStatus: this.upstreamStatus,
      safeDetails: this.safeDetails,
    };
  }
}

export function isNewApiError(error: unknown): error is NewApiError {
  return error instanceof NewApiError;
}

export function safeNewApiError(error: unknown, requestId: string) {
  if (isNewApiError(error)) return error.toSafeResponse();
  return new NewApiError({
    code: "NEW_API_UPSTREAM_ERROR",
    message: "New API request failed.",
    requestId,
  }).toSafeResponse();
}
