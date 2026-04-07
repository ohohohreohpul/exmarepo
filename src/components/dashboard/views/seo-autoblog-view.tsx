'use client'

import { useState, useEffect, useRef } from 'react'
import { Rss, Plus, Trash2, Bot, Send, Loader2, CheckCircle2, Clock, XCircle, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface Draft {
  id: string
  status: string
  title: string | null
  slug: string | null
  word_count: number | null
  target_keywords: string[] | null
  published_url: string | null
  created_at: string
}

interface Feed {
  id: string
  display_name: string
  feed_url: string
  active: boolean
  item_count: number
  last_fetched_at: string | null
}

interface Message { id: string; role: 'user' | 'assistant'; content: string; isStreaming?: boolean }
interface Props { workspaceId?: string }

const STATUS_CONFIG: Record<string, { label: string; className: string; icon: React.ElementType }> = {
  draft:      { label: 'Draft',      className: 'bg-zinc-50 text-zinc-600 border-zinc-200',      icon: Clock },
  approved:   { label: 'Approved',   className: 'bg-blue-50 text-blue-700 border-blue-200',       icon: CheckCircle2 },
  publishing: { label: 'Publishing', className: 'bg-amber-50 text-amber-700 border-amber-200',    icon: Loader2 },
  published:  { label: 'Published',  className: 'bg-emerald-50 text-emerald-700 border-emerald-200', icon: CheckCircle2 },
  failed:     { label: 'Failed',     className: 'bg-rose-50 text-rose-700 border-rose-200',       icon: XCircle },
  dismissed:  { label: 'Dismissed',  className: 'bg-zinc-50 text-zinc-400 border-zinc-200',       icon: XCircle },
}

export function SeoAutoblogView({ workspaceId }: Props) {
  const [tab,       setTab]       = useState<'drafts' | 'feeds' | 'agent'>('drafts')
  const [drafts,    setDrafts]    = useState<Draft[]>([])
  const [feeds,     setFeeds]     = useState<Feed[]>([])
  const [loading,   setLoading]   = useState(true)
  const [statusFilter, setStatusFilter] = useState('draft')
  const [newFeedUrl, setNewFeedUrl] = useState('')
  const [addingFeed, setAddingFeed] = useState(false)
  const [messages,  setMessages]  = useState<Message[]>([])
  const [input,     setInput]     = useState('')
  const [streaming, setStreaming] = useState(false)
  const [acting,    setActing]    = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  function load() {
    if (!workspaceId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/seo/autoblog/drafts?workspaceId=${workspaceId}&status=${statusFilter}`).then(r => r.json()),
      fetch(`/api/seo/autoblog/feeds?workspaceId=${workspaceId}`).then(r => r.json()),
    ]).then(([d, f]) => { setDrafts(d.drafts ?? []); setFeeds(f.feeds ?? []) })
    .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId, statusFilter])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

  async function addFeed() {
    if (!newFeedUrl.trim() || !workspaceId) return
    setAddingFeed(true)
    const res = await fetch('/api/seo/autoblog/feeds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, feedUrl: newFeedUrl.trim() }),
    })
    const d = await res.json() as { error?: string }
    if (d.error) { alert(d.error) } else { setNewFeedUrl(''); load() }
    setAddingFeed(false)
  }

  async function removeFeed(id: string) {
    await fetch('/api/seo/autoblog/feeds', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    setFeeds(p => p.filter(f => f.id !== id))
  }

  async function draftAction(id: string, action: 'approve' | 'dismiss' | 'publish') {
    setActing(id)
    await fetch('/api/seo/autoblog/drafts', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, action }),
    })
    load()
    setActing(null)
  }

  async function sendMessage() {
    if (!input.trim() || streaming || !workspaceId) return
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: input }
    const assistantId = (Date.now() + 1).toString()
    setMessages(p => [...p, userMsg, { id: assistantId, role: 'assistant', content: '', isStreaming: true }])
    setInput(''); setStreaming(true)

    const res = await fetch('/api/agents/autoblog', {
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
          if (evt.type === 'done') { load(); setTab('drafts') }
          setMessages(p => p.map(m => m.id === assistantId ? { ...m, content: text } : m))
        } catch { /* skip */ }
      }
    }
    setMessages(p => p.map(m => m.id === assistantId ? { ...m, isStreaming: false } : m))
    setStreaming(false)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Auto Blogger</h2>
          <p className="text-sm text-muted-foreground">AI-generated posts from RSS feeds, published to WordPress</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {(['drafts', 'feeds', 'agent'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px capitalize transition-colors',
            tab === t ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-muted-foreground hover:text-foreground'
          )}>
            {t === 'drafts' && <Clock className="size-4" />}
            {t === 'feeds' && <Rss className="size-4" />}
            {t === 'agent' && <Bot className="size-4" />}
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === 'drafts' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {['draft', 'approved', 'published', 'dismissed'].map(s => (
              <button key={s} onClick={() => setStatusFilter(s)} className={cn(
                'text-xs px-3 py-1.5 rounded-full border font-medium transition-colors capitalize',
                statusFilter === s ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-muted-foreground border-border hover:border-indigo-300'
              )}>{s}</button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-16 rounded-xl bg-zinc-100 animate-pulse" />)}</div>
          ) : drafts.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Clock className="size-8 mx-auto mb-2" />
              <p className="text-sm">No {statusFilter} drafts. Run the Autopilot Agent to generate posts.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {drafts.map(draft => {
                const cfg = STATUS_CONFIG[draft.status] ?? STATUS_CONFIG.draft
                const Icon = cfg.icon
                return (
                  <div key={draft.id} className="bg-white rounded-xl border border-border shadow-sm px-5 py-4 flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{draft.title ?? 'Untitled'}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={cn('flex items-center gap-1 text-xs border rounded px-1.5 py-0.5', cfg.className)}>
                          <Icon className="size-3" /> {cfg.label}
                        </span>
                        {draft.word_count && <span className="text-xs text-muted-foreground">{draft.word_count}w</span>}
                        {(draft.target_keywords ?? []).slice(0, 2).map(k => (
                          <span key={k} className="text-xs bg-zinc-100 text-zinc-600 rounded px-1.5 py-0.5">{k}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {draft.published_url && (
                        <a href={draft.published_url} target="_blank" rel="noreferrer">
                          <Button variant="ghost" size="sm"><ExternalLink className="size-3.5 mr-1" /> View</Button>
                        </a>
                      )}
                      {draft.status === 'draft' && (
                        <>
                          <Button variant="outline" size="sm" disabled={acting === draft.id} onClick={() => draftAction(draft.id, 'approve')}>
                            {acting === draft.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Approve'}
                          </Button>
                          <Button variant="ghost" size="sm" disabled={acting === draft.id} onClick={() => draftAction(draft.id, 'dismiss')}>Dismiss</Button>
                        </>
                      )}
                      {draft.status === 'approved' && (
                        <Button size="sm" disabled={acting === draft.id} onClick={() => draftAction(draft.id, 'publish')}>
                          {acting === draft.id ? <Loader2 className="size-3.5 animate-spin" /> : 'Publish to WP'}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {tab === 'feeds' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <input value={newFeedUrl} onChange={e => setNewFeedUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && addFeed()}
              placeholder="https://example.com/feed or https://example.com/rss.xml"
              className="flex-1 px-3 py-2 text-sm border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <Button size="sm" onClick={addFeed} disabled={addingFeed || !newFeedUrl.trim()}>
              {addingFeed ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4 mr-1" />} Add Feed
            </Button>
          </div>
          {feeds.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Rss className="size-8 mx-auto mb-2" />
              <p className="text-sm">No RSS feeds added. Add industry blogs to generate content from.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {feeds.map(feed => (
                <div key={feed.id} className="bg-white rounded-xl border border-border px-5 py-3 flex items-center gap-4">
                  <Rss className="size-4 text-amber-500 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{feed.display_name}</p>
                    <p className="text-xs text-muted-foreground truncate">{feed.feed_url}</p>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{feed.item_count} items</span>
                  <button onClick={() => removeFeed(feed.id)} className="text-muted-foreground hover:text-rose-500 transition-colors">
                    <Trash2 className="size-3.5" />
                  </button>
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
                <Bot className="size-8 mx-auto mb-3" />
                <p className="font-medium">Autopilot Blog Agent</p>
                <p className="text-sm mt-1">I'll fetch your RSS feeds, pick the best topics, write full SEO posts, and save them as drafts.</p>
                <button onClick={() => setInput('Generate blog posts from my RSS feeds')}
                  className="mt-4 text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-full px-4 py-1.5 hover:bg-indigo-100">
                  Generate posts now
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
              placeholder="Generate posts, or give a specific topic…"
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
