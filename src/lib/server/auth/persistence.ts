import {
  createJsonNewApiUserMappingRepository,
  type NewApiUserMappingRepository,
} from "../integrations/new-api/user-mapping";
import { getJsonAuthDualRepairRepository, redactedAuthDualRepairKey, sanitizeAuthDualRepairError } from "./dual-repair";
import { createJsonAuthRepository, type AuthRepository } from "./repository";

export type AuthPersistenceMode = "json" | "dual" | "postgres";

export class AuthPersistenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthPersistenceConfigError";
  }
}

export type AuthPersistenceRepositories = {
  mode: AuthPersistenceMode;
  authRepository: AuthRepository;
  mappingRepository: NewApiUserMappingRepository;
};

const allowedModes = new Set<AuthPersistenceMode>(["json", "dual", "postgres"]);

function rawMode() {
  return process.env.APP_AUTH_PERSISTENCE_MODE?.trim().toLowerCase();
}

export function getAuthPersistenceMode(): AuthPersistenceMode {
  const raw = rawMode();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new AuthPersistenceConfigError("APP_AUTH_PERSISTENCE_MODE must be explicitly set in production.");
    }
    return "json";
  }
  if (!allowedModes.has(raw as AuthPersistenceMode)) {
    throw new AuthPersistenceConfigError("APP_AUTH_PERSISTENCE_MODE must be json, dual, or postgres.");
  }
  return raw as AuthPersistenceMode;
}

export function createAuthPersistenceRepositories(
  mode: AuthPersistenceMode = getAuthPersistenceMode(),
): AuthPersistenceRepositories {
  if (mode === "json") {
    return {
      mode,
      authRepository: createJsonAuthRepository(),
      mappingRepository: createJsonNewApiUserMappingRepository(),
    };
  }

  if (mode === "postgres") {
    return {
      mode,
      authRepository: loadPostgresAuthRepository(),
      mappingRepository: loadPostgresMappingRepository(),
    };
  }

  const jsonAuthRepository = createJsonAuthRepository();
  const postgresAuthRepository = loadPostgresAuthRepository();
  const jsonMappingRepository = createJsonNewApiUserMappingRepository();
  const postgresMappingRepository = loadPostgresMappingRepository();

  return {
    mode,
    authRepository: createDualAuthRepository(jsonAuthRepository, postgresAuthRepository),
    mappingRepository: createDualNewApiUserMappingRepository(jsonMappingRepository, postgresMappingRepository),
  };
}

function serverRequire<T>(path: string): T {
  const requireFn = (0, eval)("require") as NodeRequire;
  return requireFn(path) as T;
}

function loadPostgresAuthRepository() {
  const postgresRepositoryModule = serverRequire<typeof import("./postgres-repository")>("./postgres-repository");
  return postgresRepositoryModule.createPostgresAuthRepository();
}

function loadPostgresMappingRepository() {
  const postgresMappingModule = serverRequire<typeof import("../integrations/new-api/postgres-user-mapping")>(
    "../integrations/new-api/postgres-user-mapping",
  );
  return postgresMappingModule.createPostgresNewApiUserMappingRepository();
}

function warnDualMismatch(scope: string, key: string, jsonValue: unknown, postgresValue: unknown) {
  console.warn(JSON.stringify({
    event: "auth.persistence.dual_mismatch",
    scope,
    key: redactedAuthDualRepairKey(key),
    json: stableComparable(jsonValue),
    postgres: stableComparable(postgresValue),
  }));
}

function stableComparable(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.password_hash;
  delete copy.token_hash;
  delete copy.last_error_message;
  delete copy.details;
  return copy;
}

async function recordShadowFailure(scope: string, operation: string, key: string | number | null | undefined, error: unknown) {
  try {
    const dualRepairRepository = getJsonAuthDualRepairRepository();
    const record = await dualRepairRepository.recordFailure({ scope, operation, key, error });
    console.warn(JSON.stringify({
      event: "auth.persistence.dual_shadow_failure",
      scope,
      operation,
      repair_record_id: record.id,
      key: record.redacted_key,
      error_code: record.last_error_code,
    }));
  } catch (recordError) {
    console.error(JSON.stringify({
      event: "auth.persistence.dual_repair_record_failed",
      severity: "critical",
      scope,
      operation,
      key: redactedAuthDualRepairKey(key),
      shadow_error: sanitizeAuthDualRepairError(error),
      repair_error: sanitizeAuthDualRepairError(recordError),
    }));
  }
}

async function compareShadow<T>(
  scope: string,
  operation: string,
  key: string,
  primaryValue: T,
  shadow: () => Promise<unknown>,
  differs: (primaryValue: T, shadowValue: unknown) => boolean,
) {
  try {
    const shadowValue = await shadow();
    if (differs(primaryValue, shadowValue)) {
      warnDualMismatch(scope, key, primaryValue, shadowValue);
    }
  } catch (error) {
    await recordShadowFailure(scope, operation, key, error);
  }
}

async function mirrorWrite<T>(
  primary: Promise<T>,
  input: {
    scope: string;
    operation: string;
    key: (result: T) => string | number | null | undefined;
    mirror: (result: T) => Promise<unknown>;
  },
) {
  const result = await primary;
  try {
    await input.mirror(result);
  } catch (error) {
    await recordShadowFailure(input.scope, input.operation, input.key(result), error);
  }
  return result;
}

export function createDualAuthRepository(json: AuthRepository, postgres: AuthRepository): AuthRepository {
  return {
    async getUserById(localUserId) {
      const jsonUser = await json.getUserById(localUserId);
      await compareShadow(
        "auth_user",
        "getUserById",
        localUserId,
        jsonUser,
        () => postgres.getUserById(localUserId),
        (primary, shadow) => primary?.local_user_id !== (shadow as Awaited<ReturnType<AuthRepository["getUserById"]>>)?.local_user_id,
      );
      return jsonUser;
    },
    async getUserByIdentifier(identifier) {
      const jsonUser = await json.getUserByIdentifier(identifier);
      await compareShadow(
        "auth_user_identifier",
        "getUserByIdentifier",
        identifier,
        jsonUser,
        () => postgres.getUserByIdentifier(identifier),
        (primary, shadow) => primary?.local_user_id !== (shadow as Awaited<ReturnType<AuthRepository["getUserByIdentifier"]>>)?.local_user_id,
      );
      return jsonUser;
    },
    async createUser(input) {
      return mirrorWrite(
        json.createUser(input),
        {
          scope: "auth_user",
          operation: "createUser",
          key: (user) => user.local_user_id,
          mirror: () => postgres.createUser(input),
        },
      );
    },
    async updateUser(localUserId, patch, now) {
      return mirrorWrite(
        json.updateUser(localUserId, patch, now),
        {
          scope: "auth_user",
          operation: "updateUser",
          key: () => localUserId,
          mirror: () => postgres.updateUser(localUserId, patch, now),
        },
      );
    },
    async createSession(session) {
      return mirrorWrite(
        json.createSession(session),
        {
          scope: "auth_session",
          operation: "createSession",
          key: (created) => created.session_id,
          mirror: () => postgres.createSession(session),
        },
      );
    },
    async getSessionByTokenHash(tokenHash) {
      const jsonSession = await json.getSessionByTokenHash(tokenHash);
      await compareShadow(
        "auth_session",
        "getSessionByTokenHash",
        tokenHash,
        jsonSession,
        () => postgres.getSessionByTokenHash(tokenHash),
        (primary, shadow) => primary?.session_id !== (shadow as Awaited<ReturnType<AuthRepository["getSessionByTokenHash"]>>)?.session_id,
      );
      return jsonSession;
    },
    async touchSession(sessionId, patch) {
      return mirrorWrite(
        json.touchSession(sessionId, patch),
        {
          scope: "auth_session",
          operation: "touchSession",
          key: () => sessionId,
          mirror: () => postgres.touchSession(sessionId, patch),
        },
      );
    },
    async revokeSession(sessionId, now) {
      return mirrorWrite(
        json.revokeSession(sessionId, now),
        {
          scope: "auth_session",
          operation: "revokeSession",
          key: () => sessionId,
          mirror: () => postgres.revokeSession(sessionId, now),
        },
      );
    },
    async appendAudit(event) {
      await mirrorWrite(
        json.appendAudit(event),
        {
          scope: "auth_audit",
          operation: "appendAudit",
          key: () => event.id,
          mirror: () => postgres.appendAudit(event),
        },
      );
    },
    async listAuditEvents() {
      return json.listAuditEvents();
    },
  };
}

export function createDualNewApiUserMappingRepository(
  json: NewApiUserMappingRepository,
  postgres: NewApiUserMappingRepository,
): NewApiUserMappingRepository {
  return {
    async getByLocalUserId(localUserId) {
      const jsonMapping = await json.getByLocalUserId(localUserId);
      await compareShadow(
        "new_api_mapping",
        "getByLocalUserId",
        localUserId,
        jsonMapping,
        () => postgres.getByLocalUserId(localUserId),
        (primary, shadow) => (
          primary?.new_api_user_id !== (shadow as Awaited<ReturnType<NewApiUserMappingRepository["getByLocalUserId"]>>)?.new_api_user_id
          || primary?.sync_status !== (shadow as Awaited<ReturnType<NewApiUserMappingRepository["getByLocalUserId"]>>)?.sync_status
        ),
      );
      return jsonMapping;
    },
    async getByNewApiUserId(newApiUserId) {
      const jsonMapping = await json.getByNewApiUserId(newApiUserId);
      await compareShadow(
        "new_api_mapping_upstream",
        "getByNewApiUserId",
        String(newApiUserId),
        jsonMapping,
        () => postgres.getByNewApiUserId(newApiUserId),
        (primary, shadow) => primary?.local_user_id !== (shadow as Awaited<ReturnType<NewApiUserMappingRepository["getByNewApiUserId"]>>)?.local_user_id,
      );
      return jsonMapping;
    },
    async listByStatus(status) {
      return json.listByStatus(status);
    },
    async createPending(input) {
      return mirrorWrite(json.createPending(input), {
        scope: "new_api_mapping",
        operation: "createPending",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.createPending(input),
      });
    },
    async markActive(input) {
      return mirrorWrite(json.markActive(input), {
        scope: "new_api_mapping",
        operation: "markActive",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.markActive(input),
      });
    },
    async markFailed(input) {
      return mirrorWrite(json.markFailed(input), {
        scope: "new_api_mapping",
        operation: "markFailed",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.markFailed(input),
      });
    },
    async markDisabled(input) {
      return mirrorWrite(json.markDisabled(input), {
        scope: "new_api_mapping",
        operation: "markDisabled",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.markDisabled(input),
      });
    },
    async markOrphaned(input) {
      return mirrorWrite(json.markOrphaned(input), {
        scope: "new_api_mapping",
        operation: "markOrphaned",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.markOrphaned(input),
      });
    },
    async scheduleRepair(input) {
      return mirrorWrite(json.scheduleRepair(input), {
        scope: "new_api_mapping",
        operation: "scheduleRepair",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.scheduleRepair(input),
      });
    },
    async prepareRetry(input) {
      return mirrorWrite(json.prepareRetry(input), {
        scope: "new_api_mapping",
        operation: "prepareRetry",
        key: (mapping) => mapping.local_user_id,
        mirror: () => postgres.prepareRetry(input),
      });
    },
  };
}
