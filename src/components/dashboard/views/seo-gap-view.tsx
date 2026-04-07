'use client'

import { useState, useEffect, useRef } from 'react'
import { Target, Plus, Trash2, Bot, Send, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Gap {
  id: string
  topic: string
  opportunity_score: number | null
  target_keywords: string[] | null
  suggested_title: string | null
  suggested_outline: string[] | null
  created_at: string
}

interface Competitor {
  id: string
  display_name: string
  site_url: string
  last_crawled_at: string | null
}

interface Message { id: string; role: 'user' | 'assistant'; content: string; isStreaming?: boolean }

interface Props { workspaceId?: string }

export function SeoGapView({ workspaceId }: Props) {
  const [tab,          setTab]         = useState<'gaps' | 'agent'>('gaps')
  const [gaps,         setGaps]        = useState<Gap[]>([])
  const [competitors,  setCompetitors] = useState<Competitor[]>([])
  const [loading,      setLoading]     = useState(true)
  const [expanded,     setExpanded]    = useState<string | null>(null)
  const [newCompUrl,   setNewCompUrl]  = useState('')
  const [newCompName,  setNewCompName] = useState('')
  const [addingComp,   setAddingComp]  = useState(false)
  const [messages,     setMessages]    = useState<Message[]>([])
  const [input,        setInput]       = useState('')
  const [streaming,    setStreaming]   = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  function load() {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/seo/competitors?workspaceId=${workspaceId}`).then(r => r.json()),
      fetch(`/api/seo/gap?workspaceId=${workspaceId}`).then(r => r.json()).catch(() => ({ gaps: [] })),
    ]).then(([comps, gapsData]) => {
      setCompetitors(comps.competitors ?? [])
      setGaps(gapsData.gaps ?? [])
    }).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function addCompetitor() {
    if (!newCompUrl.trim() || !workspaceId) return
    setAddingComp(true)
    await fetch('/api/seo/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, siteUrl: newCompUrl.trim(), displayName: newCompName.trim() || newCompUrl.trim() }),
    })
    setNewCompUrl(''); setNewCompName('')
    load()
    setAddingComp(false)
  }

  async function removeCompetitor(id: string) {
    await fetch('/api/seo/competitors', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setCompetitors(p => p.filter(c => c.id !== id))
  }

  async function sendMessage() {
    if (!input.trim() || streaming || !workspaceId) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    const assistantId = (Date.now() + 1).toString()
    setMessages(p => [...p, userMsg, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])
    setInput(''); setStreaming(true)

    const res = await fetch('/api/agents/content-gap', {
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
          if (evt.type === 'tool_call') text += `\n\n_Using tool: ${evt.name}…_\n`
          if (evt.type === 'done') load()
          setMessages(p => p.map(m => m.id === assistantId ? { ...m, content: text } : m))
        } catch { /* skip */ }
      }
    }
    setMessages(p => p.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
    setStreaming(false)
  }

  return (
    <div className="p-6 space-y-4">
      {/* Competitors bar */}
      <div className="bg-white rounded-xl border border-border p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Tracked Competitors</p>
        <div className="flex flex-wrap gap-2">
          {competitors.map(c => (
            <div key={c.id} className="flex items-center gap-1.5 bg-zinc-50 border border-border rounded-lg px-3 py-1.5 text-sm">
              <span className="font-medium">{c.display_name}</span>
              <button onClick={() => removeCompetitor(c.id)} className="text-muted-foreground hover:text-rose-500 ml-1">
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          {competitors.length === 0 && <span className="text-sm text-muted-foreground">No competitors added yet</span>}
        </div>
        <div className="flex gap-2 pt-1">
          <input value={newCompName} onChange={e => setNewCompName(e.target.value)} placeholder="Name (optional)"
            className="w-36 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <input value={newCompUrl} onChange={e => setNewCompUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCompetitor()}
            placeholder="https://competitor.com"
            className="flex-1 px-3 py-1.5 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
          <Button size="sm" onClick={addCompetitor} disabled={addingComp || !newCompUrl.trim()}>
            {addingComp ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4 mr-1" />} Add
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['gaps', 'agent'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
            tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
            {t === 'gaps' ? <><Target className="size-4" /> Opportunities</> : <><Bot className="size-4" /> AI Analyst</>}
          </button>
        ))}
      </div>

      {tab === 'gaps' && (
        loading ? <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />)}</div> :
        gaps.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Target className="size-8 mx-auto mb-2" />
            <p className="font-medium">No gaps found yet</p>
            <p className="text-sm mt-1">Add competitors and run the AI Analyst to discover content opportunities.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {gaps.sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)).map(gap => (
              <div key={gap.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpanded(expanded === gap.id ? null : gap.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-zinc-50 transition-colors"
                >
                  <div className="w-12 h-12 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center shrink-0">
                    <span className="text-lg font-bold text-indigo-600">{gap.opportunity_score ?? '?'}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate">{gap.topic}</p>
                    {gap.suggested_title && <p className="text-xs text-muted-foreground truncate mt-0.5">{gap.suggested_title}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {(gap.target_keywords ?? []).slice(0, 2).map(k => (
                      <span key={k} className="text-xs bg-zinc-100 text-zinc-600 rounded px-2 py-0.5">{k}</span>
                    ))}
                    {expanded === gap.id ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                  </div>
                </button>
                {expanded === gap.id && gap.suggested_outline && (
                  <div className="border-t border-border px-5 py-4 bg-zinc-50">
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Suggested Outline</p>
                    <ol className="space-y-1">
                      {(gap.suggested_outline as string[]).map((h, i) => (
                        <li key={i} className="text-sm text-foreground flex gap-2">
                          <span className="text-muted-foreground">{i + 1}.</span> {h}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'agent' && (
        <div className="bg-white rounded-xl border border-border flex flex-col" style={{ height: '500px' }}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Target className="size-8 mx-auto mb-3" />
                <p className="font-medium">Content Gap Analyst</p>
                <p className="text-sm mt-1">I'll crawl your competitors, compare content, and surface gaps your site is missing.</p>
                <button onClick={() => setInput('Analyze content gaps against my competitors')}
                  className="mt-4 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-4 py-1.5 hover:bg-indigo-100 transition-colors">
                  Analyze content gaps
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
              placeholder="Analyze content gaps…"
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
