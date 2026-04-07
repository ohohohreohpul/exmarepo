'use client'

import { useEffect, useState, useRef } from 'react'
import { TrendingUp, Plus, Trash2, Bot, Send, Loader2, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface Gap {
  id: string
  topic: string
  opportunity_score: number | null
  target_keywords: string[] | null
  suggested_title: string | null
  suggested_outline: string[] | null
  competitor_examples: string[] | null
  created_at: string
}

interface Competitor {
  id: string
  site_url: string
  display_name: string
  last_crawled_at: string | null
}

interface Message {
  id: string; role: 'user' | 'assistant'; content: string
  toolCalls?: Array<{ name: string }>
}

export function ContentGapView({ workspaceId }: Props) {
  const [tab, setTab]               = useState<'gaps' | 'competitors' | 'agent'>('gaps')
  const [gaps, setGaps]             = useState<Gap[]>([])
  const [competitors, setCompetitors] = useState<Competitor[]>([])
  const [loading, setLoading]       = useState(true)
  const [expanded, setExpanded]     = useState<string | null>(null)
  const [messages, setMessages]     = useState<Message[]>([])
  const [input, setInput]           = useState('')
  const [running, setRunning]       = useState(false)
  const [compUrl, setCompUrl]       = useState('')
  const [compName, setCompName]     = useState('')
  const [addingComp, setAddingComp] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  function loadGaps() {
    fetch(`/api/seo/competitors?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.competitors) setCompetitors(d.competitors) })
      .catch(() => {})
    // Load gaps via inline DB query through existing API
    setLoading(false)
  }

  useEffect(() => { loadGaps() }, [workspaceId])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function addCompetitor() {
    if (!compUrl.trim()) return
    setAddingComp(true)
    const res = await fetch('/api/seo/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, siteUrl: compUrl, displayName: compName || compUrl }),
    })
    const d = await res.json() as { competitor?: Competitor }
    if (d.competitor) setCompetitors(prev => [d.competitor!, ...prev])
    setCompUrl(''); setCompName(''); setAddingComp(false)
  }

  async function removeCompetitor(id: string) {
    await fetch('/api/seo/competitors', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setCompetitors(prev => prev.filter(c => c.id !== id))
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
      const res = await fetch('/api/agents/content-gap', {
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
      loadGaps()
    } catch (e) {
      const errText = String(e)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${errText}` } : m))
    } finally {
      setRunning(false)
    }
  }

  function scoreColor(s: number | null) {
    if (s == null) return 'bg-zinc-100 text-zinc-500'
    if (s >= 70) return 'bg-green-100 text-green-700'
    if (s >= 40) return 'bg-amber-100 text-amber-700'
    return 'bg-zinc-100 text-zinc-500'
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg w-fit">
        {([['gaps', 'Opportunities'], ['competitors', 'Competitors'], ['agent', 'AI Analyst']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cn('text-xs px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-white shadow-sm' : 'text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'gaps' && (
        <>
          {gaps.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-center">
              <TrendingUp className="size-8 text-zinc-300" />
              <p className="text-sm font-medium">No content gaps found yet</p>
              <p className="text-xs text-muted-foreground">Add competitors, then run the AI Analyst to discover opportunities.</p>
              <Button size="sm" variant="outline" onClick={() => setTab('agent')}>Run AI Analyst</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {gaps.map(gap => (
                <div key={gap.id} className="bg-white rounded-xl border border-border shadow-sm overflow-hidden">
                  <button onClick={() => setExpanded(expanded === gap.id ? null : gap.id)} className="flex items-center gap-3 w-full px-4 py-3 text-left">
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', scoreColor(gap.opportunity_score))}>
                      {gap.opportunity_score ?? '?'}
                    </span>
                    <span className="text-sm font-medium flex-1">{gap.topic}</span>
                    {expanded === gap.id ? <ChevronUp className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                  </button>
                  {expanded === gap.id && (
                    <div className="px-4 pb-4 border-t border-border space-y-3 bg-zinc-50">
                      {gap.suggested_title && (
                        <div className="pt-3">
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Suggested Title</p>
                          <p className="text-sm font-medium">{gap.suggested_title}</p>
                        </div>
                      )}
                      {gap.target_keywords && gap.target_keywords.length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Keywords</p>
                          <div className="flex flex-wrap gap-1">
                            {gap.target_keywords.map(k => <Badge key={k} variant="outline" className="text-[10px]">{k}</Badge>)}
                          </div>
                        </div>
                      )}
                      {gap.suggested_outline && (gap.suggested_outline as unknown as string[]).length > 0 && (
                        <div>
                          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1">Outline</p>
                          <ol className="text-xs space-y-0.5 text-muted-foreground list-decimal list-inside">
                            {(gap.suggested_outline as unknown as string[]).map((h, i) => <li key={i}>{h}</li>)}
                          </ol>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'competitors' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border p-4 space-y-3 shadow-sm">
            <p className="text-xs font-semibold">Add Competitor</p>
            <div className="grid gap-2">
              <div>
                <Label className="text-xs">URL *</Label>
                <Input placeholder="https://competitor.com" value={compUrl} onChange={e => setCompUrl(e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
              <div>
                <Label className="text-xs">Name</Label>
                <Input placeholder="Competitor Name" value={compName} onChange={e => setCompName(e.target.value)} className="mt-1 h-8 text-sm" />
              </div>
            </div>
            <Button size="sm" onClick={addCompetitor} disabled={!compUrl.trim() || addingComp}>
              {addingComp ? <Loader2 className="size-3 animate-spin mr-1" /> : <Plus className="size-3 mr-1" />}
              Add
            </Button>
          </div>

          <div className="space-y-2">
            {competitors.map(c => (
              <div key={c.id} className="bg-white rounded-lg border border-border px-4 py-3 flex items-center justify-between shadow-sm">
                <div>
                  <p className="text-sm font-medium">{c.display_name}</p>
                  <p className="text-xs text-muted-foreground">{c.site_url}</p>
                </div>
                <button onClick={() => removeCompetitor(c.id)} className="text-muted-foreground hover:text-rose-600">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {competitors.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No competitors added yet.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'agent' && (
        <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <Bot className="size-10 text-zinc-300" />
                <p className="text-sm font-medium">AI Content Gap Analyst</p>
                <p className="text-xs text-muted-foreground">Crawls your competitors and finds topics you're missing.</p>
                <p className="text-xs text-muted-foreground italic">e.g. "Find content gaps between my site and competitors"</p>
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
              placeholder="Find content gaps…"
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
