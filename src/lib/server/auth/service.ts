import { randomBytes, randomUUID } from "node:crypto";

import {
  createJsonNewApiUserMappingRepository,
  createNewApiUserSyncService,
  type NewApiUserMappingRepository,
  type NewApiUserSyncService,
} from "../integrations/new-api";
import { hashPassword, validatePasswordStrength, verifyPassword } from "./password";
import { InMemoryRateLimiter } from "./rate-limit";
import {
  createJsonAuthRepository,
  AuthRepositoryError,
  type AuthRepository,
} from "./repository";
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
  usernameFromEmail,
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
  type AuthUser,
  type PublicAuthUser,
} from "./types";

export type RegisterInput = {
  email: string;
  password: string;
  username?: string;
  displayName?: string;
  redirectTo?: string;
};

export type LoginInput = {
  identifier: string;
  password: string;
  existingSessionToken?: string | null;
  redirectTo?: string;
};

export type AuthServiceDependencies = {
  repository?: AuthRepository;
  mappingRepository?: NewApiUserMappingRepository;
  userSyncService?: NewApiUserSyncService;
  loginLimiter?: InMemoryRateLimiter;
  registerLimiter?: InMemoryRateLimiter;
  now?: () => Date;
};

const genericInvalidCredentials = "Invalid email, username, or password.";

function failure(input: Omit<AuthFailure, "ok">): AuthFailure {
  return { ok: false, ...input };
}

function publicUser(user: AuthUser): PublicAuthUser {
  return {
    local_user_id: user.local_user_id,
    email: user.email,
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

function contextHash(value?: string) {
  return value ? sha256(value) : null;
}

function rateLimitKey(action: string, identifier: string, context: AuthRequestContext) {
  return `${action}:${context.ip || "unknown"}:${normalizeIdentifier(identifier || "anonymous")}`;
}

function success(input: Omit<AuthSuccess, "ok">): AuthSuccess {
  return { ok: true, ...input };
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly mappingRepository: NewApiUserMappingRepository;
  private readonly userSyncService: NewApiUserSyncService;
  private readonly loginLimiter: InMemoryRateLimiter;
  private readonly registerLimiter: InMemoryRateLimiter;
  private readonly now: () => Date;

  constructor(dependencies: AuthServiceDependencies = {}) {
    this.repository = dependencies.repository || createJsonAuthRepository();
    this.mappingRepository = dependencies.mappingRepository || createJsonNewApiUserMappingRepository();
    this.userSyncService = dependencies.userSyncService || createNewApiUserSyncService({
      repository: this.mappingRepository,
    });
    this.loginLimiter = dependencies.loginLimiter || new InMemoryRateLimiter(5, 10 * 60 * 1000);
    this.registerLimiter = dependencies.registerLimiter || new InMemoryRateLimiter(3, 60 * 60 * 1000);
    this.now = dependencies.now || (() => new Date());
  }

  async register(input: RegisterInput, context: AuthRequestContext = {}): Promise<AuthResult> {
    const email = normalizeEmail(input.email || "");
    const normalizedUsername = input.username
      ? normalizeUsername(input.username)
      : `${usernameFromEmail(email)}-${sha256(email).slice(0, 6)}`.slice(0, 32);
    const displayName = publicSafeString(input.displayName || normalizedUsername, 80);
    const redirectTo = safeRedirectPath(input.redirectTo);
    const limitKey = rateLimitKey("register", email || normalizedUsername, context);
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

    const localUserId = randomUUID();
    let user: AuthUser;
    try {
      user = await this.repository.createUser({
        localUserId,
        email,
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
    const limitKey = rateLimitKey("login", identifier, context);
    const rate = this.loginLimiter.consume(limitKey, this.now());
    if (!rate.allowed) {
      return failure({
        status: 429,
        code: "AUTH_RATE_LIMITED",
        uiState: "rate_limited",
        message: "Too many login attempts.",
        retryAfterSeconds: rate.retryAfterSeconds,
      });
    }

    const user = await this.repository.getUserByIdentifier(identifier);
    const passwordOk = await verifyPassword(input.password || "", user?.password_hash);
    if (!user || !passwordOk) {
      await this.audit("auth.login.failed", user?.local_user_id || null, context, { reason: "invalid_credentials" });
      return failure({
        status: 401,
        code: "AUTH_INVALID_CREDENTIALS",
        uiState: "invalid_credentials",
        message: genericInvalidCredentials,
      });
    }

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
    const session = await this.createSession(updatedUser, context);
    this.loginLimiter.reset(limitKey);
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
        initialQuota: 0,
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

  private async createSession(user: AuthUser, context: AuthRequestContext): Promise<AuthSessionPayload> {
    const now = this.now();
    const token = newSessionToken();
    const session: AuthSession = {
      session_id: randomUUID(),
      local_user_id: user.local_user_id,
      token_hash: tokenHash(token),
      session_version: user.session_version,
      created_at: nowIso(now),
      updated_at: nowIso(now),
      last_seen_at: nowIso(now),
      idle_expires_at: nowIso(new Date(now.getTime() + AUTH_SESSION_IDLE_SECONDS * 1000)),
      expires_at: nowIso(new Date(now.getTime() + AUTH_SESSION_TTL_SECONDS * 1000)),
      revoked_at: null,
      user_agent_hash: contextHash(context.userAgent),
      ip_hash: contextHash(context.ip),
    };
    return {
      token,
      session: await this.repository.createSession(session),
      cookieMaxAgeSeconds: AUTH_SESSION_IDLE_SECONDS,
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

const defaultAuthRepository = createJsonAuthRepository();
const defaultMappingRepository = createJsonNewApiUserMappingRepository();
const defaultAuthService = new AuthService({
  repository: defaultAuthRepository,
  mappingRepository: defaultMappingRepository,
  userSyncService: createNewApiUserSyncService({ repository: defaultMappingRepository }),
});

export function createAuthService(dependencies?: AuthServiceDependencies) {
  return new AuthService(dependencies);
}

export function getAuthService() {
  return defaultAuthService;
}
