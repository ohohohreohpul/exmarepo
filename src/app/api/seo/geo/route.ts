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
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

  const { data: queries, error } = await admin()
    .from('geo_queries')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = await Promise.all((queries ?? []).map(async q => {
    const { data: latest } = await admin()
      .from('geo_results')
      .select('brand_cited, our_url_cited, checked_at')
      .eq('query_id', q.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return { ...q, latest_result: latest ?? null }
  }))

  const { data: suggestions } = await admin()
    .from('geo_improvement_suggestions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('implemented', false)
    .order('created_at', { ascending: false })
    .limit(10)

  return NextResponse.json({ queries: enriched, suggestions: suggestions ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workspaceId, queryText, engine } = await req.json() as {
    workspaceId: string; queryText: string; engine?: string
  }

  const { data, error } = await admin()
    .from('geo_queries')
    .insert({ workspace_id: workspaceId, query_text: queryText, engine: engine ?? 'perplexity' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ query: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id: string }
  const { error } = await admin().from('geo_queries').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
