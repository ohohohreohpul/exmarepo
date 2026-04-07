import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { decrypt } from '@/lib/encryption'
import { publishToWordPress } from '@/lib/wordpress'

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
  const status      = req.nextUrl.searchParams.get('status')
  if (!workspaceId) return NextResponse.json({ error: 'Missing workspaceId' }, { status: 400 })

  let query = admin()
    .from('blog_drafts')
    .select('id, status, title, slug, meta_description, word_count, target_keywords, published_url, wp_post_id, approved_at, published_at, created_at, site_id')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ drafts: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, action } = await req.json() as { id: string; action: 'approve' | 'dismiss' | 'publish' }

  if (action === 'approve') {
    await admin().from('blog_drafts').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'dismiss') {
    await admin().from('blog_drafts').update({ status: 'dismissed' }).eq('id', id)
    return NextResponse.json({ ok: true })
  }

  if (action === 'publish') {
    const { data: draft } = await admin()
      .from('blog_drafts')
      .select('*, site_connections(site_url, wp_username, wp_password_enc)')
      .eq('id', id)
      .single()

    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

    const site = (draft as Record<string, unknown>).site_connections as {
      site_url: string; wp_username: string; wp_password_enc: string
    } | null

    if (!site) return NextResponse.json({ error: 'No WordPress site linked to this draft' }, { status: 400 })

    await admin().from('blog_drafts').update({ status: 'publishing' }).eq('id', id)

    const password = decrypt(site.wp_password_enc)
    const result   = await publishToWordPress(site.site_url, site.wp_username, password, {
      title:           (draft as Record<string, unknown>).title as string,
      content:         (draft as Record<string, unknown>).content_html as string ?? (draft as Record<string, unknown>).content_markdown as string,
      slug:            (draft as Record<string, unknown>).slug as string,
      metaDescription: (draft as Record<string, unknown>).meta_description as string,
    })

    if (result.ok) {
      await admin().from('blog_drafts').update({
        status: 'published', wp_post_id: result.postId, published_url: result.url, published_at: new Date().toISOString()
      }).eq('id', id)
      return NextResponse.json({ ok: true, url: result.url })
    } else {
      await admin().from('blog_drafts').update({ status: 'failed', error_message: result.error }).eq('id', id)
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
