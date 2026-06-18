import {
  createJsonNewApiUserMappingRepository,
  type NewApiUserMappingRepository,
} from "../integrations/new-api/user-mapping";
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
    key: redactedKey(key),
    json: stableComparable(jsonValue),
    postgres: stableComparable(postgresValue),
  }));
}

function redactedKey(value: string) {
  return value.length <= 8 ? "[REDACTED]" : `${value.slice(0, 4)}...${value.slice(-4)}`;
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

async function mirrorWrite<T>(primary: Promise<T>, mirror: () => Promise<unknown>) {
  const result = await primary;
  await mirror();
  return result;
}

function createDualAuthRepository(json: AuthRepository, postgres: AuthRepository): AuthRepository {
  return {
    async getUserById(localUserId) {
      const jsonUser = await json.getUserById(localUserId);
      const postgresUser = await postgres.getUserById(localUserId);
      if (jsonUser?.local_user_id !== postgresUser?.local_user_id) {
        warnDualMismatch("auth_user", localUserId, jsonUser, postgresUser);
      }
      return jsonUser;
    },
    async getUserByIdentifier(identifier) {
      const jsonUser = await json.getUserByIdentifier(identifier);
      const postgresUser = await postgres.getUserByIdentifier(identifier);
      if (jsonUser?.local_user_id !== postgresUser?.local_user_id) {
        warnDualMismatch("auth_user_identifier", identifier, jsonUser, postgresUser);
      }
      return jsonUser;
    },
    async createUser(input) {
      return mirrorWrite(
        json.createUser(input),
        () => postgres.createUser(input),
      );
    },
    async updateUser(localUserId, patch, now) {
      return mirrorWrite(
        json.updateUser(localUserId, patch, now),
        () => postgres.updateUser(localUserId, patch, now),
      );
    },
    async createSession(session) {
      return mirrorWrite(
        json.createSession(session),
        () => postgres.createSession(session),
      );
    },
    async getSessionByTokenHash(tokenHash) {
      const jsonSession = await json.getSessionByTokenHash(tokenHash);
      const postgresSession = await postgres.getSessionByTokenHash(tokenHash);
      if (jsonSession?.session_id !== postgresSession?.session_id) {
        warnDualMismatch("auth_session", tokenHash, jsonSession, postgresSession);
      }
      return jsonSession;
    },
    async touchSession(sessionId, patch) {
      return mirrorWrite(
        json.touchSession(sessionId, patch),
        () => postgres.touchSession(sessionId, patch),
      );
    },
    async revokeSession(sessionId, now) {
      return mirrorWrite(
        json.revokeSession(sessionId, now),
        () => postgres.revokeSession(sessionId, now),
      );
    },
    async appendAudit(event) {
      await mirrorWrite(
        json.appendAudit(event),
        () => postgres.appendAudit(event),
      );
    },
    async listAuditEvents() {
      return json.listAuditEvents();
    },
  };
}

function createDualNewApiUserMappingRepository(
  json: NewApiUserMappingRepository,
  postgres: NewApiUserMappingRepository,
): NewApiUserMappingRepository {
  return {
    async getByLocalUserId(localUserId) {
      const jsonMapping = await json.getByLocalUserId(localUserId);
      const postgresMapping = await postgres.getByLocalUserId(localUserId);
      if (jsonMapping?.new_api_user_id !== postgresMapping?.new_api_user_id || jsonMapping?.sync_status !== postgresMapping?.sync_status) {
        warnDualMismatch("new_api_mapping", localUserId, jsonMapping, postgresMapping);
      }
      return jsonMapping;
    },
    async getByNewApiUserId(newApiUserId) {
      const jsonMapping = await json.getByNewApiUserId(newApiUserId);
      const postgresMapping = await postgres.getByNewApiUserId(newApiUserId);
      if (jsonMapping?.local_user_id !== postgresMapping?.local_user_id) {
        warnDualMismatch("new_api_mapping_upstream", String(newApiUserId), jsonMapping, postgresMapping);
      }
      return jsonMapping;
    },
    async listByStatus(status) {
      return json.listByStatus(status);
    },
    async createPending(input) {
      return mirrorWrite(json.createPending(input), () => postgres.createPending(input));
    },
    async markActive(input) {
      return mirrorWrite(json.markActive(input), () => postgres.markActive(input));
    },
    async markFailed(input) {
      return mirrorWrite(json.markFailed(input), () => postgres.markFailed(input));
    },
    async markDisabled(input) {
      return mirrorWrite(json.markDisabled(input), () => postgres.markDisabled(input));
    },
    async markOrphaned(input) {
      return mirrorWrite(json.markOrphaned(input), () => postgres.markOrphaned(input));
    },
    async scheduleRepair(input) {
      return mirrorWrite(json.scheduleRepair(input), () => postgres.scheduleRepair(input));
    },
    async prepareRetry(input) {
      return mirrorWrite(json.prepareRetry(input), () => postgres.prepareRetry(input));
    },
  };
}
