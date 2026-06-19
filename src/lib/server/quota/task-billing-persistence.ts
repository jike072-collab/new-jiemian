import {
  createJsonNewApiUserMappingRepository,
  type NewApiUserMappingRepository,
} from "../integrations/new-api";
import { type UsageLogRepository, createJsonUsageLogRepository } from "./repository";
import { type TaskBillingRepository, createJsonTaskBillingRepository } from "./task-billing-repository";

export type TaskBillingPersistenceMode = "json" | "postgres";

export type TaskBillingPersistenceRepositories = {
  mode: TaskBillingPersistenceMode;
  taskRepository: TaskBillingRepository;
  usageRepository: UsageLogRepository;
  mappingRepository: NewApiUserMappingRepository;
};

export class TaskBillingPersistenceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskBillingPersistenceConfigError";
  }
}

const allowedModes = new Set<TaskBillingPersistenceMode>(["json", "postgres"]);

function rawMode() {
  return process.env.APP_TASK_BILLING_PERSISTENCE_MODE?.trim().toLowerCase();
}

export function getTaskBillingPersistenceMode(): TaskBillingPersistenceMode {
  const raw = rawMode();
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new TaskBillingPersistenceConfigError("APP_TASK_BILLING_PERSISTENCE_MODE must be explicitly set in production.");
    }
    return "json";
  }
  if (!allowedModes.has(raw as TaskBillingPersistenceMode)) {
    throw new TaskBillingPersistenceConfigError("APP_TASK_BILLING_PERSISTENCE_MODE must be json or postgres.");
  }
  const mode = raw as TaskBillingPersistenceMode;
  if (process.env.NODE_ENV === "production" && mode !== "postgres") {
    throw new TaskBillingPersistenceConfigError("APP_TASK_BILLING_PERSISTENCE_MODE must be postgres in production.");
  }
  return mode;
}

export function createTaskBillingPersistenceRepositories(
  mode: TaskBillingPersistenceMode = getTaskBillingPersistenceMode(),
): TaskBillingPersistenceRepositories {
  if (mode === "json") {
    return {
      mode,
      taskRepository: createJsonTaskBillingRepository(),
      usageRepository: createJsonUsageLogRepository(),
      mappingRepository: createJsonNewApiUserMappingRepository(),
    };
  }

  return {
    mode,
    taskRepository: loadPostgresTaskBillingRepository(),
    usageRepository: loadPostgresUsageLogRepository(),
    mappingRepository: loadPostgresMappingRepository(),
  };
}

function serverRequire<T>(path: string): T {
  const requireFn = (0, eval)("require") as NodeRequire;
  return requireFn(path) as T;
}

function loadPostgresTaskBillingRepository() {
  const repositoryModule = serverRequire<typeof import("./postgres-task-billing-repository")>("./postgres-task-billing-repository");
  return repositoryModule.createPostgresTaskBillingRepository();
}

function loadPostgresUsageLogRepository() {
  const repositoryModule = serverRequire<typeof import("./postgres-usage-repository")>("./postgres-usage-repository");
  return repositoryModule.createPostgresUsageLogRepository();
}

function loadPostgresMappingRepository() {
  const mappingModule = serverRequire<typeof import("../integrations/new-api/postgres-user-mapping")>(
    "../integrations/new-api/postgres-user-mapping",
  );
  return mappingModule.createPostgresNewApiUserMappingRepository();
}
