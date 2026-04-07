'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { Search, Plus, Trash2, Loader2, TrendingUp, BarChart3, Bot, Send } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface Keyword {
  id: string
  keyword: string
  search_volume: number | null
  difficulty: number | null
  cpc_usd: number | null
  intent: string | null
  latest_ranking: { position: number; url: string; checked_at: string } | null
}

interface Stats {
  total: number; ranked: number; top10: number; top3: number; totalVolume: number
}

interface Message {
  id: string; role: 'user' | 'assistant'; content: string
  toolCalls?: Array<{ name: string; input: unknown }>
}

const INTENT_COLORS: Record<string, string> = {
  informational: 'bg-blue-100 text-blue-700',
  transactional: 'bg-green-100 text-green-700',
  commercial:    'bg-purple-100 text-purple-700',
  navigational:  'bg-zinc-100 text-zinc-700',
}

function diffColor(d: number | null) {
  if (d == null) return 'text-zinc-400'
  if (d < 30) return 'text-green-600'
  if (d < 60) return 'text-amber-600'
  return 'text-rose-600'
}

export function KeywordsView({ workspaceId }: Props) {
  const [tab, setTab]         = useState<'list' | 'agent'>('list')
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [stats, setStats]     = useState<Stats>({ total: 0, ranked: 0, top10: 0, top3: 0, totalVolume: 0 })
  const [loading, setLoading] = useState(true)
  const [search, setSearch]   = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]     = useState('')
  const [running, setRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  function load() {
    fetch(`/api/seo/keywords?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.keywords) { setKeywords(d.keywords); setStats(d.stats) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function runAgent() {
    if (!input.trim() || running) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setRunning(true)

    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/agents/keyword-researcher', {
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
            const evt = JSON.parse(line) as { type: string; content?: string; name?: string; input?: unknown }
            if (evt.type === 'text') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: m.content + (evt.content ?? '') } : m))
            }
            if (evt.type === 'tool_call') {
              setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolCalls: [...(m.toolCalls ?? []), { name: evt.name!, input: evt.input }] } : m))
            }
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

  const filtered = keywords.filter(k => k.keyword.includes(search.toLowerCase()))

  return (
    <div className="p-6 space-y-4">
      {/* Tabs */}
      <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg w-fit">
        {([['list', 'Keywords'], ['agent', 'AI Researcher']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cn('text-xs px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-white shadow-sm' : 'text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total',    value: stats.total },
              { label: 'Ranked',   value: stats.ranked },
              { label: 'Top 10',   value: stats.top10 },
              { label: 'Top 3',    value: stats.top3 },
            ].map(s => (
              <div key={s.label} className="bg-white rounded-xl border border-border p-3 shadow-sm text-center">
                <p className="text-xl font-bold">{s.value}</p>
                <p className="text-[10px] text-muted-foreground">{s.label}</p>
              </div>
            ))}
          </div>

          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
            <Input placeholder="Filter keywords…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-8 text-sm" />
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-zinc-100 animate-pulse rounded-lg" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3">
              <Search className="size-8 text-zinc-300" />
              <p className="text-sm text-muted-foreground">No keywords yet. Use the AI Researcher to add some.</p>
              <Button size="sm" onClick={() => setTab('agent')}>Open AI Researcher</Button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="grid grid-cols-[1fr_60px_60px_60px_70px_60px] gap-2 px-3 text-[10px] uppercase tracking-wider text-muted-foreground">
                <span>Keyword</span><span className="text-right">Vol</span><span className="text-right">Diff</span>
                <span className="text-right">CPC</span><span>Intent</span><span className="text-right">Pos</span>
              </div>
              {filtered.map(kw => (
                <div key={kw.id} className="bg-white rounded-lg border border-border px-3 py-2 grid grid-cols-[1fr_60px_60px_60px_70px_60px] gap-2 items-center shadow-sm">
                  <span className="text-xs font-medium truncate">{kw.keyword}</span>
                  <span className="text-xs text-right text-muted-foreground">{kw.search_volume != null ? (kw.search_volume >= 1000 ? `${Math.round(kw.search_volume/1000)}k` : kw.search_volume) : '—'}</span>
                  <span className={cn('text-xs text-right font-medium', diffColor(kw.difficulty))}>{kw.difficulty ?? '—'}</span>
                  <span className="text-xs text-right text-muted-foreground">{kw.cpc_usd != null ? `$${kw.cpc_usd.toFixed(2)}` : '—'}</span>
                  <span className={cn('text-[10px] px-1.5 py-0.5 rounded font-medium w-fit', INTENT_COLORS[kw.intent ?? 'informational'] ?? 'bg-zinc-100 text-zinc-600')}>{kw.intent ?? '—'}</span>
                  <span className="text-xs text-right font-semibold">{kw.latest_ranking?.position != null ? `#${kw.latest_ranking.position}` : '—'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'agent' && (
        <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <Bot className="size-10 text-zinc-300" />
                <div>
                  <p className="text-sm font-medium">AI Keyword Researcher</p>
                  <p className="text-xs text-muted-foreground mt-1">Tell it your niche and it'll find, score, and save keyword clusters.</p>
                </div>
                <p className="text-xs text-muted-foreground italic">e.g. "Research keywords for my SaaS landing page optimisation blog"</p>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[85%] rounded-xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-zinc-900 text-white' : 'bg-white border border-border shadow-sm')}>
                  {m.toolCalls?.map((tc, i) => (
                    <div key={i} className="text-[10px] text-muted-foreground bg-zinc-100 rounded px-2 py-1 mb-1">
                      <span className="font-mono">⚙ {tc.name}</span>
                    </div>
                  ))}
                  {m.content || (!m.toolCalls?.length && <Loader2 className="size-3 animate-spin text-zinc-400" />)}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
          <div className="flex gap-2 pt-2 border-t border-border">
            <Input
              placeholder="e.g. Research SEO keywords for a B2B SaaS company…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAgent() } }}
              className="h-9 text-sm"
            />
            <Button size="sm" onClick={runAgent} disabled={running || !input.trim()} className="h-9 px-3 shrink-0">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
