export type NewApiEnvironment = "test" | "staging" | "production";

export type NewApiContextKind = "health" | "user" | "admin";

export type NewApiAuthContext =
  | { kind: "health" }
  | {
      kind: "admin";
      newApiUserId: number;
      accessToken: string;
    }
  | {
      kind: "user";
      newApiUserId: number;
      accessToken: string;
    };

export type NewApiRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  context: NewApiAuthContext;
  timeoutMs?: number;
  retry?: boolean;
  requestId?: string;
  maxResponseBytes?: number;
};

export type NewApiConfig = {
  enabled: boolean;
  baseUrl: string;
  timeoutMs: number;
  maxResponseBytes: number;
  environment: NewApiEnvironment;
  adminAccessToken?: string;
  adminUserId?: number;
};

export type NewApiHealth = {
  success?: boolean;
  message?: string;
  version?: string;
  [key: string]: unknown;
};

export type NewApiResponse<T> = {
  data: T;
  requestId: string;
  upstreamStatus: number;
};
