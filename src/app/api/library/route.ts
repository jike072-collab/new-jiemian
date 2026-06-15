import { NextResponse } from "next/server";

import { deleteLibraryItem, readLibrary } from "@/lib/server/library";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ items: await readLibrary() });
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { id?: string };
    if (!body.id) return NextResponse.json({ error: "缺少作品 ID。" }, { status: 400 });
    return NextResponse.json(await deleteLibraryItem(body.id));
  } catch {
    return NextResponse.json({ error: "删除失败。" }, { status: 400 });
  }
}
