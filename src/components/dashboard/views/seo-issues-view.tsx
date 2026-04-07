'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, ChevronDown, ChevronUp, CheckCircle2, EyeOff, RotateCcw, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface Issue {
  id: string
  issue_type: string
  severity: 'critical' | 'warning' | 'info'
  status: string
  description: string
  recommendation: string
  seo_pages: { url: string; title: string | null } | null
}

type Filter = 'all' | 'critical' | 'warning' | 'info'

const SEVERITY_CONFIG = {
  critical: { label: 'Critical', className: 'bg-rose-50 border-rose-200 text-rose-700', badge: 'bg-rose-100 text-rose-700 border-rose-200' },
  warning:  { label: 'Warning',  className: 'bg-amber-50 border-amber-200 text-amber-700', badge: 'bg-amber-100 text-amber-700 border-amber-200' },
  info:     { label: 'Info',     className: 'bg-blue-50 border-blue-200 text-blue-700',   badge: 'bg-blue-100 text-blue-700 border-blue-200' },
}

export function SeoIssuesView({ workspaceId }: Props) {
  const [issues, setIssues]   = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter]   = useState<Filter>('all')
  const [showResolved, setShowResolved] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [updating, setUpdating] = useState<Record<string, boolean>>({})

  function load() {
    const status = showResolved ? 'resolved' : 'open'
    fetch(`/api/seo/issues?workspaceId=${workspaceId}&status=${status}`)
      .then(r => r.json())
      .then(d => { if (d.issues) setIssues(d.issues) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId, showResolved])

  async function updateStatus(id: string, status: 'resolved' | 'ignored' | 'open') {
    setUpdating(p => ({ ...p, [id]: true }))
    await fetch('/api/seo/issues', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status }),
    })
    setIssues(prev => prev.filter(i => i.id !== id))
    setUpdating(p => ({ ...p, [id]: false }))
  }

  const shown = issues.filter(i => filter === 'all' || i.severity === filter)
  const counts = {
    critical: issues.filter(i => i.severity === 'critical').length,
    warning:  issues.filter(i => i.severity === 'warning').length,
    info:     issues.filter(i => i.severity === 'info').length,
  }

  return (
    <div className="p-6 space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex gap-1.5">
          {(['all', 'critical', 'warning', 'info'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                'text-xs px-2.5 py-1 rounded-full border capitalize',
                filter === f ? 'bg-zinc-900 text-white border-zinc-900' : 'border-border text-muted-foreground hover:text-foreground'
              )}
            >
              {f === 'all' ? `All (${issues.length})` : `${f} (${counts[f]})`}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setShowResolved(p => !p); setLoading(true) }}
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            <RefreshCw className="size-3" />
            {showResolved ? 'Show open' : 'Show resolved'}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-16 bg-zinc-100 animate-pulse rounded-xl" />)}</div>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <CheckCircle2 className="size-8 text-green-400" />
          <p className="text-sm text-muted-foreground">{showResolved ? 'No resolved issues.' : 'No open issues. Great job!'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(issue => {
            const cfg = SEVERITY_CONFIG[issue.severity]
            const isExpanded = expanded === issue.id
            return (
              <div key={issue.id} className={cn('rounded-xl border overflow-hidden', cfg.className)}>
                <button
                  onClick={() => setExpanded(isExpanded ? null : issue.id)}
                  className="flex items-start gap-3 w-full px-4 py-3 text-left"
                >
                  <AlertCircle className="size-4 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <Badge className={cn('text-[10px] h-4 border', cfg.badge)}>{issue.severity}</Badge>
                      <span className="text-xs font-medium">{issue.issue_type.replace(/_/g, ' ')}</span>
                    </div>
                    <p className="text-xs opacity-80 truncate">{issue.seo_pages?.url ?? '—'}</p>
                  </div>
                  {isExpanded ? <ChevronUp className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0" />}
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 pt-0 space-y-2.5 border-t border-current/10">
                    <p className="text-xs">{issue.description}</p>
                    <div className="bg-white/60 rounded-lg p-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1">Recommendation</p>
                      <p className="text-xs">{issue.recommendation}</p>
                    </div>
                    {issue.seo_pages?.title && (
                      <p className="text-xs opacity-70">Page: {issue.seo_pages.title}</p>
                    )}
                    {!showResolved && (
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm" variant="outline"
                          className="h-6 text-xs bg-white/70"
                          onClick={() => updateStatus(issue.id, 'resolved')}
                          disabled={updating[issue.id]}
                        >
                          <CheckCircle2 className="size-3 mr-1" /> Resolve
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="h-6 text-xs opacity-70"
                          onClick={() => updateStatus(issue.id, 'ignored')}
                          disabled={updating[issue.id]}
                        >
                          <EyeOff className="size-3 mr-1" /> Ignore
                        </Button>
                      </div>
                    )}
                    {showResolved && (
                      <Button
                        size="sm" variant="outline"
                        className="h-6 text-xs bg-white/70"
                        onClick={() => updateStatus(issue.id, 'open')}
                        disabled={updating[issue.id]}
                      >
                        <RotateCcw className="size-3 mr-1" /> Reopen
                      </Button>
                    )}
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
