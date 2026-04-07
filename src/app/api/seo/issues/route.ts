import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

export const runtime = 'nodejs'

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const workspaceId = req.nextUrl.searchParams.get('workspaceId')
  const severity    = req.nextUrl.searchParams.get('severity')
  const status      = req.nextUrl.searchParams.get('status') ?? 'open'
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

  let query = admin()
    .from('seo_issues')
    .select('*, seo_pages(url, title)')
    .eq('workspace_id', workspaceId)
    .eq('status', status)
    .order('severity', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(200)

  if (severity) query = query.eq('severity', severity)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ issues: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, status } = await req.json() as { id: string; status: 'resolved' | 'ignored' | 'open' }

  const update: Record<string, unknown> = { status }
  if (status === 'resolved') update.resolved_at = new Date().toISOString()

  const { error } = await admin().from('seo_issues').update(update).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
