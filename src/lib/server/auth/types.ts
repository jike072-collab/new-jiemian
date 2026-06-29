export type AuthUserStatus = "active" | "disabled" | "verification_required";
export type AuthUserRole = "user" | "admin";

export type AuthUiState =
  | "idle"
  | "submitting"
  | "success"
  | "invalid_credentials"
  | "validation_error"
  | "account_disabled"
  | "verification_required"
  | "mapping_pending"
  | "rate_limited"
  | "service_unavailable"
  | "session_expired";

export type AuthErrorCode =
  | "AUTH_VALIDATION_ERROR"
  | "AUTH_DUPLICATE_ACCOUNT"
  | "AUTH_INVALID_CREDENTIALS"
  | "AUTH_ACCOUNT_DISABLED"
  | "AUTH_VERIFICATION_REQUIRED"
  | "AUTH_MAPPING_PENDING"
  | "AUTH_RATE_LIMITED"
  | "AUTH_SERVICE_UNAVAILABLE"
  | "AUTH_SESSION_EXPIRED"
  | "AUTH_CSRF_REQUIRED"
  | "AUTH_INVITE_REQUIRED"
  | "AUTH_TEST_USER_LIMIT_REACHED";

export type AuthUser = {
  local_user_id: string;
  email: string;
  username: string;
  display_name: string;
  password_hash: string;
  status: AuthUserStatus;
  role: AuthUserRole;
  session_version: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

export type PublicAuthUser = {
  local_user_id: string;
  email: string;
  username: string;
  display_name: string;
  status: AuthUserStatus;
  role: AuthUserRole;
};

export type AuthSession = {
  session_id: string;
  local_user_id: string;
  token_hash: string;
  session_version: number;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  idle_expires_at: string;
  expires_at: string;
  revoked_at: string | null;
  user_agent_hash: string | null;
  ip_hash: string | null;
};

export type AuthAuditEvent = {
  id: string;
  event: string;
  local_user_id: string | null;
  created_at: string;
  request_id: string | null;
  ip_hash: string | null;
  user_agent_hash: string | null;
  details: Record<string, string | number | boolean | null>;
};

export type AuthStore = {
  users: AuthUser[];
  sessions: AuthSession[];
  audit: AuthAuditEvent[];
};

export type AuthRequestContext = {
  requestId?: string;
  ip?: string;
  userAgent?: string;
};

export type AuthFailure = {
  ok: false;
  status: number;
  code: AuthErrorCode;
  uiState: AuthUiState;
  message: string;
  retryAfterSeconds?: number;
};

export type AuthSessionPayload = {
  token: string;
  session: AuthSession;
  cookieMaxAgeSeconds: number;
};

export type AuthSuccess = {
  ok: true;
  status: number;
  uiState: AuthUiState;
  user: PublicAuthUser;
  mappingStatus: string | null;
  session: AuthSessionPayload | null;
  redirectTo: string;
};

export type AuthResult = AuthSuccess | AuthFailure;

export type AuthActionSuccess = {
  ok: true;
  status: number;
  uiState: AuthUiState;
  message: string;
};

export type AuthActionResult = AuthActionSuccess | AuthFailure;

export const AUTH_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
export const AUTH_SESSION_IDLE_SECONDS = 60 * 60 * 8;
export const AUTH_CSRF_TTL_SECONDS = 60 * 60;
