import "server-only";

import { existsSync } from "node:fs";

import { getAuthSecret } from "../auth/secrets";
import { getAuthPersistenceMode } from "../auth/persistence";
import { productionPaymentEnabled, productionWebhookSecret, publicPaymentChannels } from "../billing/config";
import { hasProductionPaymentProvider } from "../billing/payment-provider-registry";
import { getApplicationDatabaseConfig } from "../database/config";
import { getNewApiConfig } from "../integrations/new-api/config";
import { getTaskBillingPersistenceMode } from "../quota/task-billing-persistence";
import { getBillingPersistenceMode } from "../billing/persistence";

export type ReleaseCheckStatus = "pass" | "warn" | "fail";

export type ReleaseCheckItem = {
  name: string;
  status: ReleaseCheckStatus;
  message: string;
};

export type ReleaseCheckReport = {
  ok: boolean;
  environment: "development" | "test" | "production";
  generatedAt: string;
  items: ReleaseCheckItem[];
  summary: {
    pass: number;
    warn: number;
    fail: number;
  };
};

function item(name: string, status: ReleaseCheckStatus, message: string): ReleaseCheckItem {
  return { name, status, message };
}

function checkNoDefaultAuthSecret() {
  try {
    const secret = getAuthSecret();
    if (secret === "dev-only-auth-session-secret-change-me") {
      return item("auth.session_secret", "fail", "Production must not use the development auth secret fallback.");
    }
    if (secret.length < 32) {
      return item("auth.session_secret", "fail", "AUTH_SESSION_SECRET or SESSION_SECRET must be at least 32 characters.");
    }
    return item("auth.session_secret", "pass", "Server session secret is present and not the development fallback.");
  } catch (error) {
    return item("auth.session_secret", "fail", error instanceof Error ? error.message : "Session secret check failed.");
  }
}

function checkDatabaseConfig() {
  try {
    const config = getApplicationDatabaseConfig();
    if (config.environment === "production" && config.expectedDatabaseName.toLowerCase().includes("test")) {
      return item("database.config", "fail", "Production database expected name must not look like a test database.");
    }
    return item("database.config", "pass", "Application database URL and expected database identity are configured.");
  } catch (error) {
    return item("database.config", "fail", error instanceof Error ? error.message : "Application database configuration failed.");
  }
}

function checkPersistenceModes() {
  const results: ReleaseCheckItem[] = [];
  try {
    const mode = getAuthPersistenceMode();
    results.push(item("auth.persistence", mode === "postgres" ? "pass" : "warn", `Auth persistence mode is ${mode}.`));
  } catch (error) {
    results.push(item("auth.persistence", "fail", error instanceof Error ? error.message : "Auth persistence mode is invalid."));
  }

  try {
    const mode = getBillingPersistenceMode();
    results.push(item("billing.persistence", mode === "postgres" ? "pass" : "warn", `Billing persistence mode is ${mode}.`));
  } catch (error) {
    results.push(item("billing.persistence", "fail", error instanceof Error ? error.message : "Billing persistence mode is invalid."));
  }

  try {
    const mode = getTaskBillingPersistenceMode();
    results.push(item("task_billing.persistence", mode === "postgres" ? "pass" : "warn", `Task billing persistence mode is ${mode}.`));
  } catch (error) {
    results.push(item("task_billing.persistence", "fail", error instanceof Error ? error.message : "Task billing persistence mode is invalid."));
  }
  return results;
}

function checkNewApiConfig() {
  try {
    const config = getNewApiConfig();
    if (!config.enabled) return item("new_api.config", "fail", "NEW_API_ENABLED must be true for production release.");
    if (config.environment !== "production") {
      return item("new_api.config", "fail", "NEW_API_ENVIRONMENT must be production for production release.");
    }
    if (!config.adminAccessToken || !config.adminUserId) {
      return item("new_api.config", "fail", "New API admin user id and access token are required server-side.");
    }
    return item("new_api.config", "pass", "New API production integration is configured.");
  } catch (error) {
    return item("new_api.config", "fail", error instanceof Error ? error.message : "New API configuration failed.");
  }
}

function checkProductionPayment() {
  const enabled = productionPaymentEnabled();
  const hasSecret = Boolean(productionWebhookSecret().trim());
  const hasProvider = hasProductionPaymentProvider();
  const channel = publicPaymentChannels().find((entry) => entry.channel === "production_generic");

  if (!enabled && !hasSecret && !hasProvider && channel?.enabled === false) {
    return item("payment.production", "pass", "Production payment is fail-closed and disabled by default.");
  }
  if (enabled && hasProvider && hasSecret && channel?.enabled === true) {
    return item("payment.production", "warn", "Production payment provider is installed and enabled; launch approval is required.");
  }
  if (enabled && !hasProvider && channel?.enabled === false) {
    return item("payment.production", "pass", "Production payment remains fail-closed without a registered provider.");
  }
  return item("payment.production", "fail", "Production payment configuration is inconsistent.");
}

function checkNewApiInfraConfig() {
  const composeExists = existsSync("infra/new-api/docker-compose.yml");
  const exampleExists = existsSync("infra/new-api/.env.example");
  if (!composeExists || !exampleExists) {
    return item("new_api.infra", "fail", "New API compose file and .env.example are required.");
  }
  return item("new_api.infra", "pass", "New API deployment files are present; run the Docker exposure checks before release.");
}

export function runBackendReleaseChecks(now = new Date()): ReleaseCheckReport {
  const environment = process.env.NODE_ENV === "production" || process.env.NODE_ENV === "test"
    ? process.env.NODE_ENV
    : "development";
  const items = [
    checkNoDefaultAuthSecret(),
    checkDatabaseConfig(),
    ...checkPersistenceModes(),
    checkNewApiConfig(),
    checkProductionPayment(),
    checkNewApiInfraConfig(),
  ];
  const summary = {
    pass: items.filter((entry) => entry.status === "pass").length,
    warn: items.filter((entry) => entry.status === "warn").length,
    fail: items.filter((entry) => entry.status === "fail").length,
  };
  return {
    ok: summary.fail === 0,
    environment,
    generatedAt: now.toISOString(),
    items,
    summary,
  };
}
