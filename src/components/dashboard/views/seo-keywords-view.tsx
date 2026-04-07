'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Plus, Trash2, TrendingUp, Bot, Send, Loader2, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Keyword {
  id: string
  keyword: string
  search_volume: number | null
  difficulty: number | null
  cpc_usd: number | null
  intent: string | null
  trend_data: number[] | null
  latest_ranking: { position: number | null; url: string | null; checked_at: string } | null
}

interface Stats {
  total: number; ranked: number; top10: number; top3: number; totalVolume: number
}

interface Message { id: string; role: 'user' | 'assistant'; content: string; isStreaming?: boolean }

interface Props { workspaceId?: string }

function diffColor(d: number | null) {
  if (d == null) return 'text-muted-foreground'
  if (d < 30) return 'text-emerald-600'
  if (d < 60) return 'text-amber-600'
  return 'text-rose-600'
}

function intentBadge(intent: string | null) {
  const map: Record<string, string> = {
    informational: 'bg-blue-50 text-blue-700 border-blue-200',
    transactional:  'bg-emerald-50 text-emerald-700 border-emerald-200',
    commercial:     'bg-violet-50 text-violet-700 border-violet-200',
    navigational:   'bg-zinc-50 text-zinc-600 border-zinc-200',
  }
  return map[intent ?? ''] ?? 'bg-zinc-50 text-zinc-600 border-zinc-200'
}

export function SeoKeywordsView({ workspaceId }: Props) {
  const [tab,      setTab]      = useState<'list' | 'agent'>('list')
  const [keywords, setKeywords] = useState<Keyword[]>([])
  const [stats,    setStats]    = useState<Stats>({ total: 0, ranked: 0, top10: 0, top3: 0, totalVolume: 0 })
  const [loading,  setLoading]  = useState(true)
  const [query,    setQuery]    = useState('')
  const [adding,   setAdding]   = useState(false)
  const [newKw,    setNewKw]    = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [input,    setInput]    = useState('')
  const [streaming, setStreaming] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  function load() {
    if (!workspaceId) return
    setLoading(true)
    fetch(`/api/seo/keywords?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { setKeywords(d.keywords ?? []); setStats(d.stats ?? stats) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function addKeyword() {
    if (!newKw.trim() || !workspaceId) return
    setAdding(true)
    await fetch('/api/seo/keywords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, keywords: [{ keyword: newKw.trim() }] }),
    })
    setNewKw('')
    load()
    setAdding(false)
  }

  async function deleteKeyword(id: string) {
    await fetch('/api/seo/keywords', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setKeywords(p => p.filter(k => k.id !== id))
  }

  async function sendMessage() {
    if (!input.trim() || streaming || !workspaceId) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    const assistantId = (Date.now() + 1).toString()
    setMessages(p => [...p, userMsg, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])
    setInput('')
    setStreaming(true)

    const res = await fetch('/api/agents/keyword-researcher', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })) }),
    })

    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    let buf = ''
    let text = ''

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
          if (evt.type === 'text' && evt.content) { text += evt.content }
          if (evt.type === 'tool_call') { text += `\n\n_Using tool: ${evt.name}…_\n` }
          if (evt.type === 'done') { load() }
          setMessages(p => p.map(m => m.id === assistantId ? { ...m, content: text } : m))
        } catch { /* skip */ }
      }
    }
    setMessages(p => p.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
    setStreaming(false)
  }

  const filtered = keywords.filter(k => !query || k.keyword.toLowerCase().includes(query.toLowerCase()))

  return (
    <div className="p-6 space-y-4">
      {/* Stats bar */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          { label: 'Tracked',      value: stats.total },
          { label: 'Ranked',       value: stats.ranked },
          { label: 'Top 10',       value: stats.top10 },
          { label: 'Top 3',        value: stats.top3 },
          { label: 'Total Volume', value: (stats.totalVolume / 1000).toFixed(1) + 'k' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-lg border border-border p-3 text-center">
            <p className="text-xl font-bold">{s.value}</p>
            <p className="text-xs text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['list', 'agent'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
            {t === 'list' ? <><Search className="size-4" /> Keywords</> : <><Bot className="size-4" /> AI Researcher</>}
          </button>
        ))}
      </div>

      {tab === 'list' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Filter keywords…"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <div className="flex gap-2">
              <input value={newKw} onChange={e => setNewKw(e.target.value)} onKeyDown={e => e.key === 'Enter' && addKeyword()}
                placeholder="Add keyword…"
                className="w-48 px-3 py-2 text-sm border border-border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300" />
              <Button size="sm" onClick={addKeyword} disabled={adding || !newKw.trim()}>
                {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded-lg bg-zinc-100 animate-pulse" />)}</div>
          ) : (
            <div className="bg-white rounded-xl border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 border-b border-border">
                  <tr>
                    {['Keyword', 'Volume', 'Difficulty', 'CPC', 'Intent', 'Position', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-xs font-semibold text-muted-foreground uppercase tracking-widest">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filtered.map(kw => (
                    <tr key={kw.id} className="hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium">{kw.keyword}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{kw.search_volume?.toLocaleString() ?? '—'}</td>
                      <td className={cn('px-4 py-2.5 font-medium', diffColor(kw.difficulty))}>{kw.difficulty ?? '—'}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{kw.cpc_usd ? `$${kw.cpc_usd}` : '—'}</td>
                      <td className="px-4 py-2.5">
                        {kw.intent && <span className={cn('text-xs border rounded px-1.5 py-0.5', intentBadge(kw.intent))}>{kw.intent}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {kw.latest_ranking?.position
                          ? <span className="font-medium text-indigo-600">#{kw.latest_ranking.position}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <button onClick={() => deleteKeyword(kw.id)} className="text-muted-foreground hover:text-rose-500 transition-colors">
                          <Trash2 className="size-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground text-sm">No keywords yet. Add some above or use the AI Researcher.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'agent' && (
        <div className="bg-white rounded-xl border border-border flex flex-col" style={{ height: '500px' }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <TrendingUp className="size-8 mx-auto mb-3" />
                <p className="font-medium">AI Keyword Researcher</p>
                <p className="text-sm mt-1">Tell me your niche and I'll research keywords, estimate metrics, and save them.</p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {['Research keywords for a fitness blog', 'Find low-competition SaaS keywords', 'Keywords for a travel site in Asia'].map(s => (
                    <button key={s} onClick={() => setInput(s)} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-3 py-1 hover:bg-indigo-100 transition-colors">{s}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map(m => (
              <div key={m.id} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div className={cn('max-w-[80%] rounded-xl px-4 py-2.5 text-sm whitespace-pre-wrap', m.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-zinc-100 text-foreground')}>
                  {m.content || (m.isStreaming ? <Loader2 className="size-4 animate-spin" /> : '')}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t border-border p-3 flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="e.g. Research keywords for a SaaS marketing blog…"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <Button size="sm" onClick={sendMessage} disabled={streaming || !input.trim()}>
              {streaming ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
