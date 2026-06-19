import {
  createJsonNewApiUserMappingRepository,
  type NewApiUserMappingRepository,
} from "../integrations/new-api";
import { createPostgresNewApiUserMappingRepository } from "../integrations/new-api/postgres-user-mapping";
import { type UsageLogRepository, createJsonUsageLogRepository } from "./repository";
import { createPostgresUsageLogRepository } from "./postgres-usage-repository";
import { type TaskBillingRepository, createJsonTaskBillingRepository } from "./task-billing-repository";
import { createPostgresTaskBillingRepository } from "./postgres-task-billing-repository";

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

function loadPostgresTaskBillingRepository() {
  return createPostgresTaskBillingRepository();
}

function loadPostgresUsageLogRepository() {
  return createPostgresUsageLogRepository();
}

function loadPostgresMappingRepository() {
  return createPostgresNewApiUserMappingRepository();
}
