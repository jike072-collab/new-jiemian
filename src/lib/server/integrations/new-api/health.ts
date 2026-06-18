import { NewApiHttpClient } from "./client";
import { newApiHealthContext } from "./auth";
import { type NewApiHealth } from "./types";

export async function checkNewApiHealth(client = new NewApiHttpClient()) {
  return client.request<NewApiHealth>({
    path: "/api/status",
    context: newApiHealthContext(),
    retry: true,
  });
}
