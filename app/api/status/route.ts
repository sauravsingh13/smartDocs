import { NextResponse } from "next/server";
import { countChunks } from "../../../lib/store";

export async function GET() {
  const n = await countChunks();
  return NextResponse.json({ chunks: n });
}
