import { type NewApiAuthContext } from "./types";

export function newApiHealthContext(): NewApiAuthContext {
  return { kind: "health" };
}

export function newApiAdminContext(input: {
  newApiUserId: number;
  accessToken: string;
}): NewApiAuthContext {
  return {
    kind: "admin",
    newApiUserId: input.newApiUserId,
    accessToken: input.accessToken,
  };
}

export function newApiUserContext(input: {
  newApiUserId: number;
  accessToken: string;
}): NewApiAuthContext {
  return {
    kind: "user",
    newApiUserId: input.newApiUserId,
    accessToken: input.accessToken,
  };
}
