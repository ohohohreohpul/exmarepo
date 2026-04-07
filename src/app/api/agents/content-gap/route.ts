import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { parsePageSeo } from '@/lib/seo-parser'

export const runtime     = 'nodejs'
export const maxDuration = 120

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const TOOLS = [
  {
    name: 'get_own_pages',
    description: 'Get all crawled pages from your own sites to understand existing content.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'get_competitors',
    description: 'Get the list of tracked competitor sites.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'crawl_competitor_site',
    description: 'Crawl a competitor site to discover their pages and content.',
    input_schema: {
      type: 'object' as const,
      properties: {
        competitor_id: { type: 'string', description: 'Competitor site ID' },
        site_url:      { type: 'string', description: 'Competitor site URL' },
      },
      required: ['competitor_id', 'site_url'],
    },
  },
  {
    name: 'analyze_content_gaps',
    description: 'Analyze competitor pages vs own pages to identify topics not covered.',
    input_schema: {
      type: 'object' as const,
      properties: {
        own_topics:        { type: 'array', items: { type: 'string' } },
        competitor_topics: { type: 'array', items: { type: 'string' } },
      },
      required: ['own_topics', 'competitor_topics'],
    },
  },
  {
    name: 'save_gap',
    description: 'Save a content gap opportunity to the database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic:               { type: 'string' },
        opportunity_score:   { type: 'number', description: '0–100' },
        target_keywords:     { type: 'array', items: { type: 'string' } },
        suggested_title:     { type: 'string' },
        suggested_outline:   { type: 'array', items: { type: 'string' } },
        competitor_examples: { type: 'array', items: { type: 'string' } },
      },
      required: ['topic', 'opportunity_score'],
    },
  },
]

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Response('Unauthorized', { status: 401 })

  const { messages, workspaceId } = await req.json() as {
    messages: { role: string; content: string }[]
    workspaceId: string
  }

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) return new Response('OPENROUTER_API_KEY not set', { status: 500 })

  const encoder = new TextEncoder()
  const stream  = new TransformStream()
  const writer  = stream.writable.getWriter()

  function send(obj: unknown) {
    writer.write(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  ;(async () => {
    const history = [...messages]
    let iteration = 0
    const maxIter = 10

    while (iteration < maxIter) {
      iteration++
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'anthropic/claude-sonnet-4-5',
          messages: [
            {
              role: 'system',
              content: `You are an SEO content gap analyst. Find topics competitors cover that you don't.
Workspace: ${workspaceId}
Steps: 1) get own pages, 2) get competitors, 3) crawl each competitor, 4) analyze gaps, 5) save top opportunities.`,
            },
            ...history,
          ],
          tools: TOOLS,
          tool_choice: 'auto',
        }),
      })

      const data = await res.json() as {
        choices: Array<{
          message: { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
          finish_reason: string
        }>
      }

      const msg = data.choices[0]?.message
      if (!msg) break

      history.push({ role: msg.role, content: msg.content ?? '' })
      if (msg.content) send({ type: 'text', content: msg.content })
      if (!msg.tool_calls?.length || data.choices[0].finish_reason === 'stop') break

      const toolResults: Array<{ tool_use_id: string; content: string }> = []

      for (const tc of msg.tool_calls) {
        const name  = tc.function.name
        const input = JSON.parse(tc.function.arguments) as Record<string, unknown>
        send({ type: 'tool_call', name, input })

        let result = ''

        if (name === 'get_own_pages') {
          const { data: pages } = await admin()
            .from('seo_pages')
            .select('url, title, h1')
            .eq('workspace_id', workspaceId)
            .limit(200)
          result = JSON.stringify((pages ?? []).map((p: { url: string; title: string | null; h1: string | null }) => ({ url: p.url, title: p.title ?? p.h1 })))
        }

        else if (name === 'get_competitors') {
          const { data: comps } = await admin()
            .from('competitor_sites')
            .select('id, site_url, display_name')
            .eq('workspace_id', workspaceId)
          result = JSON.stringify(comps ?? [])
        }

        else if (name === 'crawl_competitor_site') {
          const competitorId = input.competitor_id as string
          const siteUrl      = input.site_url as string
          const urls: string[] = []

          try {
            const sm = await fetch(`${siteUrl}/sitemap.xml`, { signal: AbortSignal.timeout(10000) })
            if (sm.ok) {
              const xml  = await sm.text()
              const locs = [...xml.matchAll(/<loc>([\s\S]*?)<\/loc>/g)].map(m => m[1].trim())
              urls.push(...locs.slice(0, 30))
            }
          } catch { /* no sitemap */ }

          if (urls.length === 0) urls.push(siteUrl)

          const pages: Array<{ url: string; title: string; h1: string }> = []
          for (const url of urls.slice(0, 30)) {
            try {
              const r = await fetch(url, { signal: AbortSignal.timeout(8000) })
              if (!r.ok) continue
              const html = await r.text()
              const seo  = parsePageSeo(html, url)
              if (seo.title || seo.h1) {
                pages.push({ url, title: seo.title ?? '', h1: seo.h1 ?? '' })
                await admin().from('competitor_pages').upsert({ competitor_id: competitorId, url, title: seo.title, word_count: seo.wordCount, h1: seo.h1 }, { onConflict: 'competitor_id,url' })
              }
            } catch { /* skip */ }
          }

          await admin().from('competitor_sites').update({ last_crawled_at: new Date().toISOString() }).eq('id', competitorId)
          result = JSON.stringify(pages)
        }

        else if (name === 'analyze_content_gaps') {
          const own        = input.own_topics as string[]
          const competitor = input.competitor_topics as string[]
          const prompt = `You are an SEO expert. Identify content gaps.

My topics: ${own.slice(0, 50).join(', ')}
Competitor topics: ${competitor.slice(0, 100).join(', ')}

List 10 high-value topics the competitor covers that I don't. For each return JSON:
{ "topic": "...", "opportunity_score": 85, "keywords": ["kw1","kw2"], "suggested_title": "...", "outline": ["H2 1","H2 2","H2 3"] }

Return ONLY a JSON array.`

          const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = aiData.choices[0]?.message?.content ?? '[]'
        }

        else if (name === 'save_gap') {
          const { error } = await admin().from('content_gaps').insert({
            workspace_id:        workspaceId,
            topic:               input.topic,
            opportunity_score:   input.opportunity_score,
            target_keywords:     input.target_keywords ?? [],
            suggested_title:     input.suggested_title,
            suggested_outline:   input.suggested_outline ? JSON.stringify(input.suggested_outline) : null,
            competitor_examples: input.competitor_examples ? JSON.stringify(input.competitor_examples) : null,
          })
          result = error ? `Error: ${error.message}` : `Saved gap: ${input.topic}`
        }

        send({ type: 'tool_result', name, result: result.slice(0, 500) })
        toolResults.push({ tool_use_id: tc.id, content: result })
      }

      history.push({ role: 'tool', content: JSON.stringify(toolResults) })
    }

    send({ type: 'done' })
    writer.close()
  })().catch(err => {
    send({ type: 'error', message: String(err) })
    writer.close()
  })

  return new Response(stream.readable, {
    headers: { 'Content-Type': 'application/x-ndjson', 'Transfer-Encoding': 'chunked' },
  })
}
