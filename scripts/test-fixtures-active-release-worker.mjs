#!/usr/bin/env node
import { writeActiveRelease } from "./ops/active-release.mjs";
import { getServiceConfig } from "./ops/service-config.mjs";

const [root, service, releaseRoot, runtimeCommit] = process.argv.slice(2);
const config = getServiceConfig(service, { root });
writeActiveRelease(config, { releaseRoot, runtimeCommit });
