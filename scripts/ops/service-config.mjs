import { existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

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
  const root = resolve(options.root || getKnownServiceRoot(service));
  assertServiceRoot(service, root);
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
    activeReleaseFile: join(runtimeDir, `active-release-${service}.json`),
    envFilePaths: definition.envFiles.map((file) => resolve(root, file)),
    backupRoot: resolve(root, "..", "_rollback_backups"),
  };
}

export function getKnownServiceRoot(service, options = {}) {
  assertServiceName(service);
  if (options.root) {
    const root = resolve(options.root);
    assertServiceRoot(service, root);
    return root;
  }
  const envKey = service === "production" ? "AOHUANG_PRODUCTION_ROOT" : "AOHUANG_STAGING_ROOT";
  if (process.env[envKey]) {
    const root = resolve(process.env[envKey]);
    assertServiceRoot(service, root);
    return root;
  }

  const cwd = resolve(process.cwd());
  const parent = dirname(cwd);
  const sibling = service === "production" ? join(parent, "new-jiemian") : join(parent, "new-jiemian-3107");
  if (existsSync(join(sibling, "package.json"))) {
    assertServiceRoot(service, sibling);
    return sibling;
  }
  throw new Error(`Unable to resolve ${service} service root. Pass --root or set ${envKey}; refusing to fall back to the current directory.`);
}

export function getAllServiceConfigs(options = {}) {
  const configs = serviceNames.map((service) => {
    const root = getKnownServiceRoot(service, { root: options[`${service}Root`] });
    return getServiceConfig(service, { root });
  });
  assertServiceConfigsSeparated(configs);
  return configs;
}

export function assertServiceRoot(service, root) {
  assertServiceName(service);
  const resolved = resolve(root);
  if (!existsSync(join(resolved, "package.json"))) {
    throw new Error(`${service} service root is invalid: package.json is missing at ${resolved}`);
  }
}

export function assertServiceConfigsSeparated(configs) {
  const [production, staging] = configs;
  if (!production || !staging) return;
  if (samePath(production.root, staging.root)) {
    throw new Error("production and staging service roots must not be the same directory.");
  }
  for (const prodPath of [production.dataDir, production.uploadsDir]) {
    for (const stagingPath of [staging.dataDir, staging.uploadsDir]) {
      if (samePath(prodPath, stagingPath) || isPathInside(prodPath, stagingPath) || isPathInside(stagingPath, prodPath)) {
        throw new Error("production and staging data/uploads directories must be isolated.");
      }
    }
  }
}

function samePath(left, right) {
  return resolve(left).toLowerCase() === resolve(right).toLowerCase();
}

function isPathInside(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return Boolean(rel) && !rel.startsWith("..") && !isAbsolute(rel);
}
