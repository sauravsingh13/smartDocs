import { NextResponse } from 'next/server';
import { loadStore } from '../../../lib/store';

export async function GET() {
  const store = await loadStore();
  return NextResponse.json({ chunks: store.chunks.length });
}
