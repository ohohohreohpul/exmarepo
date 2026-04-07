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
  const siteId      = req.nextUrl.searchParams.get('siteId')
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

  let query = admin()
    .from('seo_pages')
    .select('id, site_id, url, title, meta_description, h1, word_count, index_status, last_crawled_at')
    .eq('workspace_id', workspaceId)
    .order('last_crawled_at', { ascending: false })
    .limit(200)

  if (siteId) query = query.eq('site_id', siteId)

  const { data: pages, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const enriched = await Promise.all((pages ?? []).map(async page => {
    const { data: issues } = await admin()
      .from('seo_issues')
      .select('severity')
      .eq('page_id', page.id)
      .eq('status', 'open')
    const counts = { critical: 0, warning: 0, info: 0 }
    for (const i of (issues ?? [])) {
      const s = (i as { severity: string }).severity as keyof typeof counts
      if (s in counts) counts[s]++
    }
    return { ...page, issue_counts: counts }
  }))

  return NextResponse.json({ pages: enriched })
}
