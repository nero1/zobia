import { NextRequest, NextResponse } from 'next/server';
import { redis } from '@/lib/redis';

export async function POST(req: NextRequest) {
  const { code } = await req.json();
  if (!code || typeof code !== 'string') {
    return NextResponse.json({ error: 'Invalid code' }, { status: 400 });
  }
  const token = await redis.getdel(`web_pre_auth:${code}`);
  if (!token) {
    return NextResponse.json({ error: 'Code expired or invalid' }, { status: 401 });
  }
  return NextResponse.json({ token });
}
