'use client'

import { useState, useEffect } from 'react'
import {
  Home,
  BarChart3,
  Workflow,
  LayoutGrid,
  Bell,
  Plug,
  Settings2,
  RefreshCcw,
  Download,
  ChevronRight,
  Bot,
  LogOut,
  CircleUser,
  Globe,
  Search,
  TrendingUp,
  Eye,
  Rss,
  FileText,
  AlertCircle,
  Bird,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarSeparator,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { ClueZeroMark } from '@/components/brand/logo'
import { loadBrandColors } from '@/lib/brand-colors'
import { PageLoader } from '@/components/ui/page-loader'

import { HomeView }             from './views/home-view'
import { AlertsView }           from './views/alerts-view'
import { ConnectionsView }      from './views/connections-view'
import { SetupView }            from './views/setup-view'
import { AccountView }          from './views/account-view'
import { AgentsHubView }        from './views/agents-hub-view'
import { IntelligenceHubView }  from './views/intelligence-hub-view'
import { CanvasView }           from './canvas/canvas-view'
import { DashboardsView }       from './views/dashboards-view'
import { SeoOverviewView }      from './views/seo-overview-view'
import { SeoSitesView }         from './views/seo-sites-view'
import { SeoPagesView }         from './views/seo-pages-view'
import { SeoIssuesView }        from './views/seo-issues-view'
import { KeywordsView }         from './views/keywords-view'
import { ContentGapView }       from './views/content-gap-view'
import { GeoView }              from './views/geo-view'
import { AutoblogView }         from './views/autoblog-view'
import { TwitterBotView }       from './views/twitter-bot-view'

type ViewId =
  | 'home'
  | 'intelligence'
  | 'canvas'
  | 'dashboards'
  | 'agents'
  | 'alerts'
  | 'connections' | 'setup' | 'account'
  | 'seo-overview' | 'seo-sites' | 'seo-pages' | 'seo-issues'
  | 'seo-keywords' | 'content-gap' | 'geo' | 'autoblog'
  | 'twitter-bot'

const NAV_GROUPS = [
  {
    label: 'Home',
    items: [
      { id: 'home' as ViewId, label: 'Dashboard', icon: Home },
    ],
  },
  {
    label: 'Reporting',
    items: [
      { id: 'intelligence' as ViewId, label: 'Intelligence', icon: BarChart3 },
      { id: 'canvas'       as ViewId, label: 'Canvas',       icon: Workflow },
      { id: 'dashboards'   as ViewId, label: 'Spaces',       icon: LayoutGrid },
    ],
  },
  {
    label: 'Agents',
    items: [
      { id: 'agents' as ViewId, label: 'Agent Hub', icon: Bot },
    ],
  },
  {
    label: 'SEO',
    items: [
      { id: 'seo-overview' as ViewId, label: 'SEO Overview',  icon: Globe },
      { id: 'seo-sites'    as ViewId, label: 'Sites',         icon: Plug },
      { id: 'seo-pages'    as ViewId, label: 'Pages',         icon: FileText },
      { id: 'seo-issues'   as ViewId, label: 'Issues',        icon: AlertCircle },
      { id: 'seo-keywords' as ViewId, label: 'Keywords',      icon: Search },
      { id: 'content-gap'  as ViewId, label: 'Content Gap',   icon: TrendingUp },
      { id: 'geo'          as ViewId, label: 'AI Visibility',  icon: Eye },
      { id: 'autoblog'     as ViewId, label: 'Autopilot Blog', icon: Rss },
    ],
  },
  {
    label: 'Social',
    items: [
      { id: 'twitter-bot' as ViewId, label: 'X / Twitter Bot', icon: Bird },
    ],
  },
  {
    label: 'Monitor',
    items: [
      { id: 'alerts' as ViewId, label: 'Alerts', icon: Bell },
    ],
  },
  {
    label: 'Workspace',
    items: [
      { id: 'connections' as ViewId, label: 'Connections', icon: Plug },
      { id: 'setup'       as ViewId, label: 'Setup',        icon: Settings2 },
      { id: 'account'     as ViewId, label: 'Account',      icon: CircleUser },
    ],
  },
]

const ALL_ITEMS = NAV_GROUPS.flatMap(g => g.items)

function generateWeeks(n = 4): { value: string; label: string }[] {
  const result = []
  const now = new Date()
  const day = now.getUTCDay()
  const diff = now.getUTCDate() - day + (day === 0 ? -6 : 1)
  const monday = new Date(now)
  monday.setUTCDate(diff)
  for (let i = 0; i < n; i++) {
    const mon = new Date(monday)
    mon.setUTCDate(monday.getUTCDate() - i * 7)
    const sun = new Date(mon)
    sun.setUTCDate(mon.getUTCDate() + 6)
    const fmt = (d: Date) => `${String(d.getUTCDate()).padStart(2,'0')}.${String(d.getUTCMonth()+1).padStart(2,'0')}`
    result.push({ value: `w${i}`, label: `${fmt(mon)} – ${fmt(sun)}.${sun.getUTCFullYear()}` })
  }
  return result
}

const weeks = generateWeeks(4)

// Views that don't need the week selector
const WORKSPACE_VIEWS: ViewId[] = ['home', 'connections', 'setup', 'alerts', 'account', 'agents', 'intelligence', 'canvas', 'dashboards', 'seo-overview', 'seo-sites', 'seo-pages', 'seo-issues', 'seo-keywords', 'content-gap', 'geo', 'autoblog', 'twitter-bot']

interface Props {
  workspaceId: string
  workspaceName: string
  workspaceSlug: string
  ownBrand?: string
}

interface SnowflakeSource {
  id: string
  name: string
}

export function CompetitiveIntelDashboard({ workspaceId, workspaceName, workspaceSlug, ownBrand = '' }: Props) {
  const [view,          setView]          = useState<ViewId>('home')
  const [pendingView,   setPendingView]   = useState<ViewId | null>(null)
  const [transitioning, setTransitioning] = useState(false)
  const [week, setWeek] = useState('w0')
  const [sources, setSources] = useState<SnowflakeSource[]>([])
  const [connectionId, setConnectionId] = useState<string>('all')
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    if (!workspaceId) return
    // Warm the brand-colors cache so all charts use live colors immediately
    loadBrandColors(workspaceId)
  }, [workspaceId])

  useEffect(() => {
    if (!workspaceId) return
    fetch(`/api/snowflake/status?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d.connections) && d.connections.length > 0) {
          setSources(d.connections.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })))
        }
      })
      .catch(() => {})
  }, [workspaceId])

  function navigateTo(next: ViewId) {
    if (next === view && !transitioning) return
    setPendingView(next)
    setTransitioning(true)
    // Show icon for 480 ms, then swap view and fade out
    setTimeout(() => {
      setView(next)
      setPendingView(null)
      setTimeout(() => setTransitioning(false), 220)
    }, 480)
  }

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const activeItem = ALL_ITEMS.find(n => n.id === view)!
  const showWeekSelector = !WORKSPACE_VIEWS.includes(view)

  return (
    <SidebarProvider>
      <Sidebar className="dark" collapsible="icon">
        <SidebarHeader className="p-0">
          <div className="flex items-center gap-3 px-4 py-4">
            <ClueZeroMark size={30} color="white" className="shrink-0" />
            <div className="flex flex-col min-w-0 group-data-[collapsible=icon]:hidden">
              <span className="text-sm font-semibold text-sidebar-foreground truncate">{workspaceName}</span>
              <span className="text-[11px] text-sidebar-foreground/50">ClueZero</span>
            </div>
          </div>
        </SidebarHeader>

        <SidebarSeparator />

        <SidebarContent>
          {NAV_GROUPS.map((group, gi) => (
            <SidebarGroup key={group.label}>
              {gi > 1 && <SidebarSeparator className="mb-1" />}
              <SidebarGroupLabel className={cn(
                'text-sidebar-foreground/40 text-[10px] uppercase tracking-widest',
                gi === 0 && 'sr-only'
              )}>
                {group.label}
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {group.items.map(item => (
                    <SidebarMenuItem key={item.id}>
                      <SidebarMenuButton
                        isActive={view === item.id || pendingView === item.id}
                        onClick={() => navigateTo(item.id)}
                        tooltip={item.label}
                        className="data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-foreground"
                      >
                        <item.icon className="size-4" />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
        </SidebarContent>

        <SidebarFooter className="p-3 group-data-[collapsible=icon]:p-2">
          <div className="flex items-center gap-2.5 group-data-[collapsible=icon]:justify-center">
            <button onClick={() => navigateTo('account')} className="shrink-0" title="Account settings">
              <Avatar className="size-7">
                <AvatarFallback className="bg-zinc-600 text-white text-[10px] font-semibold">
                  {workspaceName.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            </button>
            <div className="flex flex-col min-w-0 flex-1 group-data-[collapsible=icon]:hidden">
              <button
                onClick={() => navigateTo('account')}
                className="text-xs font-medium text-sidebar-foreground truncate text-left hover:underline"
              >
                {workspaceName}
              </button>
              <span className="text-[10px] text-sidebar-foreground/50">Admin</span>
            </div>
            <button
              onClick={handleSignOut}
              className="group-data-[collapsible=icon]:hidden shrink-0 p-1 rounded text-sidebar-foreground/40 hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors"
              title="Sign out"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="bg-zinc-50 dark:bg-background">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b border-border bg-white/80 backdrop-blur-sm px-4 shrink-0">
          <SidebarTrigger className="size-8" />
          <Separator orientation="vertical" className="h-4" />
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{NAV_GROUPS.find(g => g.items.some(i => i.id === view))?.label}</span>
            <ChevronRight className="size-3.5" />
            <span className="font-medium text-foreground">{activeItem.label}</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {showWeekSelector && sources.length > 1 && (
              <Select value={connectionId} onValueChange={setConnectionId}>
                <SelectTrigger className="h-8 w-[160px] text-xs border-border bg-white">
                  <SelectValue placeholder="All sources" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all" className="text-xs">All sources</SelectItem>
                  {sources.map(s => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {showWeekSelector && (
              <Select value={week} onValueChange={setWeek}>
                <SelectTrigger className="h-8 w-[180px] text-xs border-border bg-white">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {weeks.map(w => (
                    <SelectItem key={w.value} value={w.value} className="text-xs">
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs border-border bg-white">
              <RefreshCcw className="size-3.5" />
              Refresh
            </Button>
            <Button size="sm" className="h-8 gap-1.5 text-xs">
              <Download className="size-3.5" />
              Export
            </Button>
          </div>
        </header>

        <main className="p-6 relative">
          <PageLoader visible={transitioning} />
          {view === 'home'         && <HomeView workspaceName={workspaceName} workspaceId={workspaceId} ownBrand={ownBrand} onNavigate={() => navigateTo('intelligence')} connectionId={connectionId === 'all' ? undefined : connectionId} />}
          {view === 'intelligence' && <IntelligenceHubView workspaceId={workspaceId} ownBrand={ownBrand} connectionId={connectionId === 'all' ? undefined : connectionId} />}
          {view === 'canvas'       && <CanvasView workspaceId={workspaceId} connectionId={connectionId === 'all' ? undefined : connectionId} />}
          {view === 'dashboards'   && <DashboardsView workspaceId={workspaceId} connectionId={connectionId === 'all' ? undefined : connectionId} onNavigate={(v) => navigateTo(v as ViewId)} />}
          {view === 'agents'       && <AgentsHubView workspaceId={workspaceId} ownBrand={ownBrand} connectionId={connectionId === 'all' ? undefined : connectionId} />}
          {view === 'alerts'       && <AlertsView workspaceId={workspaceId} />}
          {view === 'connections'  && <ConnectionsView workspaceId={workspaceId} />}
          {view === 'setup'        && <SetupView workspaceId={workspaceId} workspaceName={workspaceName} workspaceSlug={workspaceSlug} ownBrand={ownBrand} />}
          {view === 'account'      && <AccountView workspaceId={workspaceId} />}
          {view === 'seo-overview' && <SeoOverviewView workspaceId={workspaceId} onNavigate={(v) => navigateTo(v as ViewId)} />}
          {view === 'seo-sites'    && <SeoSitesView workspaceId={workspaceId} />}
          {view === 'seo-pages'    && <SeoPagesView workspaceId={workspaceId} />}
          {view === 'seo-issues'   && <SeoIssuesView workspaceId={workspaceId} />}
          {view === 'seo-keywords' && <KeywordsView workspaceId={workspaceId} />}
          {view === 'content-gap'  && <ContentGapView workspaceId={workspaceId} />}
          {view === 'geo'          && <GeoView workspaceId={workspaceId} />}
          {view === 'autoblog'     && <AutoblogView workspaceId={workspaceId} />}
          {view === 'twitter-bot'  && <TwitterBotView workspaceId={workspaceId} />}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}
