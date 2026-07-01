#!/usr/bin/env node
import { runCompiledDatabaseTestsOrExit } from "./compiled-test-runner.mjs";

runCompiledDatabaseTestsOrExit([
  "src/lib/server/database/__tests__/client.test.js",
]);
