import { createPostgresMembershipRepository } from "./postgres-repository";
import { createJsonMembershipRepository, type MembershipRepository } from "./repository";

export class MembershipPersistenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MembershipPersistenceConfigError";
  }
}

export function getMembershipPersistenceMode() {
  return process.env.APP_MEMBERSHIP_PERSISTENCE_MODE?.trim().toLowerCase()
    || process.env.APP_BILLING_PERSISTENCE_MODE?.trim().toLowerCase();
}

export function createMembershipPersistenceRepository(mode = getMembershipPersistenceMode()): MembershipRepository {
  if (!mode) {
    if (process.env.NODE_ENV === "production") {
      throw new MembershipPersistenceConfigError("APP_MEMBERSHIP_PERSISTENCE_MODE must be explicitly set in production.");
    }
    return createJsonMembershipRepository();
  }
  if (mode === "json") return createJsonMembershipRepository();
  if (mode === "postgres") return createPostgresMembershipRepository();
  if (mode === "dual") return createPostgresMembershipRepository();
  throw new MembershipPersistenceConfigError("APP_MEMBERSHIP_PERSISTENCE_MODE must be json or postgres.");
}
