import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'
import { buildKeywordResearchPrompt, buildKeywordEstimationPrompt, parseKeywordEstimations } from '@/lib/keywords'

export const runtime    = 'nodejs'
export const maxDuration = 120

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

const TOOLS = [
  {
    name: 'research_keywords',
    description: 'Generate keyword ideas for a topic using AI. Call this first with the seed topic.',
    input_schema: {
      type: 'object' as const,
      properties: {
        topic: { type: 'string', description: 'Seed topic or niche to research' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'estimate_keyword_metrics',
    description: 'Estimate search volume, difficulty, CPC, and intent for a list of keywords.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: { type: 'array', items: { type: 'string' }, description: 'List of keywords to estimate' },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'get_existing_keywords',
    description: 'Fetch already tracked keywords for this workspace to avoid duplicates.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'save_keywords',
    description: 'Save keyword estimates to the database.',
    input_schema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              keyword: { type: 'string' },
              volume: { type: 'number' },
              difficulty: { type: 'number' },
              cpcUsd: { type: 'number' },
              intent: { type: 'string' },
              trendData: { type: 'array', items: { type: 'number' } },
            },
          },
        },
      },
      required: ['keywords'],
    },
  },
  {
    name: 'cluster_keywords',
    description: 'Group saved keywords into topic clusters.',
    input_schema: {
      type: 'object' as const,
      properties: {
        clusters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              keywords: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
      required: ['clusters'],
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
    const maxIter = 8

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
              content: `You are an expert SEO keyword researcher. Use your tools to research, estimate, save, and cluster keywords for the workspace.
Workspace ID: ${workspaceId}
Always: 1) get existing keywords first to avoid duplicates, 2) research keywords, 3) estimate metrics, 4) save, 5) cluster.`,
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

        if (name === 'get_existing_keywords') {
          const { data: kws } = await admin().from('keywords').select('keyword').eq('workspace_id', workspaceId).limit(500)
          result = JSON.stringify((kws ?? []).map((k: { keyword: string }) => k.keyword))
        }

        else if (name === 'research_keywords') {
          const topic = input.topic as string
          const { data: kws } = await admin().from('keywords').select('keyword').eq('workspace_id', workspaceId).limit(500)
          const existing = (kws ?? []).map((k: { keyword: string }) => k.keyword)
          const prompt   = buildKeywordResearchPrompt(topic, existing)
          const aiRes    = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = aiData.choices[0]?.message?.content ?? '[]'
        }

        else if (name === 'estimate_keyword_metrics') {
          const keywords = input.keywords as string[]
          const prompt   = buildKeywordEstimationPrompt(keywords)
          const aiRes    = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData   = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          const raw      = aiData.choices[0]?.message?.content ?? '[]'
          const estimates = parseKeywordEstimations(raw)
          result = JSON.stringify(estimates)
        }

        else if (name === 'save_keywords') {
          const keywords = input.keywords as Array<{ keyword: string; volume: number; difficulty: number; cpcUsd: number; intent: string; trendData: number[] }>
          const rows = keywords.map(k => ({
            workspace_id:  workspaceId,
            keyword:       k.keyword.toLowerCase().trim(),
            country_code:  'us',
            search_volume: k.volume,
            difficulty:    k.difficulty,
            cpc_usd:       k.cpcUsd,
            intent:        k.intent,
            trend_data:    JSON.stringify(k.trendData ?? []),
          }))
          const { error } = await admin().from('keywords').upsert(rows, { onConflict: 'workspace_id,keyword,country_code' })
          result = error ? `Error: ${error.message}` : `Saved ${rows.length} keywords`
        }

        else if (name === 'cluster_keywords') {
          const clusters = input.clusters as Array<{ name: string; keywords: string[] }>
          let saved = 0
          for (const cluster of clusters) {
            const { data: clusterRow } = await admin()
              .from('keyword_clusters')
              .insert({ workspace_id: workspaceId, name: cluster.name })
              .select()
              .single()
            if (!clusterRow) continue
            for (const kw of cluster.keywords) {
              const { data: kwRow } = await admin()
                .from('keywords')
                .select('id')
                .eq('workspace_id', workspaceId)
                .eq('keyword', kw.toLowerCase().trim())
                .maybeSingle()
              if (kwRow) {
                await admin().from('keyword_cluster_items').upsert({ cluster_id: (clusterRow as { id: string }).id, keyword_id: (kwRow as { id: string }).id })
                saved++
              }
            }
          }
          result = `Created ${clusters.length} clusters with ${saved} items`
        }

        send({ type: 'tool_result', name, result: result.slice(0, 500) })
        toolResults.push({ tool_use_id: tc.id, content: result })
      }

      history.push({
        role: 'tool',
        content: JSON.stringify(toolResults),
      })
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
