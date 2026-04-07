'use client'

import { useState, useEffect } from 'react'
import { Globe, Plus, RefreshCw, Trash2, CheckCircle2, XCircle, Loader2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface Props { workspaceId: string }

interface Site {
  id: string
  type: 'wordpress' | 'html'
  display_name: string
  site_url: string
  status: string
  last_crawled_at: string | null
  page_count: number
  issue_counts: { critical: number; warning: number; info: number }
}

type AddMode = null | 'wordpress' | 'html'

export function SeoSitesView({ workspaceId }: Props) {
  const [sites, setSites]     = useState<Site[]>([])
  const [loading, setLoading] = useState(true)
  const [addMode, setAddMode] = useState<AddMode>(null)
  const [crawling, setCrawling] = useState<Record<string, boolean>>({})
  const [deleting, setDeleting] = useState<Record<string, boolean>>({})

  // Form state
  const [siteUrl, setSiteUrl]       = useState('')
  const [displayName, setDisplayName] = useState('')
  const [wpUser, setWpUser]         = useState('')
  const [wpPass, setWpPass]         = useState('')
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle')
  const [testError, setTestError]   = useState('')
  const [saving, setSaving]         = useState(false)

  function load() {
    fetch(`/api/sites/list?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => { if (d.sites) setSites(d.sites) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [workspaceId])

  async function testConnection() {
    setTestStatus('testing')
    const res  = await fetch('/api/sites/wordpress/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ siteUrl, username: wpUser, password: wpPass }),
    })
    const data = await res.json() as { ok: boolean; error?: string }
    setTestStatus(data.ok ? 'ok' : 'fail')
    setTestError(data.error ?? '')
  }

  async function save() {
    setSaving(true)
    const body: Record<string, string> = {
      workspaceId, type: addMode!, displayName: displayName || siteUrl, siteUrl,
    }
    if (addMode === 'wordpress') { body.wpUsername = wpUser; body.wpPassword = wpPass }

    const res  = await fetch('/api/sites/connect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await res.json() as { site?: Site }
    if (data.site) {
      setSites(prev => [{ ...data.site!, page_count: 0, issue_counts: { critical: 0, warning: 0, info: 0 } }, ...prev])
      setAddMode(null); setSiteUrl(''); setDisplayName(''); setWpUser(''); setWpPass(''); setTestStatus('idle')
    }
    setSaving(false)
  }

  async function crawl(siteId: string) {
    setCrawling(p => ({ ...p, [siteId]: true }))
    await fetch(`/api/sites/${siteId}/crawl`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceId }),
    })
    load()
    setCrawling(p => ({ ...p, [siteId]: false }))
  }

  async function remove(siteId: string) {
    setDeleting(p => ({ ...p, [siteId]: true }))
    await fetch(`/api/sites/${siteId}/disconnect?workspaceId=${workspaceId}`, { method: 'DELETE' })
    setSites(p => p.filter(s => s.id !== siteId))
    setDeleting(p => ({ ...p, [siteId]: false }))
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">Site Connections</h2>
          <p className="text-xs text-muted-foreground">Connect WordPress or HTML sites to crawl and audit.</p>
        </div>
        {addMode === null && (
          <div className="relative group">
            <Button size="sm" onClick={() => setAddMode('wordpress')}>
              <Plus className="size-4 mr-1" /> Add Site
            </Button>
          </div>
        )}
      </div>

      {/* Add form */}
      {addMode !== null && (
        <div className="bg-white rounded-xl border border-border p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <button
              onClick={() => setAddMode('wordpress')}
              className={cn('text-xs px-3 py-1 rounded-full border', addMode === 'wordpress' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-border text-muted-foreground')}
            >WordPress</button>
            <button
              onClick={() => setAddMode('html')}
              className={cn('text-xs px-3 py-1 rounded-full border', addMode === 'html' ? 'bg-zinc-900 text-white border-zinc-900' : 'border-border text-muted-foreground')}
            >HTML / Static</button>
            <button onClick={() => setAddMode(null)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">Cancel</button>
          </div>

          <div className="grid gap-3">
            <div>
              <Label className="text-xs">Site URL *</Label>
              <Input placeholder="https://example.com" value={siteUrl} onChange={e => setSiteUrl(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            <div>
              <Label className="text-xs">Display Name</Label>
              <Input placeholder="My Website" value={displayName} onChange={e => setDisplayName(e.target.value)} className="mt-1 h-8 text-sm" />
            </div>
            {addMode === 'wordpress' && (
              <>
                <div>
                  <Label className="text-xs">WP Username *</Label>
                  <Input placeholder="admin" value={wpUser} onChange={e => setWpUser(e.target.value)} className="mt-1 h-8 text-sm" />
                </div>
                <div>
                  <Label className="text-xs">Application Password *</Label>
                  <Input type="password" placeholder="xxxx xxxx xxxx xxxx xxxx xxxx" value={wpPass} onChange={e => { setWpPass(e.target.value); setTestStatus('idle') }} className="mt-1 h-8 text-sm" />
                  <p className="text-[10px] text-muted-foreground mt-1">WordPress → Users → Profile → Application Passwords</p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={testConnection} disabled={!siteUrl || !wpUser || !wpPass || testStatus === 'testing'}>
                    {testStatus === 'testing' ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
                    Test Connection
                  </Button>
                  {testStatus === 'ok'   && <span className="flex items-center gap-1 text-xs text-green-600"><CheckCircle2 className="size-3" /> Connected</span>}
                  {testStatus === 'fail' && <span className="flex items-center gap-1 text-xs text-rose-600"><XCircle className="size-3" /> {testError || 'Failed'}</span>}
                </div>
              </>
            )}
          </div>

          <Button
            size="sm"
            onClick={save}
            disabled={!siteUrl || (addMode === 'wordpress' && (!wpUser || !wpPass)) || saving}
          >
            {saving ? <Loader2 className="size-3 animate-spin mr-1" /> : null}
            Save Site
          </Button>
        </div>
      )}

      {/* Site list */}
      {loading ? (
        <div className="space-y-3">{[1,2].map(i => <div key={i} className="h-20 bg-zinc-100 animate-pulse rounded-xl" />)}</div>
      ) : sites.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
          <Globe className="size-8 text-zinc-300" />
          <p className="text-sm text-muted-foreground">No sites connected. Add your first site above.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map(site => (
            <div key={site.id} className="bg-white rounded-xl border border-border p-4 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{site.display_name}</p>
                    <Badge variant="outline" className="text-[10px] shrink-0">{site.type}</Badge>
                    <span className={cn('text-[10px] shrink-0', site.status === 'active' ? 'text-green-600' : 'text-rose-600')}>{site.status}</span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">{site.site_url}</p>
                  {site.last_crawled_at && (
                    <p className="text-[10px] text-muted-foreground mt-1">Last crawled {fmt(site.last_crawled_at)} · {site.page_count} pages</p>
                  )}
                  <div className="flex gap-1.5 mt-2">
                    {site.issue_counts.critical > 0 && <Badge variant="destructive" className="text-[10px] h-4">{site.issue_counts.critical} critical</Badge>}
                    {site.issue_counts.warning  > 0 && <Badge className="text-[10px] h-4 bg-amber-100 text-amber-700 border-amber-200">{site.issue_counts.warning} warnings</Badge>}
                    {site.issue_counts.critical === 0 && site.issue_counts.warning === 0 && site.page_count > 0 && (
                      <Badge className="text-[10px] h-4 bg-green-100 text-green-700 border-green-200">All clear</Badge>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm" variant="outline"
                    onClick={() => crawl(site.id)}
                    disabled={crawling[site.id]}
                    className="h-7 text-xs"
                  >
                    {crawling[site.id] ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />}
                    <span className="ml-1">{site.page_count > 0 ? 'Re-crawl' : 'Crawl'}</span>
                  </Button>
                  <Button
                    size="sm" variant="ghost"
                    onClick={() => remove(site.id)}
                    disabled={deleting[site.id]}
                    className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                  >
                    {deleting[site.id] ? <Loader2 className="size-3 animate-spin" /> : <Trash2 className="size-3" />}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add site type picker when list is empty and no form open */}
      {sites.length === 0 && addMode === null && (
        <div className="flex gap-3 justify-center pt-2">
          <Button variant="outline" size="sm" onClick={() => setAddMode('wordpress')}>WordPress</Button>
          <Button variant="outline" size="sm" onClick={() => setAddMode('html')}>HTML / Static</Button>
        </div>
      )}
    </div>
  )
}
