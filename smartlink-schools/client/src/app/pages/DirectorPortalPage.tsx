import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { Download, Search, XCircle, AlertTriangle, CircleCheck, TrendingDown, TrendingUp, Plus, Check, ClipboardList } from 'lucide-react'
import {
  Bar,
  BarChart,
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { PageBackButton } from '../components/PageBackButton'
import { DirectorTaskModal } from '../components/DirectorTaskModal'
import { OperationalActionModal } from '../components/OperationalActionModal'
import { usePortal } from '../lib/portalContext'

const selectClassName = 'h-9 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'
// Material-inspired SmartLink palette: confident primary purple with a warm magenta signal color.
const chartColors = ['#5B21D6', '#EC268F', '#7C3AED', '#D946EF', '#0F9F8F', '#F97316']
const chartSoftColors = ['#EDE9FE', '#FCE7F3', '#F3E8FF', '#FAE8FF', '#CCFBF1', '#FFEDD5']

const sectionTitles: Record<string, string> = {
  overview: 'Overview',
  'finance-fee-collection': 'Fee Collection',
  'finance-outstanding-balances': 'Outstanding Balances',
  'finance-discounts-bursaries': 'Discounts & Bursaries',
  'finance-expenses': 'Expenses',
  'finance-financial-reports': 'Financial Reports',
  'admissions-enrollment-pipeline': 'Enrollment Pipeline',
  'admissions-class-capacity': 'Class Capacity',
  'admissions-withdrawals': 'Withdrawals',
  'academics-performance-overview': 'Performance Overview',
  'academics-at-risk-students': 'At-Risk Students',
  'academics-subject-trends': 'Subject Trends',
  'academics-marks-submission': 'Marks Submission',
  'staff-teacher-compliance': 'Teacher Compliance',
  'staff-attendance': 'Attendance',
  'staff-workload': 'Workload',
  'operations-incidents': 'Incidents',
  'operations-complaints': 'Complaints',
  'operations-approvals': 'Approvals',
  'reports-director-report': 'Director Report',
  'reports-term-report': 'Term Report',
  'reports-export-center': 'Export Center',
  'audit-security': 'Audit & Security',
  settings: 'Settings',
}

function valueLabel(value: any) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatCell(value: any) {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'number') return value.toLocaleString()
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) return new Date(value).toLocaleString()
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return new Date(`${value}T00:00:00`).toLocaleDateString()
  return String(value).replace(/_/g, ' ')
}

function directorRouteFromPath(pathname: string) {
  const rest = pathname.replace(/^\/+/, '').replace(/\/+$/, '')
  if (!rest) return { section: 'overview', detailId: '' }
  const parts = rest.split('/').filter(Boolean)
  if (parts[0] === 'overview') return { section: 'overview', detailId: parts[1] || '' }
  if (parts[0] === 'audit-security' || parts[0] === 'leadership-settings') return { section: parts[0] === 'leadership-settings' ? 'settings' : parts[0], detailId: parts[1] || '' }
  const section = parts.length >= 2 ? `${parts[0]}-${parts[1]}` : parts[0]
  return { section, detailId: parts[2] || '' }
}

function toneClass(tone: string) {
  if (tone === 'bad' || tone === 'critical') return 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
  if (tone === 'warn' || tone === 'warning') return 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
  if (tone === 'good' || tone === 'healthy') return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
  return 'border-[#dbeafe] bg-[#eff6ff] text-[#1d4ed8]'
}

function statusBadge(value: any) {
  const status = String(value || '').toLowerCase()
  const tone = /(critical|over|bad|declin|late|overdue|missing|unpaid|pending|warn|withdrawn)/.test(status)
    ? 'warn'
    : /(healthy|good|paid|approved|locked|submitted|active|improving|present|ready)/.test(status)
      ? 'good'
      : 'neutral'
  return <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${toneClass(tone)}`}>{formatCell(value)}</span>
}

function defaultColumns(keys: string[] = []) {
  const statusKeys = new Set(['status', 'submission_status', 'risk_level', 'computed_status', 'workload_level', 'severity', 'priority'])
  return keys.length
    ? keys.map((key) => ({
        key,
        label: valueLabel(key),
        render: (row: any) => statusKeys.has(key) ? statusBadge(row?.[key]) : formatCell(row?.[key]),
      }))
    : [{ key: 'record', label: 'Record', render: (row: any) => formatCell(row?.title || row?.metric || row?.id) }]
}

function hasChartData(chart: any) {
  const data = chart?.data || []
  const series = chart?.series || []
  return data.some((row: any) => series.some((item: any) => Number(row?.[item.key] || 0) !== 0))
}

function DirectorChart({ chart }: { chart: any }) {
  const data = chart?.data || []
  const series = chart?.series || [{ key: 'value', label: 'Value' }]
  const xKey = chart?.xKey || 'name'
  const ready = hasChartData(chart)
  const [chartPage, setChartPage] = useState(0)
  const shouldPaginateBars = chart?.type !== 'line' && chart?.type !== 'pie' && data.length > 14
  const pageSize = Number(chart?.page_size || chart?.pageSize || 12)
  const totalPages = shouldPaginateBars ? Math.max(1, Math.ceil(data.length / pageSize)) : 1
  const pagedData = shouldPaginateBars ? data.slice(chartPage * pageSize, chartPage * pageSize + pageSize) : data

  useEffect(() => {
    setChartPage(0)
  }, [chart?.title, data.length])

  if (!ready) {
    return (
      <div className="grid min-h-[240px] place-items-center p-5 text-center text-[12px] leading-5 text-[#64748b]">
        {chart?.empty_state?.message || 'No chartable records are available for this view yet.'}
      </div>
    )
  }

  if (chart.type === 'pie' && data.length > 0 && data.length <= 3) {
    const dataKey = series[0]?.key || 'value'
    const values = data.map((row: any) => Math.max(0, Number(row?.[dataKey] || 0)))
    const total = values.reduce((sum: number, value: number) => sum + value, 0)
    const ordered = data.map((row: any, index: number) => ({ row, value: values[index], index })).sort((a: any, b: any) => b.value - a.value)
    const radialData = ordered.map((item: any) => ({ name: formatCell(item.row?.[xKey]), value: item.value, percent: total ? Number(((item.value / total) * 100).toFixed(1)) : 0, fill: chartColors[item.index % chartColors.length] }))
    return (
      <div className="grid min-h-[300px] items-center gap-4 p-5 sm:grid-cols-[minmax(210px,1fr)_minmax(150px,.72fr)]">
        <div className="relative mx-auto h-[240px] w-full max-w-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <RadialBarChart data={radialData} cx="50%" cy="50%" innerRadius="28%" outerRadius="96%" startAngle={90} endAngle={-270} barSize={18}>
              <RadialBar dataKey="percent" background={{ fill: '#EEEAF3' }} cornerRadius={12} />
              <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#E5E1EA', boxShadow: '0 14px 34px rgba(55,30,90,.14)', fontSize: 12 }} formatter={(value: any, _name: any, item: any) => [`${Number(value).toFixed(1)}% · ${formatCell(item?.payload?.value)}`, item?.payload?.name || 'Value']} />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 grid place-content-center text-center"><div className="text-[28px] font-bold tracking-[-.05em] text-[#5B21D6]">{radialData[0]?.percent?.toFixed?.(0) || 0}%</div><div className="mt-0.5 max-w-[90px] truncate text-[10px] font-semibold text-[#64748b]">{radialData[0]?.name}</div></div>
        </div>
        <div className="grid content-center gap-4">
          {radialData.map((item: any, index: number) => <div key={`legend-${item.name}-${index}`} className="border-l-[3px] pl-3" style={{ borderColor: item.fill }}><div className="flex items-baseline gap-2"><span className="text-[24px] font-bold tracking-[-.04em]" style={{ color: item.fill }}>{item.percent.toFixed(0)}%</span><span className="font-mono text-[11px] font-bold text-[#64748b]">{formatCell(item.value)}</span></div><div className="mt-0.5 text-[11px] font-semibold text-[#64748b]">{item.name}</div></div>)}
        </div>
      </div>
    )
  }

  if (chart.type === 'line') {
    return (
      <div className="h-[300px] px-3 pb-3 pt-5">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 20, left: 0, bottom: 12 }}>
            <defs>{series.map((item:any,index:number)=><linearGradient key={item.key} id={`director-gradient-${item.key}-${index}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={chartColors[index%chartColors.length]} stopOpacity={0.22}/><stop offset="95%" stopColor={chartColors[index%chartColors.length]} stopOpacity={0.01}/></linearGradient>)}</defs>
            <CartesianGrid vertical={false} stroke="#E7E5EB" strokeDasharray="3 5" />
            <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} interval="preserveStartEnd" />
            <YAxis domain={chart?.domain || ['auto', 'auto']} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={44} />
            <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#E5E1EA', boxShadow: '0 14px 34px rgba(55,30,90,.14)', fontSize: 12 }} formatter={(value: any) => formatCell(value)} labelFormatter={(label) => formatCell(label)} />
            {series.length>1?<Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />:null}
            {series.map((item: any, index: number) => (
              <Area key={item.key} type="monotone" connectNulls dataKey={item.key} name={item.label || valueLabel(item.key)} stroke={chartColors[index % chartColors.length]} fill={`url(#director-gradient-${item.key}-${index})`} strokeWidth={3} dot={data.length <= 12 ? { r: 3, fill: '#fff', strokeWidth: 2 } : false} activeDot={{ r: 5, fill: '#fff', strokeWidth: 3 }} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
    )
  }

  if (chart.type === 'pie') {
    const dataKey = series[0]?.key || 'value'
    return (
      <div className="h-[300px] p-4">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey={dataKey} nameKey={xKey} outerRadius={102} innerRadius={68} cornerRadius={7} paddingAngle={4} stroke="#fff" strokeWidth={3}>
              {data.map((_: any, index: number) => <Cell key={index} fill={chartColors[index % chartColors.length]} />)}
            </Pie>
            <Tooltip contentStyle={{ borderRadius: 12, borderColor: '#E5E1EA', boxShadow: '0 14px 34px rgba(55,30,90,.14)', fontSize: 12 }} formatter={(value: any) => formatCell(value)} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className="grid gap-2 px-3 pb-3 pt-5">
      {shouldPaginateBars ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-1 text-[11px] text-[#64748b]">
          <span className="font-semibold">Showing {chartPage * pageSize + 1}-{Math.min(data.length, chartPage * pageSize + pageSize)} of {data.length}</span>
          <div className="flex items-center gap-1.5">
            <button type="button" disabled={chartPage <= 0} onClick={() => setChartPage((page) => Math.max(0, page - 1))} className="h-7 rounded-[5px] border border-[#d9dce3] px-2 font-semibold text-[#334155] disabled:opacity-40">Prev</button>
            <span className="px-1 font-semibold">{chartPage + 1}/{totalPages}</span>
            <button type="button" disabled={chartPage >= totalPages - 1} onClick={() => setChartPage((page) => Math.min(totalPages - 1, page + 1))} className="h-7 rounded-[5px] border border-[#d9dce3] px-2 font-semibold text-[#334155] disabled:opacity-40">Next</button>
          </div>
        </div>
      ) : null}
      <div className="h-[300px]">
        <ResponsiveContainer width="100%" height="100%">
        <BarChart data={pagedData} margin={{ top: 12, right: 18, left: 0, bottom: 12 }}>
          <CartesianGrid vertical={false} stroke="#E7E5EB" strokeDasharray="3 5" />
          <XAxis dataKey={xKey} axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} interval={0} angle={pagedData.length > 7 ? -18 : 0} textAnchor={pagedData.length > 7 ? 'end' : 'middle'} height={pagedData.length > 7 ? 58 : 34} />
          <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: '#64748b' }} width={44} />
          <Tooltip cursor={{ fill: '#F8F6FB' }} contentStyle={{ borderRadius: 12, borderColor: '#E5E1EA', boxShadow: '0 14px 34px rgba(55,30,90,.14)', fontSize: 12 }} formatter={(value: any) => formatCell(value)} labelFormatter={(label) => formatCell(label)} />
          {series.length>1?<Legend wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />:null}
          {series.map((item: any, index: number) => (
            <Bar key={item.key} dataKey={item.key} name={item.label || valueLabel(item.key)} fill={chartColors[index % chartColors.length]} radius={[9, 9, 3, 3]} maxBarSize={34} background={{ fill: chartSoftColors[index % chartSoftColors.length], opacity: .28, radius: 9 }}>
              {series.length === 1 ? pagedData.map((_: any, dataIndex: number) => <Cell key={`bar-${dataIndex}`} fill={chartColors[dataIndex % 2]} />) : null}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      </div>
    </div>
  )
}

function makeCsv(rows: any[], columns: string[]) {
  const safe = (value: any) => `"${String(formatCell(value)).replace(/"/g, '""')}"`
  return [columns.map(valueLabel).map(safe).join(','), ...rows.map((row) => columns.map((key) => safe(row?.[key])).join(','))].join('\n')
}

export function DirectorPortalPage() {
  const { token, api, user, runAction } = usePortal()
  const location = useLocation()
  const navigate = useNavigate()
  const { section, detailId } = directorRouteFromPath(location.pathname)
  const [page, setPage] = useState<any>(null)
  const [classes, setClasses] = useState<any[]>([])
  const [filters, setFilters] = useState<any>({ status: '', type: '', class_id: '', search: '', date_from: '', date_to: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [cancellingId, setCancellingId] = useState<any>(null)
  const [decidingDiscountId, setDecidingDiscountId] = useState<any>(null)
  const [taskOpen, setTaskOpen] = useState(false)
  const [taskInitial, setTaskInitial] = useState<any>({})
  const [tasks, setTasks] = useState<any[]>([])
  const [staff, setStaff] = useState<any[]>([])
  const [closure, setClosure] = useState<any>(null)
  const [operationalAction, setOperationalAction] = useState<any>(null)
  const [whatsapp, setWhatsapp] = useState<any>({})
  const canCancel = ['school_owner', 'director', 'owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())

  const loadPage = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const requestFilters = { ...filters, ...(detailId ? { detail_id: detailId } : {}) }
      const payload = await api.getDirectorPage(token, section, requestFilters)
      setPage(payload?.page || null)
    } catch (err: any) {
      setError(err?.message || 'Unable to load Director page.')
      setPage(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPage()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, section, detailId, filters.status, filters.type, filters.class_id, filters.date_from, filters.date_to])

  useEffect(() => {
    if (!token) return
    const needsClasses = page?.filters?.some((filter: any) => filter.type === 'class') || section === 'admissions-withdrawals'
    if (!needsClasses) return
    api.listClasses(token).then((payload: any) => setClasses(payload?.classes || [])).catch(() => setClasses([]))
  }, [api, token, page?.filters, section])

  const loadOperations = async () => {
    if (!token) return
    const [taskPayload, userPayload] = await Promise.all([api.listDirectorTasks(token).catch(() => ({ tasks: [] })), api.listUsers(token).catch(() => ({ users: [] }))])
    setTasks(taskPayload?.tasks || [])
    setStaff((userPayload?.users || []).filter((item: any) => item.is_active !== 0))
    if (section === 'overview') setClosure((await api.getDirectorDailyClosure(token).catch(() => ({ closure: null })))?.closure || null)
    if (section === 'settings') { const payload=await api.getWhatsAppSettings(token).catch(()=>({settings:{}})); setWhatsapp(payload?.settings||{}) }
  }

  useEffect(() => { loadOperations() }, [token, section])

  const kpis = page?.kpis || []
  const insights = [...(page?.insights || [])].sort((a: any, b: any) => {
    const priority: Record<string, number> = { bad: 0, critical: 0, warn: 1, warning: 1, neutral: 2, good: 3, healthy: 3 }
    return (priority[a?.tone] ?? 2) - (priority[b?.tone] ?? 2)
  })
  const charts = page?.charts || []
  const tables = page?.tables?.length ? page.tables : [{ title: page?.title || sectionTitles[section] || 'Director Records', rows: page?.rows || [], columns: page?.columns || [], empty_state: page?.empty_state }]
  const headerTitle = page?.title || sectionTitles[section] || 'Director Portal'
  const filtersEnabled = Boolean(page?.filters?.length)

  const mainTable = tables[0] || { rows: [], columns: [] }
  const exportRows = mainTable.rows || []
  const exportColumns = mainTable.columns || []

  const filterControls = useMemo(() => page?.filters || [], [page?.filters])

  function exportMainTable() {
    if (!exportRows.length || !exportColumns.length) return
    const blob = new Blob([makeCsv(exportRows, exportColumns)], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${section}-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  async function cancelWithdrawal() {
    const withdrawal = page?.detail?.withdrawal
    if (!token || !withdrawal?.student_id || !withdrawal?.id) return
    if (!window.confirm('Cancel this withdrawal record?')) return
    setCancellingId(withdrawal.id)
    setError('')
    try {
      await runAction(async () => {
        await api.cancelStudentWithdrawal(token, withdrawal.student_id, withdrawal.id, { reason: 'Cancelled from Director withdrawal detail' })
        await loadPage()
      }, 'Cancelling withdrawal...', { refresh: false })
    } catch (err: any) {
      setError(err?.message || 'Unable to cancel withdrawal.')
    } finally {
      setCancellingId(null)
    }
  }

  async function decideDiscount(row: any, action: 'approve' | 'reject') {
    if (!token || !row?.id || decidingDiscountId) return
    const learner = row.student_name || row.student_code || 'this learner'
    const verb = action === 'approve' ? 'Approve' : 'Reject'
    const effect = action === 'approve'
      ? 'This will apply the discount to the learner’s outstanding fee account.'
      : 'The request will remain recorded as rejected and will not affect the fee account.'
    if (!window.confirm(`${verb} the discount request for ${learner}?\n\n${effect}`)) return

    setDecidingDiscountId(row.id)
    setError('')
    try {
      await runAction(
        () => api.transitionFinanceDiscount(token, row.id, action),
        `${action === 'approve' ? 'Approving' : 'Rejecting'} discount...`,
        { refresh: false },
      )
      await loadPage()
    } catch (err: any) {
      setError(err?.message || `Unable to ${action} the discount request.`)
    } finally {
      setDecidingDiscountId(null)
    }
  }

  const onRowClick = (row: any) => {
    if (row?.detail_path) navigate(row.detail_path)
  }

  const category = section.startsWith('finance-') ? 'finance' : section.startsWith('academics-') ? 'academics' : section.startsWith('staff-') ? 'staff' : section.startsWith('admissions-') ? 'admissions' : section.startsWith('operations-') ? 'operations' : 'general'
  const openTask = (row: any = null) => {
    const recordName = row?.student_name || row?.teacher_name || row?.class_name || row?.subject_name || row?.title || row?.assessment_name || headerTitle
    const contextSnapshot = row ? Object.fromEntries(Object.entries(row).filter(([key, value]) => !/(^id$|_id$|public_ref|detail_path)/.test(key) && ['string','number','boolean'].includes(typeof value)).slice(0, 16)) : { page: headerTitle }
    setTaskInitial({ category, priority: ['academics-at-risk-students','finance-outstanding-balances','operations-incidents','operations-complaints'].includes(section) ? 'high' : 'medium', title: `Follow up: ${recordName}`, description: row ? `Director follow-up created from ${headerTitle}. Review the attached source context and report the outcome with evidence.` : `Operational follow-up from ${headerTitle}.`, linked_entity_type: page?.detail?.type || section, linked_entity_id: row?.student_id || row?.teacher_id || row?.class_id || row?.subject_id || row?.batch_id || row?.id || page?.detail?.id || null, context_snapshot: contextSnapshot })
    setTaskOpen(true)
  }
  const createTask = async (payload: any) => { await api.createDirectorTask(token, payload); await loadOperations() }
  const reviewClosure = async () => {
    const notes = window.prompt('Daily closure notes (optional)', closure?.reviewed?.notes || '')
    if (notes === null) return
    const payload = await api.reviewDirectorDailyClosure(token, { date: closure?.date, notes })
    setClosure(payload?.closure || null)
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            {page?.detail?.back_path ? (
              <PageBackButton fallback={page.detail.back_path || '/overview'} label={`Back to ${sectionTitles[section] || 'Director page'}`} className="mb-3" />
            ) : null}
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-[var(--mera-panel-text-muted)]">Director Portal</p>
            <h1 className="mt-1 text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">{headerTitle}</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">{page?.description || 'Owner-level visibility across school operations.'}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" className="h-9 rounded-[7px] text-[12px]" onClick={() => openTask()}><Plus className="size-3.5" /> Create follow-up</Button>
            {page?.detail?.type === 'withdrawal' && canCancel && page?.detail?.withdrawal?.computed_status !== 'cancelled' ? (
              <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px] text-[#b91c1c]" disabled={String(cancellingId || '') === String(page.detail.withdrawal.id)} onClick={cancelWithdrawal}>
                {String(cancellingId || '') === String(page.detail.withdrawal.id) ? 'Cancelling...' : 'Cancel Withdrawal'}
              </Button>
            ) : null}
            <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" disabled={!exportRows.length} onClick={exportMainTable}>
              <Download className="size-3.5" />
              CSV
            </Button>
            {loading ? <span className="rounded-full border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-1 text-[11px] font-semibold text-[#1d4ed8]">Loading</span> : null}
          </div>
        </div>
      </section>

      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}

      {loading && !page ? (
        <div className="grid min-h-[360px] place-items-center rounded-[8px] border border-[var(--mera-panel-border)] bg-white p-6">
          <SmartLinkLoadingState variant="inline" label="Loading Director intelligence" detail="Reading current school records." />
        </div>
      ) : null}

      {kpis.length ? <SectionKpiStrip items={kpis} /> : null}

      {section === 'settings' ? <SectionCard title="WhatsApp Business Integration" subtitle="Official Meta Cloud API configuration. Tokens are encrypted and never returned to the browser."><div className="grid gap-3 p-4 md:grid-cols-2"><label className={labelClass}>Business Account ID<Input value={whatsapp.business_account_id||''} onChange={e=>setWhatsapp({...whatsapp,business_account_id:e.target.value})}/></label><label className={labelClass}>Phone Number ID<Input value={whatsapp.phone_number_id||''} onChange={e=>setWhatsapp({...whatsapp,phone_number_id:e.target.value})}/></label><label className={labelClass}>Display Phone Number<Input value={whatsapp.display_phone_number||''} onChange={e=>setWhatsapp({...whatsapp,display_phone_number:e.target.value})}/></label><label className={labelClass}>Access Token<Input type="password" placeholder={whatsapp.has_access_token?'Saved — enter only to replace':'Paste Meta access token'} value={whatsapp.access_token||''} onChange={e=>setWhatsapp({...whatsapp,access_token:e.target.value})}/></label><label className={labelClass}>Webhook Verify Token<Input type="password" placeholder={whatsapp.has_webhook_token?'Saved — enter only to replace':'Enter verify token'} value={whatsapp.webhook_verify_token||''} onChange={e=>setWhatsapp({...whatsapp,webhook_verify_token:e.target.value})}/></label><label className="flex items-end gap-2 pb-2 text-[12px] font-semibold text-[#334155]"><input type="checkbox" checked={Boolean(whatsapp.is_enabled)} onChange={e=>setWhatsapp({...whatsapp,is_enabled:e.target.checked})}/>Enable WhatsApp Cloud API</label><div className="md:col-span-2 flex items-center justify-between rounded-[7px] border border-[#e2e8f0] bg-[#f8fafc] p-3"><p className="text-[12px] text-[#64748b]">Status: <strong className={whatsapp.is_enabled&&whatsapp.has_access_token&&whatsapp.phone_number_id?'text-[#15803d]':'text-[#b45309]'}>{whatsapp.is_enabled&&whatsapp.has_access_token&&whatsapp.phone_number_id?'Configured':'Not configured — in-app reminders remain available'}</strong></p><Button onClick={async()=>{const payload=await api.updateWhatsAppSettings(token,whatsapp);setWhatsapp(payload?.settings||{})}}>Save configuration</Button></div></div></SectionCard> : null}

      {section === 'overview' ? <div className="grid gap-3 xl:grid-cols-2">
        <SectionCard title="Director Tasks" subtitle="Open follow-ups ordered by urgency and due date.">
          <div className="divide-y divide-[#eef0f3]">
            {tasks.filter((task) => ['open','in_progress'].includes(task.status)).slice(0,8).map((task) => <div key={task.id} className="flex items-start gap-3 px-4 py-3">
              <span className={`mt-1 size-2 rounded-full ${task.priority === 'urgent' ? 'bg-[#dc2626]' : task.priority === 'high' ? 'bg-[#f59e0b]' : 'bg-[#64748b]'}`} />
              <button type="button" onClick={() => navigate(`/tasks/${encodeURIComponent(task.id)}`)} className="min-w-0 flex-1 text-left"><p className="text-[13px] font-semibold text-[#111827] hover:underline">{task.title}</p><p className="mt-1 text-[11px] text-[#64748b]">{task.assigned_to_name || 'Unassigned'} · {task.due_date ? `Due ${String(task.due_date).slice(0,10)}` : 'No due date'}{task.is_overdue ? ' · Overdue' : ''}</p></button>
              <Button variant="outline" className="h-8 text-[11px]" onClick={() => navigate(`/tasks/${encodeURIComponent(task.id)}`)}>Open</Button>
            </div>)}
            {!tasks.some((task) => ['open','in_progress'].includes(task.status)) ? <div className="p-5 text-center text-[12px] text-[#64748b]">No open Director tasks. Create a follow-up from any operational page.</div> : null}
          </div>
        </SectionCard>
        <SectionCard title="Daily Closure Checklist" subtitle={closure?.reviewed ? `Reviewed by ${closure.reviewed.completed_by_name}` : 'Review today’s operational readiness.'}>
          <div className="divide-y divide-[#eef0f3]">{(closure?.items || []).map((item: any) => <div key={item.key} className="flex items-center gap-3 px-4 py-3"><span className={`grid size-7 place-items-center rounded-full ${item.status === 'complete' ? 'bg-[#f0fdf4] text-[#15803d]' : item.status === 'incomplete' ? 'bg-[#fff7ed] text-[#c2410c]' : 'bg-[#f1f5f9] text-[#64748b]'}`}>{item.status === 'complete' ? <Check className="size-3.5" /> : <ClipboardList className="size-3.5" />}</span><div className="min-w-0 flex-1"><p className="text-[12px] font-semibold text-[#111827]">{item.label}</p><p className="text-[11px] text-[#64748b]">{item.description}</p></div><Button variant="outline" className="h-8 text-[11px]" onClick={() => navigate(item.actionRoute)}>Review</Button></div>)}<div className="flex items-center justify-between gap-3 px-4 py-3"><p className="text-[11px] text-[#64748b]">{closure?.reviewed?.notes || 'Record the Director’s end-of-day review.'}</p><Button className="h-8 text-[11px]" onClick={reviewClosure}>{closure?.reviewed ? 'Update review' : 'Mark reviewed'}</Button></div></div>
        </SectionCard>
      </div> : null}

      {filtersEnabled ? (
        <SectionCard title="Filters" subtitle="Narrow this executive view using current school records.">
          <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-6">
            {filterControls.map((filter: any) => {
              if (filter.type === 'search') {
                return (
                  <label key={filter.key} className={`${labelClass} relative xl:col-span-2`}>
                    {filter.label}
                    <Search className="absolute bottom-2 left-3 size-3.5 text-[#9ca3af]" />
                    <Input className="h-9 pl-8 text-[12px]" value={filters[filter.key] || ''} onChange={(event) => setFilters({ ...filters, [filter.key]: event.target.value })} onKeyDown={(event) => event.key === 'Enter' && loadPage()} placeholder="Search records" />
                  </label>
                )
              }
              if (filter.type === 'date') {
                return (
                  <label key={filter.key} className={labelClass}>
                    {filter.label}
                    <Input type="date" className="h-9 text-[12px]" value={filters[filter.key] || ''} onChange={(event) => setFilters({ ...filters, [filter.key]: event.target.value })} />
                  </label>
                )
              }
              if (filter.type === 'class') {
                return (
                  <label key={filter.key} className={labelClass}>
                    {filter.label}
                    <select className={selectClassName} value={filters[filter.key] || ''} onChange={(event) => setFilters({ ...filters, [filter.key]: event.target.value })}>
                      <option value="">All classes</option>
                      {classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                    </select>
                  </label>
                )
              }
              return (
                <label key={filter.key} className={labelClass}>
                  {filter.label}
                  <select className={selectClassName} value={filters[filter.key] || ''} onChange={(event) => setFilters({ ...filters, [filter.key]: event.target.value })}>
                    {(filter.options || ['']).map((option: any) => <option key={option || 'all'} value={option}>{option ? valueLabel(option) : 'All'}</option>)}
                  </select>
                </label>
              )
            })}
            <div className="flex items-end gap-2">
              <Button type="button" variant="outline" className="h-9 rounded-[5px] text-[12px]" onClick={() => setFilters({ status: '', type: '', class_id: '', search: '', date_from: '', date_to: '' })}>
                <XCircle className="size-3.5" />
                Clear
              </Button>
              <Button type="button" className="h-9 rounded-[5px] text-[12px]" onClick={loadPage}>Apply</Button>
            </div>
          </div>
        </SectionCard>
      ) : null}

      {insights.length ? (
        <SectionCard title="Director Insights" subtitle="Deterministic observations generated from the records behind this page.">
          <div className="m-4 overflow-hidden rounded-[8px] border border-[#e2e8f0] bg-white">
            {insights.map((item: any, index: number) => {
              const bad = item.tone === 'bad' || item.tone === 'critical'
              const good = item.tone === 'good' || item.tone === 'healthy'
              const Icon = bad ? AlertTriangle : good ? CircleCheck : item.metric?.includes('declin') ? TrendingDown : TrendingUp
              const badge = item.value || item.message?.match(/(?:MWK\s*)?[\d,.]+(?:\.\d+)?%?/)?.[0]
              return (
                <div key={`${item.metric || 'insight'}-${index}`} className={`flex items-start gap-3 px-4 py-3.5 ${index ? 'border-t border-[#eef0f3]' : ''}`}>
                  <span className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ${bad ? 'bg-[#fef2f2] text-[#dc2626]' : good ? 'bg-[#f0fdf4] text-[#16a34a]' : 'bg-[#fff7ed] text-[#d97706]'}`}><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1"><p className="text-[13px] font-semibold leading-5 text-[#111827]">{item.headline || item.message}</p><p className="mt-0.5 text-[12px] leading-5 text-[#64748b]">{item.detail || 'Based on the latest records in this view.'}</p></div>
                  {badge ? <span className="mt-1 shrink-0 rounded-[5px] bg-[#f1f5f9] px-2 py-1 font-mono text-[11px] font-bold text-[#334155]">{badge}</span> : null}
                </div>
              )
            })}
          </div>
        </SectionCard>
      ) : null}

      {charts.length ? (
        <div className="grid gap-3 xl:grid-cols-2">
          {charts.map((item: any, index: number) => (
            <SectionCard key={`${item.title}-${index}`} title={item.title} subtitle={item.subtitle || 'Computed from current school records.'}>
              <DirectorChart chart={item} />
            </SectionCard>
          ))}
        </div>
      ) : null}

      {page?.report_sections?.length ? (
        <SectionCard title="Executive Report" subtitle="Readable summary generated from current Director analytics.">
          <div className="grid gap-3 p-4 lg:grid-cols-2">
            {page.report_sections.map((sectionItem: any, index: number) => (
              <article key={`${sectionItem.title}-${index}`} className="rounded-[6px] border border-[#e5e7eb] bg-white p-4">
                <h3 className="text-[13px] font-semibold text-[#111827]">{sectionItem.title}</h3>
                <p className="mt-2 text-[13px] leading-6 text-[#4b5563]">{sectionItem.body}</p>
              </article>
            ))}
          </div>
        </SectionCard>
      ) : null}

      {tables.map((tableItem: any, index: number) => {
        const rows = tableItem.rows || []
        const columns: any[] = defaultColumns(tableItem.columns || [])
        if (rows.length && section === 'finance-discounts-bursaries') {
          columns.push({
            key: '__discount_decision',
            label: 'Decision',
            render: (row: any) => {
              const pending = String(row?.status || '').toLowerCase() === 'pending'
              const deciding = String(decidingDiscountId || '') === String(row?.id || '')
              if (!pending) {
                return <span className="text-[11px] font-semibold text-[#64748b]">{valueLabel(row?.status || 'Processed')}</span>
              }
              return (
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={Boolean(decidingDiscountId)}
                    onClick={(event) => { event.stopPropagation(); decideDiscount(row, 'approve') }}
                    className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 text-[11px] font-semibold text-[#166534] transition hover:border-[#86efac] hover:bg-[#dcfce7] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Check className="size-3.5" />
                    {deciding ? 'Working...' : 'Approve'}
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(decidingDiscountId)}
                    onClick={(event) => { event.stopPropagation(); decideDiscount(row, 'reject') }}
                    className="inline-flex h-7 items-center gap-1 rounded-[6px] border border-[#fecaca] bg-[#fff7f7] px-2.5 text-[11px] font-semibold text-[#b91c1c] transition hover:border-[#fca5a5] hover:bg-[#fef2f2] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <XCircle className="size-3.5" />
                    Reject
                  </button>
                </div>
              )
            },
          })
        }
        if (rows.length && tableItem.title !== 'Director Tasks') columns.push({ key: '__director_action', label: 'Action', render: (row: any) => <div className="flex flex-wrap gap-1.5"><button type="button" className="rounded-[6px] border border-[#d8dee8] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#334155] hover:bg-[#f8fafc]" onClick={(event) => { event.stopPropagation(); openTask(row) }}>Follow up</button>{['academics-marks-submission','staff-teacher-compliance','staff-attendance','academics-subject-trends'].includes(section)?<button type="button" className="rounded-[6px] border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-1.5 text-[11px] font-semibold text-[#1d4ed8]" onClick={(event)=>{event.stopPropagation();setOperationalAction({type:'reminder',row})}}>Remind</button>:null}{['academics-marks-submission','staff-teacher-compliance','staff-attendance','academics-subject-trends','academics-at-risk-students'].includes(section)?<button type="button" className="rounded-[6px] border border-[#fed7aa] bg-[#fff7ed] px-2.5 py-1.5 text-[11px] font-semibold text-[#9a3412]" onClick={(event)=>{event.stopPropagation();setOperationalAction({type:'escalate',row})}}>Escalate</button>:null}{section==='finance-outstanding-balances'?<><button type="button" className="rounded-[6px] border border-[#dbeafe] bg-[#eff6ff] px-2.5 py-1.5 text-[11px] font-semibold text-[#1d4ed8]" onClick={(event)=>{event.stopPropagation();setOperationalAction({type:'fee',row})}}>Fee reminder</button><button type="button" className="rounded-[6px] border border-[#e2e8f0] px-2.5 py-1.5 text-[11px] font-semibold text-[#475569]" onClick={(event)=>{event.stopPropagation();setOperationalAction({type:'promise',row})}}>Promise</button></>:null}{section==='staff-attendance'?<button type="button" className="rounded-[6px] border border-[#bbf7d0] bg-[#f0fdf4] px-2.5 py-1.5 text-[11px] font-semibold text-[#166534]" onClick={(event)=>{event.stopPropagation();setOperationalAction({type:'attendance',row})}}>Record</button>:null}</div> })
        const clickable = rows.some((row: any) => row?.detail_path)
        return (
          <SectionCard
            key={`${tableItem.title || 'table'}-${index}`}
            title={tableItem.title || headerTitle}
            subtitle={rows.length ? tableItem.subtitle || `${rows.length} record${rows.length === 1 ? '' : 's'} loaded from school data` : tableItem.empty_state?.message || page?.empty_state?.message || 'No records are available yet.'}
          >
            <PortalTable
              columns={columns}
              rows={rows}
              onRowClick={clickable ? onRowClick : undefined}
              emptyMessage={tableItem.empty_state?.message || page?.empty_state?.message || 'No records are available yet.'}
            />
          </SectionCard>
        )
      })}
      <DirectorTaskModal open={taskOpen} onOpenChange={setTaskOpen} staff={staff} initial={taskInitial} onSubmit={createTask} />
      <OperationalActionModal open={Boolean(operationalAction)} onOpenChange={(open:boolean)=>!open&&setOperationalAction(null)} type={operationalAction?.type} row={operationalAction?.row} staff={staff} api={api} token={token} onDone={()=>loadPage()} />
    </div>
  )
}
