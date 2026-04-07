'use client'

import '@xyflow/react/dist/style.css'

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
} from 'react'
import {
  ReactFlow, Background, Controls, MiniMap,
  addEdge, useNodesState, useEdgesState,
  Handle, Position, useReactFlow,
  useHandleConnections, useNodesData,
  BackgroundVariant, Panel,
  BaseEdge, EdgeLabelRenderer, getBezierPath,
  type Node, type Edge, type NodeProps, type EdgeProps, type Connection,
  type OnConnectEnd, type FinalConnectionState,
} from '@xyflow/react'
import {
  BarChart3, LineChart, PieChart, ScatterChart, Layers,
  Database, Plus, Loader2, ChevronDown,
  LayoutGrid, Check, X, Workflow, Sparkles,
  Trash2, Save, FolderOpen, AlertTriangle, Clock,
} from 'lucide-react'
import { METRICS, DIMENSIONS, CHART_TYPES } from '@/lib/metrics'
import { ChartRenderer, type DataPoint } from '@/components/dashboard/_components/chart-renderer'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

interface SnowflakeConn { id: string; name: string }

interface SourceData extends Record<string, unknown> {
  metricA:        string
  metricB:        string
  dimension:      string
  weekRange:      number
  dbConnectionId: string
  outputData:     DataPoint[]
  loading:        boolean
}

interface ChartData extends Record<string, unknown> {
  chartType: string
  title:     string
}

// ─── Canvas context ───────────────────────────────────────────────────────────

interface CanvasCtxType {
  workspaceId:      string
  dbConnections:    SnowflakeConn[]
  dashboards:       { id: string; name: string }[]
  onAddToDashboard: (
    cfg: { title: string; metricA: string; metricB?: string; dimension: string; chartType: string; weekRange: number },
    dashboardId: string
  ) => Promise<void>
}

const CanvasCtx = createContext<CanvasCtxType>({
  workspaceId: '', dbConnections: [], dashboards: [],
  onAddToDashboard: async () => {},
})

// ─── Shared node field ────────────────────────────────────────────────────────

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-400 block mb-1.5">
      {children}
    </label>
  )
}

function NodeSelect({ value, onChange, options }: {
  value: string; onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full h-8 text-[11.5px] rounded-xl border border-zinc-200 pl-3 pr-7 bg-white text-zinc-700 font-medium focus:outline-none focus:ring-2 focus:ring-zinc-900/10 focus:border-zinc-400 cursor-pointer appearance-none transition-colors hover:border-zinc-300"
      >
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 size-3 text-zinc-400" />
    </div>
  )
}

// ─── Node shell ───────────────────────────────────────────────────────────────

function NodeShell({ darkIcon, icon: Icon, label, children, onDelete, selected }: {
  darkIcon?: boolean; icon: React.ElementType; label: string
  children: React.ReactNode; onDelete?: () => void; selected?: boolean
}) {
  return (
    <div
      style={{
        minWidth: 280,
        border:      selected ? '1.5px solid #18181b' : '1.5px solid #e4e4e7',
        boxShadow:   selected
          ? '0 0 0 3px rgba(24,24,27,0.07), 0 8px 28px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.06)'
          : '0 2px 10px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
      }}
      className="bg-white rounded-2xl overflow-hidden"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-zinc-100">
        {/* Icon badge */}
        <div className={cn(
          'size-7 rounded-xl flex items-center justify-center shrink-0',
          darkIcon ? 'bg-zinc-900' : 'bg-zinc-100',
        )}>
          <Icon className={cn('size-3.5', darkIcon ? 'text-white' : 'text-zinc-600')} />
        </div>

        {/* Label */}
        <span className="text-[12.5px] font-semibold text-zinc-800 flex-1 leading-none tracking-tight">
          {label}
        </span>

        {/* Delete */}
        {onDelete && (
          <button
            onClick={onDelete}
            className="size-6 flex items-center justify-center rounded-lg text-zinc-300 hover:text-zinc-600 hover:bg-zinc-100 transition-colors ml-1"
          >
            <X className="size-3.5" />
          </button>
        )}
      </div>

      {/* ── Content ── */}
      <div className="p-4 space-y-3">{children}</div>
    </div>
  )
}

// ─── Source Node ──────────────────────────────────────────────────────────────

function SourceNodeFn({ id, data, selected }: NodeProps) {
  const d = data as SourceData
  const { updateNodeData, deleteElements } = useReactFlow()
  const { workspaceId, dbConnections } = useContext(CanvasCtx)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function upd(patch: Partial<SourceData>) { updateNodeData(id, patch) }

  useEffect(() => {
    if (!workspaceId) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      upd({ loading: true })
      try {
        const res = await fetch('/api/data/explore', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            workspaceId,
            connectionId: d.dbConnectionId !== 'all' ? d.dbConnectionId : undefined,
            metricA: d.metricA, metricB: d.metricB !== 'none' ? d.metricB : undefined,
            dimension: d.dimension, weekRange: d.weekRange,
          }),
        })
        const json = await res.json()
        upd({ outputData: json.data ?? [], loading: false })
      } catch { upd({ loading: false }) }
    }, 450)
    return () => { if (timer.current) clearTimeout(timer.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.metricA, d.metricB, d.dimension, d.weekRange, d.dbConnectionId, workspaceId])

  const metricOpts = Object.entries(METRICS).map(([k, v]) => ({ value: k, label: v.label }))
  const dimOpts    = Object.entries(DIMENSIONS).map(([k, v]) => ({ value: k, label: v.label }))
  const weekOpts   = [
    { value: '2', label: '2 weeks' }, { value: '4', label: '4 weeks' },
    { value: '8', label: '8 weeks' }, { value: '12', label: '12 weeks' },
  ]
  const dbOpts = [
    { value: 'all', label: dbConnections.length ? 'All connections' : 'No connections configured' },
    ...dbConnections.map(c => ({ value: c.id, label: c.name })),
  ]

  return (
    <NodeShell darkIcon icon={Database} label="Data Source"
      onDelete={() => deleteElements({ nodes: [{ id }] })} selected={selected}>

      <div>
        <FieldLabel>Database</FieldLabel>
        <NodeSelect value={d.dbConnectionId} onChange={v => upd({ dbConnectionId: v })} options={dbOpts} />
      </div>

      <div className="h-px bg-zinc-100 -mx-4 my-0.5" />

      <div>
        <FieldLabel>Metric</FieldLabel>
        <NodeSelect value={d.metricA} onChange={v => upd({ metricA: v })} options={metricOpts} />
      </div>
      <div>
        <FieldLabel>Compare with</FieldLabel>
        <NodeSelect value={d.metricB} onChange={v => upd({ metricB: v })}
          options={[{ value: 'none', label: '— none —' }, ...metricOpts.filter(o => o.value !== d.metricA)]} />
      </div>
      <div className="flex gap-2">
        <div className="flex-1">
          <FieldLabel>Group by</FieldLabel>
          <NodeSelect value={d.dimension} onChange={v => upd({ dimension: v })} options={dimOpts} />
        </div>
        <div className="w-[88px]">
          <FieldLabel>Period</FieldLabel>
          <NodeSelect value={String(d.weekRange)} onChange={v => upd({ weekRange: Number(v) })} options={weekOpts} />
        </div>
      </div>

      {/* Status row */}
      <div className="flex items-center gap-2 pt-0.5">
        {d.loading ? (
          <div className="flex items-center gap-1.5 text-[10.5px] text-zinc-400">
            <Loader2 className="size-3 animate-spin" />
            <span>Fetching data…</span>
          </div>
        ) : d.outputData.length > 0 ? (
          <div className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200/80 rounded-full px-2.5 py-1">
            <div className="size-1.5 rounded-full bg-emerald-500" />
            {d.outputData.length} rows ready
          </div>
        ) : (
          <span className="text-[10.5px] text-zinc-400">No data — try adjusting config</span>
        )}
      </div>

      <Handle type="source" position={Position.Right} id="out"
        style={{
          width: 12, height: 12,
          background: '#18181b',
          border: '2.5px solid white',
          borderRadius: '50%', right: -6,
          boxShadow: '0 1px 6px rgba(0,0,0,0.25)',
        }}
      />
    </NodeShell>
  )
}

// ─── Multi-source merge ───────────────────────────────────────────────────────
// When multiple Data Source nodes feed one Chart node, sum values for the
// same group key (e.g. "ORLEN" from DB-A + "ORLEN" from DB-B → combined).

function mergeSourceData(datasets: DataPoint[][]): DataPoint[] {
  if (datasets.length === 0) return []
  if (datasets.length === 1) return datasets[0]
  const map = new Map<string, { metricA: number; metricB: number; hasB: boolean }>()
  for (const dataset of datasets) {
    for (const pt of dataset) {
      const e = map.get(pt.name)
      if (e) {
        e.metricA += pt.metricA
        if (pt.metricB !== undefined) { e.metricB += pt.metricB; e.hasB = true }
      } else {
        map.set(pt.name, { metricA: pt.metricA, metricB: pt.metricB ?? 0, hasB: pt.metricB !== undefined })
      }
    }
  }
  return Array.from(map.entries())
    .map(([name, v]) => ({ name, metricA: v.metricA, ...(v.hasB ? { metricB: v.metricB } : {}) }))
    .sort((a, b) => b.metricA - a.metricA)
}

// ─── Chart Node ───────────────────────────────────────────────────────────────

const CHART_ICONS: Record<string, React.ElementType> = {
  bar: BarChart3, line: LineChart, area: Layers, scatter: ScatterChart, pie: PieChart,
}

function ChartNodeFn({ id, data, selected }: NodeProps) {
  const d = data as ChartData
  const { updateNodeData, deleteElements } = useReactFlow()
  const { dashboards, onAddToDashboard } = useContext(CanvasCtx)
  const [showPicker, setShowPicker] = useState(false)
  const [savingTo,   setSavingTo]   = useState<string | null>(null)
  const [savedTo,    setSavedTo]    = useState<string | null>(null)
  // chartReady: true only once ALL sources have finished loading — so the chart
  // animation plays from a clean starting state, never mid-load.
  const [chartReady, setChartReady] = useState(false)

  function upd(patch: Partial<ChartData>) { updateNodeData(id, patch) }

  // ── Reactive data — reads ALL connected sources and merges them ─────────────
  // useHandleConnections + useNodesData (ReactFlow v12): re-renders whenever
  // any upstream node's data changes, including outputData updates.
  const connections  = useHandleConnections({ type: 'target', id: 'in' })
  const sourceIds    = connections.map(c => c.source)
  const sourceNodes  = useNodesData(sourceIds)                               // Node[]
  const sources      = sourceNodes
    .map(n => n?.data as SourceData | undefined)
    .filter((s): s is SourceData => !!s && Array.isArray(s.outputData))

  // Primary source drives the metric/dimension labels shown on axes
  const primarySrc   = sources[0]
  const metricA      = primarySrc?.metricA ?? 'spend'
  const metricB      = primarySrc?.metricB !== 'none' ? primarySrc?.metricB : undefined
  const weekRange    = primarySrc?.weekRange ?? 4
  const dimension    = primarySrc?.dimension ?? 'brand'

  // Merged dataset (sum same-named groups across all sources)
  const chartData    = mergeSourceData(sources.map(s => s.outputData))

  const isConnected  = connections.length > 0
  const anyLoading   = isConnected && sources.some(s => s.loading)
  const hasData      = chartData.length > 0
  const _sourceCount = sources.length   // kept for future multi-source badge

  // Gate chartReady: flip false when a source starts loading, true after done.
  // The 80ms delay lets React flush so ChartRenderer mounts fresh each time.
  useEffect(() => {
    if (anyLoading) { setChartReady(false); return }
    if (!hasData)   { setChartReady(false); return }
    const t = setTimeout(() => setChartReady(true), 80)
    return () => clearTimeout(t)
  }, [anyLoading, hasData])

  async function saveToDb(dashId: string) {
    setSavingTo(dashId)
    await onAddToDashboard({ title: d.title || 'Chart', metricA, metricB, dimension, chartType: d.chartType, weekRange }, dashId)
    setSavingTo(null); setSavedTo(dashId)
    setTimeout(() => { setSavedTo(null); setShowPicker(false) }, 1500)
  }

  const activeMetricB = metricB && metricB !== 'none' ? metricB : undefined
  const available     = CHART_TYPES.filter(ct => !ct.requiresB || activeMetricB)

  return (
    <div style={{ minWidth: 320 }}>
      <Handle type="target" position={Position.Left} id="in"
        style={{
          width: 12, height: 12,
          background: '#71717a',
          border: '2.5px solid white',
          borderRadius: '50%', left: -6,
          boxShadow: '0 1px 6px rgba(0,0,0,0.20)',
        }}
      />

      <NodeShell icon={BarChart3} label="Chart"
        onDelete={() => deleteElements({ nodes: [{ id }] })} selected={selected}>

        <div>
          <FieldLabel>Title</FieldLabel>
          <input value={d.title} onChange={e => upd({ title: e.target.value })}
            placeholder="Untitled chart…"
            className="w-full h-7 text-[11px] rounded-lg border border-zinc-200 px-2.5 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-zinc-400/60 placeholder:text-zinc-300" />
        </div>

        <div>
          <FieldLabel>Chart type</FieldLabel>
          <div className="flex gap-1.5">
            {available.map(ct => {
              const Icon = CHART_ICONS[ct.id]
              return (
                <button key={ct.id} onClick={() => upd({ chartType: ct.id })} title={ct.label}
                  className={cn('size-8 flex items-center justify-center rounded-xl border transition-all',
                    d.chartType === ct.id
                      ? 'bg-zinc-900 border-zinc-900 text-white shadow-sm shadow-zinc-900/20'
                      : 'bg-white border-zinc-200 text-zinc-400 hover:border-zinc-300 hover:text-zinc-600')}>
                  <Icon className="size-3.5" />
                </button>
              )
            })}
          </div>
        </div>

        {/* Chart preview */}
        <div className={cn('rounded-xl border overflow-hidden',
          isConnected && chartReady ? 'border-zinc-200 bg-white' : 'border-zinc-100 bg-zinc-50/80')}
          style={{ height: 210 }}>
          {!isConnected ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 px-4">
              <div className="size-9 rounded-2xl border-2 border-dashed border-zinc-200 flex items-center justify-center">
                <Workflow className="size-4 text-zinc-300" />
              </div>
              <div className="text-center">
                <p className="text-[11px] font-semibold text-zinc-400">No source connected</p>
                <p className="text-[10px] text-zinc-300 mt-0.5">Drag from the • handle on a Data Source</p>
              </div>
            </div>
          ) : anyLoading || !chartReady ? (
            /* Skeleton — waits until ALL sources finish so chart animates cleanly */
            <div className="h-full flex flex-col justify-end px-4 pb-5 pt-4 gap-1.5">
              <div className="flex items-end gap-1.5 h-full">
                {[55, 80, 40, 95, 65, 30, 75, 50].map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md bg-zinc-200 animate-pulse"
                    style={{ height: `${h}%`, animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
              <div className="flex gap-1.5">
                {[55, 80, 40, 95, 65, 30, 75, 50].map((_, i) => (
                  <div key={i} className="flex-1 h-1.5 rounded bg-zinc-100 animate-pulse"
                    style={{ animationDelay: `${i * 60}ms` }} />
                ))}
              </div>
            </div>
          ) : !hasData ? (
            <div className="h-full flex items-center justify-center">
              <p className="text-[11px] text-zinc-400">No data for this config</p>
            </div>
          ) : (
            <ChartRenderer data={chartData} chartType={d.chartType}
              metricA={metricA} metricB={activeMetricB} height={210} />
          )}
        </div>

        {/* Add to Space */}
        <div className="relative">
          <button onClick={() => setShowPicker(v => !v)}
            disabled={!isConnected || !hasData}
            className={cn('w-full flex items-center gap-2.5 px-4 py-3 text-xs font-semibold rounded-xl transition-all',
              isConnected && hasData
                ? 'bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm shadow-zinc-900/20'
                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed')}>
            <LayoutGrid className="size-3.5 shrink-0" />
            <span className="flex-1 text-left">Add to Space</span>
            <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', showPicker && 'rotate-180')} />
          </button>

          {showPicker && (
            <div className="absolute bottom-full mb-2 left-0 right-0 bg-white border border-zinc-200 rounded-xl shadow-xl overflow-hidden z-50">
              <div className="px-3.5 py-2.5 border-b border-zinc-100">
                <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">Choose a Space</p>
              </div>
              {dashboards.length === 0
                ? <p className="text-[11px] text-zinc-400 px-3.5 py-3">No Spaces yet — create one in Spaces.</p>
                : dashboards.map(db => (
                    <button key={db.id} onClick={() => saveToDb(db.id)}
                      className="w-full flex items-center justify-between px-3.5 py-2.5 text-[11px] text-left hover:bg-zinc-50 transition-colors border-b border-zinc-50 last:border-0 text-zinc-700">
                      <span className="font-medium">{db.name}</span>
                      {savingTo === db.id ? <Loader2 className="size-3 animate-spin text-zinc-500" />
                        : savedTo === db.id ? <Check className="size-3 text-emerald-500" />
                        : null}
                    </button>
                  ))
              }
            </div>
          )}
        </div>
      </NodeShell>
    </div>
  )
}

// ─── Deletable edge ───────────────────────────────────────────────────────────

function DeletableEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, style, markerEnd, selected }: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [hovered, setHovered] = useState(false)
  const [edgePath, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const show = selected || hovered

  return (
    <>
      {/* Wide transparent hit area for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        style={{ cursor: 'pointer' }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        {show && (
          <div
            style={{
              position:  'absolute',
              transform: `translate(-50%,-50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
            }}
            className="nodrag nopan"
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            <button
              onClick={() => deleteElements({ edges: [{ id }] })}
              className="size-5 rounded-full bg-white border border-zinc-200 shadow-md flex items-center justify-center text-zinc-400 hover:text-rose-500 hover:border-rose-300 hover:bg-rose-50 transition-colors"
              title="Remove connection"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  )
}

// ─── Node types (outside component for stable reference) ─────────────────────

const nodeTypes = { source: SourceNodeFn, chart: ChartNodeFn }
const edgeTypes = { deletable: DeletableEdge }

// ─── Factories ────────────────────────────────────────────────────────────────

let uid = 1
function nextId(prefix: string) { return `${prefix}-${Date.now()}-${uid++}` }

function makeSource(id: string, pos: { x: number; y: number }, dbConnectionId = 'all'): Node {
  return {
    id, type: 'source', position: pos,
    data: { metricA: 'spend', metricB: 'none', dimension: 'brand', weekRange: 4, dbConnectionId, outputData: [], loading: false } as SourceData,
  }
}
function makeChart(id: string, pos: { x: number; y: number }): Node {
  return { id, type: 'chart', position: pos, data: { chartType: 'bar', title: '' } as ChartData }
}

// ─── Connection suggestion popup ─────────────────────────────────────────────

interface SuggestMenu { x: number; y: number; fromNodeId: string; fromHandle: string }

function ConnectionMenu({ menu, onCreate, onClose }: {
  menu: SuggestMenu; onCreate: (t: 'chart' | 'source') => void; onClose: () => void
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div style={{ left: menu.x, top: menu.y, transform: 'translate(-50%, 10px)' }}
        className="fixed z-50 bg-white border border-zinc-200 rounded-2xl shadow-2xl overflow-hidden w-52">
        <div className="px-4 pt-3.5 pb-2.5 border-b border-zinc-100">
          <p className="text-[9px] font-bold uppercase tracking-widest text-zinc-400">Connect to…</p>
        </div>
        <div className="p-2 space-y-1">
          {menu.fromHandle === 'out' && (
            <button onClick={() => onCreate('chart')}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors text-left">
              <div className="size-8 rounded-xl bg-zinc-100 flex items-center justify-center shrink-0">
                <BarChart3 className="size-3.5 text-zinc-600" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-zinc-700">Chart node</p>
                <p className="text-[10px] text-zinc-400">Visualise this data</p>
              </div>
            </button>
          )}
          {menu.fromHandle === 'in' && (
            <button onClick={() => onCreate('source')}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-zinc-50 transition-colors text-left">
              <div className="size-8 rounded-xl bg-zinc-900 flex items-center justify-center shrink-0">
                <Database className="size-3.5 text-white" />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-zinc-700">Data Source node</p>
                <p className="text-[10px] text-zinc-400">Define a data query</p>
              </div>
            </button>
          )}
        </div>
      </div>
    </>
  )
}

// ─── Main CanvasView ──────────────────────────────────────────────────────────

interface Props { workspaceId?: string; connectionId?: string }
interface CanvasSave { id: string; name: string; created_at: string }

const STORAGE_KEY    = (wid: string) => `canvas-v2-${wid}`
const LAST_SAVED_KEY = (wid: string) => `canvas-last-saved-${wid}`

export function CanvasView({ workspaceId }: Props) {
  const [nodes,       setNodes,       onNodesChange] = useNodesState<Node>([])
  const [edges,       setEdges,       onEdgesChange] = useEdgesState<Edge>([])
  const [dbConns,     setDbConns]     = useState<SnowflakeConn[]>([])
  const [dashboards,  setDashboards]  = useState<{ id: string; name: string }[]>([])
  const [suggestMenu, setSuggestMenu] = useState<SuggestMenu | null>(null)
  const [autoSaved,   setAutoSaved]   = useState(false)

  // ── Save / Load / Clear state ─────────────────────────────────────────────
  const [saves,         setSaves]         = useState<CanvasSave[]>([])
  const [savesLoaded,   setSavesLoaded]   = useState(false)
  const [showSaveInput, setShowSaveInput] = useState(false)
  const [showLoadPanel, setShowLoadPanel] = useState(false)
  const [saveName,      setSaveName]      = useState('')
  const [saving,        setSaving]        = useState(false)
  const [loadingId,     setLoadingId]     = useState<string | null>(null)
  const [deletingId,    setDeletingId]    = useState<string | null>(null)
  // Clear dialog: null = closed | 'prompt' = ask save first | 'confirm' = final confirm
  const [clearDialog,   setClearDialog]   = useState<null | 'prompt' | 'confirm'>(null)
  const [lastSavedName, setLastSavedName] = useState<string | null>(null)

  const saveNameRef    = useRef<HTMLInputElement>(null)
  const loadPanelRef   = useRef<HTMLDivElement>(null)
  const saveTimer      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rfRef          = useRef<{ screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number } } | null>(null)

  // ── Bootstrap ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!workspaceId) return
    fetch(`/api/snowflake/status?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => setDbConns((d.connections ?? []).map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }))))
      .catch(() => {})
    fetch(`/api/dashboards?workspaceId=${workspaceId}`)
      .then(r => r.json())
      .then(d => setDashboards(d.dashboards ?? []))
      .catch(() => {})
    // Load last saved name
    setLastSavedName(localStorage.getItem(LAST_SAVED_KEY(workspaceId)))
    // Load auto-saved draft
    try {
      const raw = localStorage.getItem(STORAGE_KEY(workspaceId))
      if (raw) { const { nodes: n, edges: e } = JSON.parse(raw); setNodes(n ?? []); setEdges(e ?? []) }
    } catch { /* ignore */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // ── Auto-save draft to localStorage ───────────────────────────────────────
  useEffect(() => {
    if (!workspaceId || nodes.length === 0) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      const stripped = nodes.map(n =>
        n.type === 'source' ? { ...n, data: { ...n.data, outputData: [], loading: false } } : n
      )
      localStorage.setItem(STORAGE_KEY(workspaceId), JSON.stringify({ nodes: stripped, edges }))
      setAutoSaved(true); setTimeout(() => setAutoSaved(false), 1500)
    }, 1000)
  }, [nodes, edges, workspaceId])

  // ── Close load panel on outside click ────────────────────────────────────
  useEffect(() => {
    if (!showLoadPanel) return
    const handler = (e: MouseEvent) => {
      if (loadPanelRef.current && e.target instanceof Element && !loadPanelRef.current.contains(e.target)) setShowLoadPanel(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showLoadPanel])

  useEffect(() => { if (showSaveInput) saveNameRef.current?.focus() }, [showSaveInput])

  // ── Load saves list ───────────────────────────────────────────────────────
  async function fetchSaves() {
    if (!workspaceId) return
    const res  = await fetch(`/api/canvas-saves?workspaceId=${workspaceId}`)
    const data = await res.json()
    setSaves(data.saves ?? [])
    setSavesLoaded(true)
  }

  function openLoadPanel() {
    setShowLoadPanel(v => !v)
    if (!savesLoaded) fetchSaves()
  }

  // ── Save named snapshot ───────────────────────────────────────────────────
  async function handleSave() {
    if (!workspaceId || !saveName.trim()) return
    setSaving(true)
    const stripped = nodes.map(n =>
      n.type === 'source' ? { ...n, data: { ...n.data, outputData: [], loading: false } } : n
    )
    const res  = await fetch('/api/canvas-saves', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, name: saveName.trim(), nodes: stripped, edges }),
    })
    const data = await res.json()
    if (data.save) {
      setSaves(prev => [data.save, ...prev])
      localStorage.setItem(LAST_SAVED_KEY(workspaceId), saveName.trim())
      setLastSavedName(saveName.trim())
    }
    setSaving(false); setSaveName(''); setShowSaveInput(false)
  }

  // ── Load a named snapshot ─────────────────────────────────────────────────
  async function handleLoad(saveId: string) {
    if (!workspaceId) return
    setLoadingId(saveId)
    const res  = await fetch(`/api/canvas-saves/${saveId}?workspaceId=${workspaceId}`)
    const data = await res.json()
    if (data.save) {
      setNodes(data.save.nodes ?? [])
      setEdges(data.save.edges ?? [])
      localStorage.setItem(LAST_SAVED_KEY(workspaceId), data.save.name)
      setLastSavedName(data.save.name)
    }
    setLoadingId(null); setShowLoadPanel(false)
  }

  // ── Delete a save ─────────────────────────────────────────────────────────
  async function handleDeleteSave(saveId: string) {
    if (!workspaceId) return
    setDeletingId(saveId)
    await fetch(`/api/canvas-saves?id=${saveId}&workspaceId=${workspaceId}`, { method: 'DELETE' })
    setSaves(prev => prev.filter(s => s.id !== saveId))
    setDeletingId(null)
  }

  // ── Clear canvas ──────────────────────────────────────────────────────────
  // Step 1: If there are nodes and no named save, ask "save first?"
  // Step 2: If already saved (or user declined), show final confirm
  function handleClearClick() {
    if (nodes.length === 0) return // already empty
    if (lastSavedName) {
      setClearDialog('confirm') // already saved → go straight to confirm
    } else {
      setClearDialog('prompt')  // unsaved → ask first
    }
  }

  async function executeClear() {
    setNodes([]); setEdges([])
    if (workspaceId) {
      localStorage.removeItem(STORAGE_KEY(workspaceId))
      localStorage.removeItem(LAST_SAVED_KEY(workspaceId))
    }
    setLastSavedName(null)
    setClearDialog(null)
  }

  // ── Connections ───────────────────────────────────────────────────────────
  const EDGE_STYLE = { stroke: '#52525b', strokeWidth: 2 }

  const onConnect = useCallback((params: Connection) => {
    setEdges(eds => addEdge({ ...params, type: 'deletable', animated: true, style: EDGE_STYLE }, eds))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setEdges])

  const handleConnectEnd: OnConnectEnd = useCallback((event, state: FinalConnectionState) => {
    if (state.isValid) { setSuggestMenu(null); return }
    const fromNodeId = state.fromNode?.id
    const fromHandle = state.fromHandle?.id
    if (!fromNodeId || !fromHandle) { setSuggestMenu(null); return }
    const ev = 'changedTouches' in event ? event.changedTouches[0] : event as MouseEvent
    setSuggestMenu({ x: ev.clientX, y: ev.clientY, fromNodeId, fromHandle })
  }, [])

  const defaultDb = dbConns[0]?.id ?? 'all'

  function addSource() {
    const id = nextId('source')
    setNodes(ns => [...ns, makeSource(id, { x: 80 + Math.random() * 40, y: 100 + Math.random() * 40 }, defaultDb)])
  }
  function addChart() {
    const id = nextId('chart')
    setNodes(ns => [...ns, makeChart(id, { x: 460 + Math.random() * 40, y: 100 + Math.random() * 40 })])
  }

  function handleSuggestCreate(type: 'chart' | 'source') {
    if (!suggestMenu || !rfRef.current) { setSuggestMenu(null); return }
    const pos   = rfRef.current.screenToFlowPosition({ x: suggestMenu.x, y: suggestMenu.y })
    const newId = nextId(type)
    if (type === 'chart') {
      setNodes(ns => [...ns, makeChart(newId, { x: pos.x, y: pos.y - 150 })])
      setEdges(es => addEdge({ id: `e-${suggestMenu.fromNodeId}-${newId}`,
        source: suggestMenu.fromNodeId, sourceHandle: 'out', target: newId, targetHandle: 'in',
        animated: true, type: 'deletable', style: EDGE_STYLE }, es))
    } else {
      setNodes(ns => [...ns, makeSource(newId, { x: pos.x - 320, y: pos.y - 150 }, defaultDb)])
      setEdges(es => addEdge({ id: `e-${newId}-${suggestMenu.fromNodeId}`,
        source: newId, sourceHandle: 'out', target: suggestMenu.fromNodeId, targetHandle: 'in',
        animated: true, type: 'deletable', style: EDGE_STYLE }, es))
    }
    setSuggestMenu(null)
  }

  async function handleAddToDashboard(
    cfg: { title: string; metricA: string; metricB?: string; dimension: string; chartType: string; weekRange: number },
    dashboardId: string
  ) {
    if (!workspaceId) return
    await fetch('/api/dashboard/tiles', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workspaceId, dashboardId, ...cfg }),
    })
  }

  const ctx: CanvasCtxType = {
    workspaceId: workspaceId ?? '', dbConnections: dbConns, dashboards,
    onAddToDashboard: handleAddToDashboard,
  }

  return (
    <CanvasCtx.Provider value={ctx}>
      {/* ── Clear dialog ─────────────────────────────────────────────────── */}
      {clearDialog && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl border border-zinc-200 w-80 overflow-hidden">
            {clearDialog === 'prompt' ? (
              <>
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="size-9 rounded-xl bg-amber-50 border border-amber-100 flex items-center justify-center shrink-0 mt-0.5">
                      <AlertTriangle className="size-4 text-amber-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-800">Save before clearing?</p>
                      <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">
                        Your canvas has unsaved work. Save it first so you can come back to it later.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 px-5 pb-5">
                  <button onClick={() => setClearDialog(null)}
                    className="flex-1 h-9 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={() => { setClearDialog(null); setShowSaveInput(true) }}
                    className="flex-1 h-9 rounded-xl bg-zinc-900 text-white text-xs font-semibold hover:bg-zinc-800 transition-colors">
                    Save first
                  </button>
                  <button onClick={() => setClearDialog('confirm')}
                    className="flex-1 h-9 rounded-xl bg-white border border-zinc-200 text-xs font-semibold text-zinc-500 hover:bg-zinc-50 transition-colors">
                    Clear anyway
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="px-5 pt-5 pb-4">
                  <div className="flex items-start gap-3">
                    <div className="size-9 rounded-xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0 mt-0.5">
                      <Trash2 className="size-4 text-rose-500" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-zinc-800">Clear the canvas?</p>
                      <p className="text-[12px] text-zinc-500 mt-1 leading-relaxed">
                        This removes all nodes and connections.
                        {lastSavedName && <> Your save <strong>&ldquo;{lastSavedName}&rdquo;</strong> won&apos;t be affected.</>}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 px-5 pb-5">
                  <button onClick={() => setClearDialog(null)}
                    className="flex-1 h-9 rounded-xl border border-zinc-200 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={executeClear}
                    className="flex-1 h-9 rounded-xl bg-rose-600 text-white text-xs font-semibold hover:bg-rose-700 transition-colors">
                    Clear canvas
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ height: 'calc(100vh - 7.5rem)' }}
        className="relative rounded-2xl overflow-hidden border border-zinc-200 shadow-sm">

        <ReactFlow
          nodes={nodes} edges={edges}
          onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
          onConnect={onConnect} onConnectEnd={handleConnectEnd}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView fitViewOptions={{ padding: 0.3 }}
          deleteKeyCode="Backspace"
          className="bg-[#f7f8fb]"
          onInit={instance => { rfRef.current = instance }}
          defaultEdgeOptions={{ type: 'deletable', animated: true, style: EDGE_STYLE }}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1.2} color="#d8dce8" />
          <Controls showInteractive={false}
            className="!border !border-zinc-200 !shadow-sm !rounded-xl !bg-white overflow-hidden" />
          <MiniMap
            className="!border !border-zinc-200 !rounded-xl !shadow-sm"
            style={{ background: '#f7f8fb' }}
            nodeColor={n => n.type === 'source' ? '#18181b' : '#71717a'}
            maskColor="rgba(247,248,251,0.85)"
          />

          {/* ── Toolbar ── */}
          <Panel position="top-left">
            <div className="flex items-center gap-1.5 mt-1 ml-1 bg-white/90 backdrop-blur-sm border border-zinc-200 rounded-2xl px-3 py-2 shadow-sm">
              {/* Add nodes */}
              <button onClick={addSource}
                className="flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-xl bg-zinc-900 text-white hover:bg-zinc-800 transition-colors">
                <Plus className="size-3" /> Data Source
              </button>
              <button onClick={addChart}
                className="flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-xl bg-white text-zinc-700 border border-zinc-200 hover:bg-zinc-50 hover:border-zinc-300 transition-colors">
                <Plus className="size-3" /> Chart
              </button>

              <div className="w-px h-4 bg-zinc-200 mx-0.5" />

              {/* Save */}
              {showSaveInput ? (
                <div className="flex items-center gap-1">
                  <input
                    ref={saveNameRef}
                    value={saveName}
                    onChange={e => setSaveName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setShowSaveInput(false); setSaveName('') } }}
                    placeholder="Name this save…"
                    className="h-8 w-36 text-[11px] rounded-xl border border-zinc-300 px-2.5 focus:outline-none focus:ring-1 focus:ring-zinc-400 bg-white"
                  />
                  <button onClick={handleSave} disabled={saving || !saveName.trim()}
                    className="h-8 px-2.5 rounded-xl bg-zinc-900 text-white text-[11px] font-semibold hover:bg-zinc-800 disabled:opacity-40 transition-colors">
                    {saving ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                  </button>
                  <button onClick={() => { setShowSaveInput(false); setSaveName('') }}
                    className="h-8 w-8 flex items-center justify-center rounded-xl text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 transition-colors">
                    <X className="size-3" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setShowSaveInput(true)} disabled={nodes.length === 0}
                  className="flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-xl text-zinc-600 hover:bg-zinc-100 disabled:opacity-30 transition-colors">
                  <Save className="size-3" /> Save
                </button>
              )}

              {/* Load */}
              <div ref={loadPanelRef} className="relative">
                <button onClick={openLoadPanel}
                  className={cn('flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-xl transition-colors',
                    showLoadPanel ? 'bg-zinc-900 text-white' : 'text-zinc-600 hover:bg-zinc-100')}>
                  <FolderOpen className="size-3" /> Load
                </button>

                {showLoadPanel && (
                  <div className="absolute left-0 top-full mt-2 z-50 bg-white border border-zinc-200 rounded-2xl shadow-xl w-64 overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-100">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Saved Canvases</p>
                    </div>
                    {!savesLoaded ? (
                      <div className="flex items-center justify-center py-6">
                        <Loader2 className="size-4 animate-spin text-zinc-400" />
                      </div>
                    ) : saves.length === 0 ? (
                      <div className="px-4 py-5 text-center">
                        <p className="text-xs text-zinc-400">No saves yet.</p>
                        <p className="text-[11px] text-zinc-300 mt-0.5">Click Save to create one.</p>
                      </div>
                    ) : (
                      <div className="max-h-64 overflow-y-auto p-1.5 space-y-0.5">
                        {saves.map(s => (
                          <div key={s.id}
                            className="flex items-center gap-2 px-3 py-2.5 rounded-xl hover:bg-zinc-50 group transition-colors">
                            <button onClick={() => handleLoad(s.id)} className="flex-1 text-left min-w-0">
                              <p className="text-[11px] font-semibold text-zinc-700 truncate">{s.name}</p>
                              <p className="text-[10px] text-zinc-400 flex items-center gap-1 mt-0.5">
                                <Clock className="size-2.5" />
                                {new Date(s.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                              </p>
                            </button>
                            {loadingId === s.id
                              ? <Loader2 className="size-3.5 animate-spin text-zinc-400 shrink-0" />
                              : (
                                <button onClick={() => handleDeleteSave(s.id)} disabled={deletingId === s.id}
                                  className="p-1 rounded-lg text-zinc-300 hover:text-rose-500 hover:bg-rose-50 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                                  {deletingId === s.id ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                                </button>
                              )
                            }
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Clear */}
              <button onClick={handleClearClick} disabled={nodes.length === 0}
                className="flex items-center gap-1.5 h-8 px-3 text-[11px] font-semibold rounded-xl text-zinc-400 hover:text-rose-500 hover:bg-rose-50 disabled:opacity-30 transition-colors">
                <Trash2 className="size-3" /> Clear
              </button>
            </div>
          </Panel>

          {/* Auto-save flash */}
          <Panel position="top-right">
            <div className={cn('flex items-center gap-1.5 text-[11px] font-medium mt-1 mr-1 px-3 py-1.5 rounded-xl transition-all duration-300 bg-white border',
              autoSaved ? 'text-emerald-600 border-emerald-200 opacity-100' : 'opacity-0 border-transparent')}>
              <Check className="size-3" /> Saved
            </div>
          </Panel>
        </ReactFlow>

        {/* Empty state */}
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div className="bg-white/90 backdrop-blur-sm border border-zinc-200 rounded-2xl px-10 py-9 shadow-md text-center max-w-sm">
              <div className="flex items-center justify-center gap-3 mb-4">
                <div className="size-10 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center">
                  <Database className="size-4 text-white" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="w-7 h-0.5 bg-zinc-400 rounded-full" />
                  <div className="w-5 h-0.5 bg-zinc-300 rounded-full ml-2" />
                  <div className="w-7 h-0.5 bg-zinc-400 rounded-full" />
                </div>
                <div className="size-10 rounded-2xl bg-zinc-100 border border-zinc-200 flex items-center justify-center">
                  <BarChart3 className="size-4 text-zinc-600" />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="w-7 h-0.5 bg-zinc-300 rounded-full" />
                  <div className="w-5 h-0.5 bg-zinc-200 rounded-full ml-2" />
                  <div className="w-7 h-0.5 bg-zinc-300 rounded-full" />
                </div>
                <div className="size-10 rounded-2xl bg-zinc-50 border border-zinc-200 flex items-center justify-center">
                  <LayoutGrid className="size-4 text-zinc-400" />
                </div>
              </div>
              <p className="text-sm font-semibold text-zinc-800">Build your first pipeline</p>
              <p className="text-[11px] text-zinc-400 mt-1.5 leading-relaxed">
                Add a <span className="text-zinc-900 font-semibold">Data Source</span>, connect it to a{' '}
                <span className="text-zinc-600 font-medium">Chart</span>, then push to a Space.
              </p>
              <div className="h-px bg-zinc-100 my-3.5" />
              <p className="text-[10px] text-zinc-400">
                <Sparkles className="size-2.5 inline mr-1 text-zinc-400" />
                Tip: release a wire in empty space for a quick-connect menu
              </p>
            </div>
          </div>
        )}
      </div>

      {suggestMenu && (
        <ConnectionMenu menu={suggestMenu} onCreate={handleSuggestCreate} onClose={() => setSuggestMenu(null)} />
      )}
    </CanvasCtx.Provider>
  )
}
