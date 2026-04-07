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
    name: 'get_pending_quote_tweets',
    description: 'Get quote tweets that have not yet had analytics fetched today.',
    input_schema: { type: 'object' as const, properties: {}, required: [] },
  },
  {
    name: 'fetch_tweet_analytics',
    description: 'Fetch likes, replies, and retweet counts for a posted quote tweet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_id:      { type: 'string', description: 'Twitter action DB ID' },
        quote_tweet_id: { type: 'string', description: 'Twitter tweet ID' },
      },
      required: ['action_id', 'quote_tweet_id'],
    },
  },
  {
    name: 'check_engagement_threshold',
    description: 'Check if a tweet has met the engagement threshold for affiliate link reply.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_id:     { type: 'string' },
        likes:         { type: 'number' },
        replies:       { type: 'number' },
        retweets:      { type: 'number' },
      },
      required: ['action_id', 'likes', 'replies'],
    },
  },
  {
    name: 'generate_affiliate_reply',
    description: 'Generate a reply tweet with an affiliate link for a high-engagement quote tweet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        quote_tweet_content: { type: 'string' },
        source_topic:        { type: 'string' },
      },
      required: ['quote_tweet_content'],
    },
  },
  {
    name: 'post_affiliate_reply',
    description: 'Post the affiliate reply to the quote tweet.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action_id:      { type: 'string' },
        quote_tweet_id: { type: 'string' },
        content:        { type: 'string' },
        affiliate_link: { type: 'string' },
      },
      required: ['action_id', 'quote_tweet_id', 'content'],
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
    let accessToken: string | null = null
    let thresholdLikes   = 10
    let thresholdReplies = 3
    let affiliateLinks: Record<string, string> = {}

    // Pre-load config
    const { data: cfg } = await admin()
      .from('twitter_bot_configs')
      .select('engagement_threshold_likes, engagement_threshold_replies, affiliate_links, persona_prompt')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    const { data: conn } = await admin()
      .from('twitter_connections')
      .select('access_token_enc')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (cfg) {
      thresholdLikes   = (cfg as Record<string, unknown>).engagement_threshold_likes   as number ?? 10
      thresholdReplies = (cfg as Record<string, unknown>).engagement_threshold_replies as number ?? 3
      affiliateLinks   = (cfg as Record<string, unknown>).affiliate_links as Record<string, string> ?? {}
    }
    if (conn) {
      const { decrypt } = await import('@/lib/encryption')
      accessToken = decrypt((conn as Record<string, unknown>).access_token_enc as string)
    }

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
              content: `You are an X/Twitter analytics & monetization bot.
Workspace: ${workspaceId}
Thresholds: ${thresholdLikes} likes OR ${thresholdReplies} replies triggers affiliate reply.
Available affiliate links: ${JSON.stringify(Object.keys(affiliateLinks))}

Steps: 1) get pending quote tweets, 2) fetch analytics for each, 3) check thresholds, 4) generate + post affiliate replies for qualifying tweets.
IMPORTANT: Only post affiliate reply once per tweet (check affiliate_replied flag).`,
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

        if (name === 'get_pending_quote_tweets') {
          const { data: actions } = await admin()
            .from('twitter_actions')
            .select('id, quote_tweet_id, quote_content, source_content, likes_count, replies_count, affiliate_replied, posted_at')
            .eq('workspace_id', workspaceId)
            .eq('affiliate_replied', false)
            .order('posted_at', { ascending: false })
            .limit(20)
          result = JSON.stringify(actions ?? [])
        }

        else if (name === 'fetch_tweet_analytics') {
          if (!accessToken) { result = 'Not authenticated'; }
          else {
            try {
              const tRes = await fetch(
                `https://api.twitter.com/2/tweets/${input.quote_tweet_id}?tweet.fields=public_metrics`,
                { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10000) }
              )
              const tData = await tRes.json() as { data?: { public_metrics: Record<string, number> } }
              const m = tData.data?.public_metrics ?? {}
              const likes    = m.like_count    ?? 0
              const replies  = m.reply_count   ?? 0
              const retweets = m.retweet_count ?? 0

              await admin().from('twitter_actions').update({ likes_count: likes, replies_count: replies, retweets_count: retweets }).eq('id', input.action_id)
              result = JSON.stringify({ likes, replies, retweets })
            } catch (e) {
              result = `Error: ${String(e)}`
            }
          }
        }

        else if (name === 'check_engagement_threshold') {
          const likes   = input.likes   as number
          const replies = input.replies as number
          const qualifies = likes >= thresholdLikes || replies >= thresholdReplies
          result = JSON.stringify({ qualifies, thresholdLikes, thresholdReplies, likes, replies })
        }

        else if (name === 'generate_affiliate_reply') {
          const personaPrompt = (cfg as Record<string, unknown> | null)?.persona_prompt as string ?? 'Helpful marketing professional'
          const linkKeys = Object.keys(affiliateLinks)
          const linkKey  = linkKeys[0] ?? ''
          const link     = affiliateLinks[linkKey] ?? ''

          const prompt = `You are: ${personaPrompt}

This quote tweet got great engagement:
"${input.quote_tweet_content}"

Write a reply that naturally mentions this resource: ${link} (${linkKey})

Rules:
- Max 260 chars
- Feels organic, not spammy
- Relates to the tweet topic
- Natural call-to-action
- Include the URL

Return ONLY the reply text.`

          const aiRes  = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'anthropic/claude-haiku-4-5', messages: [{ role: 'user', content: prompt }] }),
          })
          const aiData = await aiRes.json() as { choices: Array<{ message: { content: string } }> }
          result = JSON.stringify({ content: aiData.choices[0]?.message?.content?.trim() ?? '', affiliateLink: link })
        }

        else if (name === 'post_affiliate_reply') {
          if (!accessToken) { result = 'Not authenticated'; }
          else {
            // Guard: check not already replied
            const { data: action } = await admin()
              .from('twitter_actions')
              .select('affiliate_replied')
              .eq('id', input.action_id)
              .maybeSingle()

            if ((action as Record<string, unknown> | null)?.affiliate_replied) {
              result = 'Already posted affiliate reply for this tweet. Skipping.'
            } else {
              try {
                const tRes = await fetch('https://api.twitter.com/2/tweets', {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    text:  input.content,
                    reply: { in_reply_to_tweet_id: input.quote_tweet_id },
                  }),
                  signal: AbortSignal.timeout(15000),
                })
                const tData = await tRes.json() as { data?: { id: string } }
                if (tData.data?.id) {
                  await admin().from('twitter_actions').update({
                    affiliate_replied:  true,
                    affiliate_tweet_id: tData.data.id,
                    affiliate_link:     input.affiliate_link ?? '',
                  }).eq('id', input.action_id)
                  result = `Affiliate reply posted! ID: ${tData.data.id}`
                } else {
                  result = `Twitter API error: ${JSON.stringify(tData)}`
                }
              } catch (e) {
                result = `Error: ${String(e)}`
              }
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
