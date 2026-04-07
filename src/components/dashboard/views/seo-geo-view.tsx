'use client'

import { useState, useEffect, useRef } from 'react'
import { Globe, Plus, Trash2, Bot, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface GeoQuery {
  id: string
  query_text: string
  engine: string
  active: boolean
  latest_result: { brand_cited: boolean; our_url_cited: boolean; checked_at: string } | null
}

interface Suggestion {
  id: string
  suggestion: string
  priority: string
}

interface Message { id: string; role: 'user' | 'assistant'; content: string; isStreaming?: boolean }

interface Props { workspaceId?: string }

const ENGINE_LABELS: Record<string, string> = {
  perplexity:         'Perplexity',
  chatgpt:            'ChatGPT',
  google_ai_overview: 'Google AI',
  bing_copilot:       'Bing Copilot',
}

export function SeoGeoView({ workspaceId }: Props) {
  const [tab,         setTab]         = useState<'queries' | 'agent'>('queries')
  const [queries,     setQueries]     = useState<GeoQuery[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading,     setLoading]     = useState(true)
  const [newQuery,    setNewQuery]    = useState('')
  const [newEngine,   setNewEngine]   = useState('perplexity')
  const [adding,      setAdding]      = useState(false)
  const [messages,    setMessages]    = useState<Message[]>([])
  const [input,       setInput]       = useState('')
  const [streaming,   setStreaming]   = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  function load() {
    if (!workspaceId) return
    setLoading(true)
    fetch(`/api/seo/geo?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { setQueries(d.queries ?? []); setSuggestions(d.suggestions ?? []) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function addQuery() {
    if (!newQuery.trim() || !workspaceId) return
    setAdding(true)
    await fetch('/api/seo/geo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, queryText: newQuery.trim(), engine: newEngine }),
    })
    setNewQuery('')
    load()
    setAdding(false)
  }

  async function removeQuery(id: string) {
    await fetch('/api/seo/geo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setQueries(p => p.filter(q => q.id !== id))
  }

  async function sendMessage() {
    if (!input.trim() || streaming || !workspaceId) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    const assistantId = (Date.now() + 1).toString()
    setMessages(p => [...p, userMsg, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])
    setInput(''); setStreaming(true)

    const res = await fetch('/api/agents/geo-monitor', {
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
          if (evt.type === 'tool_call') text += `\n\n_Querying ${evt.name}…_\n`
          if (evt.type === 'done') load()
          setMessages(p => p.map(m => m.id === assistantId ? { ...m, content: text } : m))
        } catch { /* skip */ }
      }
    }
    setMessages(p => p.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
    setStreaming(false)
  }

  const cited    = queries.filter(q => q.latest_result?.brand_cited).length
  const urlCited = queries.filter(q => q.latest_result?.our_url_cited).length
  const citationRate = queries.length > 0 ? Math.round((cited / queries.length) * 100) : 0

  return (
    <div className="p-6 space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-indigo-600">{citationRate}%</p>
          <p className="text-xs text-muted-foreground mt-0.5">Citation Rate</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold">{cited}/{queries.length}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Queries with Brand</p>
        </div>
        <div className="bg-white rounded-xl border border-border p-4 text-center">
          <p className="text-2xl font-bold text-emerald-600">{urlCited}</p>
          <p className="text-xs text-muted-foreground mt-0.5">URL Citations</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['queries', 'agent'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
            {t === 'queries' ? <><Globe className="size-4" /> Monitored Queries</> : <><Bot className="size-4" /> GEO Monitor</>}
          </button>
        ))}
      </div>

      {tab === 'queries' && (
        <div className="space-y-4">
          {/* Add query */}
          <div className="flex gap-2">
            <input value={newQuery} onChange={e => setNewQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && addQuery()}
              placeholder="e.g. best SEO tools for small business"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <select value={newEngine} onChange={e => setNewEngine(e.target.value)}
              className="text-sm border border-border rounded-lg px-3 py-2 bg-white focus:outline-none">
              {Object.entries(ENGINE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <Button size="sm" onClick={addQuery} disabled={adding || !newQuery.trim()}>
              {adding ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4 mr-1" />} Add
            </Button>
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 rounded-xl bg-zinc-100 animate-pulse" />)}</div>
          ) : queries.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Globe className="size-8 mx-auto mb-2" />
              <p className="text-sm">Add queries to monitor your brand visibility in AI search engines.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {queries.map(q => (
                <div key={q.id} className="bg-white rounded-xl border border-border px-5 py-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">"{q.query_text}"</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{ENGINE_LABELS[q.engine] ?? q.engine}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {q.latest_result ? (
                      <>
                        <span className={cn('flex items-center gap-1 text-xs font-medium', q.latest_result.brand_cited ? 'text-emerald-600' : 'text-rose-500')}>
                          {q.latest_result.brand_cited ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
                          Brand {q.latest_result.brand_cited ? 'cited' : 'not cited'}
                        </span>
                        {q.latest_result.our_url_cited && (
                          <span className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 rounded px-1.5 py-0.5">URL cited</span>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Not checked yet</span>
                    )}
                    <button onClick={() => removeQuery(q.id)} className="text-muted-foreground hover:text-rose-500 transition-colors">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">AI Improvement Suggestions</p>
              {suggestions.map(s => (
                <div key={s.id} className={cn('rounded-lg border px-4 py-3 text-sm', s.priority === 'critical' ? 'bg-rose-50 border-rose-200 text-rose-700' : s.priority === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-700' : 'bg-blue-50 border-blue-200 text-blue-700')}>
                  {s.suggestion}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'agent' && (
        <div className="bg-white rounded-xl border border-border flex flex-col" style={{ height: '500px' }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Globe className="size-8 mx-auto mb-3" />
                <p className="font-medium">GEO Monitor Agent</p>
                <p className="text-sm mt-1">I'll query Perplexity and ChatGPT to check if your brand is being cited in AI answers.</p>
                <button onClick={() => setInput('Run GEO check on all monitored queries')}
                  className="mt-4 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-4 py-1.5 hover:bg-indigo-100">
                  Run GEO check
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
            <div ref={messagesEndRef} />
          </div>
          <div className="border-t border-border p-3 flex gap-2">
            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Run GEO check or ask about AI visibility…"
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
