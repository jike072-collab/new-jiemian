import { type NextRequest, NextResponse } from "next/server";

import { requireAdmin } from "@/lib/server/admin-auth";
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
  const blocked = requireAdmin(request);
  if (blocked) return blocked;

  try {
    const body = await request.json() as {
      id?: string;
      apiUrl?: string;
      apiKey?: string;
    };
    const id = String(body.id || "").trim();
    const provider = id ? await providerById(id) : null;
    if (!provider && !body.apiUrl) {
      return NextResponse.json({ error: "供应商不存在。" }, { status: 404 });
    }

    const apiUrl = String(body.apiUrl || provider?.apiUrl || "").trim();
    const apiKey = String(body.apiKey || provider?.apiKey || "").trim();
    if (!apiUrl) {
      return NextResponse.json({ error: "请先填写接口地址。" }, { status: 400 });
    }
    if (!apiKey) {
      return NextResponse.json({ error: "请先填写或保存 API Key。" }, { status: 400 });
    }

    const endpoint = modelsEndpointFor(apiUrl);
    if (!endpoint) {
      return NextResponse.json({ error: "接口地址无效。" }, { status: 400 });
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
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const root = asRecord(payload);
    const models = (Array.isArray(root.data) ? root.data : [])
      .map(readModelId)
      .filter(Boolean);
    return NextResponse.json({ models: Array.from(new Set(models)) });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "读取模型失败。",
    }, { status: 400 });
  }
}
