import { redactJson } from "./redaction";

type LogLevel = "info" | "warn" | "error";

type LogPayload = {
  event: string;
  requestId?: string;
  context?: string;
  method?: string;
  path?: string;
  status?: number;
  retryable?: boolean;
  details?: Record<string, unknown>;
};
function write(level: LogLevel, payload: LogPayload) {
  const safePayload = redactJson({
    source: "new-api-bff",
    level,
    ...payload,
  });

  if (level === "error") {
    console.error(safePayload);
    return;
  }
  if (level === "warn") {
    console.warn(safePayload);
    return;
  }
  console.info(safePayload);
}

export const newApiLogger = {
  info: (payload: LogPayload) => write("info", payload),
  warn: (payload: LogPayload) => write("warn", payload),
  error: (payload: LogPayload) => write("error", payload),
};
