import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL("../db/migrations/013_auth_verification_login_purpose.sql", import.meta.url),
  "utf8",
);
const applyScript = await readFile(
  new URL("./database/apply-013-auth-verification-login-purpose.mjs", import.meta.url),
  "utf8",
);

for (const purpose of ["register", "password_reset", "login"]) {
  assert.match(migration, new RegExp(`['\"]${purpose}['\"]`));
}

assert.match(migration, /auth_verification_codes_purpose_check/);
assert.match(applyScript, /APP_DATABASE_EXPECTED_NAME/);
assert.match(applyScript, /013_auth_verification_login_purpose/);
console.log("auth verification migration contract passed");
