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

  const { data: sites, error } = await admin()
    .from('site_connections')
    .select('id, type, display_name, site_url, status, last_crawled_at, created_at')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach counts
  const enriched = await Promise.all((sites ?? []).map(async site => {
    const [pages, issues] = await Promise.all([
      admin().from('seo_pages').select('id', { count: 'exact', head: true }).eq('site_id', site.id),
      admin().from('seo_issues').select('id, severity', { count: 'exact' }).eq('site_id', site.id).eq('status', 'open'),
    ])
    const issueCounts = { critical: 0, warning: 0, info: 0 }
    for (const iss of (issues.data ?? [])) {
      const s = (iss as { severity: string }).severity as keyof typeof issueCounts
      if (s in issueCounts) issueCounts[s]++
    }
    return { ...site, page_count: pages.count ?? 0, issue_counts: issueCounts }
  }))

  return NextResponse.json({ sites: enriched })
}
