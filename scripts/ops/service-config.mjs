import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export const serviceNames = ["production", "staging"];

const serviceDefinitions = {
  production: {
    label: "3106 production",
    port: "3106",
    dataDirName: "data",
    uploadsDirName: "uploads",
    envFiles: [".env.local", ".runtime/production.env"],
    logFileName: "3106-production.log",
    stateFileName: "service-production.json",
    taskName: "AohuangAI-3106-production-watchdog",
    backupPrefix: "3106-production",
  },
  staging: {
    label: "3107 staging",
    port: "3107",
    dataDirName: "data-staging",
    uploadsDirName: "uploads-staging",
    envFiles: [".env.local", ".runtime/staging.env"],
    logFileName: "3107-staging.log",
    stateFileName: "service-staging.json",
    taskName: "AohuangAI-3107-staging-watchdog",
    backupPrefix: "3107-staging",
  },
};

export function assertServiceName(service) {
  if (!serviceNames.includes(service)) {
    throw new Error(`Expected service to be one of: ${serviceNames.join(", ")}`);
  }
}

export function getServiceConfig(service, options = {}) {
  assertServiceName(service);
  const root = resolve(options.root || process.cwd());
  const definition = serviceDefinitions[service];
  const runtimeDir = join(root, ".runtime");
  const portEnvKey = service === "production" ? "PRODUCTION_PORT" : "STAGING_PORT";
  const fallbackPort = service === "staging" && process.env.STAGING_SMOKE_PORT
    ? process.env.STAGING_SMOKE_PORT
    : undefined;
  return {
    service,
    ...definition,
    root,
    port: String(options.port || process.env[portEnvKey] || fallbackPort || definition.port),
    dataDir: resolve(root, definition.dataDirName),
    uploadsDir: resolve(root, definition.uploadsDirName),
    runtimeDir,
    logFile: join(runtimeDir, definition.logFileName),
    stateFile: join(runtimeDir, definition.stateFileName),
    envFilePaths: definition.envFiles.map((file) => resolve(root, file)),
    backupRoot: resolve(root, "..", "_rollback_backups"),
  };
}

export function getKnownServiceRoot(service, options = {}) {
  assertServiceName(service);
  if (options.root) return resolve(options.root);
  const envKey = service === "production" ? "AOHUANG_PRODUCTION_ROOT" : "AOHUANG_STAGING_ROOT";
  if (process.env[envKey]) return resolve(process.env[envKey]);

  const cwd = resolve(process.cwd());
  const parent = dirname(cwd);
  const sibling = service === "production" ? join(parent, "new-jiemian") : join(parent, "new-jiemian-3107");
  if (existsSync(join(sibling, "package.json"))) return sibling;
  return cwd;
}

export function getAllServiceConfigs(options = {}) {
  return serviceNames.map((service) => {
    const root = getKnownServiceRoot(service, { root: options[`${service}Root`] });
    return getServiceConfig(service, { root });
  });
}
