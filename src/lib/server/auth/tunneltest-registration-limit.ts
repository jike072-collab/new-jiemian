import "server-only";

import { join } from "node:path";

import { dataRoot, readJsonFile, writeJsonFile } from "../paths";
import { isTunnelTestRuntime } from "../tunneltest-limits";
import { type AuthStore } from "./types";

const additionalUserLimit = 8;
const authStorePath = join(dataRoot, "auth-store.json");
const baselinePath = join(dataRoot, "tunneltest-registration-baseline.json");

type Baseline = {
  existingUsers: number;
  additionalUserLimit: number;
  createdAt: string;
};

async function currentUserCount() {
  const store = await readJsonFile<Partial<AuthStore> | null>(authStorePath, null);
  return Array.isArray(store?.users) ? store.users.length : 0;
}

async function readOrCreateBaseline(): Promise<Baseline> {
  const existing = await readJsonFile<Partial<Baseline> | null>(baselinePath, null);
  if (existing && Number.isFinite(existing.existingUsers)) {
    return {
      existingUsers: Number(existing.existingUsers),
      additionalUserLimit: Number.isFinite(existing.additionalUserLimit)
        ? Number(existing.additionalUserLimit)
        : additionalUserLimit,
      createdAt: typeof existing.createdAt === "string" ? existing.createdAt : new Date().toISOString(),
    };
  }

  const baseline = {
    existingUsers: await currentUserCount(),
    additionalUserLimit,
    createdAt: new Date().toISOString(),
  };
  await writeJsonFile(baselinePath, baseline);
  return baseline;
}

export async function tunneltestRegistrationMaxUsers() {
  if (!isTunnelTestRuntime()) return undefined;
  const baseline = await readOrCreateBaseline();
  return baseline.existingUsers + baseline.additionalUserLimit;
}

export async function tunneltestRegistrationLimitSummary() {
  if (!isTunnelTestRuntime()) return null;
  const baseline = await readOrCreateBaseline();
  return {
    existingUsers: baseline.existingUsers,
    additionalUserLimit: baseline.additionalUserLimit,
    maxUsers: baseline.existingUsers + baseline.additionalUserLimit,
  };
}
