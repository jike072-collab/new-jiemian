import { type NextRequest } from "next/server";

import { adminResponse } from "@/lib/server/admin/http";
import { modelsEndpointFor, providerById } from "@/lib/server/providers";

export const runtime = "nodejs";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readModelId(value: unknown) {
  const record = asRecord(value);
  return typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as {
    id?: string;
    apiUrl?: string;
    apiKey?: string;
  };

  return adminResponse(request, async () => {
    try {
      const id = String(body.id || "").trim();
      const provider = id ? await providerById(id) : null;
      if (!provider && !body.apiUrl) {
        return {
          ok: false,
          status: 404,
          code: "admin_not_found",
          message: "供应商不存在。",
        };
      }

      const apiUrl = String(body.apiUrl || provider?.apiUrl || "").trim();
      const apiKey = String(body.apiKey || provider?.apiKey || "").trim();
      if (!apiUrl) {
        return {
          ok: false,
          status: 400,
          code: "admin_invalid_request",
          message: "请先填写接口地址。",
        };
      }
      if (!apiKey) {
        return {
          ok: false,
          status: 400,
          code: "admin_invalid_request",
          message: "请先填写或保存 API Key。",
        };
      }

      const endpoint = modelsEndpointFor(apiUrl);
      if (!endpoint) {
        return {
          ok: false,
          status: 400,
          code: "admin_invalid_request",
          message: "接口地址无效。",
        };
      }

      const response = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30000),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const record = asRecord(payload);
        const message = typeof asRecord(record.error).message === "string"
          ? String(asRecord(record.error).message)
          : typeof record.message === "string" ? String(record.message) : `读取模型失败：HTTP ${response.status}`;
        return {
          ok: false,
          status: 400,
          code: "admin_upstream_unavailable",
          message,
        };
      }

      const root = asRecord(payload);
      const models = (Array.isArray(root.data) ? root.data : [])
        .map(readModelId)
        .filter(Boolean);
      return {
        ok: true,
        status: 200,
        models: Array.from(new Set(models)),
      };
    } catch (error) {
      return {
        ok: false,
        status: 400,
        code: "admin_upstream_unavailable",
        message: error instanceof Error ? error.message : "读取模型失败。",
      };
    }
  });
}
