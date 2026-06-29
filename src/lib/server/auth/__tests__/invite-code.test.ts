import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { requireTestInviteCode } from "../invite-code";

const previousEnv = {
  TEST_INVITE_CODE: process.env.TEST_INVITE_CODE,
  PORT: process.env.PORT,
  DATA_DIR: process.env.DATA_DIR,
  UPLOADS_DIR: process.env.UPLOADS_DIR,
  RUNTIME_STORAGE_ISOLATION: process.env.RUNTIME_STORAGE_ISOLATION,
};

function restoreEnv() {
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(restoreEnv);

test("does not require invite code for non-tunneltest registration when unset", () => {
  delete process.env.TEST_INVITE_CODE;
  delete process.env.PORT;
  delete process.env.DATA_DIR;
  delete process.env.UPLOADS_DIR;
  delete process.env.RUNTIME_STORAGE_ISOLATION;

  assert.equal(requireTestInviteCode(undefined), null);
});

test("requires configured invite code before registration", () => {
  process.env.TEST_INVITE_CODE = "short-test-code";

  assert.equal(requireTestInviteCode("short-test-code"), null);
  assert.equal(requireTestInviteCode(" short-test-code "), null);
  assert.equal(requireTestInviteCode(undefined)?.code, "AUTH_INVITE_REQUIRED");
  assert.equal(requireTestInviteCode("wrong-code")?.status, 403);
});

test("rejects open registration in tunneltest runtime when invite code is missing", () => {
  delete process.env.TEST_INVITE_CODE;
  process.env.PORT = "3107";
  process.env.DATA_DIR = "data-tunneltest";
  process.env.UPLOADS_DIR = "uploads-tunneltest";
  process.env.RUNTIME_STORAGE_ISOLATION = "strict";

  const result = requireTestInviteCode("anything");

  assert.equal(result?.ok, false);
  assert.equal(result?.code, "AUTH_INVITE_REQUIRED");
  assert.equal(result?.status, 403);
});
