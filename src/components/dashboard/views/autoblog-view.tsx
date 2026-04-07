'use client'

import { useEffect, useState, useRef } from 'react'
import { Rss, Plus, Trash2, Bot, Send, Loader2, CheckCircle2, ExternalLink, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface Draft {
  id: string
  title: string | null
  status: string
  word_count: number | null
  target_keywords: string[] | null
  published_url: string | null
  created_at: string
}

interface Feed {
  id: string
  feed_url: string
  display_name: string | null
  active: boolean
  item_count: number
}

interface Message {
  id: string; role: 'user' | 'assistant'; content: string
  toolCalls?: Array<{ name: string }>
}

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  draft:      { label: 'Draft',      className: 'bg-zinc-100 text-zinc-700' },
  approved:   { label: 'Approved',   className: 'bg-blue-100 text-blue-700' },
  publishing: { label: 'Publishing', className: 'bg-amber-100 text-amber-700' },
  published:  { label: 'Published',  className: 'bg-green-100 text-green-700' },
  failed:     { label: 'Failed',     className: 'bg-rose-100 text-rose-700' },
  dismissed:  { label: 'Dismissed',  className: 'bg-zinc-100 text-zinc-400' },
}

export function AutoblogView({ workspaceId }: Props) {
  const [tab, setTab]       = useState<'drafts' | 'feeds' | 'agent'>('drafts')
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [feeds, setFeeds]   = useState<Feed[]>([])
  const [statusFilter, setStatusFilter] = useState('draft')
  const [loading, setLoading] = useState(true)
  const [feedUrl, setFeedUrl] = useState('')
  const [addingFeed, setAddingFeed] = useState(false)
  const [actionId, setActionId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput]   = useState('')
  const [running, setRunning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  function loadDrafts() {
    fetch(`/api/seo/autoblog/drafts?workspaceId=${workspaceId}&status=${statusFilter}`)
      .then(r => r.json())
      .then(d => { if (d.drafts) setDrafts(d.drafts) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  function loadFeeds() {
    fetch(`/api/seo/autoblog/feeds?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.feeds) setFeeds(d.feeds) })
      .catch(() => {})
  }

  useEffect(() => { loadDrafts(); loadFeeds() }, [workspaceId, statusFilter])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function draftAction(id: string, action: 'approve' | 'dismiss' | 'publish') {
    setActionId(id)
    await fetch('/api/seo/autoblog/drafts', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, action }),
    })
    loadDrafts()
    setActionId(null)
  }

  async function addFeed() {
    if (!feedUrl.trim()) return
    setAddingFeed(true)
    const res = await fetch('/api/seo/autoblog/feeds', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId, feedUrl }),
    })
    const d = await res.json() as { feed?: Feed; error?: string }
    if (d.feed) setFeeds(prev => [{ ...d.feed!, item_count: 0 }, ...prev])
    else alert(d.error ?? 'Failed to add feed')
    setFeedUrl(''); setAddingFeed(false)
  }

  async function removeFeed(id: string) {
    await fetch('/api/seo/autoblog/feeds', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setFeeds(prev => prev.filter(f => f.id !== id))
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
      const res = await fetch('/api/agents/autoblog', {
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
      loadDrafts()
    } catch (e) {
      const errText = String(e)
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${errText}` } : m))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex gap-1 bg-zinc-100 p-1 rounded-lg w-fit">
        {([['drafts', 'Drafts'], ['feeds', 'RSS Feeds'], ['agent', 'Autopilot Agent']] as const).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={cn('text-xs px-3 py-1.5 rounded-md font-medium', tab === t ? 'bg-white shadow-sm' : 'text-muted-foreground')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'drafts' && (
        <div className="space-y-4">
          <div className="flex gap-1.5 flex-wrap">
            {['draft', 'approved', 'published', 'dismissed'].map(s => (
              <button key={s} onClick={() => { setStatusFilter(s); setLoading(true) }}
                className={cn('text-xs px-2.5 py-1 rounded-full border capitalize', statusFilter === s ? 'bg-zinc-900 text-white border-zinc-900' : 'border-border text-muted-foreground')}>
                {s}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 bg-zinc-100 animate-pulse rounded-xl" />)}</div>
          ) : drafts.length === 0 ? (
            <div className="flex flex-col items-center py-16 gap-3 text-center">
              <FileText className="size-8 text-zinc-300" />
              <p className="text-sm text-muted-foreground">No {statusFilter} drafts. Run the Autopilot Agent to generate posts.</p>
              <Button size="sm" onClick={() => setTab('agent')}>Run Autopilot Agent</Button>
            </div>
          ) : (
            <div className="space-y-2">
              {drafts.map(draft => {
                const cfg = STATUS_CONFIG[draft.status] ?? STATUS_CONFIG.draft
                return (
                  <div key={draft.id} className="bg-white rounded-xl border border-border p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={cn('text-[10px] h-4 border-0', cfg.className)}>{cfg.label}</Badge>
                          {draft.word_count && <span className="text-[10px] text-muted-foreground">{draft.word_count} words</span>}
                        </div>
                        <p className="text-sm font-medium truncate">{draft.title ?? 'Untitled'}</p>
                        {draft.target_keywords && draft.target_keywords.length > 0 && (
                          <div className="flex gap-1 mt-1 flex-wrap">
                            {draft.target_keywords.slice(0, 3).map(k => <Badge key={k} variant="outline" className="text-[10px] h-4">{k}</Badge>)}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-1.5 shrink-0">
                        {draft.status === 'draft' && (
                          <>
                            <Button size="sm" className="h-6 text-xs" onClick={() => draftAction(draft.id, 'approve')} disabled={actionId === draft.id}>
                              {actionId === draft.id ? <Loader2 className="size-3 animate-spin" /> : <CheckCircle2 className="size-3" />}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 text-xs text-zinc-400" onClick={() => draftAction(draft.id, 'dismiss')} disabled={actionId === draft.id}>✕</Button>
                          </>
                        )}
                        {draft.status === 'approved' && (
                          <Button size="sm" className="h-6 text-xs bg-green-600 hover:bg-green-700" onClick={() => draftAction(draft.id, 'publish')} disabled={actionId === draft.id}>
                            {actionId === draft.id ? <Loader2 className="size-3 animate-spin" /> : 'Publish'}
                          </Button>
                        )}
                        {draft.published_url && (
                          <a href={draft.published_url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'feeds' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-border p-4 space-y-3 shadow-sm">
            <p className="text-xs font-semibold">Add RSS Feed</p>
            <div className="flex gap-2">
              <Input placeholder="https://example.com/feed.xml" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} className="h-8 text-sm flex-1" />
              <Button size="sm" onClick={addFeed} disabled={!feedUrl.trim() || addingFeed} className="h-8">
                {addingFeed ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {feeds.map(feed => (
              <div key={feed.id} className="bg-white rounded-lg border border-border px-4 py-3 flex items-center gap-3 shadow-sm">
                <Rss className="size-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{feed.display_name ?? feed.feed_url}</p>
                  <p className="text-xs text-muted-foreground truncate">{feed.feed_url} · {feed.item_count} items</p>
                </div>
                <button onClick={() => removeFeed(feed.id)} className="text-muted-foreground hover:text-rose-600 shrink-0">
                  <Trash2 className="size-4" />
                </button>
              </div>
            ))}
            {feeds.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No RSS feeds added yet.</p>}
          </div>
        </div>
      )}

      {tab === 'agent' && (
        <div className="flex flex-col h-[calc(100vh-200px)] min-h-[400px]">
          <div className="flex-1 overflow-y-auto space-y-3 pb-4">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                <Bot className="size-10 text-zinc-300" />
                <p className="text-sm font-medium">Autopilot Blog Agent</p>
                <p className="text-xs text-muted-foreground">Reads your RSS feeds and writes SEO-optimised blog posts automatically.</p>
                <p className="text-xs text-muted-foreground italic">e.g. "Generate 3 blog posts from my RSS feeds"</p>
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
            <Input placeholder="Generate blog posts from RSS…" value={input} onChange={e => setInput(e.target.value)}
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
