import { type NextRequest } from "next/server";

import { optimizePromptResponse } from "@/lib/server/prompts";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  return optimizePromptResponse(request);
}
