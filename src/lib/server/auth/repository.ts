import { randomUUID } from "node:crypto";
import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import { nowIso, normalizeEmail, normalizeIdentifier, normalizeUsername } from "./normalize";
import {
  type AuthAuditEvent,
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
  createUser(input: CreateAuthUserInput): Promise<AuthUser>;
  updateUser(localUserId: string, patch: Partial<Pick<AuthUser, "status" | "last_login_at" | "session_version" | "display_name">>, now?: Date): Promise<AuthUser>;
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

export type AuthRepository = UserRepository & SessionRepository & AuthAuditRepository;

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
    audit: store.audit.map((event) => ({ ...event, details: { ...event.details } })),
  };
}

function normalizeStore(store: Partial<AuthStore> | null): AuthStore {
  return {
    users: Array.isArray(store?.users) ? store.users : [],
    sessions: Array.isArray(store?.sessions) ? store.sessions : [],
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
    const normalized = normalizeIdentifier(identifier);
    const store = await this.storage.read();
    const found = store.users.find((user) => (
      user.email === normalized || user.username === normalized
    ));
    return found ? { ...found } : null;
  }

  async createUser(input: CreateAuthUserInput) {
    const email = normalizeEmail(input.email);
    const username = normalizeUsername(input.username);
    const timestamp = nowIso(input.now);

    return this.mutate((store) => {
      const duplicate = store.users.find((user) => user.email === email || user.username === username);
      if (duplicate) {
        throw new AuthRepositoryError("AUTH_DUPLICATE_ACCOUNT", "Account already exists.");
      }

      const user: AuthUser = {
        local_user_id: input.localUserId || randomUUID(),
        email,
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
    patch: Partial<Pick<AuthUser, "status" | "last_login_at" | "session_version" | "display_name">>,
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
