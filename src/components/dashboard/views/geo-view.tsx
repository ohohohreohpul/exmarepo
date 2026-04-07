'use client'

import { useEffect, useState, useRef } from 'react'
import { Eye, Plus, Trash2, Bot, Send, Loader2, CheckCircle2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

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

interface Message {
  id: string; role: 'user' | 'assistant'; content: string
  toolCalls?: Array<{ name: string }>
}

export function GeoView({ workspaceId }: Props) {
  const [tab, setTab]             = useState<'monitor' | 'agent'>('monitor')
  const [queries, setQueries]     = useState<GeoQuery[]>([])
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [loading, setLoading]     = useState(true)
  const [queryText, setQueryText] = useState('')
  const [engine, setEngine]       = useState('perplexity')
  const [adding, setAdding]       = useState(false)
  const [messages, setMessages]   = useState<Message[]>([])
  const [input, setInput]         = useState('')
  const [running, setRunning]     = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  function load() {
    fetch(`/api/seo/geo?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.queries) { setQueries(d.queries); setSuggestions(d.suggestions ?? []) } })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function addQuery() {
    if (!queryText.trim()) return
    setAdding(true)
    const res = await fetch('/api/seo/geo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, queryText, engine }),
    })
    const d = await res.json() as { query?: GeoQuery }
    if (d.query) setQueries(prev => [{ ...d.query!, latest_result: null }, ...prev])
    setQueryText(''); setAdding(false)
  }

  async function removeQuery(id: string) {
    await fetch('/api/seo/geo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setQueries(prev => prev.filter(q => q.id !== id))
  }

  async function runAgent() {
    if (!input.trim() || running) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setRunning(true)
    const assistantId = (Date.now() + 1).toString()
    setMessages(prev => [...prev, { id: assistantId, role: 'assistant', content: '' }])

    try {
      const res = await fetch('/api/agents/geo-monitor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: userMsg.content }], workspaceId }),
      })
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
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

  const cited  = queries.filter(q => q.latest_result?.brand_cited).length
  const total  = queries.filter(q => q.latest_result != null).length
  const rate   = total > 0 ? Math.round((cited / total) * 100) : null

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg w-fit">
        {([['monitor', 'Monitor'], ['agent', 'GEO Agent']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cn('text-xs px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-white shadow-sm' : 'text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'monitor' && (
        <div className="space-y-4">
          {/* Stats */}
          {total > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white rounded-xl border border-border p-3 text-center shadow-sm">
                <p className="text-xl font-bold">{queries.length}</p>
                <p className="text-[10px] text-muted-foreground">Queries</p>
              </div>
              <div className="bg-white rounded-xl border border-border p-3 text-center shadow-sm">
                <p className="text-xl font-bold">{cited}</p>
                <p className="text-[10px] text-muted-foreground">Brand Citations</p>
              </div>
              <div className={cn('rounded-xl border p-3 text-center shadow-sm', rate != null && rate >= 50 ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200')}>
                <p className="text-xl font-bold">{rate != null ? `${rate}%` : '—'}</p>
                <p className="text-[10px] text-muted-foreground">Citation Rate</p>
              </div>
            </div>
          )}

          {/* Add query */}
          <div className="bg-white rounded-xl border border-border p-4 space-y-3 shadow-sm">
            <p className="text-xs font-semibold">Add Query to Monitor</p>
            <div className="flex gap-2">
              <Input
                placeholder='e.g. "best SEO tools for small business"'
                value={queryText}
                onChange={e => setQueryText(e.target.value)}
                className="h-8 text-sm flex-1"
              />
              <select value={engine} onChange={e => setEngine(e.target.value)} className="h-8 text-xs border border-border rounded-md px-2 bg-white">
                <option value="perplexity">Perplexity</option>
                <option value="chatgpt">ChatGPT</option>
              </select>
              <Button size="sm" onClick={addQuery} disabled={!queryText.trim() || adding} className="h-8">
                {adding ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              </Button>
            </div>
          </div>

          {/* Queries */}
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-zinc-100 animate-pulse rounded-xl" />)}</div>
          ) : queries.length === 0 ? (
            <div className="flex flex-col items-center py-12 gap-3 text-center">
              <Eye className="size-8 text-zinc-300" />
              <p className="text-sm text-muted-foreground">Add queries to monitor your brand in AI search.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {queries.map(q => (
                <div key={q.id} className="bg-white rounded-lg border border-border px-4 py-3 flex items-center gap-3 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">&ldquo;{q.query_text}&rdquo;</p>
                    <div className="flex items-center gap-2 mt-1">
                      <Badge variant="outline" className="text-[10px] h-4">{q.engine}</Badge>
                      {q.latest_result ? (
                        q.latest_result.brand_cited
                          ? <span className="flex items-center gap-1 text-[10px] text-green-600"><CheckCircle2 className="size-3" /> Cited</span>
                          : <span className="flex items-center gap-1 text-[10px] text-zinc-400"><XCircle className="size-3" /> Not cited</span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground">Not checked yet</span>
                      )}
                    </div>
                  </div>
                  <button onClick={() => removeQuery(q.id)} className="text-muted-foreground hover:text-rose-600 shrink-0">
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Suggestions */}
          {suggestions.length > 0 && (
            <div>
              <p className="text-xs font-semibold mb-2">Improvement Suggestions</p>
              <div className="space-y-2">
                {suggestions.map(s => (
                  <div key={s.id} className="bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
                    <p className="text-xs text-blue-800">{s.suggestion}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'agent' && (
        <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <Bot className="size-10 text-zinc-300" />
                <p className="text-sm font-medium">GEO Monitor Agent</p>
                <p className="text-xs text-muted-foreground">Checks if your brand appears in AI search results and suggests improvements.</p>
                <p className="text-xs text-muted-foreground italic">e.g. "Check my AI visibility and suggest improvements"</p>
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
            <Input placeholder="Check AI visibility…" value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAgent() } }}
              className="h-9 text-sm" />
            <Button size="sm" onClick={runAgent} disabled={running || !input.trim()} className="h-9 px-3 shrink-0">
              {running ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
