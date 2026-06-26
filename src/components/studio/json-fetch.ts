import { fetchJson } from "@/lib/client/api";

export async function jsonFetch<T>(url: string, options?: RequestInit): Promise<T> {
  return fetchJson<T>(url, options);
}
