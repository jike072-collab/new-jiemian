const SECRET_HEADER_NAMES = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "x-admin-password",
  "x-api-key",
  "new-api-admin-token",
]);

export function redactSecret(value: string) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-[REDACTED]")
    .replace(/(password|secret|token|cookie|authorization|api[_-]?key)=([^&\s]+)/gi, "$1=[REDACTED]");
}
export function redactHeaders(headers: Headers | Record<string, string>) {
  const entries = headers instanceof Headers ? Array.from(headers.entries()) : Object.entries(headers);
  return Object.fromEntries(entries.map(([key, value]) => [
    key,
    SECRET_HEADER_NAMES.has(key.toLowerCase()) ? "[REDACTED]" : redactSecret(String(value)),
  ]));
}

export function redactJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJson);
  if (!value || typeof value !== "object") {
    return typeof value === "string" ? redactSecret(value) : value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (/password|secret|token|cookie|authorization|api[_-]?key/i.test(key)) {
      return [key, "[REDACTED]"];
    }
    return [key, redactJson(nested)];
  }));
}
