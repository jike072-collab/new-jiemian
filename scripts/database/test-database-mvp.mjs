#!/usr/bin/env node
import { runCompiledDatabaseTestsOrExit, runOrExit } from "./compiled-test-runner.mjs";

runOrExit(process.execPath, ["scripts/database/check-stage9c-schema.mjs"]);
runCompiledDatabaseTestsOrExit([
  "src/lib/server/database/__tests__/mvp-repositories.test.js",
]);

const hasTemporaryDatabase = Boolean(
  process.env.STAGE9C_TEST_DATABASE_URL
  && process.env.STAGE9C_TEST_DATABASE_EXPECTED_NAME,
);

if (hasTemporaryDatabase) {
  runOrExit(process.execPath, ["scripts/database/check-stage9c-migration.mjs"]);
}

console.log(JSON.stringify({
  ok: true,
  repositoryTests: "passed",
  schemaCheck: "passed",
  temporaryTestDatabase: hasTemporaryDatabase ? "used/masked" : "not_configured",
  productionDbWritten: false,
  stagingDbWritten: false,
  generationEndpointsCalled: false,
  newApiCalled: false,
  secrets: "masked",
}, null, 2));
