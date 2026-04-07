import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { decrypt } from '@/lib/encryption'
import { fetchWpContent, extractTitle, extractMetaDescription, stripHtml } from '@/lib/wordpress'
import { parsePageSeo, detectSeoIssues } from '@/lib/seo-parser'

export const runtime  = 'nodejs'
export const maxDuration = 120

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function blank(): ReturnType<typeof parsePageSeo> {
  return {
    title: null as string | null,
    metaDescription: null as string | null,
    h1: null as string | null,
    h2s: [],
    canonical: null as string | null,
    robotsMeta: null as string | null,
    schemaTypes: [],
    wordCount: 0,
    internalLinks: 0,
    crawlHash: '',
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: siteId } = await params
  const { workspaceId } = await req.json() as { workspaceId: string }

  const { data: site } = await admin()
    .from('site_connections')
    .select('*')
    .eq('id', siteId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 })

  const { data: run } = await admin()
    .from('seo_agent_runs')
    .insert({ workspace_id: workspaceId, agent_type: 'auditor', status: 'running' })
    .select()
    .single()

  let pageCount = 0
  let issueCount = 0

  try {
    if (site.type === 'wordpress' && site.wp_username && site.wp_password_enc) {
      const password = decrypt(site.wp_password_enc as string)
      const wpPosts  = await fetchWpContent(site.site_url as string, site.wp_username as string, password)

      for (const post of wpPosts) {
        const url = post.link
        let seo = blank()
        try {
          const htmlRes = await fetch(url, { signal: AbortSignal.timeout(10000) })
          if (htmlRes.ok) {
            const html = await htmlRes.text()
            seo = parsePageSeo(html, url)
          } else {
            seo.title           = extractTitle(post)
            seo.metaDescription = stripHtml(extractMetaDescription(post))
          }
        } catch {
          seo.title           = extractTitle(post)
          seo.metaDescription = stripHtml(extractMetaDescription(post))
        }

        const { data: page } = await admin()
          .from('seo_pages')
          .upsert({
            workspace_id:     workspaceId,
            site_id:          siteId,
            url,
            title:            seo.title,
            meta_description: seo.metaDescription,
            h1:               seo.h1,
            h2s:              seo.h2s,
            canonical:        seo.canonical,
            robots_meta:      seo.robotsMeta,
            schema_types:     seo.schemaTypes,
            word_count:       seo.wordCount,
            internal_links:   seo.internalLinks,
            crawl_hash:       seo.crawlHash,
            index_status:     seo.robotsMeta?.includes('noindex') ? 'noindex' : 'indexed',
            last_crawled_at:  new Date().toISOString(),
          }, { onConflict: 'site_id,url' })
          .select()
          .single()

        if (page) {
          pageCount++
          const issues = detectSeoIssues(seo, url)
          await admin().from('seo_issues').delete().eq('page_id', page.id).eq('status', 'open')
          for (const iss of issues) {
            await admin().from('seo_issues').insert({
              workspace_id:   workspaceId,
              site_id:        siteId,
              page_id:        page.id,
              issue_type:     iss.type,
              severity:       iss.severity,
              description:    iss.description,
              recommendation: iss.recommendation,
            })
            issueCount++
          }
        }
      }
    } else {
      // HTML site — try sitemap first, then link discovery
      const siteUrl = site.site_url as string
      const visited = new Set<string>()
      const queue   = [`${siteUrl}/sitemap.xml`]
      let urls: string[] = []

      try {
        const sm = await fetch(`${siteUrl}/sitemap.xml`, { signal: AbortSignal.timeout(10000) })
        if (sm.ok) {
          const xml = await sm.text()
          const locMatches = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)]
          urls = locMatches.map(m => m[1].trim()).slice(0, 50)
        }
      } catch { /* no sitemap */ }

      if (urls.length === 0) urls = [siteUrl]
      queue.length = 0
      queue.push(...urls)

      while (queue.length > 0 && visited.size < 50) {
        const url = queue.shift()!
        if (visited.has(url)) continue
        visited.add(url)

        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
          if (!res.ok) continue
          const html = await res.text()
          const seo  = parsePageSeo(html, url)

          const { data: page } = await admin()
            .from('seo_pages')
            .upsert({
              workspace_id:     workspaceId,
              site_id:          siteId,
              url,
              title:            seo.title,
              meta_description: seo.metaDescription,
              h1:               seo.h1,
              h2s:              seo.h2s,
              canonical:        seo.canonical,
              robots_meta:      seo.robotsMeta,
              schema_types:     seo.schemaTypes,
              word_count:       seo.wordCount,
              internal_links:   seo.internalLinks,
              crawl_hash:       seo.crawlHash,
              index_status:     seo.robotsMeta?.includes('noindex') ? 'noindex' : 'indexed',
              last_crawled_at:  new Date().toISOString(),
            }, { onConflict: 'site_id,url' })
            .select()
            .single()

          if (page) {
            pageCount++
            const issues = detectSeoIssues(seo, url)
            await admin().from('seo_issues').delete().eq('page_id', page.id).eq('status', 'open')
            for (const iss of issues) {
              await admin().from('seo_issues').insert({
                workspace_id:   workspaceId,
                site_id:        siteId,
                page_id:        page.id,
                issue_type:     iss.type,
                severity:       iss.severity,
                description:    iss.description,
                recommendation: iss.recommendation,
              })
              issueCount++
            }
          }
        } catch { /* skip failed URLs */ }
      }
    }

    await admin().from('site_connections').update({ last_crawled_at: new Date().toISOString(), status: 'active' }).eq('id', siteId)
    if (run) {
      await admin().from('seo_agent_runs').update({ status: 'completed', finished_at: new Date().toISOString(), summary: `Crawled ${pageCount} pages, found ${issueCount} issues` }).eq('id', run.id)
    }

    return NextResponse.json({ pageCount, issueCount })
  } catch (e) {
    if (run) {
      await admin().from('seo_agent_runs').update({ status: 'failed', error: String(e), finished_at: new Date().toISOString() }).eq('id', run.id)
    }
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
