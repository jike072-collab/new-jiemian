#!/usr/bin/env node
import { runCompiledDatabaseTestsOrExit } from "./compiled-test-runner.mjs";

runCompiledDatabaseTestsOrExit([
  "src/lib/server/database/__tests__/stage9cb-flags.test.js",
  "src/lib/server/database/__tests__/library-jobs-adapter.test.js",
  "src/lib/server/database/__tests__/library-shadow-write.test.js",
]);

console.log(JSON.stringify({
  ok: true,
  stage: "Stage 9C-B",
  command: "test:database-library-integration",
  databaseConnected: false,
  productionDbWritten: false,
  stagingDbWritten: false,
  migrationExecuted: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  realProviderCalled: false,
  costIncurred: false,
  secrets: "masked",
}, null, 2));
