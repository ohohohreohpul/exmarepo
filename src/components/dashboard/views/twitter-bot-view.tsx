'use client'

import { useEffect, useState, useRef } from 'react'
import { Bird, Bot, Send, Loader2, Plus, Trash2, MessageSquare, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface TwitterAction {
  id: string
  source_username: string
  source_content: string
  quote_content: string
  quote_tweet_id: string | null
  likes_count: number
  replies_count: number
  retweets_count: number
  affiliate_replied: boolean
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

interface Message {
  id: string; role: 'user' | 'assistant'; content: string
  toolCalls?: Array<{ name: string }>
}

export function TwitterBotView({ workspaceId }: Props) {
  const [tab, setTab]           = useState<'activity' | 'engage' | 'analytics' | 'settings'>('activity')
  const [actions, setActions]   = useState<TwitterAction[]>([])
  const [config, setConfig]     = useState<BotConfig | null>(null)
  const [connection, setConnection] = useState<TwitterConnection | null>(null)
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [engageMessages, setEngageMessages] = useState<Message[]>([])
  const [analyticsMessages, setAnalyticsMessages] = useState<Message[]>([])
  const [engageInput, setEngageInput] = useState('')
  const [analyticsInput, setAnalyticsInput] = useState('')
  const [engageRunning, setEngageRunning] = useState(false)
  const [analyticsRunning, setAnalyticsRunning] = useState(false)
  const engageBottomRef   = useRef<HTMLDivElement>(null)
  const analyticsBottomRef = useRef<HTMLDivElement>(null)

  // Config form
  const [persona, setPersona]   = useState('')
  const [topics, setTopics]     = useState('')
  const [dailyLimit, setDailyLimit] = useState(5)
  const [threshLikes, setThreshLikes] = useState(10)
  const [threshReplies, setThreshReplies] = useState(3)
  const [voiceExample, setVoiceExample] = useState('')
  const [voiceExamples, setVoiceExamples] = useState<string[]>([])
  const [affKey, setAffKey]     = useState('')
  const [affUrl, setAffUrl]     = useState('')
  const [affiliateLinks, setAffiliateLinks] = useState<Record<string, string>>({})

  function load() {
    Promise.all([
      fetch(`/api/twitter/actions?workspaceId=${workspaceId}`).then(r => r.json()),
      fetch(`/api/twitter/config?workspaceId=${workspaceId}`).then(r => r.json()),
      fetch(`/api/twitter/connect?workspaceId=${workspaceId}`).then(r => r.json()),
    ]).then(([a, c, conn]) => {
      if (a.actions) setActions(a.actions)
      if (c.config) {
        setConfig(c.config)
        setPersona(c.config.persona_prompt ?? '')
        setTopics((c.config.topics ?? []).join(', '))
        setDailyLimit(c.config.daily_quote_limit ?? 5)
        setThreshLikes(c.config.engagement_threshold_likes ?? 10)
        setThreshReplies(c.config.engagement_threshold_replies ?? 3)
        setVoiceExamples(c.config.voice_examples ?? [])
        setAffiliateLinks(c.config.affiliate_links ?? {})
      }
      if (conn.connection) setConnection(conn.connection)
    }).catch(() => {}).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { engageBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [engageMessages])
  useEffect(() => { analyticsBottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [analyticsMessages])

  async function saveConfig() {
    setSaving(true)
    const topicArr = topics.split(',').map(t => t.trim()).filter(Boolean)
    await fetch('/api/twitter/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        personaPrompt:              persona,
        voiceExamples,
        topics:                     topicArr,
        affiliateLinks,
        dailyQuoteLimit:            dailyLimit,
        engagementThresholdLikes:   threshLikes,
        engagementThresholdReplies: threshReplies,
      }),
    })
    setSaving(false)
  }

  async function runAgentStream(
    agentPath: string,
    input: string,
    setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
    setRunning: React.Dispatch<React.SetStateAction<boolean>>
  ) {
    if (!input.trim() || engageRunning || analyticsRunning) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setRunning(true)
    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const res = await fetch(agentPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: userMsg.content }], workspaceId }),
      })
      const reader = res.body!.getReader()
      const dec    = new TextDecoder()
      let buf = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const evt = JSON.parse(line) as { type: string; content?: string; name?: string }
            if (evt.type === 'text') setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + (evt.content ?? '') } : m))
            if (evt.type === 'tool_call') setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolCalls: [...(m.toolCalls ?? []), { name: evt.name! }] } : m))
          } catch { /* skip */ }
        }
      }
      load()
    } catch (e) {
      const errText = String(e)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${errText}` } : m))
    } finally {
      setRunning(false)
    }
  }

  function AgentChat({
    messages, input, setInput, running, onSend, placeholder, bottomRef,
  }: {
    messages: Message[]; input: string; setInput: (v: string) => void; running: boolean
    onSend: () => void; placeholder: string; bottomRef: React.RefObject<HTMLDivElement | null>
  }) {
    return (
      <div className="flex flex-col h-[calc(100vh-220px)] min-h-[360px]">
        <div className="flex-1 overflow-y-auto space-y-3 pb-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Bot className="size-10 text-zinc-300" />
              <p className="text-xs text-muted-foreground italic">{placeholder}</p>
            </div>
          )}
          {messages.map(m => (
            <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
              <div className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-white border border-border shadow-sm')}>
                {m.toolCalls?.map((tc, i) => (
                  <div key={i} className="text-[10px] text-muted-foreground bg-zinc-100 rounded px-2 py-1 mb-1 font-mono">⚙ {tc.name}</div>
                ))}
                {m.content || (!m.toolCalls?.length && <Loader2 className="size-3 animate-spin text-zinc-400" />)}
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>
        <div className="flex gap-2 pt-2 border-t border-border">
          <Input value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend() } }}
            placeholder={placeholder} className="h-9 text-sm" />
          <Button size="sm" onClick={onSend} disabled={running || !input.trim()} className="h-9 px-3 shrink-0">
            {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-4">
      {/* Connection status */}
      {!loading && (
        <div className={cn('rounded-lg border px-4 py-2 flex items-center gap-2 text-xs', connection ? 'bg-green-50 border-green-200 text-green-700' : 'bg-amber-50 border-amber-200 text-amber-700')}>
          <Bird className="size-3.5" />
          {connection ? `Connected as @${connection.twitter_username}` : 'Not connected. Add TWITTER_CLIENT_ID and TWITTER_CLIENT_SECRET to .env.local to connect.'}
        </div>
      )}

      <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg w-fit flex-wrap">
        {([['activity', 'Activity'], ['engage', 'Engage Agent'], ['analytics', 'Analytics Agent'], ['settings', 'Settings']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cn('text-xs px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-white shadow-sm' : 'text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'activity' && (
        <div className="space-y-2">
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-zinc-100 animate-pulse rounded-xl" />)}</div>
          ) : actions.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-center">
              <MessageSquare className="size-8 text-zinc-300" />
              <p className="text-sm text-muted-foreground">No activity yet. Run the Engage Agent to start quoting tweets.</p>
            </div>
          ) : (
            actions.map(action => (
              <div key={action.id} className="bg-white rounded-xl border border-border p-4 shadow-sm space-y-2">
                <div className="text-xs text-muted-foreground">
                  Quoted <span className="font-medium text-foreground">@{action.source_username}</span>
                </div>
                <p className="text-xs text-zinc-500 italic line-clamp-2">&ldquo;{action.source_content}&rdquo;</p>
                <p className="text-sm">{action.quote_content}</p>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>♥ {action.likes_count}</span>
                  <span>💬 {action.replies_count}</span>
                  <span>🔁 {action.retweets_count}</span>
                  {action.affiliate_replied && (
                    <Badge className="text-[10px] h-4 bg-green-100 text-green-700 border-green-200">
                      <CheckCircle2 className="size-2.5 mr-0.5" /> Affiliate replied
                    </Badge>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'engage' && (
        <AgentChat
          messages={engageMessages}
          input={engageInput}
          setInput={setEngageInput}
          running={engageRunning}
          onSend={() => {
            runAgentStream('/api/agents/twitter-engage', engageInput, setEngageMessages, setEngageRunning)
            setEngageInput('')
          }}
          placeholder='e.g. "Find great tweets to quote in my niche and post them"'
          bottomRef={engageBottomRef}
        />
      )}

      {tab === 'analytics' && (
        <AgentChat
          messages={analyticsMessages}
          input={analyticsInput}
          setInput={setAnalyticsInput}
          running={analyticsRunning}
          onSend={() => {
            runAgentStream('/api/agents/twitter-analytics', analyticsInput, setAnalyticsMessages, setAnalyticsRunning)
            setAnalyticsInput('')
          }}
          placeholder='e.g. "Check engagement and post affiliate replies to qualifying tweets"'
          bottomRef={analyticsBottomRef}
        />
      )}

      {tab === 'settings' && (
        <div className="space-y-5">
          <div className="bg-white rounded-xl border border-border p-5 space-y-4 shadow-sm">
            <p className="text-sm font-semibold">Bot Persona</p>
            <div>
              <Label className="text-xs">Persona / Voice Prompt</Label>
              <textarea
                value={persona}
                onChange={e => setPersona(e.target.value)}
                placeholder="e.g. Bold, data-driven SEO expert who challenges conventional wisdom with real-world results..."
                className="mt-1 w-full h-24 text-sm border border-border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div>
              <Label className="text-xs">Topics (comma-separated)</Label>
              <Input value={topics} onChange={e => setTopics(e.target.value)} placeholder="SEO, content marketing, AI search" className="mt-1 h-8 text-sm" />
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-5 space-y-3 shadow-sm">
            <p className="text-sm font-semibold">Voice Examples</p>
            <div className="flex gap-2">
              <Input value={voiceExample} onChange={e => setVoiceExample(e.target.value)} placeholder="Paste an example tweet…" className="h-8 text-sm" />
              <Button size="sm" variant="outline" className="h-8" onClick={() => { if (voiceExample.trim()) { setVoiceExamples(prev => [...prev, voiceExample.trim()]); setVoiceExample('') } }}>
                <Plus className="size-3" />
              </Button>
            </div>
            <div className="space-y-1">
              {voiceExamples.map((ex, i) => (
                <div key={i} className="flex items-start gap-2 bg-zinc-50 rounded-lg px-3 py-2">
                  <p className="text-xs flex-1 text-zinc-700">{ex}</p>
                  <button onClick={() => setVoiceExamples(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-rose-600 shrink-0">
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-5 space-y-3 shadow-sm">
            <p className="text-sm font-semibold">Affiliate Links</p>
            <div className="flex gap-2">
              <Input value={affKey} onChange={e => setAffKey(e.target.value)} placeholder="Label (e.g. My Course)" className="h-8 text-sm flex-1" />
              <Input value={affUrl} onChange={e => setAffUrl(e.target.value)} placeholder="https://…" className="h-8 text-sm flex-1" />
              <Button size="sm" variant="outline" className="h-8" onClick={() => { if (affKey && affUrl) { setAffiliateLinks(prev => ({ ...prev, [affKey]: affUrl })); setAffKey(''); setAffUrl('') } }}>
                <Plus className="size-3" />
              </Button>
            </div>
            <div className="space-y-1">
              {Object.entries(affiliateLinks).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 bg-zinc-50 rounded-lg px-3 py-2">
                  <span className="text-xs font-medium flex-1">{k}</span>
                  <span className="text-xs text-muted-foreground truncate max-w-[150px]">{v}</span>
                  <button onClick={() => setAffiliateLinks(prev => { const n = { ...prev }; delete n[k]; return n })} className="text-muted-foreground hover:text-rose-600">
                    <Trash2 className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-border p-5 space-y-3 shadow-sm">
            <p className="text-sm font-semibold">Limits & Thresholds</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">Daily Quote Limit</Label>
                <Input type="number" min={1} max={50} value={dailyLimit} onChange={e => setDailyLimit(Number(e.target.value))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Likes threshold</Label>
                <Input type="number" min={1} value={threshLikes} onChange={e => setThreshLikes(Number(e.target.value))} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Replies threshold</Label>
                <Input type="number" min={1} value={threshReplies} onChange={e => setThreshReplies(Number(e.target.value))} className="mt-1 h-8 text-sm" />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">Affiliate reply triggers when likes ≥ threshold OR replies ≥ threshold.</p>
          </div>

          <Button onClick={saveConfig} disabled={saving} className="w-full">
            {saving ? <Loader2 className="size-4 animate-spin mr-2" /> : null}
            Save Settings
          </Button>
        </div>
      )}
    </div>
  )
}
