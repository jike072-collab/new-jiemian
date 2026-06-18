import { createHash, randomUUID } from "node:crypto";

import { adminCreateUser, adminGetUsers, type NewApiUserRecord } from "./admin";
import { isNewApiError } from "./errors";
import {
  createJsonNewApiUserMappingRepository,
  NewApiUserMappingError,
  type NewApiUserMapping,
  type NewApiUserMappingRepository,
} from "./user-mapping";

export type NewApiUserSyncProfile = {
  localUserId: string;
  email?: string;
  username?: string;
  displayName?: string;
  group?: string;
  initialQuota?: number;
};

export type NewApiUserSyncOptions = {
  maxRetryCount?: number;
  idempotencyKey?: string;
  passwordSeed?: string;
};

export type NewApiUserSyncResult = {
  mapping: NewApiUserMapping;
  action:
    | "already_active"
    | "created_upstream"
    | "linked_existing"
    | "failed_retryable"
    | "repair_required";
};

export type NewApiUserSyncDependencies = {
  repository?: NewApiUserMappingRepository;
  createUser?: typeof adminCreateUser;
  listUsers?: typeof adminGetUsers;
};

type UpstreamCreateResult =
  | { kind: "created"; user: NewApiUserRecord }
  | { kind: "duplicate"; user: NewApiUserRecord | null }
  | { kind: "retryable_failure"; code: string; message: string }
  | { kind: "repair_required"; code: string; message: string };

const DEFAULT_GROUP = "default";
const MAX_NEW_API_USER_FIELD_LENGTH = 20;

function shortenValue(raw: string, seed: string, maxLength = MAX_NEW_API_USER_FIELD_LENGTH, lowerCase = true) {
  const normalized = raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^A-Za-z0-9_.@ -]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const candidate = lowerCase ? normalized.toLowerCase() : normalized;
  if (!candidate) return `local-${stableHash(seed).slice(0, Math.max(8, maxLength - 6))}`.slice(0, maxLength);
  if (candidate.length <= maxLength) return candidate;
  const hash = stableHash(seed).slice(0, 8);
  const prefixLength = Math.max(1, maxLength - hash.length - 1);
  return `${candidate.slice(0, prefixLength)}-${hash}`.slice(0, maxLength);
}

function normalizeUsername(profile: NewApiUserSyncProfile) {
  const raw = profile.username || profile.email || profile.localUserId;
  return shortenValue(raw, `${profile.localUserId}:username`);
}

function normalizeDisplayName(profile: NewApiUserSyncProfile) {
  const raw = profile.displayName || profile.email || profile.localUserId;
  return shortenValue(raw, `${profile.localUserId}:displayName`, MAX_NEW_API_USER_FIELD_LENGTH, false);
}

function stableHash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function generatedPassword(profile: NewApiUserSyncProfile, options: NewApiUserSyncOptions) {
  const seed = options.passwordSeed || randomUUID();
  return `napi_${stableHash(`${profile.localUserId}:${seed}`).slice(0, 32)}A1!`;
}

function extractUsers(payload: Awaited<ReturnType<typeof adminGetUsers>>["data"]) {
  const candidates = payload.data || payload.users || [];
  return Array.isArray(candidates) ? candidates : [];
}

function extractCreatedUser(payload: Awaited<ReturnType<typeof adminCreateUser>>["data"]) {
  const data = payload.data;
  if (data && typeof data.id === "number") return data;
  return null;
}

function sameIdentity(user: NewApiUserRecord, profile: NewApiUserSyncProfile) {
  const username = normalizeUsername(profile);
  const email = profile.email?.trim().toLowerCase();
  return user.username?.trim().toLowerCase() === username
    || Boolean(email && user.email?.trim().toLowerCase() === email);
}

function isRetryableError(error: unknown) {
  if (isNewApiError(error)) return error.retryable || error.code === "NEW_API_TIMEOUT" || error.code === "NEW_API_NETWORK";
  return false;
}

function errorCode(error: unknown) {
  if (isNewApiError(error)) return error.code;
  if (error instanceof NewApiUserMappingError) return error.code;
  if (error instanceof Error) return error.name || "UNKNOWN_ERROR";
  return "UNKNOWN_ERROR";
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "New API user sync failed.";
}

async function findUpstreamUser(
  profile: NewApiUserSyncProfile,
  listUsers: typeof adminGetUsers,
) {
  const response = await listUsers();
  return extractUsers(response.data).find((user) => sameIdentity(user, profile)) || null;
}

async function createOrFindUpstreamUser(
  profile: NewApiUserSyncProfile,
  options: NewApiUserSyncOptions,
  createUser: typeof adminCreateUser,
  listUsers: typeof adminGetUsers,
): Promise<UpstreamCreateResult> {
  try {
    const response = await createUser({
      username: normalizeUsername(profile),
      password: generatedPassword(profile, options),
      display_name: normalizeDisplayName(profile),
      email: profile.email,
      group: profile.group || DEFAULT_GROUP,
      quota: profile.initialQuota ?? 0,
    });
    const user = extractCreatedUser(response.data);
    if (user) return { kind: "created", user };
    const existing = await findUpstreamUser(profile, listUsers);
    if (existing) return { kind: "duplicate", user: existing };
    return {
      kind: "repair_required",
      code: "NEW_API_USER_CREATE_EMPTY",
      message: "New API user creation returned no usable user id.",
    };
  } catch (error) {
    if (isNewApiError(error) && error.upstreamStatus === 409) {
      const existing = await findUpstreamUser(profile, listUsers).catch(() => null);
      return { kind: "duplicate", user: existing };
    }
    if (isRetryableError(error)) {
      const existing = await findUpstreamUser(profile, listUsers).catch(() => null);
      if (existing) return { kind: "duplicate", user: existing };
      return { kind: "retryable_failure", code: errorCode(error), message: errorMessage(error) };
    }
    return { kind: "repair_required", code: errorCode(error), message: errorMessage(error) };
  }
}

export class NewApiUserSyncService {
  private readonly repository: NewApiUserMappingRepository;
  private readonly createUser: typeof adminCreateUser;
  private readonly listUsers: typeof adminGetUsers;
  private readonly inFlight = new Map<string, Promise<NewApiUserSyncResult>>();

  constructor(dependencies: NewApiUserSyncDependencies = {}) {
    this.repository = dependencies.repository || createJsonNewApiUserMappingRepository();
    this.createUser = dependencies.createUser || adminCreateUser;
    this.listUsers = dependencies.listUsers || adminGetUsers;
  }

  async ensureMapped(
    profile: NewApiUserSyncProfile,
    options: NewApiUserSyncOptions = {},
  ): Promise<NewApiUserSyncResult> {
    const localUserId = profile.localUserId.trim();
    const pending = this.inFlight.get(localUserId);
    if (pending) return pending;

    const promise = this.ensureMappedOnce(profile, options);
    this.inFlight.set(localUserId, promise);
    try {
      return await promise;
    } finally {
      this.inFlight.delete(localUserId);
    }
  }

  private async ensureMappedOnce(
    profile: NewApiUserSyncProfile,
    options: NewApiUserSyncOptions,
  ): Promise<NewApiUserSyncResult> {
    const existing = await this.repository.getByLocalUserId(profile.localUserId);
    if (existing?.sync_status === "active" && existing.new_api_user_id) {
      return { mapping: existing, action: "already_active" };
    }

    const mapping = existing || await this.repository.createPending({
      localUserId: profile.localUserId,
      idempotencyKey: options.idempotencyKey,
    });

    const prepared = mapping.sync_status === "pending"
      ? mapping
      : await this.repository.prepareRetry({
          localUserId: profile.localUserId,
          maxRetryCount: options.maxRetryCount,
          expectedVersion: mapping.version,
        });

    const upstream = await createOrFindUpstreamUser(profile, options, this.createUser, this.listUsers);
    if (upstream.kind === "created" || upstream.kind === "duplicate") {
      if (!upstream.user) {
        const repair = await this.repository.markFailed({
          localUserId: profile.localUserId,
          code: "NEW_API_USER_DUPLICATE_UNCONFIRMED",
          message: "New API reported a duplicate user but the existing user could not be confirmed.",
          retryable: false,
          maxRetryCount: options.maxRetryCount,
          expectedVersion: prepared.version,
        });
        return { mapping: repair, action: "repair_required" };
      }

      const upstreamUser = upstream.user;
      const latest = await this.repository.getByLocalUserId(profile.localUserId);
      const upstreamUserId = String(upstreamUser.id);
      if (latest?.sync_status === "active" && latest.new_api_user_id === upstreamUserId) {
        return { mapping: latest, action: "already_active" };
      }

      try {
        const active = await this.repository.markActive({
          localUserId: profile.localUserId,
          newApiUserId: upstreamUserId,
          expectedVersion: latest?.version ?? prepared.version,
        });
        return {
          mapping: active,
          action: upstream.kind === "created" ? "created_upstream" : "linked_existing",
        };
      } catch (error) {
        const current = await this.repository.getByLocalUserId(profile.localUserId);
        if (current?.sync_status === "active" && current.new_api_user_id === upstreamUserId) {
          return { mapping: current, action: "already_active" };
        }
        const repair = await this.repository.scheduleRepair({
          localUserId: profile.localUserId,
          code: errorCode(error),
          message: `New API user ${upstreamUserId} exists but local mapping could not be safely activated.`,
          expectedVersion: current?.version,
        });
        return { mapping: repair, action: "repair_required" };
      }
    }

    if (upstream.kind === "retryable_failure") {
      const failed = await this.repository.markFailed({
        localUserId: profile.localUserId,
        code: upstream.code,
        message: upstream.message,
        retryable: true,
        maxRetryCount: options.maxRetryCount,
        expectedVersion: prepared.version,
      });
      return {
        mapping: failed,
        action: failed.sync_status === "failed" ? "failed_retryable" : "repair_required",
      };
    }

    const repair = await this.repository.markFailed({
      localUserId: profile.localUserId,
      code: upstream.code,
      message: upstream.message,
      retryable: false,
      maxRetryCount: options.maxRetryCount,
      expectedVersion: prepared.version,
    });
    return { mapping: repair, action: "repair_required" };
  }
}

export function createNewApiUserSyncService(dependencies?: NewApiUserSyncDependencies) {
  return new NewApiUserSyncService(dependencies);
}
