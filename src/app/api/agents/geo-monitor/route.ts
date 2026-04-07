import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { queryPerplexity, queryOpenRouterGeo, detectCitation } from '@/lib/perplexity'

export const runtime     = 'nodejs'
export const maxDuration = 180

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const TOOLS = [
  {
    name: 'get_monitored_queries',
    description: 'Get all GEO queries configured for this workspace.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'query_perplexity',
    description: 'Query Perplexity AI and check if the brand is cited.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query_id:   { type: 'string' },
        query_text: { type: 'string' },
      },
      required: ['query_id', 'query_text'],
    },
  },
  {
    name: 'query_chatgpt',
    description: 'Query ChatGPT (via OpenRouter) and check if the brand is cited.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query_id:   { type: 'string' },
        query_text: { type: 'string' },
      },
      required: ['query_id', 'query_text'],
    },
  },
  {
    name: 'analyze_citation_trends',
    description: 'Analyze citation results and summarize GEO performance.',
    input_schema: {
      type: 'object' as const,
      properties: {
        results: { type: 'array', items: { type: 'object' } },
      },
      required: ['results'],
    },
  },
  {
    name: 'suggest_geo_improvements',
    description: 'Save AI visibility improvement suggestions.',
    input_schema: {
      type: 'object' as const,
      properties: {
        suggestions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              suggestion: { type: 'string' },
              priority:   { type: 'string', enum: ['critical', 'warning', 'info'] },
            },
          },
        },
      },
      required: ['suggestions'],
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

  // Get workspace brand info
  const { data: profile } = await admin()
    .from('workspace_profiles')
    .select('brand_name, site_urls')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const brandName = (profile as Record<string, unknown> | null)?.brand_name as string ?? 'your brand'
  const siteUrls  = (profile as Record<string, unknown> | null)?.site_urls as string[] ?? []

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
          model: 'anthropic/claude-haiku-4-5',
          messages: [
            {
              role: 'system',
              content: `You are a GEO (Generative Engine Optimization) monitor. Check if "${brandName}" appears in AI search results.
Workspace: ${workspaceId}
Steps: 1) get queries, 2) run each through Perplexity/ChatGPT, 3) analyze trends, 4) suggest improvements.`,
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

        if (name === 'get_monitored_queries') {
          const { data: queries } = await admin()
            .from('geo_queries')
            .select('id, query_text, engine')
            .eq('workspace_id', workspaceId)
            .eq('active', true)
          result = JSON.stringify(queries ?? [])
        }

        else if (name === 'query_perplexity' || name === 'query_chatgpt') {
          const queryId   = input.query_id as string
          const queryText = input.query_text as string
          let response = ''
          try {
            if (name === 'query_perplexity' && process.env.PERPLEXITY_API_KEY) {
              response = await queryPerplexity(queryText)
            } else {
              response = await queryOpenRouterGeo(queryText, apiKey)
            }
          } catch (e) {
            response = await queryOpenRouterGeo(queryText, apiKey).catch(() => `Error: ${String(e)}`)
          }

          const citation = detectCitation(response, brandName, siteUrls)
          await admin().from('geo_results').insert({
            query_id:         queryId,
            brand_cited:      citation.brandCited,
            brand_position:   citation.brandPosition,
            our_url_cited:    citation.ourUrlCited,
            cited_url:        citation.citedUrl,
            citation_context: citation.citationContext,
            raw_response:     response.slice(0, 2000),
          })
          result = JSON.stringify({ ...citation, rawResponse: undefined })
        }

        else if (name === 'analyze_citation_trends') {
          const results = input.results as Array<{ brandCited: boolean; brandPosition: number | null }>
          const cited   = results.filter(r => r.brandCited).length
          const rate    = results.length > 0 ? Math.round((cited / results.length) * 100) : 0
          result = `Citation rate: ${rate}% (${cited}/${results.length} queries). ` +
            (rate < 30 ? 'Low visibility — needs improvement.' : rate < 70 ? 'Moderate visibility.' : 'Good AI visibility.')
        }

        else if (name === 'suggest_geo_improvements') {
          const suggestions = input.suggestions as Array<{ suggestion: string; priority: string }>
          for (const s of suggestions) {
            await admin().from('geo_improvement_suggestions').insert({
              workspace_id: workspaceId,
              suggestion:   s.suggestion,
              priority:     s.priority ?? 'info',
            })
          }
          result = `Saved ${suggestions.length} suggestions`
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
