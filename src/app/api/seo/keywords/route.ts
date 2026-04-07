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

  const { data: keywords, error } = await admin()
    .from('keywords')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('search_volume', { ascending: false })
    .limit(500)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach latest ranking per keyword
  const enriched = await Promise.all((keywords ?? []).map(async kw => {
    const { data: rank } = await admin()
      .from('keyword_rankings')
      .select('position, url, checked_at')
      .eq('keyword_id', kw.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    return { ...kw, latest_ranking: rank ?? null }
  }))

  const ranked  = enriched.filter(k => k.latest_ranking?.position != null)
  const top10   = ranked.filter(k => k.latest_ranking!.position <= 10)
  const top3    = ranked.filter(k => k.latest_ranking!.position <= 3)
  const volume  = enriched.reduce((s, k) => s + (k.search_volume ?? 0), 0)

  return NextResponse.json({
    keywords: enriched,
    stats: { total: enriched.length, ranked: ranked.length, top10: top10.length, top3: top3.length, totalVolume: volume },
  })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workspaceId, keywords } = await req.json() as {
    workspaceId: string
    keywords: Array<{ keyword: string; search_volume?: number; difficulty?: number; cpc_usd?: number; intent?: string; trend_data?: number[]; country_code?: string }>
  }

  const rows = keywords.map(k => ({
    workspace_id:  workspaceId,
    keyword:       k.keyword.toLowerCase().trim(),
    country_code:  k.country_code ?? 'us',
    search_volume: k.search_volume ?? null,
    difficulty:    k.difficulty    ?? null,
    cpc_usd:       k.cpc_usd       ?? null,
    intent:        k.intent        ?? null,
    trend_data:    k.trend_data    ? JSON.stringify(k.trend_data) : null,
  }))

  const { data, error } = await admin()
    .from('keywords')
    .upsert(rows, { onConflict: 'workspace_id,keyword,country_code' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keywords: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id: string }
  const { error } = await admin().from('keywords').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
