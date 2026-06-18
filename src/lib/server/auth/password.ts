import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const DUMMY_HASH = "scrypt$v=1$n=16384$r=8$p=1$len=64$ZHVtbXktc2FsdA$c92a3a4af39d2e7e7ea7e0ef9e2e2e1e42d72d8b96341b89879d5356b888cb047a90a94a234fb4e52a7d209a53f4d6d9efaab2425d6051a0dcebd6456a928d1";

function encode(value: Buffer) {
  return value.toString("base64url");
}

function decode(value: string) {
  return Buffer.from(value, "base64url");
}

function deriveKey(password: string, salt: Buffer, keyLength: number, options: {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, keyLength, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export function validatePasswordStrength(password: string) {
  const errors: string[] = [];
  if (password.length < 10) errors.push("PASSWORD_TOO_SHORT");
  if (password.length > 128) errors.push("PASSWORD_TOO_LONG");
  if (!/[a-z]/.test(password)) errors.push("PASSWORD_REQUIRES_LOWERCASE");
  if (!/[A-Z]/.test(password)) errors.push("PASSWORD_REQUIRES_UPPERCASE");
  if (!/[0-9]/.test(password)) errors.push("PASSWORD_REQUIRES_DIGIT");
  return errors;
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    "scrypt",
    "v=1",
    `n=${SCRYPT_N}`,
    `r=${SCRYPT_R}`,
    `p=${SCRYPT_P}`,
    `len=${KEY_LENGTH}`,
    encode(salt),
    key.toString("hex"),
  ].join("$");
}

export async function verifyPassword(password: string, storedHash = DUMMY_HASH) {
  const parts = storedHash.split("$");
  if (parts.length !== 8 || parts[0] !== "scrypt") return false;

  const params = Object.fromEntries(parts.slice(1, 6).map((part) => {
    const [key, value] = part.split("=");
    return [key, value];
  }));

  const expected = Buffer.from(parts[7], "hex");
  const actual = await deriveKey(password, decode(parts[6]), Number(params.len), {
    N: Number(params.n),
    r: Number(params.r),
    p: Number(params.p),
    maxmem: 64 * 1024 * 1024,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
