import { randomBytes, randomInt, randomUUID } from "node:crypto";

import { createNewApiUserSyncService, type NewApiUserMappingRepository, type NewApiUserSyncService } from "../integrations/new-api";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { InMemoryRateLimiter } from "./rate-limit";
import { hmacSha256, timingSafeStringEqual } from "./secrets";
import { AuthVerificationSendError, sendAuthVerificationCode, type AuthVerificationSender } from "./verification-sender";
import { getWorkloadLimits } from "../workload-limits";
import {
  AuthRepositoryError,
  type AuthRepository,
} from "./repository";
import { createAuthPersistenceRepositories } from "./persistence";
import {
  isValidEmail,
  isValidUsername,
  normalizeEmail,
  normalizeIdentifier,
  normalizeUsername,
  nowIso,
  publicSafeString,
  safeRedirectPath,
  sha256,
} from "./normalize";
import {
  AUTH_SESSION_IDLE_SECONDS,
  AUTH_SESSION_TTL_SECONDS,
  type AuthActionResult,
  type AuthAuditEvent,
  type AuthFailure,
  type AuthRequestContext,
  type AuthResult,
  type AuthSession,
  type AuthSessionPayload,
  type AuthSuccess,
  type AuthVerificationPurpose,
  type AuthUser,
  type PublicAuthUser,
} from "./types";

export type RegisterInput = {
  identifier?: string;
  email?: string;
  password: string;
  verificationCode?: string;
  username?: string;
  displayName?: string;
  redirectTo?: string;
};

export type LoginInput = {
  identifier: string;
  password?: string;
  verificationCode?: string;
  loginMethod?: "password" | "verification_code";
  rememberMe?: boolean;
  existingSessionToken?: string | null;
  redirectTo?: string;
};

export type VerificationCodeInput = {
  identifier: string;
  purpose: AuthVerificationPurpose;
};

export type PasswordResetInput = {
  identifier: string;
  verificationCode: string;
  password: string;
};

export type AuthServiceDependencies = {
  repository?: AuthRepository;
  mappingRepository?: NewApiUserMappingRepository;
  userSyncService?: Pick<NewApiUserSyncService, "ensureMapped">;
  loginLimiter?: InMemoryRateLimiter;
  adminPasswordLimiter?: InMemoryRateLimiter;
  registerLimiter?: InMemoryRateLimiter;
  verificationLimiter?: InMemoryRateLimiter;
  verificationSender?: AuthVerificationSender;
  now?: () => Date;
};

const genericInvalidCredentials = "Invalid email, username, or password.";
const DEFAULT_NEW_USER_INITIAL_CREDITS = 100;
const VERIFICATION_CODE_TTL_SECONDS = 10 * 60;
const VERIFICATION_CODE_MAX_ATTEMPTS = 5;
const REMEMBER_ME_SECONDS = AUTH_SESSION_TTL_SECONDS;

function envNumber(name: string, fallback: number, min: number, max: number) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.trunc(parsed), min), max);
}

function newUserInitialCredits() {
  const configured = envNumber("NEW_USER_INITIAL_CREDITS", DEFAULT_NEW_USER_INITIAL_CREDITS, 0, 100_000);
  return configured > 0 ? configured : DEFAULT_NEW_USER_INITIAL_CREDITS;
}

function failure(input: Omit<AuthFailure, "ok">): AuthFailure {
  return { ok: false, ...input };
}

function publicUser(user: AuthUser): PublicAuthUser {
  return {
    local_user_id: user.local_user_id,
    email: user.email,
    phone: user.phone,
    username: user.username,
    display_name: user.display_name,
    status: user.status,
    role: user.role,
  };
}

function tokenHash(token: string) {
  return sha256(`auth-session:${token}`);
}

function newSessionToken() {
  return randomBytes(32).toString("base64url");
}

function newVerificationCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function verificationCodeHash(input: {
  purpose: AuthVerificationPurpose;
  destination: string;
  code: string;
}) {
  return hmacSha256(`auth-verification:${input.purpose}:${input.destination}:${input.code}`);
}

function contextHash(value?: string) {
  return value ? sha256(value) : null;
}

function ipRateLimitKey(action: string, context: AuthRequestContext) {
  return `${action}:${context.ip || "unknown"}`;
}

function success(input: Omit<AuthSuccess, "ok">): AuthSuccess {
  return { ok: true, ...input };
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly userSyncService: Pick<NewApiUserSyncService, "ensureMapped">;
  private readonly loginLimiter: InMemoryRateLimiter;
  private readonly adminPasswordLimiter: InMemoryRateLimiter;
  private readonly registerLimiter: InMemoryRateLimiter;
  private readonly verificationLimiter: InMemoryRateLimiter;
  private readonly verificationSender: AuthVerificationSender;
  private readonly now: () => Date;

  constructor(dependencies: AuthServiceDependencies = {}) {
    let repository = dependencies.repository;
    let mappingRepository = dependencies.mappingRepository;
    if (!repository || !mappingRepository) {
      const persistence = createAuthPersistenceRepositories();
      repository = repository || persistence.authRepository;
      mappingRepository = mappingRepository || persistence.mappingRepository;
    }
    this.repository = repository;
    this.mappingRepository = mappingRepository;
    this.userSyncService = dependencies.userSyncService || createNewApiUserSyncService({
      repository: this.mappingRepository,
    });
    const limits = getWorkloadLimits();
    this.loginLimiter = dependencies.loginLimiter || new InMemoryRateLimiter(limits.failedLoginPerIp, limits.failedLoginWindowMs);
    this.adminPasswordLimiter = dependencies.adminPasswordLimiter || new InMemoryRateLimiter(
      limits.failedAdminPasswordPerIp,
      limits.failedAdminPasswordWindowMs,
    );
    this.registerLimiter = dependencies.registerLimiter || new InMemoryRateLimiter(limits.registerPerIp, limits.registerWindowMs);
    this.verificationLimiter = dependencies.verificationLimiter || new InMemoryRateLimiter(5, 10 * 60 * 1000);
    this.verificationSender = dependencies.verificationSender || sendAuthVerificationCode;
    this.now = dependencies.now || (() => new Date());
  }

  async requestVerificationCode(input: VerificationCodeInput, context: AuthRequestContext = {}): Promise<AuthActionResult> {
    const purpose = input.purpose;
    if (purpose !== "register" && purpose !== "password_reset" && purpose !== "login") {
      return failure({
        status: 400,
        code: "AUTH_VALIDATION_ERROR",
        uiState: "validation_error",
        message: "Verification purpose is invalid.",
      });
    }

    const destination = normalizeEmail(input.identifier || "");
    if (!isValidEmail(destination)) {
      return failure({
        status: 400,
        code: "AUTH_VALIDATION_ERROR",
        uiState: "validation_error",
        message: "Verification destination is invalid.",
      });
    }

    const destinationHash = sha256(destination);
    const existingUser = await this.repository.getUserByIdentifier(destination);
    if (purpose === "register" && existingUser) {
      await this.audit("auth.verification.duplicate", existingUser.local_user_id, context, { destination: destinationHash });
      return failure({
        status: 409,
        code: "AUTH_DUPLICATE_ACCOUNT",
        uiState: "validation_error",
        message: "Account already exists.",
      });
    }
    if (purpose === "password_reset" && !existingUser) {
      await this.audit("auth.password_reset.missing_user", null, context, { destination: destinationHash });
      return {
        ok: true,
        status: 200,
        uiState: "success",
        message: "If the account exists, a verification code will be sent.",
      };
    }
    if (purpose === "login" && !existingUser) {
      await this.audit("auth.login_code.missing_user", null, context, { destination: destinationHash });
      return {
        ok: true,
        status: 200,
        uiState: "success",
        message: "If the account exists, a verification code will be sent.",
      };
    }

    const rate = this.verificationLimiter.consume(
      `${purpose}:${context.ip || "unknown"}:${destinationHash}`,
      this.now(),
    );
    if (!rate.allowed) {
      return failure({
        status: 429,
        code: "AUTH_RATE_LIMITED",
        uiState: "rate_limited",
        message: "Too many verification code requests.",
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const code = newVerificationCode();
    try {
      await this.verificationSender({
        destination,
        channel: "email",
        purpose,
        code,
        expiresInSeconds: VERIFICATION_CODE_TTL_SECONDS,
      });
    } catch (error) {
      await this.audit("auth.verification.send_failed", existingUser?.local_user_id || null, context, {
        destination: destinationHash,
        reason: error instanceof AuthVerificationSendError ? error.code : "unknown",
      });
      return failure({
        status: 503,
        code: "AUTH_VERIFICATION_SEND_UNAVAILABLE",
        uiState: "service_unavailable",
        message: "Verification sender is unavailable.",
      });
    }

    const now = this.now();
    await this.repository.createVerificationCode({
      verification_id: randomUUID(),
      destination,
      channel: "email",
      purpose,
      code_hash: verificationCodeHash({ purpose, destination, code }),
      expires_at: nowIso(new Date(now.getTime() + VERIFICATION_CODE_TTL_SECONDS * 1000)),
      consumed_at: null,
      attempt_count: 0,
      send_count: 1,
      created_at: nowIso(now),
      updated_at: nowIso(now),
    });
    await this.audit("auth.verification.sent", existingUser?.local_user_id || null, context, {
      destination: destinationHash,
      purpose,
    });
    return {
      ok: true,
      status: 200,
      uiState: "success",
      message: "Verification code sent.",
    };
  }

  async register(input: RegisterInput, context: AuthRequestContext = {}): Promise<AuthResult> {
    const email = normalizeEmail(input.identifier || input.email || "");
    const redirectTo = safeRedirectPath(input.redirectTo);
    const limitKey = ipRateLimitKey("register", context);
    const rate = this.registerLimiter.consume(limitKey, this.now());
    if (!rate.allowed) {
      return failure({
        status: 429,
        code: "AUTH_RATE_LIMITED",
        uiState: "rate_limited",
        message: "Too many registration attempts.",
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    if (!isValidEmail(email)) {
      return failure({
        status: 400,
        code: "AUTH_VALIDATION_ERROR",
        uiState: "validation_error",
        message: "Registration input is invalid.",
      });
    }

    const normalizedUsername = input.username ? normalizeUsername(input.username) : "";
    const displayName = publicSafeString(input.displayName || input.username || normalizedUsername, 80);

    const passwordErrors = validatePasswordStrength(input.password || "");
    if (!isValidEmail(email) || !isValidUsername(normalizedUsername) || passwordErrors.length > 0) {
      return failure({
        status: 400,
        code: "AUTH_VALIDATION_ERROR",
        uiState: "validation_error",
        message: "Registration input is invalid.",
      });
    }

    if (
      await this.repository.getUserByIdentifier(email)
      || await this.repository.getUserByIdentifier(normalizedUsername)
    ) {
      await this.audit("auth.register.duplicate", null, context, { identifier: sha256(email) });
      return failure({
        status: 409,
        code: "AUTH_DUPLICATE_ACCOUNT",
        uiState: "validation_error",
        message: "Account already exists.",
      });
    }

    const verification = await this.consumeVerificationCode({
      destination: email,
      purpose: "register",
      code: input.verificationCode || "",
    });
    if (!verification.ok) return verification;

    const localUserId = randomUUID();
    let user: AuthUser;
    try {
      user = await this.repository.createUser({
        localUserId,
        email,
        phone: null,
        username: normalizedUsername,
        displayName,
        passwordHash: await hashPassword(input.password),
        status: "active",
        role: "user",
        now: this.now(),
      });
    } catch (error) {
      if (error instanceof AuthRepositoryError && error.code === "AUTH_DUPLICATE_ACCOUNT") {
        await this.audit("auth.register.duplicate", null, context, { identifier: sha256(email) });
        return failure({
          status: 409,
          code: "AUTH_DUPLICATE_ACCOUNT",
          uiState: "validation_error",
          message: "Account already exists.",
        });
      }
      throw error;
    }

    const mapping = await this.syncMappingForRegistration(user, input.password, context);
    if (!mapping) {
      await this.repository.updateUser(user.local_user_id, { status: "verification_required" }, this.now());
      await this.audit("auth.register.mapping_unavailable", user.local_user_id, context, {});
      return failure({
        status: 503,
        code: "AUTH_SERVICE_UNAVAILABLE",
        uiState: "service_unavailable",
        message: "Registration could not safely create a mapping.",
      });
    }

    const session = await this.createSession(user, context);
    const mappingStatus = mapping.mapping.sync_status;
    const uiState = mappingStatus === "active" ? "success" : "mapping_pending";
    await this.audit("auth.register.success", user.local_user_id, context, { mapping_status: mappingStatus });

    return success({
      status: uiState === "success" ? 201 : 202,
      uiState,
      user: publicUser(user),
      mappingStatus,
      session,
      redirectTo,
    });
  }

  async login(input: LoginInput, context: AuthRequestContext = {}): Promise<AuthResult> {
    const identifier = normalizeIdentifier(input.identifier || "");
    const redirectTo = safeRedirectPath(input.redirectTo);
    const loginMethod = input.loginMethod === "verification_code" ? "verification_code" : "password";
    const user = await this.repository.getUserByIdentifier(identifier);

    if (loginMethod === "verification_code") {
      if (!isValidEmail(identifier)) {
        return failure({
          status: 400,
          code: "AUTH_VALIDATION_ERROR",
          uiState: "validation_error",
          message: "Login input is invalid.",
        });
      }
      if (!user) {
        await this.audit("auth.login.failed", null, context, { reason: "missing_user_code", identifier: sha256(identifier) });
        return failure({
          status: 401,
          code: "AUTH_INVALID_CREDENTIALS",
          uiState: "invalid_credentials",
          message: genericInvalidCredentials,
        });
      }
      const verification = await this.consumeVerificationCode({
        destination: identifier,
        purpose: "login",
        code: input.verificationCode || "",
      });
      if (!verification.ok) return verification;
      return this.completeLogin(user, input, context, redirectTo);
    }

    const passwordOk = await verifyPassword(input.password || "", user?.password_hash);
    if (!user || !passwordOk) {
      await this.audit("auth.login.failed", user?.local_user_id || null, context, { reason: "invalid_credentials" });
      if (user?.role === "admin") {
        const adminRate = this.adminPasswordLimiter.consume(ipRateLimitKey("admin-password", context), this.now());
        if (!adminRate.allowed) {
          return failure({
            status: 429,
            code: "AUTH_RATE_LIMITED",
            uiState: "rate_limited",
            message: "Too many administrator password attempts.",
            retryAfterSeconds: adminRate.retryAfterSeconds,
          });
        }
      }
      const rate = this.loginLimiter.consume(ipRateLimitKey("login-failed", context), this.now());
      if (!rate.allowed) {
        return failure({
          status: 429,
          code: "AUTH_RATE_LIMITED",
          uiState: "rate_limited",
          message: "Too many login attempts.",
          retryAfterSeconds: rate.retryAfterSeconds,
        });
      }
      return failure({
        status: 401,
        code: "AUTH_INVALID_CREDENTIALS",
        uiState: "invalid_credentials",
        message: genericInvalidCredentials,
      });
    }

    return this.completeLogin(user, input, context, redirectTo);
  }

  private async completeLogin(
    user: AuthUser,
    input: Pick<LoginInput, "existingSessionToken" | "rememberMe">,
    context: AuthRequestContext,
    redirectTo: string,
  ): Promise<AuthResult> {
    if (user.status === "disabled") {
      await this.audit("auth.login.blocked", user.local_user_id, context, { reason: "disabled" });
      return failure({
        status: 403,
        code: "AUTH_ACCOUNT_DISABLED",
        uiState: "account_disabled",
        message: "Account is disabled.",
      });
    }

    if (user.status === "verification_required") {
      await this.audit("auth.login.blocked", user.local_user_id, context, { reason: "verification_required" });
      return failure({
        status: 403,
        code: "AUTH_VERIFICATION_REQUIRED",
        uiState: "verification_required",
        message: "Account requires verification.",
      });
    }

    if (input.existingSessionToken) {
      await this.logout(input.existingSessionToken, context);
    }
    const updatedUser = await this.repository.updateUser(
      user.local_user_id,
      { last_login_at: nowIso(this.now()) },
      this.now(),
    );
    const session = await this.createSession(updatedUser, context, Boolean(input.rememberMe));
    await this.audit("auth.login.success", user.local_user_id, context, {});

    return success({
      status: 200,
      uiState: "success",
      user: publicUser(updatedUser),
      mappingStatus: (await this.mappingRepository.getByLocalUserId(user.local_user_id))?.sync_status || null,
      session,
      redirectTo,
    });
  }

  async resetPassword(input: PasswordResetInput, context: AuthRequestContext = {}): Promise<AuthActionResult> {
    const account = normalizeEmail(input.identifier || "");
    const passwordErrors = validatePasswordStrength(input.password || "");
    if (!isValidEmail(account) || passwordErrors.length > 0) {
      return failure({
        status: 400,
        code: "AUTH_VALIDATION_ERROR",
        uiState: "validation_error",
        message: "Password reset input is invalid.",
      });
    }

    const user = await this.repository.getUserByIdentifier(account);
    if (!user) {
      await this.audit("auth.password_reset.failed", null, context, { reason: "missing_user", identifier: sha256(account) });
      return failure({
        status: 400,
        code: "AUTH_VERIFICATION_CODE_INVALID",
        uiState: "validation_error",
        message: "Verification code is invalid or expired.",
      });
    }

    const verification = await this.consumeVerificationCode({
      destination: account,
      purpose: "password_reset",
      code: input.verificationCode || "",
    });
    if (!verification.ok) return verification;

    await this.repository.updateUser(user.local_user_id, {
      password_hash: await hashPassword(input.password),
      session_version: user.session_version + 1,
    }, this.now());
    await this.audit("auth.password_reset.success", user.local_user_id, context, {});
    return {
      ok: true,
      status: 200,
      uiState: "success",
      message: "Password reset.",
    };
  }

  async currentUser(sessionToken?: string | null, context: AuthRequestContext = {}): Promise<AuthResult> {
    const resolved = await this.resolveSession(sessionToken, context);
    if (!resolved.ok) return resolved;
    return success({
      status: 200,
      uiState: "success",
      user: publicUser(resolved.user),
      mappingStatus: (await this.mappingRepository.getByLocalUserId(resolved.user.local_user_id))?.sync_status || null,
      session: null,
      redirectTo: "/",
    });
  }

  async refreshSession(sessionToken?: string | null, context: AuthRequestContext = {}): Promise<AuthResult> {
    const resolved = await this.resolveSession(sessionToken, context);
    if (!resolved.ok) return resolved;

    const now = this.now();
    const idleExpiresAt = new Date(now.getTime() + AUTH_SESSION_IDLE_SECONDS * 1000);
    const touched = await this.repository.touchSession(resolved.session.session_id, {
      updated_at: nowIso(now),
      last_seen_at: nowIso(now),
      idle_expires_at: nowIso(idleExpiresAt),
    });
    await this.audit("auth.session.refresh", resolved.user.local_user_id, context, {});
    return success({
      status: 200,
      uiState: "success",
      user: publicUser(resolved.user),
      mappingStatus: (await this.mappingRepository.getByLocalUserId(resolved.user.local_user_id))?.sync_status || null,
      session: {
        token: sessionToken || "",
        session: touched,
        cookieMaxAgeSeconds: AUTH_SESSION_IDLE_SECONDS,
      },
      redirectTo: "/",
    });
  }

  async logout(sessionToken?: string | null, context: AuthRequestContext = {}): Promise<AuthActionResult> {
    if (sessionToken) {
      const session = await this.repository.getSessionByTokenHash(tokenHash(sessionToken));
      if (session) {
        await this.repository.revokeSession(session.session_id, this.now());
        await this.audit("auth.logout", session.local_user_id, context, {});
      }
    }
    return {
      ok: true,
      status: 200,
      uiState: "success",
      message: "Logged out.",
    };
  }

  private async syncMappingForRegistration(user: AuthUser, passwordSeed: string, context: AuthRequestContext) {
    try {
      return await this.userSyncService.ensureMapped({
        localUserId: user.local_user_id,
        email: user.email,
        username: user.username,
        displayName: user.display_name,
        initialQuota: newUserInitialCredits(),
      }, {
        idempotencyKey: `register:${user.local_user_id}`,
        passwordSeed: sha256(`${user.local_user_id}:${passwordSeed}`).slice(0, 16),
      });
    } catch (error) {
      await this.audit("auth.register.mapping_exception", user.local_user_id, context, {
        error: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      });
      return null;
    }
  }

  private async consumeVerificationCode(input: {
    destination: string;
    purpose: AuthVerificationPurpose;
    code: string;
  }): Promise<AuthActionResult> {
    const submitted = input.code.trim();
    if (!/^\d{6}$/.test(submitted)) {
      return failure({
        status: 400,
        code: "AUTH_VERIFICATION_CODE_INVALID",
        uiState: "validation_error",
        message: "Verification code is invalid or expired.",
      });
    }

    const stored = await this.repository.getLatestVerificationCode({
      destination: input.destination,
      purpose: input.purpose,
    });
    const now = this.now();
    const invalid = !stored
      || Date.parse(stored.expires_at) <= now.getTime()
      || stored.attempt_count >= VERIFICATION_CODE_MAX_ATTEMPTS;

    if (invalid) {
      if (stored && !stored.consumed_at) {
        await this.repository.touchVerificationCode(stored.verification_id, {
          consumed_at: nowIso(now),
          updated_at: nowIso(now),
        });
      }
      return failure({
        status: 400,
        code: "AUTH_VERIFICATION_CODE_INVALID",
        uiState: "validation_error",
        message: "Verification code is invalid or expired.",
      });
    }

    const expected = verificationCodeHash({
      purpose: input.purpose,
      destination: input.destination,
      code: submitted,
    });
    if (!timingSafeStringEqual(expected, stored.code_hash)) {
      await this.repository.touchVerificationCode(stored.verification_id, {
        attempt_count: stored.attempt_count + 1,
        updated_at: nowIso(now),
      });
      return failure({
        status: 400,
        code: "AUTH_VERIFICATION_CODE_INVALID",
        uiState: "validation_error",
        message: "Verification code is invalid or expired.",
      });
    }

    await this.repository.touchVerificationCode(stored.verification_id, {
      attempt_count: stored.attempt_count + 1,
      consumed_at: nowIso(now),
      updated_at: nowIso(now),
    });
    return {
      ok: true,
      status: 200,
      uiState: "success",
      message: "Verification code accepted.",
    };
  }

  private async createSession(user: AuthUser, context: AuthRequestContext, rememberMe = false): Promise<AuthSessionPayload> {
    const now = this.now();
    const token = newSessionToken();
    const idleSeconds = rememberMe ? REMEMBER_ME_SECONDS : AUTH_SESSION_IDLE_SECONDS;
    const session: AuthSession = {
      session_id: randomUUID(),
      local_user_id: user.local_user_id,
      token_hash: tokenHash(token),
      session_version: user.session_version,
      created_at: nowIso(now),
      updated_at: nowIso(now),
      last_seen_at: nowIso(now),
      idle_expires_at: nowIso(new Date(now.getTime() + idleSeconds * 1000)),
      expires_at: nowIso(new Date(now.getTime() + AUTH_SESSION_TTL_SECONDS * 1000)),
      revoked_at: null,
      user_agent_hash: contextHash(context.userAgent),
      ip_hash: contextHash(context.ip),
    };
    return {
      token,
      session: await this.repository.createSession(session),
      cookieMaxAgeSeconds: idleSeconds,
    };
  }

  private async resolveSession(
    sessionToken?: string | null,
    context: AuthRequestContext = {},
  ): Promise<{ ok: true; session: AuthSession; user: AuthUser } | AuthFailure> {
    if (!sessionToken) {
      return failure({
        status: 401,
        code: "AUTH_SESSION_EXPIRED",
        uiState: "session_expired",
        message: "Session is missing or expired.",
      });
    }

    const session = await this.repository.getSessionByTokenHash(tokenHash(sessionToken));
    const now = this.now().getTime();
    if (!session || session.revoked_at || Date.parse(session.expires_at) <= now || Date.parse(session.idle_expires_at) <= now) {
      await this.audit("auth.session.expired", session?.local_user_id || null, context, {});
      return failure({
        status: 401,
        code: "AUTH_SESSION_EXPIRED",
        uiState: "session_expired",
        message: "Session is missing or expired.",
      });
    }

    const user = await this.repository.getUserById(session.local_user_id);
    if (!user || user.session_version !== session.session_version) {
      await this.audit("auth.session.version_mismatch", session.local_user_id, context, {});
      return failure({
        status: 401,
        code: "AUTH_SESSION_EXPIRED",
        uiState: "session_expired",
        message: "Session is missing or expired.",
      });
    }
    if (user.status === "disabled") {
      await this.audit("auth.session.blocked", user.local_user_id, context, { reason: "disabled" });
      return failure({
        status: 403,
        code: "AUTH_ACCOUNT_DISABLED",
        uiState: "account_disabled",
        message: "Account is disabled.",
      });
    }
    if (user.status === "verification_required") {
      await this.audit("auth.session.blocked", user.local_user_id, context, { reason: "verification_required" });
      return failure({
        status: 403,
        code: "AUTH_VERIFICATION_REQUIRED",
        uiState: "verification_required",
        message: "Account requires verification.",
      });
    }
    return { ok: true, session, user };
  }

  private async audit(
    event: string,
    localUserId: string | null,
    context: AuthRequestContext,
    details: Record<string, string | number | boolean | null>,
  ) {
    const auditEvent: AuthAuditEvent = {
      id: randomUUID(),
      event,
      local_user_id: localUserId,
      created_at: nowIso(this.now()),
      request_id: context.requestId || null,
      ip_hash: contextHash(context.ip),
      user_agent_hash: contextHash(context.userAgent),
      details,
    };
    await this.repository.appendAudit(auditEvent);
  }
}

let defaultAuthService: AuthService | null = null;

export function createAuthService(dependencies?: AuthServiceDependencies) {
  return new AuthService(dependencies);
}

export function getAuthService() {
  if (!defaultAuthService) {
    const persistence = createAuthPersistenceRepositories();
    defaultAuthService = new AuthService({
      repository: persistence.authRepository,
      mappingRepository: persistence.mappingRepository,
      userSyncService: createNewApiUserSyncService({ repository: persistence.mappingRepository }),
    });
  }
  return defaultAuthService;
}
