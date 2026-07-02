#!/usr/bin/env node
import { runCompiledDatabaseTestsOrExit } from "./compiled-test-runner.mjs";

runCompiledDatabaseTestsOrExit(
  ["src/lib/server/database/__tests__/library-jobs-adapter.test.js"],
  { testNamePattern: "jobs|job status" },
);

console.log(JSON.stringify({
  ok: true,
  stage: "Stage 9C-B",
  command: "test:generation-jobs-db-integration",
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
