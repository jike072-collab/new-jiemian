import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import { nowIso, normalizeAuthIdentifier, normalizeEmail, normalizeIdentifier, normalizePhone, normalizeUsername } from "./normalize";
import {
  type AuthAuditEvent,
  type AuthVerificationCode,
  type AuthSession,
  type AuthStore,
  type AuthUser,
  type AuthUserRole,
  type AuthUserStatus,
} from "./types";

type AuthStorage = {
  read(): Promise<AuthStore>;
  write(store: AuthStore): Promise<void>;
};

export type CreateAuthUserInput = {
  localUserId?: string;
  email: string;
  phone?: string | null;
  username: string;
  displayName: string;
  passwordHash: string;
  status?: AuthUserStatus;
  role?: AuthUserRole;
  now?: Date;
};

export type UserRepository = {
  getUserById(localUserId: string): Promise<AuthUser | null>;
  getUserByIdentifier(identifier: string): Promise<AuthUser | null>;
  listUsersPage(filter?: AuthUserListFilter): Promise<AuthUserListPage>;
  createUser(input: CreateAuthUserInput): Promise<AuthUser>;
  updateUser(localUserId: string, patch: Partial<Pick<AuthUser, "status" | "last_login_at" | "session_version" | "display_name" | "password_hash">>, now?: Date): Promise<AuthUser>;
  releaseUserIdentity(localUserId: string, now?: Date): Promise<AuthUser>;
};

export type AuthUserListFilter = {
  status?: AuthUserStatus;
  role?: AuthUserRole;
  query?: string;
  page?: number;
  pageSize?: number;
};

export type AuthUserListPage = {
  users: AuthUser[];
  total: number;
};

export type SessionRepository = {
  createSession(session: AuthSession): Promise<AuthSession>;
  getSessionByTokenHash(tokenHash: string): Promise<AuthSession | null>;
  touchSession(sessionId: string, patch: Pick<AuthSession, "last_seen_at" | "idle_expires_at" | "updated_at">): Promise<AuthSession>;
  revokeSession(sessionId: string, now?: Date): Promise<AuthSession | null>;
};

export type AuthAuditRepository = {
  appendAudit(event: AuthAuditEvent): Promise<void>;
  listAuditEvents(): Promise<AuthAuditEvent[]>;
};

export type VerificationCodeRepository = {
  createVerificationCode(code: AuthVerificationCode): Promise<AuthVerificationCode>;
  getLatestVerificationCode(input: Pick<AuthVerificationCode, "destination" | "purpose">): Promise<AuthVerificationCode | null>;
  touchVerificationCode(verificationId: string, patch: Partial<Pick<AuthVerificationCode, "attempt_count" | "consumed_at" | "updated_at">>): Promise<AuthVerificationCode>;
};

export type AuthRepository = UserRepository & SessionRepository & VerificationCodeRepository & AuthAuditRepository;

export class AuthRepositoryError extends Error {
  constructor(readonly code: "AUTH_DUPLICATE_ACCOUNT" | "AUTH_NOT_FOUND", message: string) {
    super(message);
    this.name = "AuthRepositoryError";
  }
}

const defaultAuthStorePath = join(dataRoot, "auth-store.json");

function cloneStore(store: AuthStore): AuthStore {
  return {
    users: store.users.map((user) => ({ ...user })),
    sessions: store.sessions.map((session) => ({ ...session })),
    verificationCodes: store.verificationCodes.map((code) => ({ ...code })),
    audit: store.audit.map((event) => ({ ...event, details: { ...event.details } })),
  };
}

function normalizeStore(store: Partial<AuthStore> | null): AuthStore {
  return {
    users: Array.isArray(store?.users)
      ? store.users.map((user) => ({ ...user, phone: user.phone ?? null }))
      : [],
    sessions: Array.isArray(store?.sessions) ? store.sessions : [],
    verificationCodes: Array.isArray(store?.verificationCodes) ? store.verificationCodes : [],
    audit: Array.isArray(store?.audit) ? store.audit : [],
  };
}

class StoreAuthRepository implements AuthRepository {
  private queue = Promise.resolve();

  constructor(private readonly storage: AuthStorage) {}

  private async withLock<T>(operation: () => Promise<T>) {
    const previous = this.queue;
    let release: () => void = () => undefined;
    this.queue = previous.then(() => new Promise<void>((resolve) => {
      release = resolve;
    }));
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async mutate<T>(operation: (store: AuthStore) => Promise<T> | T) {
    return this.withLock(async () => {
      const store = cloneStore(await this.storage.read());
      const result = await operation(store);
      await this.storage.write(store);
      return result;
    });
  }

  async getUserById(localUserId: string) {
    const store = await this.storage.read();
    const found = store.users.find((user) => user.local_user_id === localUserId.trim());
    return found ? { ...found } : null;
  }

  async getUserByIdentifier(identifier: string) {
    const authIdentifier = normalizeAuthIdentifier(identifier);
    const normalized = authIdentifier?.kind === "phone" ? authIdentifier.value : normalizeIdentifier(identifier);
    const store = await this.storage.read();
    const found = store.users.find((user) => (
      user.email === normalized || user.username === normalized || user.phone === normalized
    ));
    return found ? { ...found } : null;
  }

  async listUsersPage(filter: AuthUserListFilter = {}) {
    const page = Math.max(1, Math.trunc(filter.page || 1));
    const pageSize = Math.min(100, Math.max(1, Math.trunc(filter.pageSize || 20)));
    const query = normalizeIdentifier(filter.query || "");
    const store = await this.storage.read();
    const users = store.users
      .filter((user) => !filter.status || user.status === filter.status)
      .filter((user) => !filter.role || user.role === filter.role)
      .filter((user) => !query || user.email.includes(query) || user.username.includes(query) || user.phone?.includes(query) || user.local_user_id === query)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((user) => ({ ...user }));
    const start = (page - 1) * pageSize;
    return {
      users: users.slice(start, start + pageSize),
      total: users.length,
    };
  }

  async createUser(input: CreateAuthUserInput) {
    const email = normalizeEmail(input.email);
    const phone = input.phone ? normalizePhone(input.phone) : null;
    const username = normalizeUsername(input.username);
    const timestamp = nowIso(input.now);

    return this.mutate((store) => {
      const duplicate = store.users.find((user) => (
        user.email === email || user.username === username || Boolean(phone && user.phone === phone)
      ));
      if (duplicate) {
        throw new AuthRepositoryError("AUTH_DUPLICATE_ACCOUNT", "Account already exists.");
      }

      const user: AuthUser = {
        local_user_id: input.localUserId || randomUUID(),
        email,
        phone,
        username,
        display_name: input.displayName.trim() || username,
        password_hash: input.passwordHash,
        status: input.status || "active",
        role: input.role || "user",
        session_version: 1,
        created_at: timestamp,
        updated_at: timestamp,
        last_login_at: null,
      };
      store.users.push(user);
      return { ...user };
    });
  }

  async updateUser(
    localUserId: string,
    patch: Partial<Pick<AuthUser, "status" | "last_login_at" | "session_version" | "display_name" | "password_hash">>,
    now?: Date,
  ) {
    return this.mutate((store) => {
      const index = store.users.findIndex((user) => user.local_user_id === localUserId);
      if (index < 0) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Account was not found.");
      store.users[index] = {
        ...store.users[index],
        ...patch,
        updated_at: nowIso(now),
      };
      return { ...store.users[index] };
    });
  }

  async releaseUserIdentity(localUserId: string, now?: Date) {
    return this.mutate((store) => {
      const index = store.users.findIndex((user) => user.local_user_id === localUserId);
      if (index < 0) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Account was not found.");
      const timestamp = nowIso(now);
      const archived = archivedIdentity(localUserId);
      store.users[index] = {
        ...store.users[index],
        email: archived.email,
        username: archived.username,
        phone: null,
        session_version: store.users[index].session_version + 1,
        updated_at: timestamp,
      };
      store.sessions = store.sessions.map((session) => (
        session.local_user_id === localUserId && !session.revoked_at
          ? { ...session, revoked_at: timestamp, updated_at: timestamp }
          : session
      ));
      return { ...store.users[index] };
    });
  }

  async createSession(session: AuthSession) {
    return this.mutate((store) => {
      store.sessions.push({ ...session });
      return { ...session };
    });
  }

  async getSessionByTokenHash(tokenHash: string) {
    const store = await this.storage.read();
    const found = store.sessions.find((session) => session.token_hash === tokenHash);
    return found ? { ...found } : null;
  }

  async touchSession(
    sessionId: string,
    patch: Pick<AuthSession, "last_seen_at" | "idle_expires_at" | "updated_at">,
  ) {
    return this.mutate((store) => {
      const index = store.sessions.findIndex((session) => session.session_id === sessionId);
      if (index < 0) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Session was not found.");
      store.sessions[index] = { ...store.sessions[index], ...patch };
      return { ...store.sessions[index] };
    });
  }

  async revokeSession(sessionId: string, now?: Date) {
    return this.mutate((store) => {
      const index = store.sessions.findIndex((session) => session.session_id === sessionId);
      if (index < 0) return null;
      store.sessions[index] = {
        ...store.sessions[index],
        revoked_at: store.sessions[index].revoked_at || nowIso(now),
        updated_at: nowIso(now),
      };
      return { ...store.sessions[index] };
    });
  }

  async createVerificationCode(code: AuthVerificationCode) {
    return this.mutate((store) => {
      store.verificationCodes.push({ ...code });
      return { ...code };
    });
  }

  async getLatestVerificationCode(input: Pick<AuthVerificationCode, "destination" | "purpose">) {
    const store = await this.storage.read();
    const found = store.verificationCodes
      .filter((code) => (
        code.destination === input.destination
        && code.purpose === input.purpose
        && !code.consumed_at
      ))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    return found ? { ...found } : null;
  }

  async touchVerificationCode(
    verificationId: string,
    patch: Partial<Pick<AuthVerificationCode, "attempt_count" | "consumed_at" | "updated_at">>,
  ) {
    return this.mutate((store) => {
      const index = store.verificationCodes.findIndex((code) => code.verification_id === verificationId);
      if (index < 0) throw new AuthRepositoryError("AUTH_NOT_FOUND", "Verification code was not found.");
      store.verificationCodes[index] = { ...store.verificationCodes[index], ...patch };
      return { ...store.verificationCodes[index] };
    });
  }

  async appendAudit(event: AuthAuditEvent) {
    await this.mutate((store) => {
      store.audit.push({ ...event, details: { ...event.details } });
      if (store.audit.length > 1000) store.audit = store.audit.slice(-1000);
    });
  }

  async listAuditEvents() {
    const store = await this.storage.read();
    return store.audit.map((event) => ({ ...event, details: { ...event.details } }));
  }
}

export function createMemoryAuthRepository(seed: Partial<AuthStore> = {}) {
  let store = normalizeStore(seed);
  return new StoreAuthRepository({
    async read() {
      return cloneStore(store);
    },
    async write(nextStore) {
      store = cloneStore(nextStore);
    },
  });
}

export function createJsonAuthRepository(path = defaultAuthStorePath) {
  return new StoreAuthRepository({
    async read() {
      return normalizeStore(await readJsonFile<Partial<AuthStore> | null>(path, null));
    },
    async write(store) {
      await writeJsonFile(path, store);
    },
  });
}

function archivedIdentity(localUserId: string) {
  const compact = localUserId.trim().toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 24) || randomUUID().replace(/-/g, "").slice(0, 24);
  return {
    email: `archived+${compact}@deleted.local`,
    username: `archived-${compact}`.slice(0, 32),
  };
}
