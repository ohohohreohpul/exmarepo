'use client'

import { useState, useEffect, useRef } from 'react'
import { Bird, Settings, Bot, Send, Loader2, Plus, Trash2, CheckCircle2, Heart, MessageCircle, Repeat2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface TwitterAction {
  id: string
  source_username: string
  source_content: string
  quote_content: string
  likes_count: number
  replies_count: number
  retweets_count: number
  affiliate_replied: boolean
  affiliate_link: string | null
  posted_at: string
}

interface BotConfig {
  persona_prompt: string | null
  voice_examples: string[] | null
  topics: string[] | null
  affiliate_links: Record<string, string> | null
  daily_quote_limit: number
  engagement_threshold_likes: number
  engagement_threshold_replies: number
  autopilot_enabled: boolean
}

interface TwitterConnection {
  twitter_username: string
  connected_at: string
}

interface Message { id: string; role: 'user' | 'assistant'; content: string; isStreaming?: boolean }
interface Props { workspaceId?: string }

export function SeoTwitterView({ workspaceId }: Props) {
  const [tab,        setTab]       = useState<'activity' | 'engage' | 'analytics' | 'settings'>('activity')
  const [connection, setConnection] = useState<TwitterConnection | null>(null)
  const [config,     setConfig]    = useState<BotConfig | null>(null)
  const [actions,    setActions]   = useState<TwitterAction[]>([])
  const [loading,    setLoading]   = useState(true)
  const [saving,     setSaving]    = useState(false)

  // Config form state
  const [persona,     setPersona]    = useState('')
  const [voiceExamples, setVoiceExamples] = useState<string[]>([''])
  const [topics,      setTopics]     = useState<string[]>([''])
  const [affLinks,    setAffLinks]   = useState<Array<{ name: string; url: string }>>([{ name: '', url: '' }])
  const [dailyLimit,  setDailyLimit] = useState(5)
  const [likeThresh,  setLikeThresh] = useState(10)
  const [replyThresh, setReplyThresh] = useState(3)
  const [autopilot,   setAutopilot]  = useState(false)

  // Agent tabs
  const [engageMessages,    setEngageMessages]    = useState<Message[]>([])
  const [analyticsMessages, setAnalyticsMessages] = useState<Message[]>([])
  const [engageInput,    setEngageInput]    = useState('')
  const [analyticsInput, setAnalyticsInput] = useState('')
  const [engageStreaming,    setEngageStreaming]    = useState(false)
  const [analyticsStreaming, setAnalyticsStreaming] = useState(false)
  const engageEndRef    = useRef<HTMLDivElement>(null)
  const analyticsEndRef = useRef<HTMLDivElement>(null)

  function load() {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/twitter/connect?workspaceId=${workspaceId}`).then(r => r.json()),
      fetch(`/api/twitter/config?workspaceId=${workspaceId}`).then(r => r.json()),
      fetch(`/api/twitter/actions?workspaceId=${workspaceId}`).then(r => r.json()),
    ]).then(([conn, cfg, acts]) => {
      setConnection(conn.connection)
      const c = cfg.config as BotConfig | null
      setConfig(c)
      setActions(acts.actions ?? [])
      if (c) {
        setPersona(c.persona_prompt ?? '')
        setVoiceExamples(c.voice_examples?.length ? c.voice_examples : [''])
        setTopics(c.topics?.length ? c.topics : [''])
        setAffLinks(c.affiliate_links ? Object.entries(c.affiliate_links).map(([name, url]) => ({ name, url })) : [{ name: '', url: '' }])
        setDailyLimit(c.daily_quote_limit)
        setLikeThresh(c.engagement_threshold_likes)
        setReplyThresh(c.engagement_threshold_replies)
        setAutopilot(c.autopilot_enabled)
      }
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { engageEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [engageMessages])
  useEffect(() => { analyticsEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [analyticsMessages])

  async function saveConfig() {
    if (!workspaceId) return
    setSaving(true)
    const affiliateLinks = Object.fromEntries(affLinks.filter(a => a.name && a.url).map(a => [a.name, a.url]))
    await fetch('/api/twitter/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        personaPrompt:              persona,
        voiceExamples:              voiceExamples.filter(Boolean),
        topics:                     topics.filter(Boolean),
        affiliateLinks,
        dailyQuoteLimit:            dailyLimit,
        engagementThresholdLikes:   likeThresh,
        engagementThresholdReplies: replyThresh,
        autopilotEnabled:           autopilot,
      }),
    })
    load()
    setSaving(false)
  }

  async function sendToAgent(
    endpoint: string,
    messages: Message[],
    input: string,
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
    setInput: React.Dispatch<React.SetStateAction<string>>,
    setStreaming: React.Dispatch<React.SetStateAction<boolean>>
  ) {
    if (!input.trim() || !workspaceId) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    const assistantId = (Date.now() + 1).toString()
    setMessages(p => [...p, userMsg, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])
    setInput(''); setStreaming(true)

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
    })
    const reader = res.body!.getReader(); const dec = new TextDecoder()
    let buf = ''; let text = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const evt = JSON.parse(line) as { type: string; content?: string; name?: string }
          if (evt.type === 'text' && evt.content) text += evt.content
          if (evt.type === 'tool_call') text += `\n\n_${evt.name}…_\n`
          if (evt.type === 'done') load()
          setMessages(p => p.map(m => m.id === assistantId ? { ...m, content: text } : m))
        } catch { /* skip */ }
      }
    }
    setMessages(p => p.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
    setStreaming(false)
  }

  function AgentChat({ messages, input, setInput, streaming, onSend, endRef, placeholder, emptyTitle, emptyDesc, suggestedPrompt }: {
    messages: Message[]; input: string; setInput: (v: string) => void; streaming: boolean
    onSend: () => void; endRef: React.RefObject<HTMLDivElement | null>
    placeholder: string; emptyTitle: string; emptyDesc: string; suggestedPrompt: string
  }) {
    return (
      <div className="bg-white rounded-xl border border-border flex flex-col" style={{ height: '500px' }}>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Bird className="size-8 mx-auto mb-3" />
              <p className="font-medium">{emptyTitle}</p>
              <p className="text-sm mt-1">{emptyDesc}</p>
              <button onClick={() => setInput(suggestedPrompt)}
                className="mt-4 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-4 py-1.5 hover:bg-indigo-100">
                {suggestedPrompt}
              </button>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap', m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-foreground')}>
                {m.content || (m.isStreaming ? <Loader2 className="size-4 animate-spin" /> : '')}
              </div>
            </div>
          ))}
          <div ref={endRef} />
        </div>
        <div className="border-t border-border p-3 flex gap-2">
          <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && onSend()}
            placeholder={placeholder}
            className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <Button size="sm" onClick={onSend} disabled={streaming || !input.trim()}>
            {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    )
  }

  if (loading) return <div className="p-6 space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />)}</div>

  if (!connection) {
    return (
      <div className="p-6">
        <div className="bg-white rounded-xl border border-border p-12 text-center max-w-md mx-auto">
          <Bird className="size-10 mx-auto mb-3 text-sky-500" />
          <p className="font-semibold text-lg">Connect your X/Twitter account</p>
          <p className="text-sm text-muted-foreground mt-2 mb-6">Connect to start monitoring your timeline, quoting tweets, and running the engagement bot.</p>
          <div className="bg-zinc-50 rounded-lg border border-border p-4 text-left text-sm space-y-2">
            <p className="font-medium">Setup required:</p>
            <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
              <li>Add <code className="text-xs bg-zinc-200 px-1 rounded">TWITTER_CLIENT_ID</code> and <code className="text-xs bg-zinc-200 px-1 rounded">TWITTER_CLIENT_SECRET</code> to .env.local</li>
              <li>Create an OAuth 2.0 app at developer.twitter.com</li>
              <li>Set scopes: <code className="text-xs bg-zinc-200 px-1 rounded">tweet.read tweet.write users.read offline.access</code></li>
            </ol>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bird className="size-5 text-sky-500" />
          <div>
            <p className="font-semibold">@{connection.twitter_username}</p>
            <p className="text-xs text-muted-foreground">Connected · {config?.autopilot_enabled ? '🟢 Autopilot on' : '⏸ Manual mode'}</p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['activity', 'engage', 'analytics', 'settings'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px capitalize transition-colors',
            tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
            {t === 'activity'   && <Heart className="size-4" />}
            {t === 'engage'     && <Bot className="size-4" />}
            {t === 'analytics'  && <CheckCircle2 className="size-4" />}
            {t === 'settings'   && <Settings className="size-4" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'activity' && (
        actions.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Bird className="size-8 mx-auto mb-2" />
            <p className="text-sm">No actions yet. Run the Engage Agent to start quoting tweets.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {actions.map(a => (
              <div key={a.id} className="bg-white rounded-xl border border-border p-5 space-y-3">
                <div className="text-xs text-muted-foreground">
                  Quoting <span className="font-medium text-foreground">@{a.source_username}</span>:
                  <p className="mt-1 text-foreground/70 italic line-clamp-2">"{a.source_content}"</p>
                </div>
                <div className="bg-zinc-50 rounded-lg p-3 text-sm">
                  <p>{a.quote_content}</p>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><Heart className="size-3" /> {a.likes_count}</span>
                  <span className="flex items-center gap-1"><MessageCircle className="size-3" /> {a.replies_count}</span>
                  <span className="flex items-center gap-1"><Repeat2 className="size-3" /> {a.retweets_count}</span>
                  {a.affiliate_replied && (
                    <span className="ml-auto bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-2 py-0.5 font-medium">
                      Affiliate replied ✓
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'engage' && (
        <AgentChat
          messages={engageMessages} input={engageInput} setInput={setEngageInput}
          streaming={engageStreaming} endRef={engageEndRef}
          onSend={() => sendToAgent('/api/agents/twitter-engage', engageMessages, engageInput, setEngageMessages, setEngageInput, setEngageStreaming)}
          placeholder="Run engagement cycle or give instructions…"
          emptyTitle="Engage Agent" emptyDesc="I'll scan your timeline, find great tweets to quote, and post in your trained voice."
          suggestedPrompt="Run engagement cycle"
        />
      )}

      {tab === 'analytics' && (
        <AgentChat
          messages={analyticsMessages} input={analyticsInput} setInput={setAnalyticsInput}
          streaming={analyticsStreaming} endRef={analyticsEndRef}
          onSend={() => sendToAgent('/api/agents/twitter-analytics', analyticsMessages, analyticsInput, setAnalyticsMessages, setAnalyticsInput, setAnalyticsStreaming)}
          placeholder="Check analytics or trigger affiliate replies…"
          emptyTitle="Analytics Agent" emptyDesc="I'll check engagement on your quote tweets and post affiliate replies when thresholds are hit."
          suggestedPrompt="Check analytics and post affiliate replies"
        />
      )}

      {tab === 'settings' && (
        <div className="bg-white rounded-xl border border-border p-6 space-y-6 max-w-2xl">
          {/* Persona */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Bot Persona</label>
            <textarea value={persona} onChange={e => setPersona(e.target.value)} rows={3}
              placeholder="e.g. You are an insightful SEO expert who shares contrarian views on digital marketing trends…"
              className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300 resize-none" />
          </div>

          {/* Voice examples */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Voice Examples</label>
            {voiceExamples.map((ex, i) => (
              <div key={i} className="flex gap-2">
                <input value={ex} onChange={e => { const v = [...voiceExamples]; v[i] = e.target.value; setVoiceExamples(v) }}
                  placeholder={`Example tweet ${i + 1}…`}
                  className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <button onClick={() => setVoiceExamples(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-rose-500">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setVoiceExamples(p => [...p, ''])}>
              <Plus className="size-3.5 mr-1" /> Add example
            </Button>
          </div>

          {/* Topics */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Topics to Monitor</label>
            <div className="flex flex-wrap gap-2">
              {topics.map((t, i) => (
                <div key={i} className="flex items-center gap-1 bg-zinc-100 rounded-full px-3 py-1">
                  <input value={t} onChange={e => { const v = [...topics]; v[i] = e.target.value; setTopics(v) }}
                    className="bg-transparent text-sm outline-none w-24" placeholder="topic" />
                  <button onClick={() => setTopics(p => p.filter((_, j) => j !== i))}><Trash2 className="size-3 text-muted-foreground hover:text-rose-500" /></button>
                </div>
              ))}
              <button onClick={() => setTopics(p => [...p, ''])} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-3 py-1 hover:bg-indigo-100">
                <Plus className="size-3 inline mr-0.5" /> Add
              </button>
            </div>
          </div>

          {/* Affiliate links */}
          <div className="space-y-2">
            <label className="text-sm font-semibold">Affiliate Links</label>
            {affLinks.map((a, i) => (
              <div key={i} className="flex gap-2">
                <input value={a.name} onChange={e => { const v = [...affLinks]; v[i] = { ...v[i], name: e.target.value }; setAffLinks(v) }}
                  placeholder="Product name" className="w-36 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <input value={a.url} onChange={e => { const v = [...affLinks]; v[i] = { ...v[i], url: e.target.value }; setAffLinks(v) }}
                  placeholder="https://…" className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                <button onClick={() => setAffLinks(p => p.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-rose-500">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setAffLinks(p => [...p, { name: '', url: '' }])}>
              <Plus className="size-3.5 mr-1" /> Add link
            </Button>
          </div>

          {/* Thresholds */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Daily Quote Limit</label>
              <input type="number" value={dailyLimit} onChange={e => setDailyLimit(+e.target.value)} min={1} max={50}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Min Likes for Reply</label>
              <input type="number" value={likeThresh} onChange={e => setLikeThresh(+e.target.value)} min={0}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Min Replies for Reply</label>
              <input type="number" value={replyThresh} onChange={e => setReplyThresh(+e.target.value)} min={0}
                className="w-full px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            </div>
          </div>

          {/* Autopilot toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => setAutopilot(p => !p)}
              className={cn('relative w-11 h-6 rounded-full transition-colors', autopilot ? 'bg-indigo-600' : 'bg-zinc-300')}
            >
              <span className={cn('absolute top-0.5 left-0.5 size-5 bg-white rounded-full shadow transition-transform', autopilot && 'translate-x-5')} />
            </button>
            <div>
              <p className="text-sm font-medium">Autopilot Mode</p>
              <p className="text-xs text-muted-foreground">Agents run automatically on schedule</p>
            </div>
          </div>

          <Button onClick={saveConfig} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin mr-1" /> : null}
            Save Settings
          </Button>
        </div>
      )}
    </div>
  )
}
