import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createClient as createAdmin } from '@supabase/supabase-js'

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
    name: 'load_bot_config',
    description: 'Load the bot persona, topics, and daily limits.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'fetch_home_timeline',
    description: 'Fetch recent tweets from the For You / home timeline.',
    input_schema: {
      type: 'object' as const,
      properties: {
        max_results: { type: 'number', description: 'Max tweets to fetch (default 20, max 100)' },
      },
      required: [],
    },
  },
  {
    name: 'score_tweets',
    description: 'Score fetched tweets by relevance to configured topics and quote-tweet potential.',
    input_schema: {
      type: 'object' as const,
      properties: {
        tweets: { type: 'array', items: { type: 'object' } },
        topics: { type: 'array', items: { type: 'string' } },
      },
      required: ['tweets', 'topics'],
    },
  },
  {
    name: 'generate_quote_tweet',
    description: 'Generate a quote tweet in the configured brand voice.',
    input_schema: {
      type: 'object' as const,
      properties: {
        source_tweet_id:      { type: 'string' },
        source_tweet_content: { type: 'string' },
        source_author:        { type: 'string' },
      },
      required: ['source_tweet_id', 'source_tweet_content'],
    },
  },
  {
    name: 'post_quote_tweet',
    description: 'Post the generated quote tweet to X/Twitter.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content:         { type: 'string', description: 'Tweet text (max 280 chars)' },
        quote_tweet_id:  { type: 'string', description: 'ID of the tweet being quoted' },
        source_username: { type: 'string' },
        source_content:  { type: 'string' },
      },
      required: ['content', 'quote_tweet_id'],
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
    let quotesPostedToday = 0
    let dailyLimit = 5
    let accessToken: string | null = null

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
              content: `You are an X/Twitter engagement bot. Your job: find great tweets to quote, write insightful quotes in the brand voice, and post them.
Workspace: ${workspaceId}
Steps: 1) load config, 2) fetch timeline, 3) score tweets, 4) generate quotes for top ones, 5) post (respect daily limit).`,
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

        if (name === 'load_bot_config') {
          const { data: cfg } = await admin()
            .from('twitter_bot_configs')
            .select('*')
            .eq('workspace_id', workspaceId)
            .maybeSingle()
          const { data: conn } = await admin()
            .from('twitter_connections')
            .select('access_token_enc, twitter_username')
            .eq('workspace_id', workspaceId)
            .maybeSingle()

          if (!cfg || !conn) {
            result = 'Bot not configured. Please connect Twitter and configure the bot persona first.'
          } else {
            dailyLimit  = (cfg as Record<string, unknown>).daily_quote_limit as number ?? 5
            const { decrypt } = await import('@/lib/encryption')
            accessToken = decrypt((conn as Record<string, unknown>).access_token_enc as string)
            result = JSON.stringify({
              persona:    (cfg as Record<string, unknown>).persona_prompt,
              topics:     (cfg as Record<string, unknown>).topics,
              voiceExamples: (cfg as Record<string, unknown>).voice_examples,
              dailyLimit,
              username:   (conn as Record<string, unknown>).twitter_username,
            })
          }
        }

        else if (name === 'fetch_home_timeline') {
          if (!accessToken) { result = 'Not authenticated'; }
          else {
            try {
              const maxResults = Math.min((input.max_results as number) ?? 20, 100)
              const { data: cursor } = await admin()
                .from('twitter_connections')
                .select('pagination_cursor')
                .eq('workspace_id', workspaceId)
                .maybeSingle()

              const url = new URL('https://api.twitter.com/2/timelines/home')
              url.searchParams.set('max_results', String(maxResults))
              url.searchParams.set('tweet.fields', 'author_id,public_metrics,created_at')
              url.searchParams.set('expansions', 'author_id')
              url.searchParams.set('user.fields', 'username,name')
              if ((cursor as Record<string, unknown> | null)?.pagination_cursor) {
                url.searchParams.set('pagination_token', (cursor as Record<string, unknown>).pagination_cursor as string)
              }

              const tRes = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(15000),
              })
              const tData = await tRes.json() as {
                data?: Array<{ id: string; text: string; author_id: string; public_metrics: Record<string, number> }>
                includes?: { users?: Array<{ id: string; username: string }> }
                meta?: { next_token?: string }
              }

              if (tData.meta?.next_token) {
                await admin().from('twitter_connections').update({ pagination_cursor: tData.meta.next_token }).eq('workspace_id', workspaceId)
              }

              const users = new Map((tData.includes?.users ?? []).map(u => [u.id, u.username]))
              const tweets = (tData.data ?? []).map(t => ({
                id:      t.id,
                content: t.text,
                author:  users.get(t.author_id) ?? 'unknown',
                likes:   t.public_metrics?.like_count ?? 0,
                retweets: t.public_metrics?.retweet_count ?? 0,
              }))

              // Save to feed cache
              for (const tweet of tweets) {
                await admin().from('twitter_feed_tweets').upsert({
                  workspace_id:    workspaceId,
                  tweet_id:        tweet.id,
                  author_username: tweet.author,
                  content:         tweet.content,
                }, { onConflict: 'workspace_id,tweet_id' })
              }

              result = JSON.stringify(tweets)
            } catch (e) {
              result = `Error fetching timeline: ${String(e)}`
            }
          }
        }

        else if (name === 'score_tweets') {
          const tweets = input.tweets as Array<{ id: string; content: string; author: string }>
          const topics = input.topics as string[]
          const prompt = `Score these tweets for quote-tweet potential (1–10) based on topics: ${topics.join(', ')}.
Return JSON: [{"id":"...", "score": 8, "reason": "..."}, ...]
Only score ≥6 as worth quoting.

Tweets: ${JSON.stringify(tweets.slice(0, 30))}`
          const aiRes  = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = aiData.choices[0]?.message?.content ?? '[]'

          // Update scores in DB
          try {
            const scored = JSON.parse(result) as Array<{ id: string; score: number; reason: string }>
            for (const s of scored) {
              await admin().from('twitter_feed_tweets')
                .update({ ai_score: s.score, ai_reason: s.reason })
                .eq('workspace_id', workspaceId)
                .eq('tweet_id', s.id)
            }
          } catch { /* ignore */ }
        }

        else if (name === 'generate_quote_tweet') {
          const { data: cfg } = await admin()
            .from('twitter_bot_configs')
            .select('persona_prompt, voice_examples')
            .eq('workspace_id', workspaceId)
            .maybeSingle()

          const persona = (cfg as Record<string, unknown> | null)?.persona_prompt as string ?? 'Insightful marketing professional'
          const examples = ((cfg as Record<string, unknown> | null)?.voice_examples as string[] ?? []).slice(0, 3)

          const prompt = `You are: ${persona}

Voice examples:
${examples.map((e, i) => `${i + 1}. "${e}"`).join('\n')}

Write a quote tweet for this tweet by @${input.source_author}:
"${input.source_tweet_content}"

Rules:
- Max 250 characters (leave room for the quoted tweet link)
- Match the voice examples above
- Add value, insight, or a contrarian angle
- No hashtag spam (max 1-2 if relevant)
- No "great point!" filler

Return ONLY the tweet text, nothing else.`

          const aiRes  = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = aiData.choices[0]?.message?.content?.trim() ?? ''
        }

        else if (name === 'post_quote_tweet') {
          if (quotesPostedToday >= dailyLimit) {
            result = `Daily limit of ${dailyLimit} quote tweets reached. Stopping.`
          } else if (!accessToken) {
            result = 'Not authenticated'
          } else {
            try {
              const tRes = await fetch('https://api.twitter.com/2/tweets', {
                method: 'POST',
                headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  text:  input.content,
                  quote_tweet_id: input.quote_tweet_id,
                }),
                signal: AbortSignal.timeout(15000),
              })
              const tData = await tRes.json() as { data?: { id: string } }
              if (tData.data?.id) {
                quotesPostedToday++
                await admin().from('twitter_actions').insert({
                  workspace_id:    workspaceId,
                  source_tweet_id: input.quote_tweet_id,
                  source_username: input.source_username ?? '',
                  source_content:  input.source_content  ?? '',
                  quote_tweet_id:  tData.data.id,
                  quote_content:   input.content,
                })
                result = `Posted! Tweet ID: ${tData.data.id}. (${quotesPostedToday}/${dailyLimit} today)`
              } else {
                result = `Twitter API error: ${JSON.stringify(tData)}`
              }
            } catch (e) {
              result = `Error posting: ${String(e)}`
            }
          }
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
