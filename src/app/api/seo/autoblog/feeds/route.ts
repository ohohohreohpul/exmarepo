import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { fetchRssFeed } from '@/lib/rss'

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

  const { data: feeds, error } = await admin()
    .from('rss_feeds')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = await Promise.all((feeds ?? []).map(async feed => {
    const { count } = await admin()
      .from('rss_items')
      .select('id', { count: 'exact', head: true })
      .eq('feed_id', feed.id)
    return { ...feed, item_count: count ?? 0 }
  }))

  return NextResponse.json({ feeds: enriched })
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workspaceId, feedUrl } = await req.json() as { workspaceId: string; feedUrl: string }

  // Test feed
  let displayName = feedUrl
  try {
    const feed = await fetchRssFeed(feedUrl)
    displayName = feed.title || feedUrl
  } catch (e) {
    return NextResponse.json({ error: `Could not fetch feed: ${String(e)}` }, { status: 400 })
  }

  const { data, error } = await admin()
    .from('rss_feeds')
    .upsert({ workspace_id: workspaceId, feed_url: feedUrl, display_name: displayName }, { onConflict: 'workspace_id,feed_url' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ feed: data })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await req.json() as { id: string }
  const { error } = await admin().from('rss_feeds').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
