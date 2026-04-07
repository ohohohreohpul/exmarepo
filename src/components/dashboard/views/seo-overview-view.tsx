'use client'

import { useEffect, useState } from 'react'
import { Globe, AlertCircle, FileText, CheckCircle2, TrendingUp, Search, Zap, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

interface Props {
  workspaceId: string
  onNavigate: (view: string) => void
}

interface SiteCard {
  id: string
  display_name: string
  site_url: string
  status: string
  last_crawled_at: string | null
  page_count: number
  issue_counts: { critical: number; warning: number; info: number }
}

export function SeoOverviewView({ workspaceId, onNavigate }: Props) {
  const [sites, setSites]     = useState<SiteCard[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/sites/list?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.sites) setSites(d.sites) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [workspaceId])

  const totalPages    = sites.reduce((s, c) => s + c.page_count, 0)
  const totalCritical = sites.reduce((s, c) => s + c.issue_counts.critical, 0)
  const totalIssues   = sites.reduce((s, c) => s + c.issue_counts.critical + c.issue_counts.warning + c.issue_counts.info, 0)

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        {[1,2,3].map(i => <div key={i} className="h-24 bg-zinc-100 animate-pulse rounded-xl" />)}
      </div>
    )
  }

  if (sites.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center min-h-[60vh] text-center gap-4">
        <div className="size-16 rounded-2xl bg-zinc-100 flex items-center justify-center">
          <Globe className="size-8 text-zinc-400" />
        </div>
        <div>
          <p className="text-lg font-semibold">No sites connected yet</p>
          <p className="text-sm text-muted-foreground mt-1">Connect your WordPress or HTML site to start tracking SEO.</p>
        </div>
        <Button onClick={() => onNavigate('seo-sites')}>Connect your first site</Button>
      </div>
    )
  }

  const MODULES = [
    { id: 'seo-keywords',   icon: Search,   label: 'Keyword Tracker',    desc: 'Track rankings & research keywords' },
    { id: 'content-gap',    icon: TrendingUp, label: 'Content Gap',      desc: 'Find topics competitors own' },
    { id: 'geo',            icon: Eye,       label: 'AI Visibility',      desc: 'Track citations in AI search' },
    { id: 'autoblog',       icon: Zap,       label: 'Autopilot Blogging', desc: 'AI-written posts from RSS' },
  ]

  return (
    <div className="p-6 space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Connected Sites', value: sites.length, icon: Globe, color: 'text-blue-600' },
          { label: 'Pages Indexed',   value: totalPages,   icon: FileText, color: 'text-green-600' },
          { label: 'Critical Issues', value: totalCritical, icon: AlertCircle, color: 'text-rose-600' },
          { label: 'Total Issues',    value: totalIssues,  icon: CheckCircle2, color: 'text-amber-600' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-border p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-2">
              <k.icon className={cn('size-4', k.color)} />
              <span className="text-xs text-muted-foreground">{k.label}</span>
            </div>
            <p className="text-2xl font-bold">{k.value.toLocaleString()}</p>
          </div>
        ))}
      </div>

      {/* Site breakdown */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold">Sites</p>
          <Button size="sm" variant="outline" onClick={() => onNavigate('seo-sites')}>Manage</Button>
        </div>
        <div className="space-y-3">
          {sites.map(site => (
            <div key={site.id} className="bg-white rounded-xl border border-border p-4 shadow-sm flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{site.display_name}</p>
                <p className="text-xs text-muted-foreground truncate">{site.site_url}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs text-muted-foreground">{site.page_count} pages</span>
                {site.issue_counts.critical > 0 && (
                  <Badge variant="destructive" className="text-[10px] h-5">{site.issue_counts.critical} critical</Badge>
                )}
                {site.issue_counts.warning > 0 && (
                  <Badge className="text-[10px] h-5 bg-amber-100 text-amber-700 border-amber-200">{site.issue_counts.warning} warnings</Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* SEO Modules */}
      <div>
        <p className="text-sm font-semibold mb-3">SEO Modules</p>
        <div className="grid grid-cols-2 gap-3">
          {MODULES.map(m => (
            <button
              key={m.id}
              onClick={() => onNavigate(m.id)}
              className="bg-white rounded-xl border border-border p-4 shadow-sm text-left hover:bg-zinc-50 transition-colors"
            >
              <m.icon className="size-5 text-zinc-500 mb-2" />
              <p className="text-sm font-medium">{m.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{m.desc}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
