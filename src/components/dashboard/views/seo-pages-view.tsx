'use client'

import { useEffect, useState } from 'react'
import { FileText, Search, ChevronDown, ChevronUp, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface Page {
  id: string
  url: string
  title: string | null
  meta_description: string | null
  h1: string | null
  word_count: number | null
  index_status: string
  last_crawled_at: string | null
  issue_counts: { critical: number; warning: number; info: number }
}

type SortKey = 'word_count' | 'issues' | 'last_crawled_at'

export function SeoPagesView({ workspaceId }: Props) {
  const [pages, setPages]   = useState<Page[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('issues')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [expanded, setExpanded] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/seo/pages?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.pages) setPages(d.pages) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workspaceId])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('desc') }
  }

  const filtered = pages
    .filter(p => {
      const q = search.toLowerCase()
      return (p.url.toLowerCase().includes(q) || (p.title ?? '').toLowerCase().includes(q))
    })
    .sort((a, b) => {
      let av = 0, bv = 0
      if (sortKey === 'word_count') { av = a.word_count ?? 0; bv = b.word_count ?? 0 }
      if (sortKey === 'issues') {
        av = a.issue_counts.critical * 10 + a.issue_counts.warning
        bv = b.issue_counts.critical * 10 + b.issue_counts.warning
      }
      if (sortKey === 'last_crawled_at') {
        av = a.last_crawled_at ? new Date(a.last_crawled_at).getTime() : 0
        bv = b.last_crawled_at ? new Date(b.last_crawled_at).getTime() : 0
      }
      return sortDir === 'desc' ? bv - av : av - bv
    })

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return null
    return sortDir === 'desc' ? <ChevronDown className="size-3 inline ml-0.5" /> : <ChevronUp className="size-3 inline ml-0.5" />
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            placeholder="Search pages…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-8 h-8 text-sm"
          />
        </div>
        <span className="text-xs text-muted-foreground shrink-0">{filtered.length} pages</span>
      </div>

      {/* Table header */}
      <div className="grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        <span>Page</span>
        <button onClick={() => toggleSort('word_count')} className="hover:text-foreground">Words<SortIcon k="word_count" /></button>
        <button onClick={() => toggleSort('issues')} className="hover:text-foreground">Issues<SortIcon k="issues" /></button>
        <button onClick={() => toggleSort('last_crawled_at')} className="hover:text-foreground">Crawled<SortIcon k="last_crawled_at" /></button>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-zinc-100 animate-pulse rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <FileText className="size-8 text-zinc-300" />
          <p className="text-sm text-muted-foreground">No pages found. Crawl a site first.</p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map(page => {
            const totalIssues = page.issue_counts.critical + page.issue_counts.warning + page.issue_counts.info
            const isExpanded  = expanded === page.id
            return (
              <div key={page.id} className="bg-white rounded-lg border border-border shadow-sm overflow-hidden">
                <button
                  onClick={() => setExpanded(isExpanded ? null : page.id)}
                  className="grid grid-cols-[1fr_auto_auto_auto] gap-2 w-full px-3 py-2.5 text-left hover:bg-zinc-50 items-center"
                >
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">{page.title || page.url}</p>
                    <p className="text-[10px] text-muted-foreground truncate">{page.url}</p>
                  </div>
                  <span className="text-xs text-muted-foreground text-right">{(page.word_count ?? 0).toLocaleString()}</span>
                  <div className="flex gap-1">
                    {page.issue_counts.critical > 0 && (
                      <span className="text-[10px] text-rose-600 font-semibold">{page.issue_counts.critical}C</span>
                    )}
                    {page.issue_counts.warning > 0 && (
                      <span className="text-[10px] text-amber-600 font-semibold">{page.issue_counts.warning}W</span>
                    )}
                    {totalIssues === 0 && <CheckCircle2 className="size-3 text-green-500" />}
                  </div>
                  <span className="text-[10px] text-muted-foreground text-right">
                    {page.last_crawled_at ? new Date(page.last_crawled_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '—'}
                  </span>
                </button>

                {isExpanded && (
                  <div className="px-3 pb-3 pt-0 border-t border-border bg-zinc-50 space-y-2">
                    <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Title</p>
                        <p className={cn('font-medium', !page.title && 'text-rose-500 italic')}>{page.title || 'Missing'}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">H1</p>
                        <p className={cn('font-medium', !page.h1 && 'text-rose-500 italic')}>{page.h1 || 'Missing'}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Meta Description</p>
                        <p className={cn(page.meta_description ? 'text-zinc-700' : 'text-rose-500 italic')}>
                          {page.meta_description || 'Missing'}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Words</p>
                        <p>{(page.word_count ?? 0).toLocaleString()}</p>
                      </div>
                      <div>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-0.5">Index Status</p>
                        <Badge variant={page.index_status === 'noindex' ? 'destructive' : 'outline'} className="text-[10px] h-4">{page.index_status}</Badge>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
