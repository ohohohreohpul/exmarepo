import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { fetchRssFeed } from '@/lib/rss'

export const runtime     = 'nodejs'
export const maxDuration = 300

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

function markdownToHtml(md: string): string {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gm, (line) => {
      if (line.startsWith('<h') || line.startsWith('</p>') || line === '') return line
      return line
    })
    .replace(/^(?!<[hp])(.+)/gm, (line) => line ? `<p>${line}</p>` : '')
}

const TOOLS = [
  {
    name: 'fetch_rss_feeds',
    description: 'Fetch recent items from all RSS feeds configured for this workspace.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'score_topics',
    description: 'Score RSS items by relevance and uniqueness to decide which to write about.',
    input_schema: {
      type: 'object' as const,
      properties: {
        items: { type: 'array', items: { type: 'object' } },
      },
      required: ['items'],
    },
  },
  {
    name: 'generate_blog_post',
    description: 'Generate a full SEO-optimised blog post from an RSS item or topic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic:           { type: 'string' },
        source_title:    { type: 'string' },
        source_summary:  { type: 'string' },
        target_keywords: { type: 'array', items: { type: 'string' } },
      },
      required: ['topic'],
    },
  },
  {
    name: 'save_draft',
    description: 'Save a generated blog post as a draft.',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:            { type: 'string' },
        slug:             { type: 'string' },
        meta_description: { type: 'string' },
        content_markdown: { type: 'string' },
        target_keywords:  { type: 'array', items: { type: 'string' } },
        rss_item_id:      { type: 'string' },
      },
      required: ['title', 'content_markdown'],
    },
  },
  {
    name: 'get_pending_drafts',
    description: 'Get drafts waiting for approval.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
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

  const { data: profile } = await admin()
    .from('workspace_profiles')
    .select('brand_name, niche')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const brandName = (profile as Record<string, unknown> | null)?.brand_name as string ?? 'our brand'
  const niche     = (profile as Record<string, unknown> | null)?.niche as string ?? 'general'

  const encoder = new TextEncoder()
  const stream  = new TransformStream()
  const writer  = stream.writable.getWriter()

  function send(obj: unknown) {
    writer.write(encoder.encode(JSON.stringify(obj) + '\n'))
  }

  ;(async () => {
    const history = [...messages]
    let iteration = 0
    const maxIter = 12

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
              content: `You are an autopilot blog writer for "${brandName}" in the ${niche} niche.
Workspace: ${workspaceId}
Steps: 1) fetch RSS items, 2) score topics for relevance, 3) generate 2–3 full blog posts, 4) save as drafts.
Each post must be 800–1200 words, SEO-optimised, with proper H2/H3 structure.`,
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

        if (name === 'fetch_rss_feeds') {
          const { data: feeds } = await admin()
            .from('rss_feeds')
            .select('id, feed_url, display_name')
            .eq('workspace_id', workspaceId)
            .eq('active', true)

          const allItems: Array<{ feedId: string; feedName: string; title: string; url: string; summary: string; publishedAt: string | null }> = []
          for (const feed of (feeds ?? [])) {
            try {
              const rss = await fetchRssFeed((feed as { feed_url: string }).feed_url)
              for (const item of rss.items.slice(0, 5)) {
                // Save item
                await admin().from('rss_items').upsert({
                  feed_id:      (feed as { id: string }).id,
                  guid:         item.guid,
                  title:        item.title,
                  url:          item.url,
                  summary:      item.summary.slice(0, 500),
                  full_content: item.fullContent.slice(0, 3000),
                  author:       item.author,
                  published_at: item.publishedAt,
                }, { onConflict: 'feed_id,guid' })

                allItems.push({
                  feedId:      (feed as { id: string }).id,
                  feedName:    (feed as { display_name: string }).display_name,
                  title:       item.title,
                  url:         item.url,
                  summary:     item.summary.slice(0, 200),
                  publishedAt: item.publishedAt,
                })
              }
            } catch { /* skip failed feeds */ }
          }
          result = JSON.stringify(allItems)
        }

        else if (name === 'score_topics') {
          const items = input.items as Array<{ title: string; summary: string }>
          const prompt = `Score these RSS items for blog post potential (1-10) for a ${niche} brand.
Return JSON array: [{"title":"...", "score": 8, "reason": "..."}, ...]

Items: ${JSON.stringify(items.slice(0, 20))}`
          const aiRes  = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = aiData.choices[0]?.message?.content ?? '[]'
        }

        else if (name === 'generate_blog_post') {
          const prompt = `Write a comprehensive, SEO-optimised blog post for "${brandName}".

Topic: ${input.topic}
${input.source_title ? `Based on: ${input.source_title}` : ''}
${input.source_summary ? `Summary: ${input.source_summary}` : ''}
Target keywords: ${(input.target_keywords as string[] ?? []).join(', ')}

Requirements:
- 900–1200 words
- Compelling title with primary keyword
- Meta description (150 chars max)
- URL slug (lowercase, hyphens)
- H2 and H3 subheadings
- Include an FAQ section at the end (3–5 questions)
- Natural keyword placement, not stuffed
- End with a call to action

Return JSON:
{
  "title": "...",
  "slug": "...",
  "meta_description": "...",
  "content_markdown": "...(full markdown post)...",
  "target_keywords": ["kw1", "kw2"],
  "faq": [{"q":"...","a":"..."}]
}`

          const aiRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-sonnet-4-5', messages: [{ role: 'user', content: prompt }], max_tokens: 4000 }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = aiData.choices[0]?.message?.content ?? '{}'
        }

        else if (name === 'save_draft') {
          const contentHtml = markdownToHtml(input.content_markdown as string)
          const wordCount   = (input.content_markdown as string).split(' ').filter(Boolean).length
          const { error } = await admin().from('blog_drafts').insert({
            workspace_id:     workspaceId,
            status:           'draft',
            title:            input.title,
            slug:             input.slug,
            meta_description: input.meta_description,
            content_markdown: input.content_markdown,
            content_html:     contentHtml,
            target_keywords:  input.target_keywords ?? [],
            word_count:       wordCount,
            rss_item_id:      input.rss_item_id ?? null,
          })
          result = error ? `Error: ${error.message}` : `Draft saved: "${input.title}" (${wordCount} words)`
        }

        else if (name === 'get_pending_drafts') {
          const { data: drafts } = await admin()
            .from('blog_drafts')
            .select('id, title, status, word_count, created_at')
            .eq('workspace_id', workspaceId)
            .eq('status', 'draft')
            .order('created_at', { ascending: false })
            .limit(10)
          result = JSON.stringify(drafts ?? [])
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
