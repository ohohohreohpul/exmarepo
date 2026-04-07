import { NextRequest, NextResponse } from 'next/server'
import { testWpConnection } from '@/lib/wordpress'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const { siteUrl, username, password } = await req.json() as {
    siteUrl: string; username: string; password: string
  }
  if (!siteUrl || !username || !password) {
    return NextResponse.json({ ok: false, error: 'Missing fields' }, { status: 400 })
  }
  const result = await testWpConnection(siteUrl, username, password)
  return NextResponse.json(result)
}
