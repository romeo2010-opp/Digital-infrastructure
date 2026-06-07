import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  BellRing,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock3,
  Copy,
  Database,
  Download,
  FileDown,
  Filter,
  Fuel,
  Gauge,
  GripVertical,
  Layers3,
  MapPinned,
  PackagePlus,
  Palette,
  Pencil,
  Plus,
  RefreshCcw,
  RotateCcw,
  Save,
  Search,
  Share2,
  ShieldAlert,
  ShieldCheck,
  Table2,
  TrendingUp,
  Truck,
  Trash2,
  UserRound,
  Wifi,
} from 'lucide-react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { usePortal } from '../lib/portalContext'
import { portalApi } from '../lib/portalApi'
import { useDashboardChrome } from '../lib/dashboardChrome'
import { ModalShell } from '../components/ModalShell'
import { Button } from '../components/ui/button'
import { FieldControl, FieldLabel, FieldShell } from '../components/FieldLabel'
import { KpiDrilldownDrawer, renderDrilldownValue, type DrilldownConfig } from '../components/KpiDrilldown'
import { MeraFuelHeatmap } from '../components/MeraFuelHeatmap'
import { PortalTable } from '../components/PortalTable'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '../components/ui/drawer'
import {
  dateRangeFilters,
  districtFilters,
  productFilters,
  savedNationalViews,
  widgetLibrary,
  type DashboardWidget,
  type IncidentQueueItem,
  type StationRiskRow,
} from '../data/nationalOperationsMock'

const card = 'mera-glass-strong rounded-lg text-[#111827]'
const commandSurface = 'mera-glass-strong rounded-lg text-[#111827]'
const darkPanel = 'mera-glass-strong rounded-lg text-[#111827]'
const lightPanel = 'overflow-hidden rounded-lg border border-[#e2e8f0] bg-white'
const availabilityChartColors = ['#1D9E75', '#EF9F27', '#185FA5', '#E24B4A']

type NationalCommandFilterState = {
  search: string
  jurisdiction: string
  district: string
  product: string
  dateRange: string
  savedView: string
}

const availabilityIntervals = ['15m', '1h', '6h', '24h', '7d']
const builtinDashboardTabs = [
  { id: 'builtin-my-view', label: 'My View', kind: 'builtin' as const },
  { id: 'builtin-national-overview', label: 'National Overview', kind: 'builtin' as const },
  { id: 'builtin-tasks', label: 'Tasks', kind: 'builtin' as const },
  { id: 'builtin-my-tasks', label: 'My Tasks', kind: 'builtin' as const },
  { id: 'builtin-views', label: 'Views', kind: 'builtin' as const },
  { id: 'builtin-fuel-supply', label: 'Fuel Supply', kind: 'builtin' as const },
  { id: 'builtin-compliance-watch', label: 'Compliance Watch', kind: 'builtin' as const },
  { id: 'builtin-enforcement', label: 'Enforcement Watch', kind: 'builtin' as const },
]
const dashboardCustomViewsStorageKey = 'meraDashboardCustomViews.v1'
const dashboardPinnedTabsStorageKey = 'meraDashboardPinnedTabs.v1'
const maxCustomViews = 10
const maxBlocksPerView = 12

type DashboardBlockType =
  | 'kpi-summary'
  | 'supply-map'
  | 'reserve-table'
  | 'pipeline-list'
  | 'compliance-alerts'
  | 'consumption-chart'
  | 'price-variance'
  | 'station-risk-table'
  | 'compliance-matrix'

type DashboardBlockSize = 'small' | 'medium' | 'wide'
type DashboardBlockDisplay = 'metric' | 'line' | 'bar' | 'table' | 'map' | 'list'
type DashboardColorPreset = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'teal'
type DashboardScopeType = 'National' | 'Region' | 'District'

type DashboardViewBlock = {
  id: string
  type: DashboardBlockType
  title: string
  size: DashboardBlockSize
  displayMode: DashboardBlockDisplay
  colorPreset?: DashboardColorPreset
}

type DashboardHeaderButton = {
  id: string
  label: string
  path: string
  variant: 'primary' | 'secondary'
}

type DashboardCustomView = {
  id: string
  label: string
  subtitle?: string
  headerButtons?: DashboardHeaderButton[]
  scopeType: DashboardScopeType
  scopeValue: string
  product: string
  colorPreset: DashboardColorPreset
  blocks: DashboardViewBlock[]
  createdAt: string
  updatedAt: string
}

const colorPresets: Record<DashboardColorPreset, { label: string; accent: string; soft: string; text: string }> = {
  slate: { label: 'Slate', accent: '#111827', soft: '#f3f4f6', text: '#374151' },
  blue: { label: 'Blue', accent: '#2563eb', soft: '#eff6ff', text: '#1d4ed8' },
  green: { label: 'Green', accent: '#10b981', soft: '#ecfdf5', text: '#059669' },
  amber: { label: 'Amber', accent: '#f59e0b', soft: '#fffbeb', text: '#d97706' },
  red: { label: 'Red', accent: '#ef4444', soft: '#fef2f2', text: '#dc2626' },
  teal: { label: 'Teal', accent: '#0f766e', soft: '#f0fdfa', text: '#0f766e' },
}

const regionScopes = ['Northern Region', 'Central Region', 'Southern Region']
const blockLibrary: Array<{
  type: DashboardBlockType
  title: string
  description: string
  size: DashboardBlockSize
  displayMode: DashboardBlockDisplay
  modes: DashboardBlockDisplay[]
}> = [
  { type: 'kpi-summary', title: 'KPI Summary', description: 'Core operational metrics for the selected area.', size: 'wide', displayMode: 'metric', modes: ['metric'] },
  { type: 'supply-map', title: 'Supply Map', description: 'Regional posture and national supply status.', size: 'wide', displayMode: 'map', modes: ['map'] },
  { type: 'reserve-table', title: 'Reserve Table', description: 'Fuel reserve, burn/day, depletion, and variance.', size: 'medium', displayMode: 'table', modes: ['table'] },
  { type: 'pipeline-list', title: 'Pipeline List', description: 'In-transit supply movements and ETA posture.', size: 'medium', displayMode: 'list', modes: ['list', 'table'] },
  { type: 'compliance-alerts', title: 'Compliance Alerts', description: 'Critical and high-priority compliance issues.', size: 'medium', displayMode: 'list', modes: ['list', 'table'] },
  { type: 'consumption-chart', title: 'Consumption Chart', description: 'Seven-day fuel consumption and corridor status.', size: 'medium', displayMode: 'line', modes: ['line', 'bar'] },
  { type: 'price-variance', title: 'Price Variance', description: 'Pump price variance by region and product.', size: 'medium', displayMode: 'bar', modes: ['bar', 'table'] },
  { type: 'station-risk-table', title: 'Station Risk Table', description: 'Station-level risk, license, and price checks.', size: 'wide', displayMode: 'table', modes: ['table'] },
  { type: 'compliance-matrix', title: 'Compliance Matrix', description: 'Licensing, pricing, safety, and telemetry posture.', size: 'medium', displayMode: 'bar', modes: ['bar', 'table'] },
]
const availabilityExportRanges = [
  { value: 'today', label: 'Today', detail: '00:00 to export time' },
  { value: '15m', label: 'Last 15 minutes' },
  { value: '1h', label: 'Last 1 hour' },
  { value: '6h', label: 'Last 6 hours' },
  { value: '24h', label: 'Last 24 hours' },
  { value: '7d', label: 'Last 7 days' },
]
// The MERA API timestamps are already CAT-local clock values encoded as UTC.
const dashboardTimeZone = 'UTC'

function number(value: any, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function formatAxisNumber(value: any) {
  const parsed = number(value)
  if (Math.abs(parsed) >= 1000) return `${(parsed / 1000).toFixed(parsed >= 10000 ? 0 : 1)}k`
  return String(parsed)
}

function percentOf(value: any, total: any) {
  const denominator = number(total)
  if (denominator <= 0) return 0
  return Math.max(0, Math.min(100, (number(value) / denominator) * 100))
}

function averageNumber(values: any[]) {
  const safeValues = values.map((value) => number(value, Number.NaN)).filter((value) => Number.isFinite(value))
  if (!safeValues.length) return 0
  return safeValues.reduce((sum, value) => sum + value, 0) / safeValues.length
}

function createDashboardId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function defaultDashboardBlocks(): DashboardViewBlock[] {
  return [
    { id: createDashboardId('block'), type: 'kpi-summary', title: 'KPI Summary', size: 'wide', displayMode: 'metric', colorPreset: 'slate' },
    { id: createDashboardId('block'), type: 'supply-map', title: 'Supply Map', size: 'wide', displayMode: 'map', colorPreset: 'blue' },
    { id: createDashboardId('block'), type: 'compliance-alerts', title: 'Compliance Alerts', size: 'medium', displayMode: 'list', colorPreset: 'red' },
  ]
}

function normalizeDashboardBlock(input: any): DashboardViewBlock | null {
  const libraryItem = blockLibrary.find((item) => item.type === input?.type)
  if (!libraryItem) return null
  const size = ['small', 'medium', 'wide'].includes(input?.size) ? input.size : libraryItem.size
  const displayMode = libraryItem.modes.includes(input?.displayMode) ? input.displayMode : libraryItem.displayMode
  const colorPreset: DashboardColorPreset | undefined = Object.keys(colorPresets).includes(input?.colorPreset) ? input.colorPreset : undefined
  return {
    id: String(input?.id || createDashboardId('block')),
    type: libraryItem.type,
    title: String(input?.title || libraryItem.title),
    size,
    displayMode,
    colorPreset,
  }
}

function normalizeCustomView(input: any): DashboardCustomView | null {
  const label = String(input?.label || '').trim()
  if (!label) return null
  const scopeType: DashboardScopeType = ['National', 'Region', 'District'].includes(input?.scopeType) ? input.scopeType : 'National'
  const blocks = Array.isArray(input?.blocks)
    ? input.blocks.map(normalizeDashboardBlock).filter(Boolean).slice(0, maxBlocksPerView) as DashboardViewBlock[]
    : defaultDashboardBlocks()
  const colorPreset: DashboardColorPreset = Object.keys(colorPresets).includes(input?.colorPreset) ? input.colorPreset : 'slate'
  return {
    id: String(input?.id || createDashboardId('view')),
    label,
    scopeType,
    scopeValue: String(input?.scopeValue || (scopeType === 'National' ? 'National' : 'All Districts')),
    product: productFilters.includes(input?.product) ? input.product : 'All Products',
    colorPreset,
    blocks: blocks.length ? blocks : defaultDashboardBlocks(),
    createdAt: String(input?.createdAt || new Date().toISOString()),
    updatedAt: String(input?.updatedAt || new Date().toISOString()),
  }
}

function loadCustomViews() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(dashboardCustomViewsStorageKey) || '[]')
    return Array.isArray(parsed)
      ? parsed.map(normalizeCustomView).filter(Boolean).slice(0, maxCustomViews) as DashboardCustomView[]
      : []
  } catch {
    return []
  }
}

function saveCustomViews(views: DashboardCustomView[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(dashboardCustomViewsStorageKey, JSON.stringify(views.slice(0, maxCustomViews)))
}

function loadPinnedTabs() {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(window.localStorage.getItem(dashboardPinnedTabsStorageKey) || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}

function savePinnedTabs(ids: string[]) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(dashboardPinnedTabsStorageKey, JSON.stringify(ids))
}

function uniqueViewLabel(base: string, existingLabels: string[]) {
  const cleaned = base.trim() || 'Custom View'
  if (!existingLabels.some((label) => label.toLowerCase() === cleaned.toLowerCase())) return cleaned
  let index = 2
  while (existingLabels.some((label) => label.toLowerCase() === `${cleaned} ${index}`.toLowerCase())) {
    index += 1
  }
  return `${cleaned} ${index}`
}

function formatKpiDelta(current: number, previous: number, suffix = '', maximumFractionDigits = 0) {
  const delta = current - previous
  const sign = delta >= 0 ? '+' : '-'
  const formatted = Math.abs(delta).toLocaleString(undefined, {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits,
  })
  return `${sign}${formatted}${suffix}`
}

function comparisonPrevious(comparisons: any, key: string, fallback: number) {
  const value = Number(comparisons?.[key]?.previousValue)
  return Number.isFinite(value) ? value : fallback
}

function formatChartTimestamp(value: any) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: dashboardTimeZone,
  })
}

function formatOperationalDateTime(date: Date) {
  const currentYear = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    timeZone: dashboardTimeZone,
  })
  const itemYear = date.toLocaleDateString('en-US', {
    year: 'numeric',
    timeZone: dashboardTimeZone,
  })
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(itemYear !== currentYear ? { year: 'numeric' as const } : {}),
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: dashboardTimeZone,
  })
}

type PdfLogoImage = {
  data: Uint8Array
  width: number
  height: number
}

const pdfEncoder = new TextEncoder()

async function loadSmartlinkLogoDataUrl() {
  const response = await fetch('/smartlink-mark-tight.png')
  if (!response.ok) throw new Error('Smartlink logo could not be loaded.')
  const blob = await response.blob()
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function dataUrlToBytes(dataUrl: string) {
  const base64 = dataUrl.split(',')[1] || ''
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Image could not be loaded.'))
    image.src = src
  })
}

async function loadSmartlinkLogoPdfImage(): Promise<PdfLogoImage> {
  const dataUrl = await loadSmartlinkLogoDataUrl()
  const image = await loadImage(dataUrl)
  const naturalWidth = image.naturalWidth || 160
  const naturalHeight = image.naturalHeight || 160
  const scale = Math.min(1, 260 / Math.max(naturalWidth, naturalHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(naturalWidth * scale))
  canvas.height = Math.max(1, Math.round(naturalHeight * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('PDF logo canvas is unavailable.')
  context.fillStyle = 'rgb(255,255,255)'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92)
  return {
    data: dataUrlToBytes(jpegDataUrl),
    width: canvas.width,
    height: canvas.height,
  }
}

function pdfNumber(value: number) {
  const formatted = value.toFixed(2).replace(/\.?0+$/, '')
  return formatted && formatted !== '-' ? formatted : '0'
}

function hexToPdfColor(hex: string) {
  const rgbMatch = hex.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/i)
  if (rgbMatch) {
    const [, red, green, blue] = rgbMatch
    return [red, green, blue].map((value) => pdfNumber(Number(value) / 255)).join(' ')
  }

  const normalized = hex.replace('#', '')
  const expanded = normalized.length === 3
    ? normalized.split('').map((part) => `${part}${part}`).join('')
    : normalized
  const value = Number.parseInt(expanded || '000000', 16)
  const red = ((value >> 16) & 255) / 255
  const green = ((value >> 8) & 255) / 255
  const blue = (value & 255) / 255
  return `${pdfNumber(red)} ${pdfNumber(green)} ${pdfNumber(blue)}`
}

function pdfFill(hex: string) {
  return `${hexToPdfColor(hex)} rg`
}

function pdfStroke(hex: string) {
  return `${hexToPdfColor(hex)} RG`
}

function pdfText(value: any) {
  return String(value ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapePdfString(value: any) {
  return pdfText(value)
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
}

function concatBytes(chunks: Uint8Array[]) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  chunks.forEach((chunk) => {
    output.set(chunk, offset)
    offset += chunk.length
  })
  return output
}

function createPdfDocument({
  width,
  height,
  content,
  logoImage,
}: {
  width: number
  height: number
  content: string
  logoImage: PdfLogoImage | null
}) {
  const imageObjectId = logoImage ? 6 : null
  const contentObjectId = logoImage ? 7 : 6
  const resources = `<< /Font << /F1 4 0 R /F2 5 0 R >>${imageObjectId ? ` /XObject << /Im1 ${imageObjectId} 0 R >>` : ''} >>`
  const contentBytes = pdfEncoder.encode(content)
  const objects: Array<Array<string | Uint8Array>> = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfNumber(width)} ${pdfNumber(height)}] /Resources ${resources} /Contents ${contentObjectId} 0 R >>`],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'],
    ['<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'],
  ]

  if (logoImage) {
    objects.push([
      `<< /Type /XObject /Subtype /Image /Width ${logoImage.width} /Height ${logoImage.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoImage.data.length} >>\nstream\n`,
      logoImage.data,
      '\nendstream',
    ])
  }

  objects.push([
    `<< /Length ${contentBytes.length} >>\nstream\n`,
    contentBytes,
    '\nendstream',
  ])

  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === 'string' ? pdfEncoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }

  push('%PDF-1.4\n')
  objects.forEach((object, index) => {
    offsets.push(length)
    push(`${index + 1} 0 obj\n`)
    object.forEach(push)
    push('\nendobj\n')
  })

  const xrefOffset = length
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`)
  offsets.forEach((offset) => {
    push(`${String(offset).padStart(10, '0')} 00000 n \n`)
  })
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`)

  return concatBytes(chunks)
}

function formatExportDateTime(date: Date) {
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatExportClock(date: Date) {
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

function getAvailabilityExportRangeLabel(rangeValue: string, exportedAt: Date) {
  if (rangeValue === 'today') {
    const start = new Date(exportedAt)
    start.setHours(0, 0, 0, 0)
    return `Today (${formatExportClock(start)} - ${formatExportClock(exportedAt)})`
  }

  return availabilityExportRanges.find((range) => range.value === rangeValue)?.label || rangeValue
}

function buildAvailabilityExportPdf({
  rows,
  rangeLabel,
  generatedAt,
  logoImage,
}: {
  rows: any[]
  rangeLabel: string
  generatedAt: Date
  logoImage: PdfLogoImage | null
}) {
  const width = 842
  const height = 595
  const safeRows = rows.length ? rows : [{ label: 'Now', stationsWithFuel: 0, deliveryVerifiedStationsWithFuel: 0, totalStations: 0 }]
  const latest = safeRows[safeRows.length - 1] || {}
  const generatedLabel = formatExportDateTime(generatedAt)
  const totalStations = Math.max(1, number(latest.totalStations, Math.max(...safeRows.map((row) => number(row.totalStations)), 1)))
  const availabilityPct = (row: any) => totalStations > 0 ? Math.max(0, Math.min(100, (number(row.stationsWithFuel) / Math.max(1, number(row.totalStations, totalStations))) * 100)) : 0
  const verifiedPct = (row: any) => totalStations > 0 ? Math.max(0, Math.min(100, (number(row.deliveryVerifiedStationsWithFuel) / Math.max(1, number(row.totalStations, totalStations))) * 100)) : 0
  const latestAvailabilityPct = availabilityPct(latest)
  const latestVerifiedPct = verifiedPct(latest)
  const availabilityGap = Math.max(0, totalStations - number(latest.stationsWithFuel))
  const minAvailabilityPct = Math.min(...safeRows.map(availabilityPct))
  const avgAvailabilityPct = safeRows.reduce((sum, row) => sum + availabilityPct(row), 0) / Math.max(1, safeRows.length)
  const statusLabel = latestAvailabilityPct >= 90 ? 'Stable National Coverage' : latestAvailabilityPct >= 75 ? 'Watch Coverage' : 'Critical Coverage'
  const statusColor = latestAvailabilityPct >= 90 ? '#1D9E75' : latestAvailabilityPct >= 75 ? '#EF9F27' : '#E24B4A'
  const plot = { left: 74, top: 228, right: 48, bottom: 178 }
  const plotWidth = width - plot.left - plot.right
  const plotHeight = height - plot.top - plot.bottom
  const xFor = (index: number) => plot.left + (safeRows.length === 1 ? plotWidth : (index / (safeRows.length - 1)) * plotWidth)
  const yForPct = (value: number) => plot.top + plotHeight - (Math.max(0, Math.min(100, value)) / 100) * plotHeight
  const fuelPoints = safeRows.map((row, index) => ({ x: xFor(index), y: yForPct(availabilityPct(row)) }))
  const verifiedPoints = safeRows.map((row, index) => ({ x: xFor(index), y: yForPct(verifiedPct(row)) }))
  const yTicks = [0, 25, 50, 75, 90, 100]
  const xStep = Math.max(1, Math.ceil(safeRows.length / 8))
  const xTicks = safeRows
    .map((row, index) => ({ row, index }))
    .filter(({ index }) => index === 0 || index === safeRows.length - 1 || index % xStep === 0)
  const tableRows = safeRows.slice(-8)
  const commands: string[] = []
  const pdfY = (y: number) => height - y
  const addRect = (x: number, y: number, rectWidth: number, rectHeight: number, fill: string, stroke?: string, strokeWidth = 1) => {
    commands.push(`q ${pdfFill(fill)} ${stroke ? pdfStroke(stroke) : ''} ${strokeWidth} w ${pdfNumber(x)} ${pdfNumber(pdfY(y + rectHeight))} ${pdfNumber(rectWidth)} ${pdfNumber(rectHeight)} re ${stroke ? 'B' : 'f'} Q`)
  }
  const addLine = (x1: number, y1: number, x2: number, y2: number, stroke: string, strokeWidth = 1, dash = '') => {
    commands.push(`q ${pdfStroke(stroke)} ${pdfNumber(strokeWidth)} w ${dash} ${pdfNumber(x1)} ${pdfNumber(pdfY(y1))} m ${pdfNumber(x2)} ${pdfNumber(pdfY(y2))} l S Q`)
  }
  const addText = (text: any, x: number, y: number, size: number, color = 'rgb(5,5,5)', font = 'F1', align: 'left' | 'center' | 'right' = 'left') => {
    const value = pdfText(text) || ' '
    const widthEstimate = value.length * size * (font === 'F2' ? 0.58 : 0.52)
    const tx = align === 'center' ? x - widthEstimate / 2 : align === 'right' ? x - widthEstimate : x
    commands.push(`q ${pdfFill(color)} BT /${font} ${pdfNumber(size)} Tf ${pdfNumber(tx)} ${pdfNumber(pdfY(y))} Td (${escapePdfString(value)}) Tj ET Q`)
  }
  const addPolyline = (points: Array<{ x: number; y: number }>, stroke: string, strokeWidth: number, dash = '') => {
    if (points.length < 2) return
    commands.push(`q ${pdfStroke(stroke)} ${pdfNumber(strokeWidth)} w ${dash} ${pdfNumber(points[0].x)} ${pdfNumber(pdfY(points[0].y))} m ${points.slice(1).map((point) => `${pdfNumber(point.x)} ${pdfNumber(pdfY(point.y))} l`).join(' ')} S Q`)
  }
  const addFilledSeries = (points: Array<{ x: number; y: number }>, baselineY: number, fill: string) => {
    if (points.length < 2) return
    const path = [
      `${pdfNumber(points[0].x)} ${pdfNumber(pdfY(baselineY))} m`,
      ...points.map((point) => `${pdfNumber(point.x)} ${pdfNumber(pdfY(point.y))} l`),
      `${pdfNumber(points[points.length - 1].x)} ${pdfNumber(pdfY(baselineY))} l`,
      'h',
    ].join(' ')
    commands.push(`q ${pdfFill(fill)} ${path} f Q`)
  }
  const addCircle = (x: number, y: number, radius: number, fill: string, stroke?: string, strokeWidth = 1) => {
    const cy = pdfY(y)
    const c = radius * 0.552284749831
    commands.push(`q ${pdfFill(fill)} ${stroke ? pdfStroke(stroke) : ''} ${pdfNumber(strokeWidth)} w ${pdfNumber(x + radius)} ${pdfNumber(cy)} m ${pdfNumber(x + radius)} ${pdfNumber(cy + c)} ${pdfNumber(x + c)} ${pdfNumber(cy + radius)} ${pdfNumber(x)} ${pdfNumber(cy + radius)} c ${pdfNumber(x - c)} ${pdfNumber(cy + radius)} ${pdfNumber(x - radius)} ${pdfNumber(cy + c)} ${pdfNumber(x - radius)} ${pdfNumber(cy)} c ${pdfNumber(x - radius)} ${pdfNumber(cy - c)} ${pdfNumber(x - c)} ${pdfNumber(cy - radius)} ${pdfNumber(x)} ${pdfNumber(cy - radius)} c ${pdfNumber(x + c)} ${pdfNumber(cy - radius)} ${pdfNumber(x + radius)} ${pdfNumber(cy - c)} ${pdfNumber(x + radius)} ${pdfNumber(cy)} c ${stroke ? 'B' : 'f'} Q`)
  }
  const addMetricCard = (x: number, y: number, cardWidth: number, label: string, value: string, detail: string, accent: string) => {
    addRect(x, y, cardWidth, 58, 'rgb(255,255,255)', 'rgb(215,221,229)', 0.8)
    addRect(x, y, 4, 58, accent)
    addText(label.toUpperCase(), x + 15, y + 17, 7.6, 'rgb(101,112,128)', 'F2')
    addText(value, x + 15, y + 40, 18, 'rgb(17,24,39)', 'F2')
    addText(detail, x + cardWidth - 12, y + 39, 8.2, 'rgb(101,112,128)', 'F1', 'right')
  }

  addRect(0, 0, width, height, 'rgb(238,243,247)')
  addRect(22, 22, width - 44, height - 44, 'rgb(255,255,255)', 'rgb(200,210,220)', 1)
  addRect(22, 22, width - 44, 92, 'rgb(16,32,51)')
  addRect(22, 112, width - 44, 3, statusColor)

  const logoX = 48
  const logoY = 44
  if (logoImage) {
    commands.push(`q 34 0 0 34 ${pdfNumber(logoX)} ${pdfNumber(pdfY(logoY + 34))} cm /Im1 Do Q`)
  } else {
    addRect(logoX, logoY, 34, 34, 'rgb(255,255,255)')
    addText('S', logoX + 11, logoY + 23, 16, 'rgb(16,32,51)', 'F2')
  }
  addText('MERA NATIONAL FUEL INFRASTRUCTURE', logoX + 46, 49, 17, 'rgb(255,255,255)', 'F2')
  addText('Availability and Delivery Verification Command Export', logoX + 46, 70, 9.2, 'rgb(185,198,212)')
  addText(`Coverage Window: ${rangeLabel}`, logoX + 46, 91, 9.2, 'rgb(220,229,239)', 'F2')
  addRect(width - 212, 43, 164, 30, 'rgb(24,44,67)', 'rgb(51,80,109)', 0.8)
  addText('NATIONAL LEVEL', width - 130, 62, 9, 'rgb(255,255,255)', 'F2', 'center')
  addText(`Generated ${generatedLabel}`, width - 48, 92, 8.4, 'rgb(185,198,212)', 'F1', 'right')

  addMetricCard(48, 136, 174, 'Network Availability', `${latestAvailabilityPct.toFixed(1)}%`, `${number(latest.stationsWithFuel).toLocaleString()} / ${totalStations.toLocaleString()} stations`, '#1D9E75')
  addMetricCard(236, 136, 174, 'Delivery Verified', `${latestVerifiedPct.toFixed(1)}%`, `${number(latest.deliveryVerifiedStationsWithFuel).toLocaleString()} verified`, '#185FA5')
  addMetricCard(424, 136, 174, 'Availability Floor', `${minAvailabilityPct.toFixed(1)}%`, `avg ${avgAvailabilityPct.toFixed(1)}%`, 'rgb(100,116,139)')
  addMetricCard(612, 136, 182, 'Operational Gap', availabilityGap.toLocaleString(), statusLabel, statusColor)

  addText('National Availability Corridor', 48, 214, 13.5, 'rgb(17,24,39)', 'F2')
  addText('Stations carrying fuel as a share of the active national network. Threshold bands are regulator operating bands.', 48, 230, 8.2, 'rgb(100,116,139)')
  addRect(plot.left, plot.top, plotWidth, plotHeight, 'rgb(251,253,255)', 'rgb(212,221,231)', 0.9)
  addRect(plot.left, yForPct(100), plotWidth, yForPct(90) - yForPct(100), 'rgb(237,249,241)')
  addRect(plot.left, yForPct(90), plotWidth, yForPct(75) - yForPct(90), 'rgb(255,248,223)')
  addRect(plot.left, yForPct(75), plotWidth, yForPct(0) - yForPct(75), 'rgb(255,241,240)')
  addText('Stable', plot.left + plotWidth - 10, yForPct(96), 7.2, '#1D9E75', 'F2', 'right')
  addText('Watch', plot.left + plotWidth - 10, yForPct(84), 7.2, '#EF9F27', 'F2', 'right')
  addText('Critical', plot.left + plotWidth - 10, yForPct(52), 7.2, '#E24B4A', 'F2', 'right')

  yTicks.forEach((tick) => {
    const y = yForPct(tick)
    addLine(plot.left, y, plot.left + plotWidth, y, tick === 75 || tick === 90 ? 'rgb(185,196,207)' : 'rgb(226,232,240)', tick === 75 || tick === 90 ? 0.95 : 0.55, tick === 75 || tick === 90 ? '[4 3] 0 d' : '')
    addText(`${tick}%`, plot.left - 13, y + 3, 8, 'rgb(102,112,133)', 'F1', 'right')
  })
  xTicks.forEach(({ row, index }) => {
    const x = xFor(index)
    addLine(x, plot.top, x, plot.top + plotHeight, 'rgb(238,242,247)', 0.4)
    addText(row.label, x, plot.top + plotHeight + 18, 7.5, 'rgb(102,112,133)', 'F1', 'center')
  })

  addFilledSeries(fuelPoints, plot.top + plotHeight, 'rgb(200,244,214)')
  addPolyline(fuelPoints, '#1D9E75', 2.8)
  addPolyline(verifiedPoints, '#185FA5', 2.2)
  if (fuelPoints.length <= 72) fuelPoints.forEach((point) => addCircle(point.x, point.y, 2.7, 'rgb(255,255,255)', '#1D9E75', 1.2))
  if (verifiedPoints.length <= 72) verifiedPoints.forEach((point) => addCircle(point.x, point.y, 2.2, 'rgb(255,255,255)', '#185FA5', 1.1))

  const legendY = 432
  addRect(48, legendY, 252, 34, 'rgb(255,255,255)', 'rgb(215,221,229)', 0.8)
  addCircle(66, legendY + 17, 4, '#1D9E75')
  addText('National availability', 80, legendY + 21, 8.8, 'rgb(17,24,39)', 'F2')
  addText('stations carrying fuel / active network', 184, legendY + 21, 7.4, 'rgb(102,112,133)')
  addRect(312, legendY, 216, 34, 'rgb(255,255,255)', 'rgb(215,221,229)', 0.8)
  addCircle(330, legendY + 17, 4, '#185FA5')
  addText('Delivery verified', 344, legendY + 21, 8.8, 'rgb(17,24,39)', 'F2')
  addText('recent delivery evidence', 432, legendY + 21, 7.4, 'rgb(102,112,133)')
  addRect(540, legendY, 254, 34, 'rgb(255,255,255)', 'rgb(215,221,229)', 0.8)
  addText('Thresholds', 558, legendY + 21, 8.8, 'rgb(17,24,39)', 'F2')
  addText('90% stable | 75% watch | below 75% critical', 620, legendY + 21, 7.4, 'rgb(102,112,133)')

  const tableX = 48
  const tableY = 476
  const rowHeight = 7.8
  addText('Recent National Data Points', tableX, tableY - 10, 9.6, 'rgb(17,24,39)', 'F2')
  addRect(tableX, tableY, width - 96, 18 + tableRows.length * rowHeight, 'rgb(255,255,255)', 'rgb(215,221,229)', 0.8)
  addRect(tableX, tableY, width - 96, 18, 'rgb(241,245,249)')
  const columns = [
    { label: 'Time', x: tableX + 14, align: 'left' as const },
    { label: 'Available', x: tableX + 190, align: 'right' as const },
    { label: 'Availability %', x: tableX + 312, align: 'right' as const },
    { label: 'Verified', x: tableX + 452, align: 'right' as const },
    { label: 'Verified %', x: tableX + 574, align: 'right' as const },
    { label: 'Active Network', x: tableX + 720, align: 'right' as const },
  ]
  columns.forEach((column) => addText(column.label, column.x, tableY + 12, 7.2, 'rgb(71,84,103)', 'F2', column.align))
  tableRows.forEach((row, index) => {
    const y = tableY + 28 + index * rowHeight
    if (index % 2 === 0) addRect(tableX + 1, y - 7, width - 98, rowHeight, 'rgb(251,253,255)')
    addText(row.label, tableX + 14, y, 7.2, 'rgb(31,41,55)')
    addText(number(row.stationsWithFuel).toLocaleString(), tableX + 190, y, 7.2, 'rgb(31,41,55)', 'F1', 'right')
    addText(`${availabilityPct(row).toFixed(1)}%`, tableX + 312, y, 7.2, '#1D9E75', 'F2', 'right')
    addText(number(row.deliveryVerifiedStationsWithFuel).toLocaleString(), tableX + 452, y, 7.2, 'rgb(31,41,55)', 'F1', 'right')
    addText(`${verifiedPct(row).toFixed(1)}%`, tableX + 574, y, 7.2, '#185FA5', 'F2', 'right')
    addText(number(row.totalStations, totalStations).toLocaleString(), tableX + 720, y, 7.2, 'rgb(31,41,55)', 'F1', 'right')
  })

  addLine(48, height - 34, width - 48, height - 34, 'rgb(207,216,227)', 0.8)
  addText('Smartlink MERA Portal | National operations export | Inventory-derived availability and delivery verification series.', 48, height - 18, 7.6, 'rgb(102,112,133)')
  addText('For operational oversight and infrastructure planning use.', width - 48, height - 18, 7.6, 'rgb(102,112,133)', 'F1', 'right')

  return createPdfDocument({
    width,
    height,
    content: commands.join('\n'),
    logoImage,
  })
}

function downloadBinaryFile(filename: string, content: Uint8Array, type: string) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function timeAgo(value: any) {
  if (!value) return 'now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'now'
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000))
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  return formatOperationalDateTime(date)
}

function Sparkline({ data = [], color }: { data?: number[]; color: string }) {
  const values = data.length ? data : [2, 4, 3, 6, 5, 8, 7]
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const range = Math.max(1, max - min)
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * 132
      const y = 38 - ((value - min) / range) * 30
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg viewBox="0 0 132 42" className="h-full w-full" aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function PanelHeader({ title, action = 'View all' }: { title: string; action?: string }) {
  return (
    <div className="mb-3 flex h-5 items-center justify-between">
      <h2 className="text-[14px] font-medium uppercase tracking-[0] text-[#111827]">{title}</h2>
      <button type="button" className="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-[#2563eb] transition duration-150 hover:bg-[#f9fafb] hover:text-[#111827]">{action}</button>
    </div>
  )
}

function FuelAvailabilityOverview({
  pieRows,
  historyRows = [],
  selectedInterval = '1h',
  onIntervalChange,
  mode = 'donut',
  loading,
  className = '',
}: {
  pieRows: any[]
  historyRows?: any[]
  selectedInterval?: string
  onIntervalChange?: (interval: string) => void
  mode?: 'donut' | 'history'
  loading?: boolean
  className?: string
}) {
  const { token } = usePortal()
  const rawChartRows = historyRows.length ? historyRows : [{ label: 'Now', stationsWithFuel: 0, deliveryVerifiedStationsWithFuel: 0, totalStations: 0 }]
  const chartRows = useMemo(() => rawChartRows.map((row) => ({
    ...row,
    availabilityPercent: percentOf(row.stationsWithFuel, row.totalStations),
    deliveryVerifiedPercent: percentOf(row.deliveryVerifiedStationsWithFuel, row.totalStations),
  })), [rawChartRows])
  const latest = chartRows[chartRows.length - 1] || {}
  const [exportOpen, setExportOpen] = useState(false)
  const [exportRange, setExportRange] = useState(selectedInterval)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    if (!exportOpen) setExportRange(selectedInterval)
  }, [exportOpen, selectedInterval])

  const exportGraph = async () => {
    if (!token) return
    setExporting(true)
    setExportError('')
    const exportedAt = new Date()
    try {
      const [payload, logoImage] = await Promise.all([
        portalApi.getNationalOperationsDashboard(token, exportRange),
        loadSmartlinkLogoPdfImage().catch(() => null),
      ])
      const rows = payload?.fuelAvailabilityHistory?.points || []
      const rangeLabel = getAvailabilityExportRangeLabel(exportRange, exportedAt)
      const pdf = buildAvailabilityExportPdf({
        rows,
        rangeLabel,
        generatedAt: exportedAt,
        logoImage,
      })
      const stamp = exportedAt.toISOString().slice(0, 16).replace(/[-:T]/g, '')
      downloadBinaryFile(`smartlink-fuel-availability-${exportRange}-${stamp}.pdf`, pdf, 'application/pdf')
      setExportOpen(false)
    } catch (error: any) {
      setExportError(error?.message || 'Unable to export the graph as a PDF.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className={`${card} ${mode === 'history' ? 'min-h-[292px]' : 'h-[228px] overflow-hidden'} p-4 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-[14px] font-medium uppercase tracking-[0] text-[#111827]">Fuel Availability Overview</h2>
          <div className="mt-1 truncate text-[12px] text-[#6b7280]">
            {mode === 'history' ? 'National availability percentage against time' : 'By fuel type'}
          </div>
        </div>
        {mode === 'history' ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            <div className="flex max-w-full shrink-0 overflow-x-auto rounded-md border border-[#e2e8f0] bg-white p-0.5">
              {availabilityIntervals.map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => onIntervalChange?.(interval)}
                  className={`h-6 rounded-md px-2 text-[10px] font-medium transition ${
                    selectedInterval === interval ? 'bg-[#111827] text-white' : 'text-[#6b7280] hover:text-[#111827]'
                  }`}
                >
                  {interval}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[#e2e8f0] bg-white px-2.5 text-[11px] font-medium text-[#111827] transition hover:bg-[#f9fafb]"
              onClick={() => setExportOpen(true)}
            >
              <Download className="size-3.5" />
              Export
            </button>
          </div>
        ) : null}
      </div>
      {mode === 'history' ? (
        <>
          <div className="mt-3 flex min-w-0 items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[26px] font-medium leading-none tracking-[0] text-[#111827]">
                {number(latest.stationsWithFuel).toLocaleString()}
              </div>
              <div className="mt-1 truncate text-[11px] text-[#6b7280]">
                of {number(latest.totalStations).toLocaleString()} stations currently carrying fuel
              </div>
              <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-[#6b7280]">
                <span className="h-px w-5 bg-accent-primary" />
                {number(latest.deliveryVerifiedStationsWithFuel).toLocaleString()} delivery-verified
              </div>
            </div>
            {loading ? <div className="text-[11px] font-medium text-[#2563eb]">Updating</div> : null}
          </div>
          <div className="mt-3 h-[176px] min-h-[176px] min-w-0 overflow-visible pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartRows} margin={{ top: 10, right: 14, bottom: 8, left: 2 }}>
                <defs>
                  <linearGradient id="availabilityFuelFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor={'#1D9E75'} stopOpacity={0.28} />
                    <stop offset="78%" stopColor={'#1D9E75'} stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--mera-chart-grid)" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fill: 'var(--mera-chart-axis)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  height={22}
                  interval="preserveStartEnd"
                  minTickGap={24}
                  tickMargin={6}
                />
                <YAxis
                  tick={{ fill: 'var(--mera-chart-axis)', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={44}
                  tickMargin={6}
                  tickFormatter={(value) => `${formatAxisNumber(value)}%`}
                  allowDecimals={false}
                  domain={[0, 100]}
                />
                <Tooltip
                  wrapperStyle={{ zIndex: 20 }}
                  contentStyle={{ background: 'var(--mera-chart-tooltip-bg)', border: '1px solid var(--mera-chart-tooltip-border)', borderRadius: 8, color: 'var(--mera-chart-tooltip-text)' }}
                  labelFormatter={(_label, payload: any[]) => formatChartTimestamp(payload?.[0]?.payload?.timestamp) || _label}
                  formatter={(value: any, name: any, item: any) => {
                    const row = item?.payload || {}
                    const pct = `${number(value).toFixed(1)}%`
                    if (name === 'availabilityPercent') {
                      return [`${pct} (${number(row.stationsWithFuel).toLocaleString()} of ${number(row.totalStations).toLocaleString()} stations)`, 'Availability']
                    }
                    if (name === 'deliveryVerifiedPercent') {
                      return [`${pct} (${number(row.deliveryVerifiedStationsWithFuel).toLocaleString()} verified)`, 'Delivery verified']
                    }
                    return [value, name]
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="availabilityPercent"
                  stroke={'#1D9E75'}
                  strokeWidth={2.4}
                  fill="url(#availabilityFuelFill)"
                  dot={{ r: 2.4, strokeWidth: 1.4, fill: 'var(--mera-chart-tooltip-bg)', stroke: '#1D9E75' }}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="deliveryVerifiedPercent"
                  stroke={'#185FA5'}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3.5 }}
                  connectNulls
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      ) : (
      <div className="mt-1 flex items-center gap-4">
        <div className="h-[154px] w-[154px]">
          <ResponsiveContainer>
            <PieChart>
              <Pie data={pieRows} innerRadius={42} outerRadius={68} paddingAngle={1} dataKey="value">
                {availabilityChartColors.map((color) => <Cell key={color} fill={color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {pieRows.map((row: any, index: number) => (
            <div key={row.name} className="flex items-start gap-2 text-[12px]">
              <span className="mt-1 size-2 rounded-full" style={{ background: availabilityChartColors[index] }} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2 text-[#111827]">
                  <span className="truncate">{row.name}</span>
                  <span>{row.percent}%</span>
                </div>
                <div className="text-[10px] text-[#6b7280]">({row.value} stations)</div>
              </div>
            </div>
          ))}
        </div>
      </div>
      )}
      {mode === 'history' ? (
        <ModalShell
          open={exportOpen}
          onOpenChange={setExportOpen}
          title="Export Fuel Availability Graph"
          description="Choose the range to include in the exported Smartlink PDF."
          className="border-[#e2e8f0] bg-white"
          footer={
            <>
              <Button type="button" variant="outline" onClick={() => setExportOpen(false)} disabled={exporting}>
                Cancel
              </Button>
              <Button type="button" onClick={exportGraph} disabled={exporting || !token}>
                <Download className="size-4" />
                {exporting ? 'Exporting' : 'Export PDF'}
              </Button>
            </>
          }
        >
          <div className="grid gap-3">
            <label className="text-sm font-medium text-[#111827]">Range</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {availabilityExportRanges.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  onClick={() => setExportRange(range.value)}
                  className={`rounded-md border px-3 py-3 text-left text-sm font-medium transition ${
                    exportRange === range.value
                      ? 'border-[var(--mera-panel-text)] bg-[var(--mera-shell-active)] text-[var(--mera-brand)]'
                      : 'border-[#e2e8f0] bg-white text-[#111827] hover:bg-[#f9fafb]'
                  }`}
                >
                  <span className="block">{range.label}</span>
                  {'detail' in range ? <span className="mt-1 block text-xs font-medium text-[#6b7280]">{range.detail}</span> : null}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-3">
              <img src="/smartlink-mark-tight.png" alt="" className="size-9 object-contain" />
              <div>
                <div className="text-sm font-medium text-[#111827]">Smartlink footer included</div>
                <div className="text-xs text-[#6b7280]">Every PDF export includes the Smartlink logo and footer.</div>
              </div>
            </div>
            {exportError ? <div className="rounded-md border border-[#e2e8f0] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">{exportError}</div> : null}
          </div>
        </ModalShell>
      ) : null}
    </section>
  )
}

function severityMeta(severity: string) {
  const key = String(severity || '').toLowerCase()
  if (key === 'critical') return { label: 'Critical', color: '#E24B4A', bg: 'rgba(255,52,52,0.12)' }
  if (key === 'high') return { label: 'High', color: '#EF9F27', bg: 'rgba(255,153,31,0.14)' }
  if (key === 'medium' || key === 'warning') return { label: 'Watch', color: '#EF9F27', bg: 'rgba(255,210,31,0.14)' }
  return { label: 'Info', color: '#185FA5', bg: 'rgba(46,157,255,0.12)' }
}

function formatSla(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

function SelectControl({
  label,
  value,
  options,
  onChange,
  icon: Icon,
}: {
  label: string
  value: string
  options: string[]
  onChange: (value: string) => void
  icon: any
}) {
  return (
    <label className="relative h-10 min-w-[148px] shrink-0 rounded-md border border-white/10 bg-white/[0.045] px-3 py-1.5 text-left text-white transition hover:bg-white/[0.075]">
      <span className="flex items-center gap-1.5 text-[9px] font-medium uppercase tracking-[0.11em] text-[#6b7280]">
        <Icon className="size-3" />
        <FieldLabel label={label} hint={`Choose the ${label.toLowerCase()} used by the command centre view. Example: switch this control before comparing national dashboard data.`} className="mb-0 text-[9px] text-[#9ca3af]" />
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-5 w-full appearance-none bg-transparent pr-5 text-[12px] font-medium leading-none text-white outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#111827] text-white">
            {option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute bottom-2.5 right-2.5 size-3.5 text-[#6b7280]" />
    </label>
  )
}

function NationalCommandBar({
  filters,
  onFiltersChange,
  onOpenWidgets,
  onOpenExport,
  onRefresh,
  loading,
  lastSync,
}: {
  filters: NationalCommandFilterState
  onFiltersChange: (next: NationalCommandFilterState) => void
  onOpenWidgets: () => void
  onOpenExport: () => void
  onRefresh: () => void
  loading?: boolean
  lastSync?: string
}) {
  const updateFilter = (key: keyof NationalCommandFilterState, value: string) => {
    onFiltersChange({ ...filters, [key]: value })
  }
  const tabs = ['My View', 'National Overview', 'Tasks', 'My Tasks', 'Views', 'Fuel Supply', 'Compliance Watch', 'Enforcement Watch']

  return (
    <section className="flex min-h-12 flex-wrap items-center gap-2 rounded-md border border-[#e2e8f0] bg-white px-3 py-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
        {tabs.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => updateFilter('savedView', view)}
            className={`flex h-8 min-w-0 items-center rounded-md border px-3 text-[13px] transition ${
              filters.savedView === view
                ? 'border-[#e2e8f0] bg-[#111827] font-medium text-white'
                : 'border-transparent text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'
            }`}
          >
            <span className="truncate">{view}</span>
          </button>
        ))}
        <button type="button" onClick={onOpenWidgets} className="flex h-8 items-center gap-1 rounded-md border border-transparent px-3 text-[13px] font-medium text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]">
          <Plus className="size-4" />
          New View
        </button>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="hidden items-center gap-1 text-[12px] font-medium text-[#6b7280] lg:inline-flex">
          <span className={`size-1.5 rounded-full ${loading ? 'animate-pulse bg-[#fffbeb]' : 'bg-[#ecfdf5]'}`} />
          {lastSync ? `Last sync ${timeAgo(lastSync)}` : 'Sync pending'}
        </span>
        <button type="button" onClick={onRefresh} className="grid size-8 place-items-center rounded-md border border-[#e2e8f0] bg-white text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]" aria-label="Refresh national operations">
          <RefreshCcw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button type="button" onClick={onOpenExport} className="grid size-8 place-items-center rounded-md border border-[#e2e8f0] bg-white text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]" aria-label="Export national operations">
          <FileDown className="size-4" />
        </button>
        <button type="button" onClick={onOpenWidgets} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#111827] px-3 text-[12px] font-medium text-white transition hover:bg-[#111827]">
          Add Widget
          <ChevronDown className="size-4" />
        </button>
      </div>
    </section>
  )
}

function NationalKpiCard({ label, value, delta, deltaTone = 'neutral', accent, sparkline, onClick }: any) {
  const deltaClass =
    deltaTone === 'good'
      ? 'bg-[#ecfdf5] text-[#059669]'
      : deltaTone === 'bad'
        ? 'bg-[#fef2f2] text-[#dc2626]'
        : 'bg-[#f9fafb] text-[#6b7280]'

  const className = `group relative min-h-[132px] overflow-hidden rounded-md border border-[#e2e8f0] bg-white px-4 py-4 text-left ${
    onClick ? 'transition hover:-translate-y-0.5 hover:border-[#e2e8f0] hover:shadow-sm focus:outline-none focus:ring focus:ring' : ''
  }`
  const content = (
    <>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium uppercase tracking-[0.09em] text-[#6b7280]">{label}</div>
        <div className="mt-3 truncate text-[30px] font-medium leading-none tracking-normal text-[#111827]">{value}</div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`rounded-md px-2 py-1 text-[12px] font-medium leading-none ${deltaClass}`}>{delta}</span>
          <span className="text-[12px] font-medium text-[#6b7280]">vs yesterday</span>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 h-8 w-[82px] opacity-40">
        <Sparkline data={sparkline} color={accent} />
      </div>
      {onClick ? <ArrowUpRight className="absolute right-3 top-3 size-4 text-[#6b7280] transition group-hover:text-[#111827]" /> : null}
    </>
  )

  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={className}
    >
      {content}
    </button>
  ) : (
    <article className={className}>{content}</article>
  )
}

function LightPanelHeader({
  icon: Icon,
  title,
  meta,
  children,
}: {
  icon: any
  title: string
  meta?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-[#2563eb]" />
        <h2 className="truncate text-[13px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{title}</h2>
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : children}
    </div>
  )
}

function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass =
    tone === 'good'
      ? 'border-[#e2e8f0] bg-[#ecfdf5] text-[#059669]'
      : tone === 'warn'
        ? 'border-[#e2e8f0] bg-[#fffbeb] text-[#d97706]'
        : tone === 'bad'
          ? 'border-[#e2e8f0] bg-[#fef2f2] text-[#dc2626]'
          : 'border-[#e2e8f0] bg-[#f9fafb] text-[#6b7280]'

  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${toneClass}`}>
      {renderDrilldownValue(children)}
    </span>
  )
}

function NationalSupplyCommandPanel({
  totalStations,
  onlineStations,
  criticalAlerts,
}: {
  totalStations: number
  onlineStations: number
  criticalAlerts: number
}) {
  const regions = [
    { name: 'Northern', coverage: 86, tone: '#EF9F27', status: 'Watch', statusTone: 'warn' as const },
    { name: 'Central', coverage: 94, tone: '#1D9E75', status: 'Stable', statusTone: 'good' as const },
    { name: 'Southern', coverage: 79, tone: '#E24B4A', status: 'Pressure', statusTone: 'bad' as const },
  ]
  const metaItems = [
    { label: 'Stations', value: totalStations.toLocaleString(), className: 'text-[#6b7280]' },
    { label: 'Online', value: onlineStations.toLocaleString(), className: 'text-[#059669]' },
    { label: 'Critical', value: criticalAlerts.toLocaleString(), className: 'text-[#dc2626]' },
  ]

  return (
    <section className={lightPanel}>
      <LightPanelHeader
        icon={MapPinned}
        title="National Supply Command"
        meta={
          <div className="hidden items-center gap-4 sm:flex">
            {metaItems.map((item) => (
              <div key={item.label} className="text-right">
                <div className={`text-[14px] font-medium leading-none ${item.className}`}>{item.value}</div>
                <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{item.label}</div>
              </div>
            ))}
          </div>
        }
      />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="border-b border-[#e2e8f0] p-4 lg:border-b-0 lg:border-r">
          <svg className="h-full min-h-[280px] w-full rounded-md border border-[#e2e8f0] bg-[#f9fafb]" viewBox="0 0 460 260" role="img" aria-label="Malawi national supply status map">
            <rect width="460" height="260" fill="var(--mera-panel-muted)" />
            {[52, 104, 156, 208].map((y) => <line key={`h-${y}`} x1="0" y1={y} x2="460" y2={y} stroke="var(--mera-panel-border)" strokeWidth="0.5" />)}
            {[115, 230, 345].map((x) => <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="260" stroke="var(--mera-panel-border)" strokeWidth="0.5" />)}
            <path d="M234 22 L253 34 L265 57 L270 82 L267 105 L273 128 L281 154 L283 184 L276 209 L262 230 L249 242 L236 246 L224 238 L212 218 L204 193 L199 168 L193 143 L190 119 L194 94 L200 70 L211 46 L224 28 Z" fill="transparent" stroke="var(--mera-panel-text-soft)" strokeWidth="1.15" />
            <path d="M257 35 L269 58 L270 82 L264 105 L256 98 L251 76 L248 55 Z" fill="transparent" stroke="var(--mera-panel-text-soft)" strokeWidth="1.15" opacity="0.85" />
            {[
              { label: 'Karonga', x: 258, y: 44, color: '#EF9F27' },
              { label: 'Mzuzu', x: 248, y: 82, color: '#1D9E75' },
              { label: 'Lilongwe', x: 225, y: 142, color: '#1D9E75', r: 7 },
              { label: 'Zomba', x: 236, y: 187, color: '#EF9F27' },
              { label: 'Blantyre', x: 220, y: 216, color: '#E24B4A', r: 7 },
            ].map((point) => (
              <g key={point.label}>
                <circle cx={point.x} cy={point.y} r={(point as any).r || 6} fill={point.color} opacity="0.95" />
                <circle cx={point.x} cy={point.y} r={12} fill="none" stroke={point.color} strokeWidth="1.2" opacity="0.28" />
                <text x={point.x + 14} y={point.y + 5} fill="#6b7280" fontSize="12" fontFamily="Inter, sans-serif">{point.label}</text>
              </g>
            ))}
            {[
              { x: 214, y: 63, color: '#1D9E75' },
              { x: 232, y: 113, color: '#1D9E75' },
              { x: 207, y: 164, color: '#EF9F27' },
              { x: 214, y: 126, color: '#1D9E75' },
            ].map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r="4" fill={dot.color} opacity="0.55" />)}
            <g transform="translate(20 232)">
              <circle cx="0" cy="0" r="5" fill={'#1D9E75'} />
              <text x="10" y="4" fill="#6b7280" fontSize="11">Operational</text>
              <circle cx="104" cy="0" r="5" fill={'#EF9F27'} />
              <text x="114" y="4" fill="#6b7280" fontSize="11">Low Stock</text>
              <circle cx="197" cy="0" r="5" fill={'#E24B4A'} />
              <text x="207" y="4" fill="#6b7280" fontSize="11">Critical</text>
            </g>
          </svg>
        </div>
        <div className="grid content-start gap-3 p-4">
          {regions.map((region) => (
            <div key={region.name} className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-medium text-[#6b7280]">{region.name}</div>
                <div className="text-[13px] font-medium" style={{ color: region.tone }}>{region.coverage}%</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f9fafb]">
                <div className="h-full rounded-full" style={{ width: `${region.coverage}%`, background: region.tone }} />
              </div>
              <div>
                <StatusPill tone={region.statusTone}>{region.status}</StatusPill>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function FuelReserveStatusPanel() {
  const rows = [
    { fuel: 'Petrol', reserve: 71, burn: '4.2 ML/d', depletion: '8.2 days', tone: '#185FA5', status: 'ok' },
    { fuel: 'Diesel', reserve: 84, burn: '5.8 ML/d', depletion: '11.4 days', tone: '#1D9E75', status: 'ok' },
    { fuel: 'Kerosene', reserve: 38, burn: '1.1 ML/d', depletion: '3.8 days', tone: '#EF9F27', status: 'warn' },
    { fuel: 'Jet A-1', reserve: 22, burn: '0.8 ML/d', depletion: '2.1 days', tone: '#E24B4A', status: 'crit' },
    { fuel: 'LPG', reserve: 61, burn: '0.6 ML/d', depletion: '7.0 days', tone: '#185FA5', status: 'neutral' },
  ]
  const variance = [
    { label: 'Petrol variance', value: '+MWK 61/L', tone: '#EF9F27' },
    { label: 'Diesel variance', value: '+MWK 12/L', tone: '#1D9E75' },
    { label: 'Kerosene variance', value: '+MWK 94/L', tone: '#E24B4A' },
  ]

  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={Fuel} title="Fuel Reserve Status" />
      <div className="grid grid-cols-[minmax(130px,1fr)_110px_92px_92px] gap-3 border-b border-[#e2e8f0] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b7280] max-sm:hidden">
        <div>Fuel Type</div>
        <div className="text-right">Reserve</div>
        <div className="text-right">Burn/day</div>
        <div className="text-right">Depletion</div>
      </div>
      <div>
        {rows.map((row) => (
          <div key={row.fuel} className="grid grid-cols-[minmax(130px,1fr)_110px_92px_92px] items-center gap-3 border-b border-[#e2e8f0] px-4 py-3 text-[13px] max-sm:grid-cols-1 max-sm:gap-2">
            <div className="flex items-center gap-2 font-medium text-[#6b7280]">
              <span className="size-2 rounded-full" style={{ background: row.tone }} />
              {row.fuel}
            </div>
            <div className="flex items-center justify-end gap-2 text-right text-[13px] font-medium text-[#6b7280] max-sm:justify-start">
              <span style={{ color: row.tone }}>{row.reserve}%</span>
              <span className="h-2 w-[56px] overflow-hidden rounded-full bg-[#f9fafb]">
                <span className="block h-full rounded-full" style={{ width: `${row.reserve}%`, background: row.tone }} />
              </span>
            </div>
            <div className="text-right text-[#6b7280] max-sm:text-left">{row.burn}</div>
            <div className="text-right font-medium max-sm:text-left" style={{ color: row.tone }}>{row.depletion}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 border-t border-[#e2e8f0] p-4 sm:grid-cols-3">
        {variance.map((item) => (
          <div key={item.label} className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2">
            <div className="text-[11px] font-medium text-[#6b7280]">{item.label}</div>
            <div className="mt-1 text-[14px] font-medium" style={{ color: item.tone }}>{item.value}</div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SupplyPipelinePanel({ displayMode = 'list' as DashboardBlockDisplay }: { displayMode?: DashboardBlockDisplay }) {
  const rows = [
    { route: 'Beira Depot -> Blantyre', meta: 'Diesel - TRK-2241 - S1 Corridor', eta: '4.2h', etaLabel: 'ETA', volume: '42kL', tone: 'neutral' as const },
    { route: 'Nacala Port -> Lilongwe', meta: 'Petrol - TRK-1897 - DELAYED', eta: '+6.1h', etaLabel: 'Delayed', volume: '38kL', tone: 'warn' as const },
    { route: 'Dar es Salaam -> Mzuzu', meta: 'Kerosene - TRK-3301 - On Route', eta: '11.8h', etaLabel: 'ETA', volume: '20kL', tone: 'neutral' as const },
    { route: 'Beira Depot -> Zomba', meta: 'Jet A-1 - TRK-0442 - Cleared', eta: '2.9h', etaLabel: 'ETA', volume: '15kL', tone: 'neutral' as const },
  ]

  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={Truck} title="Supply Pipeline - In Transit" meta={<div className="text-[12px] font-medium text-[#6b7280]">{displayMode}</div>} />
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
                <th className="px-4 py-2 text-left">Route</th>
                <th className="px-4 py-2 text-left">Load</th>
                <th className="px-4 py-2 text-right">ETA</th>
                <th className="px-4 py-2 text-right">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.route} className="border-b border-[#e2e8f0]">
                  <td className="px-4 py-3 font-medium text-[#111827]">{row.route}</td>
                  <td className="px-4 py-3 text-[#6b7280]">{row.meta}</td>
                  <td className={`px-4 py-3 text-right font-medium ${row.tone === 'warn' ? 'text-[#d97706]' : 'text-[#6b7280]'}`}>{row.eta}</td>
                  <td className="px-4 py-3 text-right text-[#6b7280]">{row.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.route} className="grid grid-cols-[32px_minmax(0,1fr)_64px_54px] items-center gap-3 border-b border-[#e2e8f0] px-4 py-3 last:border-b-0 max-sm:grid-cols-[32px_minmax(0,1fr)]">
              <div className="grid size-8 place-items-center rounded-md border border-[#e2e8f0] bg-[#f9fafb] text-[#6b7280]">
                <Truck className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-[#111827]">{row.route}</div>
                <div className="mt-0.5 truncate text-[12px] text-[#6b7280]">{row.meta}</div>
              </div>
              <div className="text-right max-sm:col-start-2 max-sm:text-left">
                <div className={`text-[13px] font-medium ${row.tone === 'warn' ? 'text-[#d97706]' : 'text-[#6b7280]'}`}>{row.eta}</div>
                <div className="text-[11px] font-medium text-[#6b7280]">{row.etaLabel}</div>
              </div>
              <div className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-2 py-1 text-center text-[11px] font-medium text-[#6b7280] max-sm:col-start-2 max-sm:w-max">{row.volume}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ComplianceAlertsPanel({ items, displayMode = 'list' as DashboardBlockDisplay }: { items: IncidentQueueItem[]; displayMode?: DashboardBlockDisplay }) {
  const rows = items.slice(0, 5).map((item) => ({
    severity: item.severity,
    station: item.title,
    description: item.station,
    time: item.status || 'live',
  }))
  const badgeForAlert = (severity: string) => {
    if (severity === 'critical') return { label: 'CRIT', className: 'border-[#e2e8f0] bg-[#fef2f2] text-[#dc2626]' }
    if (severity === 'high') return { label: 'HIGH', className: 'border-[#e2e8f0] bg-[#fffbeb] text-[#d97706]' }
    return { label: 'MED', className: 'border-[#e2e8f0] bg-[#f9fafb] text-[#6b7280]' }
  }

  return (
    <section className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
      <div className="border-b border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.018em] text-[#111827]">
              <AlertTriangle className="size-4 text-[#111827]" />
              Compliance alerts
            </div>
            <div className="mt-1 text-[12px] font-medium text-[#6b7280]">Prioritized live compliance exceptions from complaints, inspections, and supply status.</div>
          </div>
          <span className="rounded-full border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#111827]">{rows.length} active</span>
        </div>
      </div>
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
                <th className="px-4 py-2 text-left">Severity</th>
                <th className="px-4 py-2 text-left">Station</th>
                <th className="px-4 py-2 text-left">Message</th>
                <th className="px-4 py-2 text-right">Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const badge = badgeForAlert(row.severity)
                return (
                  <tr key={`${row.station}-${row.time}`} className="border-b border-[#e2e8f0]">
                    <td className="px-4 py-3"><span className={`rounded-md border px-1.5 py-1 text-[10px] font-medium leading-none ${badge.className}`}>{badge.label}</span></td>
                  <td className="px-4 py-3 font-medium text-[#111827]">{stationDisplayValue(row.station)}</td>
                  <td className="px-4 py-3 text-[#6b7280]">{stationDisplayValue(row.description)}</td>
                    <td className="px-4 py-3 text-right text-[#6b7280]">{row.time}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {rows.length ? rows.map((row) => {
            const badge = badgeForAlert(row.severity)
            return (
              <div key={`${row.station}-${row.time}`} className="grid grid-cols-[46px_minmax(0,1fr)_44px] gap-3 border-b border-[#e5e7eb] px-4 py-3 last:border-b-0 hover:bg-[#fafafa]">
                <div className={`mt-0.5 h-max rounded-md border px-1.5 py-1 text-center text-[10px] font-medium leading-none ${badge.className}`}>{badge.label}</div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium text-[#111827]">{stationDisplayValue(row.station)}</div>
                  <div className="mt-0.5 truncate text-[12px] text-[#6b7280]">{stationDisplayValue(row.description)}</div>
                </div>
                <div className="text-right text-[12px] font-medium text-[#6b7280]">{row.time}</div>
              </div>
            )
          }) : <div className="px-4 py-8 text-center text-[12px] text-[#6b7280]">No compliance alerts received.</div>}
        </div>
      )}
    </section>
  )
}

function ConsumptionPanel({ displayMode = 'line' as DashboardBlockDisplay }: { displayMode?: DashboardBlockDisplay }) {
  const { token, api } = usePortal()
  const [consumptionRows, setConsumptionRows] = useState<any[]>([])
  const [consumptionLoading, setConsumptionLoading] = useState(false)
  const [consumptionError, setConsumptionError] = useState('')
  const corridorRows = [
    { label: 'Beira Corridor', tone: 'good' as const, status: 'Normal' },
    { label: 'Nacala Corridor', tone: 'warn' as const, status: 'Delayed' },
    { label: 'Northern Corridor', tone: 'neutral' as const, status: 'Monitor' },
  ]
  const fallbackDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => ({ day, total: 0, petrol: 0, diesel: 0, paraffin: 0, source: 'empty' }))
  const rows = consumptionRows.length === 7 ? consumptionRows : fallbackDays
  const points = rows.map((row) => ({
    label: row.day,
    total: number(row.total),
    petrol: number(row.petrol),
    diesel: number(row.diesel),
    paraffin: number(row.paraffin),
    source: row.source || 'empty',
  }))
  const maxLitres = Math.max(1, ...points.flatMap((point) => [point.total, point.petrol, point.diesel]))
  const yTicks = [1, 0.67, 0.34, 0].map((ratio) => Math.round(maxLitres * ratio))
  const plotPoint = (value: number, index: number) => {
    const x = 36 + index * 43.6
    const y = 108 - (value / maxLitres) * 92
    return `${x.toFixed(1)},${Math.max(12, Math.min(108, y)).toFixed(1)}`
  }
  const totalPolyline = points.map((point, index) => plotPoint(point.total, index)).join(' ')
  const petrolPolyline = points.map((point, index) => plotPoint(point.petrol, index)).join(' ')
  const dieselPolyline = points.map((point, index) => plotPoint(point.diesel, index)).join(' ')
  const sourceSet = new Set(points.map((point) => point.source))
  const sourceLabel = sourceSet.has('actual')
    ? 'Actual dispense/sales data'
    : sourceSet.has('estimated')
      ? 'Estimated from stock reports'
      : 'No consumption records this week'

  useEffect(() => {
    if (!token) return undefined
    const controller = new AbortController()
    setConsumptionLoading(true)
    setConsumptionError('')
    api.getNationalConsumption(token, '7d', controller.signal)
      .then((payload: any) => {
        if (controller.signal.aborted) return
        setConsumptionRows(Array.isArray(payload) ? payload : [])
      })
      .catch((error: any) => {
        if (controller.signal.aborted) return
        setConsumptionError(error?.message || 'Unable to load national consumption.')
        setConsumptionRows([])
      })
      .finally(() => {
        if (!controller.signal.aborted) setConsumptionLoading(false)
      })
    return () => controller.abort()
  }, [api, displayMode, token])

  return (
    <section className={lightPanel}>
      <LightPanelHeader
        icon={TrendingUp}
        title="National Consumption"
        meta={<div className="text-right text-[12px] font-medium text-[#6b7280]"><div>7D Mon-Sun</div><div className="mt-0.5 text-[10px]">{displayMode}</div></div>}
      />
      <div className="px-4 py-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-medium text-[#6b7280]">
          <span>Litres consumed</span>
          <span>{consumptionLoading ? 'Loading...' : sourceLabel}</span>
        </div>
        {consumptionError ? <div className="mb-3 rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2 text-[11px] font-medium text-[#6b7280]">{consumptionError}</div> : null}
        {displayMode === 'bar' ? (
          <div className="grid h-[132px] grid-cols-7 items-end gap-2">
            {points.map((point) => (
              <div key={point.label} className="grid h-full grid-rows-[1fr_auto] gap-2 text-center">
                <div className="flex items-end rounded-t-[4px] bg-[#f9fafb]">
                  <div className="w-full rounded-t-[4px] bg-[#eff6ff]" title={`${point.label}: ${point.total.toLocaleString()} L`} style={{ height: `${Math.max(0, (point.total / maxLitres) * 100)}%` }} />
                </div>
                <div className="text-[10px] font-medium text-[#6b7280]">{point.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <svg width="100%" height="132" viewBox="0 0 300 132" role="img" aria-label="Seven day national consumption trend">
            {[
              { y: 12, label: yTicks[0] },
              { y: 44, label: yTicks[1] },
              { y: 76, label: yTicks[2] },
              { y: 108, label: yTicks[3] },
            ].map((row, index) => (
              <g key={`tick-${index}-${row.y}`}>
                <text x="0" y={row.y + 4} fill="#9ca3af" fontSize="10">{index === 0 ? `${Math.round(row.label / 1000)}k L` : Math.round(row.label / 1000)}</text>
                <line x1="34" y1={row.y} x2="300" y2={row.y} stroke="#f1f5f9" strokeWidth="0.5" />
              </g>
            ))}
            <polyline points={dieselPolyline} fill="none" stroke="#d0a36f" strokeWidth="0.45" opacity="0.75" />
            <polyline points={petrolPolyline} fill="none" stroke="#91b7a8" strokeWidth="0.45" opacity="0.75" />
            <polyline points={totalPolyline} fill="none" stroke={'#185FA5'} strokeWidth="0.75" />
            {points.map((point, index) => {
              const [x, y] = plotPoint(point.total, index).split(',')
              return <circle key={`${point.label}-${point.total}`} cx={x} cy={y} r="3" fill={'#185FA5'}><title>{`${point.label}: ${point.total.toLocaleString()} L`}</title></circle>
            })}
            {points.map((point, index) => (
              <text key={point.label} x={32 + index * 44} y="130" fill="#9ca3af" fontSize="10">{point.label}</text>
            ))}
          </svg>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[10px] font-medium text-[#6b7280]">
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[#185FA5]" />Total</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[#91b7a8]" />Petrol</span>
          <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-[#d0a36f]" />Diesel</span>
        </div>
      </div>
      <div className="grid gap-2 border-t border-[#e2e8f0] px-4 py-3">
        {corridorRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-medium text-[#6b7280]">{row.label}</div>
            <StatusPill tone={row.tone}>{row.status}</StatusPill>
          </div>
        ))}
      </div>
    </section>
  )
}

function SupplyCommandFrame({
  totalStations,
  onlineStations,
  criticalAlerts,
}: {
  totalStations: number
  onlineStations: number
  criticalAlerts: number
}) {
  const districts = [
    { name: 'Northern', coverage: 86, tone: '#1D9E75', risk: 'Watch' },
    { name: 'Central', coverage: 94, tone: '#1D9E75', risk: 'Stable' },
    { name: 'Southern', coverage: 79, tone: '#EF9F27', risk: 'Pressure' },
    { name: 'Lakeshore', coverage: 88, tone: '#185FA5', risk: 'Stable' },
  ]
  const corridors = [
    { name: 'Beira Corridor', flow: 'Normal', stock: '4.2d', tone: '#1D9E75' },
    { name: 'Nacala Corridor', flow: 'Delayed', stock: '2.8d', tone: '#EF9F27' },
    { name: 'Dar es Salaam', flow: 'Watch', stock: '3.1d', tone: '#185FA5' },
  ]

  return (
    <section className={`${darkPanel} overflow-hidden p-2.5`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 className="size-3.5 text-[#6b7280]" />
            <h2 className="truncate text-[12px] font-medium uppercase tracking-[0.1em] text-white">National Supply Command</h2>
          </div>
          <div className="mt-1 text-[11px] text-[#6b7280]">Depot cover, corridor flow, regional availability and intervention priority.</div>
        </div>
        {[
          { label: 'Stations', value: totalStations.toLocaleString(), color: '#185FA5' },
          { label: 'Online', value: onlineStations.toLocaleString(), color: '#1D9E75' },
          { label: 'Critical', value: criticalAlerts.toLocaleString(), color: '#E24B4A' },
        ].map((item) => (
          <div key={item.label} className="rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] px-2 py-1.5 text-right shadow-none">
            <div className="text-[13px] font-medium leading-none" style={{ color: item.color }}>{item.value}</div>
            <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-[#6b7280]">{item.label}</div>
          </div>
        ))}
      </div>
      <div className="grid min-h-[360px] gap-2 rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] p-2 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative min-h-[340px] overflow-hidden rounded-md border border-[var(--mera-glass-border)] bg-[linear-gradient(135deg,rgba(9,27,43,0.86),rgba(4,17,28,0.76)),linear-gradient(90deg,rgba(77,210,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(77,210,255,0.045)_1px,transparent_1px)] bg-[length:auto,34px_34px,34px_34px] p-4">
          <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(rgba(137,167,196,0.13)_1px,transparent_1px),linear-gradient(90deg,rgba(137,167,196,0.13)_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className="relative grid h-full gap-3 md:grid-cols-[170px_minmax(0,1fr)]">
            <div className="flex min-h-[300px] flex-col justify-between rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] p-3 backdrop-blur-md">
              {districts.map((district) => (
                <div key={district.name}>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-medium">
                    <span className="text-white">{district.name}</span>
                    <span style={{ color: district.tone }}>{district.coverage}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#111827]">
                    <div className="h-full rounded-full" style={{ width: `${district.coverage}%`, background: district.tone }} />
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-[#6b7280]">{district.risk}</div>
                </div>
              ))}
            </div>

            <div className="relative min-h-[300px] rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] p-4 backdrop-blur-md">
              <div className="absolute left-1/2 top-7 h-[250px] w-1 -translate-x-1/2 rounded-full bg-[#111827]" />
              {[
                { label: 'Karonga', top: '12%', left: '50%', color: '#EF9F27' },
                { label: 'Mzuzu', top: '28%', left: '42%', color: '#1D9E75' },
                { label: 'Lilongwe', top: '48%', left: '56%', color: '#1D9E75' },
                { label: 'Zomba', top: '66%', left: '46%', color: '#185FA5' },
                { label: 'Blantyre', top: '80%', left: '58%', color: '#E24B4A' },
              ].map((node) => (
                <div key={node.label} className="absolute flex items-center gap-2" style={{ top: node.top, left: node.left }}>
                  <span className="grid size-8 place-items-center rounded-full border border-white/20 bg-[#111827] shadow-none">
                    <span className="size-3 rounded-full" style={{ background: node.color }} />
                  </span>
                  <span className="rounded-md border border-[var(--mera-glass-border)] bg-[#111827]/80 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-md">{node.label}</span>
                </div>
              ))}
              <div className="absolute bottom-3 left-3 right-3 grid grid-cols-3 gap-2">
                {['Depot cover 3.8d', 'Queue risk +14%', 'Price watch +61/L'].map((item) => (
                  <div key={item} className="rounded-md border border-[var(--mera-glass-border)] bg-[#111827]/78 px-2 py-1.5 text-center text-[10px] font-medium text-[#6b7280] backdrop-blur-md">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="grid gap-2">
          {corridors.map((row) => (
            <div key={row.name} className="rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] p-3 shadow-none">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-medium text-white">{row.name}</div>
                <span className="rounded-md px-2 py-1 text-[10px] font-medium" style={{ background: `${row.tone}22`, color: row.tone }}>
                  {row.flow}
                </span>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#6b7280]">Stock Cover</div>
                  <div className="mt-1 text-[22px] font-medium text-white">{row.stock}</div>
                </div>
                <Sparkline data={[3, 4, 3.6, 4.4, 4.1, Number.parseFloat(row.stock)]} color={row.tone} />
              </div>
            </div>
          ))}
        </aside>
      </div>
    </section>
  )
}

function IncidentCommandQueue({ items }: { items: IncidentQueueItem[] }) {
  return (
    <section className={`${darkPanel} h-full min-h-[360px] p-3`}>
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BellRing className="size-3.5 text-[#d97706]" />
            <h2 className="text-[12px] font-medium uppercase tracking-[0.1em] text-white">Incident Command Queue</h2>
          </div>
          <div className="mt-1 text-[10px] text-[#6b7280]">Ownership, SLA, and escalation posture.</div>
        </div>
        <span className="rounded-md border border-[#e2e8f0] bg-[#111827] px-2 py-1 text-[10px] font-medium text-[#dc2626]">
          4 urgent
        </span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item) => {
          const meta = severityMeta(item.severity)
          return (
            <div key={item.id} className="rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] p-2.5 shadow-none">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-md" style={{ color: meta.color, background: meta.bg }}>
                  <ShieldAlert className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-medium text-white">{item.title}</div>
                      <div className="mt-1 truncate text-[10px] text-[#6b7280]">{item.district} · {item.station}</div>
                    </div>
                    <span className="shrink-0 rounded-md px-1.5 py-0.5 text-[8.5px] font-medium uppercase" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-[9.5px] text-[#6b7280]">
                    <span className="truncate"><UserRound className="mr-1 inline size-3" />{item.owner}</span>
                    <span className="truncate"><Clock3 className="mr-1 inline size-3" />SLA {formatSla(item.slaMinutes)}</span>
                    <span className="truncate text-right text-[#6b7280]">{item.status}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="mt-2 inline-flex h-6 items-center gap-1 rounded-md border border-[var(--mera-glass-border)] bg-[#f9fafb] px-2 text-[10px] font-medium text-white transition hover:border-[#e2e8f0]">
                {item.action}
                <ArrowUpRight className="size-3" />
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function AvailabilityTrendPanel({
  historyRows = [],
  selectedInterval,
  onIntervalChange,
  loading,
}: {
  historyRows?: any[]
  selectedInterval: string
  onIntervalChange: (interval: string) => void
  loading?: boolean
}) {
  const rawRows = historyRows.length ? historyRows : [
    { label: 'Mon', stationsWithFuel: 84, deliveryVerifiedStationsWithFuel: 76, totalStations: 100 },
    { label: 'Tue', stationsWithFuel: 88, deliveryVerifiedStationsWithFuel: 79, totalStations: 100 },
    { label: 'Wed', stationsWithFuel: 91, deliveryVerifiedStationsWithFuel: 82, totalStations: 100 },
    { label: 'Thu', stationsWithFuel: 92, deliveryVerifiedStationsWithFuel: 84, totalStations: 100 },
    { label: 'Fri', stationsWithFuel: 93, deliveryVerifiedStationsWithFuel: 86, totalStations: 100 },
  ]
  const chartRows = rawRows.map((row: any) => ({
    ...row,
    availabilityPercent: percentOf(row.stationsWithFuel, row.totalStations),
    deliveryVerifiedPercent: percentOf(row.deliveryVerifiedStationsWithFuel, row.totalStations),
  }))

  return (
    <section className={`${darkPanel} h-[184px] p-3`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-[11px] font-medium uppercase tracking-[0.1em] text-[#111827]">Fuel Availability</h2>
          <div className="mt-1 text-[10px] font-medium text-[#6b7280]">National product availability trend</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {availabilityIntervals.slice(1).map((interval) => (
            <button
              key={interval}
              type="button"
              onClick={() => onIntervalChange(interval)}
              className={`h-6 rounded-md px-2 text-[10px] font-medium ${
                selectedInterval === interval ? 'bg-[#eff6ff] text-[#2563eb]' : 'bg-[#f9fafb] text-[#6b7280] hover:text-[#111827]'
              }`}
            >
              {interval}
            </button>
          ))}
        </div>
      </div>
      <div className="h-[128px]">
        <ResponsiveContainer>
          <LineChart data={chartRows} margin={{ top: 8, right: 8, bottom: 0, left: -22 }}>
            <CartesianGrid stroke="var(--mera-chart-grid)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: 'var(--mera-chart-axis)', fontSize: 8 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--mera-chart-axis)', fontSize: 8 }} axisLine={false} tickLine={false} domain={[0, 100]} width={36} tickFormatter={(value) => `${value}%`} />
            <Tooltip contentStyle={{ background: 'var(--mera-chart-tooltip-bg)', border: '1px solid var(--mera-chart-tooltip-border)', borderRadius: 8, color: 'var(--mera-chart-tooltip-text)', fontSize: 10 }} />
            <Line type="monotone" dataKey="availabilityPercent" stroke={'#1D9E75'} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="deliveryVerifiedPercent" stroke={'#EF9F27'} strokeWidth={1.8} dot={false} activeDot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {loading ? <div className="mt-1 text-[10px] font-medium uppercase tracking-[0.1em] text-[#d97706]">Updating</div> : null}
    </section>
  )
}

function StationRiskTable({ rows }: { rows: StationRiskRow[] }) {
  return (
    <section className={`${darkPanel} overflow-hidden p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.1em] text-white">Station Risk Watchlist</h2>
        <span className="text-[10px] font-medium text-[#6b7280]">{rows.length} active · View all</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-left">
          <thead>
            <tr className="border-y border-[var(--mera-glass-border)] bg-[#f9fafb] text-[9px] uppercase tracking-[0.1em] text-[#6b7280]">
              <th className="w-[132px] px-2 py-1.5 font-medium">Station ID</th>
              <th className="px-2 py-1.5 font-medium">Station</th>
              <th className="w-[96px] px-2 py-1.5 font-medium">District</th>
              <th className="w-[72px] px-2 py-1.5 text-right font-medium">Fuel Days</th>
              <th className="w-[96px] px-2 py-1.5 font-medium">Last Signal</th>
              <th className="w-[96px] px-2 py-1.5 font-medium">License</th>
              <th className="w-[90px] px-2 py-1.5 font-medium">Price</th>
              <th className="w-[70px] px-2 py-1.5 text-right font-medium">Risk</th>
              <th className="w-[86px] px-2 py-1.5 text-right font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const riskColor = row.riskScore >= 80 ? '#E24B4A' : row.riskScore >= 60 ? '#EF9F27' : '#185FA5'
              return (
                <tr key={row.stationId} className="border-b border-[#e2e8f0] text-[10px] last:border-0">
                  <td className="truncate px-2 py-1.5 font-medium text-white">{row.stationId}</td>
                  <td className="truncate px-2 py-1.5 text-[#6b7280]">{stationDisplayValue(row.station)}</td>
                  <td className="truncate px-2 py-1.5 text-[#6b7280]">{row.district}</td>
                  <td className="px-2 py-1.5 text-right font-medium text-white">{row.fuelDays.toFixed(1)}</td>
                  <td className="truncate px-2 py-1.5 text-[#6b7280]">{row.lastSignal}</td>
                  <td className="truncate px-2 py-1.5 text-[#6b7280]">{row.licenseStatus}</td>
                  <td className="truncate px-2 py-1.5 font-medium text-white">{row.priceCheck}</td>
                  <td className="px-2 py-1.5 text-right font-medium" style={{ color: riskColor }}>{row.riskScore}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" className="rounded-md border border-[var(--mera-glass-border)] px-1.5 py-0.5 text-[9px] font-medium text-[#6b7280] transition hover:border-[#e2e8f0]">
                      {row.actionLabel}
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function PinnedWidgets({ widgets, onOpenWidgets }: { widgets: DashboardWidget[]; onOpenWidgets: () => void }) {
  return (
    <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
      {widgets.map((widget) => (
        <div key={widget.id} className={`${darkPanel} min-h-[112px] p-4`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-[#6b7280]">{widget.category}</div>
              <div className="mt-1 text-[13px] font-medium text-white">{widget.title}</div>
            </div>
            <span className="rounded-md border border-[#e2e8f0] bg-[#eff6ff]/10 px-1.5 py-0.5 text-[9px] font-medium uppercase text-[#6b7280]">Pinned</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-[24px] font-medium tracking-normal text-white">{widget.metric}</div>
            <div className="text-right text-[11px] font-medium text-[#6b7280]">{widget.trend}</div>
          </div>
          <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-[#6b7280]">{widget.description}</div>
        </div>
      ))}
      <button type="button" onClick={onOpenWidgets} className="min-h-[112px] rounded-md border border-dashed border-white/18 bg-white/[0.025] p-4 text-left text-[#6b7280] transition hover:border-[#e2e8f0] hover:bg-[#ecfdf5]/5">
        <PackagePlus className="size-5 text-[#059669]" />
        <div className="mt-3 text-[13px] font-medium text-white">Add operational widget</div>
        <div className="mt-1 text-[11px] text-[#6b7280]">Pin supply, licensing, telemetry, and pricing modules.</div>
      </button>
    </section>
  )
}

function blockSizeClass(size: DashboardBlockSize) {
  if (size === 'wide') return 'xl:col-span-4'
  if (size === 'medium') return 'xl:col-span-2'
  return 'xl:col-span-1'
}

function scopeOptionsFor(type: DashboardScopeType) {
  if (type === 'Region') return regionScopes
  if (type === 'District') return districtFilters.filter((item) => item !== 'All Districts')
  return ['National']
}

function createViewDraft(existingLabels: string[]): DashboardCustomView {
  const now = new Date().toISOString()
  return {
    id: createDashboardId('view'),
    label: uniqueViewLabel('Area Overview', existingLabels),
    subtitle: 'Custom operational command view for the selected scope.',
    headerButtons: [],
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'slate',
    blocks: defaultDashboardBlocks(),
    createdAt: now,
    updatedAt: now,
  }
}

function cloneBlocks(blocks: DashboardViewBlock[]) {
  return blocks.map((block) => ({ ...block, id: createDashboardId('block') }))
}

const builtinViewTemplates: Record<string, Omit<DashboardCustomView, 'createdAt' | 'updatedAt'>> = {
  'builtin-my-view': {
    id: 'builtin-my-view',
    label: 'My View',
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'slate',
    blocks: defaultDashboardBlocks(),
  },
  'builtin-national-overview': {
    id: 'builtin-national-overview',
    label: 'National Overview',
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'blue',
    blocks: [
      { id: 'overview-kpis', type: 'kpi-summary', title: 'Overview KPI Cards', size: 'wide', displayMode: 'metric', colorPreset: 'blue' },
      { id: 'overview-map', type: 'supply-map', title: 'National Supply Command', size: 'wide', displayMode: 'map', colorPreset: 'blue' },
      { id: 'overview-reserve', type: 'reserve-table', title: 'Fuel Reserve Status', size: 'medium', displayMode: 'table', colorPreset: 'green' },
      { id: 'overview-pipeline', type: 'pipeline-list', title: 'Supply Pipeline', size: 'medium', displayMode: 'list', colorPreset: 'amber' },
      { id: 'overview-compliance', type: 'compliance-alerts', title: 'Compliance Alerts', size: 'medium', displayMode: 'list', colorPreset: 'red' },
      { id: 'overview-consumption', type: 'consumption-chart', title: 'National Consumption', size: 'medium', displayMode: 'line', colorPreset: 'teal' },
    ],
  },
  'builtin-fuel-supply': {
    id: 'builtin-fuel-supply',
    label: 'Fuel Supply',
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'green',
    blocks: [
      { id: 'fuel-map', type: 'supply-map', title: 'Supply Map', size: 'wide', displayMode: 'map', colorPreset: 'green' },
      { id: 'fuel-reserve', type: 'reserve-table', title: 'Reserve Table', size: 'medium', displayMode: 'table', colorPreset: 'green' },
      { id: 'fuel-pipeline', type: 'pipeline-list', title: 'Pipeline List', size: 'medium', displayMode: 'list', colorPreset: 'amber' },
      { id: 'fuel-consumption', type: 'consumption-chart', title: 'Consumption Chart', size: 'medium', displayMode: 'line', colorPreset: 'teal' },
    ],
  },
  'builtin-compliance-watch': {
    id: 'builtin-compliance-watch',
    label: 'Compliance Watch',
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'red',
    blocks: [
      { id: 'compliance-kpis', type: 'kpi-summary', title: 'Compliance Signals', size: 'wide', displayMode: 'metric', colorPreset: 'red' },
      { id: 'compliance-alerts', type: 'compliance-alerts', title: 'Live Compliance Watch', size: 'medium', displayMode: 'list', colorPreset: 'red' },
      { id: 'compliance-risk', type: 'station-risk-table', title: 'Station Risk Table', size: 'wide', displayMode: 'table', colorPreset: 'amber' },
      { id: 'compliance-price', type: 'price-variance', title: 'Price Variance Evidence', size: 'medium', displayMode: 'bar', colorPreset: 'blue' },
      { id: 'compliance-matrix', type: 'compliance-matrix', title: 'Compliance Matrix', size: 'medium', displayMode: 'bar', colorPreset: 'green' },
    ],
  },
  'builtin-enforcement': {
    id: 'builtin-enforcement',
    label: 'Enforcement Watch',
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'amber',
    blocks: [
      { id: 'enforcement-kpis', type: 'kpi-summary', title: 'Enforcement Signals', size: 'wide', displayMode: 'metric', colorPreset: 'amber' },
      { id: 'enforcement-alerts', type: 'compliance-alerts', title: 'Escalation Queue', size: 'medium', displayMode: 'table', colorPreset: 'red' },
      { id: 'enforcement-risk', type: 'station-risk-table', title: 'Case Priority Board', size: 'wide', displayMode: 'table', colorPreset: 'amber' },
      { id: 'enforcement-price', type: 'price-variance', title: 'Price Evidence', size: 'medium', displayMode: 'table', colorPreset: 'blue' },
    ],
  },
}

function builtinViewFor(id: string): DashboardCustomView | null {
  const template = builtinViewTemplates[id]
  if (!template) return null
  return {
    ...template,
    blocks: template.blocks.map((block) => ({ ...block })),
    createdAt: '',
    updatedAt: '',
  }
}

function DashboardBlockRow({
  block,
  index,
  draggingBlockId,
  onMove,
  onUpdate,
  onRemove,
  onDragStart,
  onDragEnd,
  onDropBlock,
}: {
  block: DashboardViewBlock
  index: number
  draggingBlockId: string
  onMove: (from: number, to: number) => void
  onUpdate: (id: string, next: Partial<DashboardViewBlock>) => void
  onRemove: (id: string) => void
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDropBlock: (draggedId: string, targetId: string) => void
}) {
  const libraryItem = blockLibrary.find((item) => item.type === block.type) || blockLibrary[0]
  const blockColorPreset = colorPresets[block.colorPreset || 'slate']
  const isDragging = draggingBlockId === block.id

  return (
    <div
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', block.id)
        onDragStart(block.id)
      }}
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(event) => {
        event.preventDefault()
        onDropBlock(event.dataTransfer.getData('text/plain') || draggingBlockId, block.id)
      }}
      onDragEnd={onDragEnd}
      className={`rounded-md border border-[#e2e8f0] bg-white p-3 transition ${isDragging ? 'scale-[0.99] opacity-60' : 'opacity-100'}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 grid size-8 shrink-0 cursor-grab place-items-center rounded-md border border-[#e2e8f0] bg-[#f9fafb] text-[#6b7280]" title="Drag to reorder">
          <GripVertical className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-medium text-[#111827]">{block.title}</div>
            <span className="size-2 rounded-full" style={{ background: blockColorPreset.accent }} />
            <span className="rounded-md bg-[#f9fafb] px-1.5 py-0.5 text-[9px] font-medium uppercase text-[#6b7280]">{libraryItem.title}</span>
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[#6b7280]">{libraryItem.description}</div>
        </div>
        <button type="button" onClick={() => onRemove(block.id)} className="grid size-8 shrink-0 place-items-center rounded-md text-[#dc2626] transition hover:bg-[#fef2f2]" aria-label="Remove block">
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <FieldShell className="grid gap-1 sm:col-span-2" label="Block title" hint="Name this dashboard block for the custom view. Example: Critical station risks.">
          <input value={block.title} onChange={(event) => onUpdate(block.id, { title: event.target.value })} className="h-9 rounded-md border border-[#e2e8f0] bg-white px-2 text-[12px] font-medium text-[#6b7280] outline-none focus:border-[#e2e8f0]" />
        </FieldShell>
        <FieldShell className="grid gap-1" label="Block size" hint="Choose how much grid space this block uses. Example: Wide for charts, Small for KPI tiles.">
          <select value={block.size} onChange={(event) => onUpdate(block.id, { size: event.target.value as DashboardBlockSize })} className="h-9 rounded-md border border-[#e2e8f0] bg-white px-2 text-[12px] font-medium text-[#6b7280]">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="wide">Wide</option>
          </select>
        </FieldShell>
        <FieldShell className="grid gap-1" label="Display mode" hint="Select how the block visualizes data. Example: table for records, chart for trends.">
          <select value={block.displayMode} onChange={(event) => onUpdate(block.id, { displayMode: event.target.value as DashboardBlockDisplay })} className="h-9 rounded-md border border-[#e2e8f0] bg-white px-2 text-[12px] font-medium text-[#6b7280]">
            {libraryItem.modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </FieldShell>
        <div className="sm:col-span-3">
          <FieldLabel label="Block color" hint="Choose the accent color used for this dashboard block. Example: red for enforcement risk." className="mb-1 text-[10px]" />
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(colorPresets) as DashboardColorPreset[]).map((presetKey) => {
              const preset = colorPresets[presetKey]
              const active = (block.colorPreset || 'slate') === presetKey
              return (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => onUpdate(block.id, { colorPreset: presetKey })}
                  className={`grid size-7 place-items-center rounded-md border transition ${active ? 'border-[#e2e8f0] bg-white' : 'border-[#e2e8f0] bg-[#f9fafb] hover:border-[#e2e8f0]'}`}
                  aria-label={`Use ${preset.label} block color`}
                >
                  <span className="size-3.5 rounded-full" style={{ background: preset.accent }} />
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:pt-5">
          <button type="button" onClick={() => onMove(index, Math.max(0, index - 1))} disabled={index === 0} className="grid h-9 place-items-center rounded-md border border-[#e2e8f0] text-[#6b7280] disabled:opacity-40" aria-label="Move block up">
            <ArrowUp className="size-4" />
          </button>
          <button type="button" onClick={() => onMove(index, index + 1)} className="grid h-9 place-items-center rounded-md border border-[#e2e8f0] text-[#6b7280]" aria-label="Move block down">
            <ArrowDown className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function ViewBuilderDrawer({
  open,
  onOpenChange,
  editingView,
  customViews,
  onSave,
  onDuplicate,
  onDelete,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  editingView: DashboardCustomView | null
  customViews: DashboardCustomView[]
  onSave: (view: DashboardCustomView) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}) {
  const [draft, setDraft] = useState<DashboardCustomView>(() => createViewDraft([...builtinDashboardTabs.map((tab) => tab.label), ...customViews.map((view) => view.label)]))
  const [draggingBlockId, setDraggingBlockId] = useState('')
  const existingLabels = [...builtinDashboardTabs.map((tab) => tab.label), ...customViews.filter((view) => view.id !== draft.id).map((view) => view.label)]
  const label = draft.label.trim()
  const duplicateLabel = existingLabels.some((item) => item.toLowerCase() === label.toLowerCase())
  const limitReached = !editingView && customViews.length >= maxCustomViews
  const validation = !label
    ? 'View name is required.'
    : duplicateLabel
      ? 'Use a unique view name.'
      : limitReached
        ? `You can create up to ${maxCustomViews} custom views.`
        : draft.blocks.length === 0
          ? 'Add at least one block.'
          : ''

  useEffect(() => {
    if (!open) return
    const labels = [...builtinDashboardTabs.map((tab) => tab.label), ...customViews.map((view) => view.label)]
    setDraft(editingView ? { ...editingView, blocks: editingView.blocks.map((block) => ({ ...block })) } : createViewDraft(labels))
  }, [customViews, editingView, open])

  const updateDraft = (next: Partial<DashboardCustomView>) => setDraft((current) => ({ ...current, ...next }))
  const updateScopeType = (scopeType: DashboardScopeType) => {
    const nextOptions = scopeOptionsFor(scopeType)
    updateDraft({ scopeType, scopeValue: nextOptions[0] || 'National' })
  }
  const addBlock = (libraryItem: (typeof blockLibrary)[number]) => {
    if (draft.blocks.length >= maxBlocksPerView) return
    setDraft((current) => ({
      ...current,
      blocks: [
        ...current.blocks,
        {
          id: createDashboardId('block'),
          type: libraryItem.type,
          title: libraryItem.title,
          size: libraryItem.size,
          displayMode: libraryItem.displayMode,
          colorPreset: current.colorPreset,
        },
      ],
    }))
  }
  const moveBlock = useCallback((from: number, to: number) => {
    setDraft((current) => {
      const next = [...current.blocks]
      const target = Math.max(0, Math.min(next.length - 1, to))
      const [moved] = next.splice(from, 1)
      if (!moved) return current
      next.splice(target, 0, moved)
      return { ...current, blocks: next }
    })
  }, [])
  const dropBlock = useCallback((draggedId: string, targetId: string) => {
    if (!draggedId || draggedId === targetId) return
    setDraft((current) => {
      const from = current.blocks.findIndex((block) => block.id === draggedId)
      const to = current.blocks.findIndex((block) => block.id === targetId)
      if (from < 0 || to < 0 || from === to) return current
      const next = [...current.blocks]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return { ...current, blocks: next }
    })
  }, [])
  const updateBlock = (id: string, next: Partial<DashboardViewBlock>) => {
    setDraft((current) => ({
      ...current,
      blocks: current.blocks.map((block) => block.id === id ? { ...block, ...next } : block),
    }))
  }
  const updateHeaderButton = (index: number, next: Partial<DashboardHeaderButton>) => {
    setDraft((current) => {
      const buttons = [...(current.headerButtons || [])]
      while (buttons.length <= index) {
        buttons.push({ id: createDashboardId('action'), label: '', path: '', variant: buttons.length === 0 ? 'primary' : 'secondary' })
      }
      buttons[index] = { ...buttons[index], ...next }
      return { ...current, headerButtons: buttons.slice(0, 2) }
    })
  }
  const removeBlock = (id: string) => setDraft((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== id) }))
  const resetLayout = () => updateDraft({ blocks: defaultDashboardBlocks() })
  const save = () => {
    if (validation) return
    const now = new Date().toISOString()
    onSave({ ...draft, label, updatedAt: now, createdAt: draft.createdAt || now })
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[760px] min-w-[520px] max-w-[96vw] resize-x overflow-auto border-[#e2e8f0] bg-white text-[#111827] sm:max-w-none">
        <DrawerHeader className="border-b border-[#e2e8f0] p-5">
          <DrawerTitle className="text-[#111827]">{editingView ? 'Edit Custom View' : 'Create Custom View'}</DrawerTitle>
          <DrawerDescription className="text-[#6b7280]">Build a scoped operational overview with ordered blocks, saved locally in this browser.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5">
            <section className="grid gap-3 rounded-md border border-[#e2e8f0] bg-[#f9fafb] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">View Name</span>
                  <input value={draft.label} onChange={(event) => updateDraft({ label: event.target.value })} className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none focus:border-[#e2e8f0]" />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">Header Subtitle</span>
                  <input value={draft.subtitle || ''} onChange={(event) => updateDraft({ subtitle: event.target.value })} placeholder="Describe what this view is for..." className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none focus:border-[#e2e8f0]" />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">Fuel Product</span>
                  <select value={draft.product} onChange={(event) => updateDraft({ product: event.target.value })} className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#6b7280]">
                    {productFilters.map((product) => <option key={product} value={product}>{product}</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">Scope Type</span>
                  <select value={draft.scopeType} onChange={(event) => updateScopeType(event.target.value as DashboardScopeType)} className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#6b7280]">
                    <option value="National">National</option>
                    <option value="Region">Region</option>
                    <option value="District">District</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">Scope</span>
                  <select value={draft.scopeValue} onChange={(event) => updateDraft({ scopeValue: event.target.value })} className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#6b7280]">
                    {scopeOptionsFor(draft.scopeType).map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">
                  <Palette className="size-3.5" />
                  Color Preset
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(colorPresets) as DashboardColorPreset[]).map((presetKey) => {
                    const preset = colorPresets[presetKey]
                    const active = draft.colorPreset === presetKey
                    return (
                      <button key={presetKey} type="button" onClick={() => updateDraft({ colorPreset: presetKey })} className={`flex h-9 items-center gap-2 rounded-md border px-3 text-[12px] font-medium transition ${active ? 'border-[#e2e8f0] bg-white text-[#111827]' : 'border-[#e2e8f0] bg-white text-[#6b7280] hover:border-[#e2e8f0]'}`}>
                        <span className="size-3 rounded-full" style={{ background: preset.accent }} />
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="grid gap-3 rounded-md border border-[#e2e8f0] bg-white p-3">
                <div>
                  <div className="text-[13px] font-medium text-[#111827]">Header Buttons</div>
                  <div className="mt-1 text-[12px] text-[#6b7280]">Optional actions shown on the custom view header.</div>
                </div>
                {[0, 1].map((index) => {
                  const button = draft.headerButtons?.[index] || { label: '', path: '', variant: index === 0 ? 'primary' : 'secondary' }
                  return (
                    <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                      <input
                        value={button.label}
                        onChange={(event) => updateHeaderButton(index, { label: event.target.value })}
                        placeholder={index === 0 ? 'Primary label' : 'Secondary label'}
                        className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none"
                      />
                      <input
                        value={button.path}
                        onChange={(event) => updateHeaderButton(index, { path: event.target.value })}
                        placeholder="/tasks or /price-compliance"
                        className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#111827] outline-none"
                      />
                      <select
                        value={button.variant}
                        onChange={(event) => updateHeaderButton(index, { variant: event.target.value as DashboardHeaderButton['variant'] })}
                        className="h-10 rounded-md border border-[#e2e8f0] bg-white px-3 text-[13px] font-medium text-[#6b7280]"
                      >
                        <option value="primary">Primary</option>
                        <option value="secondary">Secondary</option>
                      </select>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-[#111827]">Block Library</div>
                  <div className="text-[12px] text-[#6b7280]">Add up to {maxBlocksPerView} clean snapped blocks.</div>
                </div>
                <button type="button" onClick={resetLayout} className="inline-flex h-8 items-center gap-1 rounded-md border border-[#e2e8f0] px-2 text-[12px] font-medium text-[#6b7280] hover:bg-[#f9fafb]">
                  <RotateCcw className="size-3.5" />
                  Reset
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {blockLibrary.map((item) => (
                  <button key={item.type} type="button" onClick={() => addBlock(item)} disabled={draft.blocks.length >= maxBlocksPerView} className="rounded-md border border-[#e2e8f0] bg-white p-3 text-left transition hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-45">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-medium text-[#111827]">{item.title}</div>
                      <Plus className="size-4 text-[#6b7280]" />
                    </div>
                    <div className="mt-1 text-[12px] leading-5 text-[#6b7280]">{item.description}</div>
                  </button>
                ))}
              </div>
            </section>

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-[#111827]">View Blocks</div>
                  <div className="text-[12px] text-[#6b7280]">Drag blocks into order or use the move controls.</div>
                </div>
                <div className="text-[12px] font-medium text-[#6b7280]">{draft.blocks.length}/{maxBlocksPerView}</div>
              </div>
              {draft.blocks.length ? (
                <div className="grid gap-2">
                  {draft.blocks.map((block, index) => (
                    <DashboardBlockRow
                      key={block.id}
                      block={block}
                      index={index}
                      draggingBlockId={draggingBlockId}
                      onMove={moveBlock}
                      onUpdate={updateBlock}
                      onRemove={removeBlock}
                      onDragStart={setDraggingBlockId}
                      onDragEnd={() => setDraggingBlockId('')}
                      onDropBlock={dropBlock}
                    />
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-[#e2e8f0] bg-[#f9fafb] p-6 text-center text-[13px] font-medium text-[#6b7280]">
                  Add blocks from the library to compose this overview.
                </div>
              )}
            </section>
          </div>
        </div>
        <DrawerFooter className="border-t border-[#e2e8f0] p-5">
          <div className="mr-auto text-[12px] font-medium text-[#dc2626]">{validation}</div>
          {editingView ? (
            <>
              <Button type="button" variant="outline" onClick={() => onDuplicate(editingView.id)}>
                <Copy className="size-4" />
                Duplicate
              </Button>
              <Button type="button" variant="outline" onClick={() => onDelete(editingView.id)} className="text-[#dc2626]">
                <Trash2 className="size-4" />
                Delete
              </Button>
            </>
          ) : null}
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </DrawerClose>
          <Button type="button" onClick={save} disabled={Boolean(validation)}>
            <Save className="size-4" />
            Save View
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function scopeMatchesDistrict(view: DashboardCustomView, district: string) {
  if (view.scopeType === 'National') return true
  if (view.scopeType === 'District') return district === view.scopeValue
  const regionDistricts: Record<string, string[]> = {
    'Northern Region': ['Mzuzu', 'Karonga'],
    'Central Region': ['Lilongwe', 'Kasungu', 'Salima', 'Mchinji'],
    'Southern Region': ['Blantyre', 'Zomba', 'Mangochi', 'Limbe'],
  }
  return (regionDistricts[view.scopeValue] || []).includes(district)
}

function PriceVarianceLightPanel({ displayMode, rows = [] }: { displayMode: DashboardBlockDisplay; rows?: any[] }) {
  const maxValue = Math.max(...rows.flatMap((row) => [number(row.petrol), number(row.diesel), number(row.lpg)]), 1)
  const totalVariance = rows.reduce((sum, row) => sum + number(row.petrol) + number(row.diesel) + number(row.lpg), 0)

  return (
    <section className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3 border-b border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.018em] text-[#111827]">
            <TrendingUp className="size-4" />
            Price variance evidence
          </div>
          <div className="mt-1 text-[12px] font-medium text-[#6b7280]">Regional pump-price deviation signals available for compliance review.</div>
        </div>
        <span className="rounded-full border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#111827]">+{totalVariance}</span>
      </div>
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
                <th className="px-4 py-2 text-left">Region</th>
                <th className="px-4 py-2 text-right">Petrol</th>
                <th className="px-4 py-2 text-right">Diesel</th>
                <th className="px-4 py-2 text-right">LPG</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.region} className="border-b border-[#e2e8f0]">
                  <td className="px-4 py-3 font-medium text-[#6b7280]">{row.region}</td>
                  <td className="px-4 py-3 text-right text-[#d97706]">+{row.petrol}</td>
                  <td className="px-4 py-3 text-right text-[#2563eb]">+{row.diesel}</td>
                  <td className="px-4 py-3 text-right text-[#059669]">+{row.lpg}</td>
                </tr>
              )) : (
                <tr className="border-b border-[#e2e8f0]">
                  <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-[#6b7280]">No price variance packet received.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 p-4">
          {rows.length ? rows.map((row) => (
            <div key={row.region} className="grid grid-cols-[76px_minmax(0,1fr)_42px] items-center gap-3 text-[12px]">
              <div className="font-medium text-[#6b7280]">{row.region}</div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f9fafb]">
                <div className="h-full rounded-full bg-[#eff6ff]" style={{ width: `${(row.petrol / maxValue) * 100}%` }} />
              </div>
              <div className="text-right font-medium text-[#2563eb]">+{row.petrol}</div>
            </div>
          )) : <div className="py-8 text-center text-[12px] text-[#6b7280]">No price variance packet received.</div>}
        </div>
      )}
    </section>
  )
}

function StationRiskLightTable({ rows }: { rows: StationRiskRow[] }) {
  const highRiskRows = rows.filter((row) => number(row.riskScore) >= 70)
  return (
    <section className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
      <div className="flex items-start justify-between gap-3 border-b border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.018em] text-[#111827]">
            <Table2 className="size-4" />
            Station risk board
          </div>
          <div className="mt-1 text-[12px] font-medium text-[#6b7280]">Ranked station exposure by fuel days, compliance risk, and next recommended action.</div>
        </div>
        <div className="flex gap-2">
          <span className="rounded-full border border-[#e5e7eb] bg-white px-2.5 py-1 text-[11px] font-semibold text-[#111827]">{rows.length} rows</span>
          <span className="rounded-full border border-[#fee2e2] bg-[#fef2f2] px-2.5 py-1 text-[11px] font-semibold text-[#dc2626]">{highRiskRows.length} high</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead>
            <tr className="border-b border-[#e2e8f0] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
              <th className="px-4 py-2 text-left">Station</th>
              <th className="px-4 py-2 text-left">District</th>
              <th className="px-4 py-2 text-right">Fuel Days</th>
              <th className="px-4 py-2 text-right">Risk</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.slice(0, 6).map((row) => (
              <tr key={row.stationId} className="border-b border-[#e5e7eb] hover:bg-[#fafafa]">
                <td className="px-4 py-3 font-medium text-[#111827]">{stationDisplayValue(row.station)}</td>
                <td className="px-4 py-3 text-[#6b7280]">{row.district}</td>
                <td className="px-4 py-3 text-right text-[#6b7280]">{row.fuelDays.toFixed(1)}</td>
                <td className="px-4 py-3 text-right"><span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${row.riskScore >= 70 ? 'bg-[#fef2f2] text-[#dc2626]' : row.riskScore >= 45 ? 'bg-[#fffbeb] text-[#d97706]' : 'bg-[#ecfdf5] text-[#059669]'}`}>{row.riskScore}</span></td>
                <td className="px-4 py-3 text-right font-medium text-[#111827]">{row.actionLabel}</td>
              </tr>
            )) : (
              <tr className="border-b border-[#e2e8f0]">
                <td colSpan={5} className="px-4 py-8 text-center text-[12px] text-[#6b7280]">No station risk packet received.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ComplianceMatrixLightPanel({ displayMode, rows = [] }: { displayMode: DashboardBlockDisplay; rows?: any[] }) {
  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={ShieldCheck} title="Compliance Matrix" meta={<div className="text-[12px] font-medium text-[#6b7280]">{displayMode}</div>} />
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="border-b border-[#e2e8f0] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
                <th className="px-4 py-2 text-left">Check</th>
                <th className="px-4 py-2 text-right">Compliant</th>
                <th className="px-4 py-2 text-right">Watch</th>
                <th className="px-4 py-2 text-right">Breach</th>
              </tr>
            </thead>
            <tbody>
              {rows.length ? rows.map((row) => (
                <tr key={row.label} className="border-b border-[#e2e8f0]">
                  <td className="px-4 py-3 font-medium text-[#6b7280]">{row.label}</td>
                  <td className="px-4 py-3 text-right font-medium text-[#059669]">{row.compliant}%</td>
                  <td className="px-4 py-3 text-right text-[#d97706]">{row.watch}%</td>
                  <td className="px-4 py-3 text-right text-[#dc2626]">{row.breach}%</td>
                </tr>
              )) : (
                <tr className="border-b border-[#e2e8f0]">
                  <td colSpan={4} className="px-4 py-8 text-center text-[12px] text-[#6b7280]">No compliance matrix packet received.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 p-4">
          {rows.length ? rows.map((row) => (
            <div key={row.label} className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <div className="font-medium text-[#6b7280]">{row.label}</div>
                <div className="font-medium text-[#059669]">{row.compliant}%</div>
              </div>
              <div className="grid h-2 grid-cols-[var(--ok)_var(--watch)_var(--breach)] overflow-hidden rounded-full bg-[#f9fafb]" style={{ '--ok': `${row.compliant}fr`, '--watch': `${row.watch}fr`, '--breach': `${row.breach}fr` } as any}>
                <div className="bg-[#ecfdf5]" />
                <div className="bg-[#fffbeb]" />
                <div className="bg-[#fef2f2]" />
              </div>
            </div>
          )) : <div className="py-8 text-center text-[12px] text-[#6b7280]">No compliance matrix packet received.</div>}
        </div>
      )}
    </section>
  )
}

function CustomDashboardBlock({
  block,
  view,
  kpiCards,
  totalStations,
  onlineStations,
  criticalAlerts,
  incidentItems,
  riskRows,
  priceVarianceRows,
  complianceMatrixRows,
}: {
  block: DashboardViewBlock
  view: DashboardCustomView
  kpiCards: any[]
  totalStations: number
  onlineStations: number
  criticalAlerts: number
  incidentItems: IncidentQueueItem[]
  riskRows: StationRiskRow[]
  priceVarianceRows: any[]
  complianceMatrixRows: any[]
}) {
  const scopedIncidents = incidentItems.filter((item) => scopeMatchesDistrict(view, item.district))
  const scopedRiskRows = riskRows.filter((row) => scopeMatchesDistrict(view, row.district))
  const preset = colorPresets[block.colorPreset || view.colorPreset]
  const frame = (children: ReactNode) => (
    <div className={blockSizeClass(block.size)}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">
        <span className="size-2 rounded-full" style={{ background: preset.accent }} />
        {block.title}
      </div>
      {children}
    </div>
  )

  if (block.type === 'kpi-summary') {
    return (
      <div className={blockSizeClass(block.size)}>
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">
          <span className="size-2 rounded-full" style={{ background: preset.accent }} />
          {block.title}
        </div>
        <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {kpiCards.map((item) => <NationalKpiCard key={item.label} {...item} />)}
        </section>
      </div>
    )
  }
  if (block.type === 'supply-map') {
    return frame(<NationalSupplyCommandPanel totalStations={totalStations} onlineStations={onlineStations} criticalAlerts={criticalAlerts} />)
  }
  if (block.type === 'reserve-table') return frame(<FuelReserveStatusPanel />)
  if (block.type === 'pipeline-list') return frame(<SupplyPipelinePanel displayMode={block.displayMode} />)
  if (block.type === 'compliance-alerts') return frame(<ComplianceAlertsPanel items={scopedIncidents} displayMode={block.displayMode} />)
  if (block.type === 'consumption-chart') return frame(<ConsumptionPanel displayMode={block.displayMode} />)
  if (block.type === 'price-variance') return frame(<PriceVarianceLightPanel displayMode={block.displayMode} rows={priceVarianceRows} />)
  if (block.type === 'station-risk-table') return frame(<StationRiskLightTable rows={scopedRiskRows} />)
  return frame(<ComplianceMatrixLightPanel displayMode={block.displayMode} rows={complianceMatrixRows} />)
}

function CustomDashboardView({
  view,
  kpiCards,
  totalStations,
  onlineStations,
  criticalAlerts,
  incidentItems,
  riskRows,
  priceVarianceRows,
  complianceMatrixRows,
  onEdit,
  onDuplicate,
  editable = true,
}: {
  view: DashboardCustomView
  kpiCards: any[]
  totalStations: number
  onlineStations: number
  criticalAlerts: number
  incidentItems: IncidentQueueItem[]
  riskRows: StationRiskRow[]
  priceVarianceRows: any[]
  complianceMatrixRows: any[]
  onEdit?: () => void
  onDuplicate?: () => void
  editable?: boolean
}) {
  const preset = colorPresets[view.colorPreset]
  const scopeLabel = view.scopeType === 'National' ? 'National' : view.scopeValue
  const navigate = useNavigate()
  const headerButtons = (view.headerButtons || []).filter((button) => button.label && button.path).slice(0, 2)

  return (
    <div className="grid gap-3">
      <section className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_14px_35px_rgba(15,23,42,0.045)]">
        <div className="h-[3px]" style={{ background: preset.accent }} />
        <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em]" style={{ color: preset.text }}>{scopeLabel} View</div>
            <div className="mt-2 truncate text-[28px] font-semibold tracking-[-0.055em] text-[#111827]">{view.label}</div>
            <p className="mt-2 max-w-3xl text-[13px] font-medium leading-6 text-[#6b7280]">{view.subtitle || 'Custom operational command view for the selected scope.'}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] font-medium text-[#6b7280]">
              <span className="rounded-md px-2 py-1" style={{ background: preset.soft, color: preset.text }}>{scopeLabel}</span>
              <span>{view.product}</span>
              <span>{view.blocks.length} blocks</span>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            {headerButtons.map((button) => (
              <Button
                key={button.id}
                type="button"
                size="sm"
                variant={button.variant === 'secondary' ? 'outline' : undefined}
                className={button.variant === 'primary' ? 'bg-[#111111] hover:bg-[#2a2a2a]' : undefined}
                onClick={() => navigate(button.path)}
              >
                {button.label}
              </Button>
            ))}
            {editable && onEdit ? (
              <Button type="button" size="sm" variant={headerButtons.length ? 'outline' : undefined} onClick={onEdit}>
                <Pencil className="size-4" />
                Edit View
              </Button>
            ) : onDuplicate ? (
              <Button type="button" size="sm" variant={headerButtons.length ? 'outline' : undefined} onClick={onDuplicate}>
                <Copy className="size-4" />
                Duplicate
              </Button>
            ) : null}
          </div>
        </div>
      </section>
      {view.blocks.length ? (
        <div className="grid gap-3 xl:grid-cols-4">
          {view.blocks.map((block) => (
            <CustomDashboardBlock
              key={block.id}
              block={block}
              view={view}
              kpiCards={kpiCards}
              totalStations={totalStations}
              onlineStations={onlineStations}
              criticalAlerts={criticalAlerts}
              incidentItems={incidentItems}
              riskRows={riskRows}
              priceVarianceRows={priceVarianceRows}
              complianceMatrixRows={complianceMatrixRows}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-[#e2e8f0] bg-white p-8 text-center text-[13px] font-medium text-[#6b7280]">
          This view is empty. Edit it to add operational blocks.
        </div>
      )}
    </div>
  )
}

function tableDate(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return String(value)
  return date.toLocaleDateString()
}

function stationDisplayValue(value: any) {
  if (!value) return '-'
  if (typeof value !== 'object' || Array.isArray(value)) return renderDrilldownValue(value)
  const name = value.name || value.stationName || value.station_name || value.title || value.label || value.publicId || value.public_id || value.id
  const city = value.city || value.district || value.location
  return [name, city].filter(Boolean).join(' - ') || renderDrilldownValue(value)
}

function statusToneFor(value: any): 'good' | 'warn' | 'bad' | 'neutral' {
  const text = String(value || '').toLowerCase()
  if (text.includes('critical') || text.includes('severe') || text.includes('crisis') || text.includes('dry') || text.includes('overdue')) return 'bad'
  if (text.includes('high') || text.includes('stress') || text.includes('watch') || text.includes('low') || text.includes('pending')) return 'warn'
  if (text.includes('available') || text.includes('stable') || text.includes('complete') || text.includes('compliant')) return 'good'
  return 'neutral'
}

function CommandSummaryTable({
  title,
  icon: Icon,
  columns,
  rows,
  emptyLabel = 'No records available.',
}: {
  title: string
  icon: any
  columns: Array<{ key: string; label: string; render?: (row: any) => ReactNode; align?: 'right' | 'left' }>
  rows: any[]
  emptyLabel?: string
}) {
  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={Icon} title={title} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-[12px]">
          <thead>
            <tr className="border-b border-[#e2e8f0] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
              {columns.map((column) => (
                <th key={column.key} className={`px-4 py-2 ${column.align === 'right' ? 'text-right' : 'text-left'}`}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length ? rows.map((row, index) => (
              <tr key={row.id || row.publicId || row.caseId || row.inspectionId || row.deliveryId || `${title}-${index}`} className="border-b border-[#e2e8f0] last:border-b-0">
                {columns.map((column) => (
                  <td key={column.key} className={`px-4 py-3 ${column.align === 'right' ? 'text-right' : 'text-left'} ${column.key === columns[0]?.key ? 'font-medium text-[#111827]' : 'text-[#6b7280]'}`}>
                    {renderDrilldownValue(column.render ? column.render(row) : row[column.key])}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td colSpan={columns.length} className="px-4 py-6 text-center text-[12px] text-[#6b7280]">{emptyLabel}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function NationalOverviewDashboard({
  activeStations,
  reserveDays,
  activeDriverQueues,
  complianceRiskCount,
  kpiCards,
  totalStations,
  onlineStations,
  criticalAlerts,
  incidentItems,
  mapStations,
  deliveryRows,
  caseRows,
  inspectionRows,
  complaintRows,
  districtRows,
  onOpenKpi,
}: {
  activeStations: number
  reserveDays: number
  activeDriverQueues: number
  complianceRiskCount: number
  kpiCards: any[]
  totalStations: number
  onlineStations: number
  criticalAlerts: number
  incidentItems: IncidentQueueItem[]
  mapStations: any[]
  deliveryRows: any[]
  caseRows: any[]
  inspectionRows: any[]
  complaintRows: any[]
  districtRows: any[]
  onOpenKpi: (drilldown: DrilldownConfig) => void
}) {
  const [focus, setFocus] = useState('supply')
  const [showAllStatus, setShowAllStatus] = useState(false)
  const mapRows = mapStations
  const isFuelAvailable = (row: any, key: 'petrol' | 'diesel') => {
    const value = String(row?.[`${key}Status`] || row?.[`${key}_status`] || row?.availabilityStatus || row?.availability_status || '').toLowerCase()
    return value.includes('available') || value.includes('low') || value.includes('limited')
  }
  const petrolAvailability = Math.round(percentOf(mapRows.filter((row) => isFuelAvailable(row, 'petrol')).length, mapRows.length || 1))
  const dieselAvailability = Math.round(percentOf(mapRows.filter((row) => isFuelAvailable(row, 'diesel')).length, mapRows.length || 1))
  const averageQueueTime = Math.round(averageNumber(mapRows.map((row) => row.averageWaitTime ?? row.avgWaitMinutes ?? row.avg_wait_minutes)))
  const stationsOffline = mapRows.filter((row) => String(row.markerStatus || row.status || row.availabilityStatus || row.availability_status || '').toLowerCase().includes('offline')).length
  const highRiskStations = mapRows.filter((row) => number(row.riskScore ?? row.risk_score) >= 76).length
  const openCases = caseRows.length || incidentItems.length
  const todayKey = new Date().toDateString()
  const todaysDeliveries = deliveryRows.filter((row) => {
    const value = row.actualArrival || row.actual_arrival || row.expectedArrival || row.expected_arrival || row.createdAt || row.created_at
    const date = value ? new Date(value) : null
    return date && !Number.isNaN(date.getTime()) && date.toDateString() === todayKey
  }).length || Math.min(deliveryRows.length, 8)
  const publicComplaintsToday = complaintRows.filter((row) => {
    const value = row.createdAt || row.created_at
    const date = value ? new Date(value) : null
    return date && !Number.isNaN(date.getTime()) && date.toDateString() === todayKey
  }).length || Math.min(complaintRows.length, 12)
  const nationalStatus = !mapRows.length
    ? 'No Data'
    : highRiskStations >= 5 || petrolAvailability < 55 || dieselAvailability < 55
    ? 'Severe'
    : highRiskStations >= 3 || petrolAvailability < 70 || dieselAvailability < 70
      ? 'Stressed'
      : averageQueueTime >= 40
        ? 'Mild Pressure'
        : 'Stable'
  const statusBar = [
    { label: 'National Fuel Status', value: nationalStatus, tone: statusToneFor(nationalStatus) },
    { label: 'Petrol Availability', value: `${petrolAvailability}%`, tone: statusToneFor(petrolAvailability < 70 ? 'watch' : 'available') },
    { label: 'Diesel Availability', value: `${dieselAvailability}%`, tone: statusToneFor(dieselAvailability < 70 ? 'watch' : 'available') },
    { label: 'Average Queue Time', value: `${averageQueueTime} min`, tone: statusToneFor(averageQueueTime >= 40 ? 'watch' : 'stable') },
    { label: 'Stations Offline', value: stationsOffline.toLocaleString(), tone: statusToneFor(stationsOffline ? 'watch' : 'stable') },
    { label: 'High-Risk Stations', value: highRiskStations.toLocaleString(), tone: statusToneFor(highRiskStations ? 'high' : 'stable') },
    { label: 'Open Cases', value: openCases.toLocaleString(), tone: statusToneFor(openCases > 10 ? 'watch' : 'stable') },
    { label: "Today's Deliveries", value: todaysDeliveries.toLocaleString(), tone: 'neutral' as const },
    { label: 'Public Complaints Today', value: publicComplaintsToday.toLocaleString(), tone: statusToneFor(publicComplaintsToday > 10 ? 'watch' : 'stable') },
  ]
  const cards = [
    {
      id: 'supply',
      label: 'Network Coverage',
      value: activeStations.toLocaleString(),
      detail: 'Active stations feeding the national view',
      accent: '#185FA5',
      drilldown: kpiCards[0]?.drilldown,
    },
    {
      id: 'reserve',
      label: 'Reserve Pressure',
      value: `${reserveDays.toFixed(1)}d`,
      detail: 'National reserve cover and burn outlook',
      accent: '#1D9E75',
      drilldown: kpiCards[1]?.drilldown,
    },
    {
      id: 'pipeline',
      label: 'Queue & Pipeline Load',
      value: activeDriverQueues.toLocaleString(),
      detail: 'Driver queues and supply movements',
      accent: '#EF9F27',
    },
    {
      id: 'compliance',
      label: 'Compliance Risk',
      value: complianceRiskCount.toLocaleString(),
      detail: 'Violations, alerts, and station risk',
      accent: '#E24B4A',
      drilldown: {
        title: 'Compliance risk',
        value: complianceRiskCount.toLocaleString(),
        subtitle: 'Compliance alerts contributing to the current risk signal.',
        rows: incidentItems,
        columns: [
          { key: 'severity', label: 'Severity', render: (row: any) => row.severity || '-' },
          { key: 'title', label: 'Case', render: (row: any) => row.title || '-' },
          { key: 'district', label: 'District', render: (row: any) => row.district || '-' },
          { key: 'station', label: 'Station', render: (row: any) => row.station || '-' },
        ],
      },
    },
  ]

  const activate = (id: string, drilldown?: DrilldownConfig) => {
    setFocus(id)
    if (drilldown) onOpenKpi(drilldown)
    window.requestAnimationFrame(() => {
      document.getElementById(`national-overview-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }
  const alertFeed = incidentItems.length
    ? incidentItems.slice(0, 7).map((item) => ({ title: item.title, station: item.station, district: item.district, severity: item.severity, action: 'Review evidence' }))
    : mapRows
        .filter((row) => number(row.riskScore ?? row.risk_score) >= 56)
        .slice(0, 7)
        .map((row) => ({
          title: `${row.stationName || row.station_name || row.name} risk signal`,
          station: row.stationName || row.station_name || row.name,
          district: row.district || row.city || '-',
          severity: number(row.riskScore ?? row.risk_score) >= 91 ? 'critical' : number(row.riskScore ?? row.risk_score) >= 76 ? 'high' : 'medium',
          action: number(row.riskScore ?? row.risk_score) >= 76 ? 'Assign inspection' : 'Request explanation',
        }))
  const districtStressRows = (districtRows.length ? districtRows : Array.from(new Set(mapRows.map((row) => row.district || row.city || 'Unknown'))).map((district) => {
    const rows = mapRows.filter((row) => (row.district || row.city || 'Unknown') === district)
    const availability = Math.round(percentOf(rows.filter((row) => isFuelAvailable(row, 'petrol') || isFuelAvailable(row, 'diesel')).length, rows.length || 1))
    return {
      district,
      availability,
      avgWait: Math.round(averageNumber(rows.map((row) => row.averageWaitTime ?? row.avgWaitMinutes ?? row.avg_wait_minutes))),
      stress: rows.some((row) => number(row.riskScore ?? row.risk_score) >= 76) ? 'High' : availability < 70 ? 'Watch' : 'Stable',
    }
  })).slice(0, 6)
  const deliverySummaryRows = deliveryRows.slice(0, 6).map((row) => ({
    ...row,
    station: row.stationName || row.station_name || row.station || row.stationId || row.station_id || '-',
    fuel: row.fuelType || row.fuel_type || '-',
    eta: row.actualArrival || row.actual_arrival || row.expectedArrival || row.expected_arrival || row.createdAt || row.created_at,
    status: row.status || row.stationConfirmationStatus || row.station_confirmation_status || 'pending_review',
  }))
  const openCaseRows = (caseRows.length ? caseRows : incidentItems).slice(0, 6)
  const priorityInspectionRows = inspectionRows.slice(0, 6)

  return (
    <div className="grid gap-3">
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => activate(card.id, card.drilldown)}
            className={`relative min-h-[132px] overflow-hidden rounded-md border bg-white px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-[#e2e8f0] hover:shadow-sm ${
              focus === card.id ? 'border-[#e2e8f0]' : 'border-[#e2e8f0]'
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: card.accent }} />
            <div className="text-[11px] font-medium uppercase tracking-[0.09em] text-[#6b7280]">{card.label}</div>
            <div className="mt-3 text-[30px] font-medium leading-none tracking-normal text-[#111827]">{card.value}</div>
            <div className="mt-3 text-[12px] font-medium leading-5 text-[#6b7280]">{card.detail}</div>
            <div className="absolute bottom-3 right-3 text-[11px] font-medium text-[#6b7280]">Open</div>
          </button>
        ))}
      </section>

      <section className="overflow-hidden rounded-md border border-[#e2e8f0] bg-white shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-medium uppercase tracking-[0.08em] text-[#111827]">National fuel indicators</h2>
            <p className="mt-1 truncate text-[12px] font-medium text-[#6b7280]">Detailed status checks sit below the main KPI cards.</p>
          </div>
          <button
            type="button"
            onClick={() => setShowAllStatus((current) => !current)}
            className="h-8 shrink-0 rounded-md border border-[#e2e8f0] bg-white px-3 text-[12px] font-medium text-[#111827] transition hover:bg-[#f9fafb]"
          >
            {showAllStatus ? 'Hide' : 'View all'}
          </button>
        </div>
        {showAllStatus ? (
          <div className="grid gap-3 border-t border-[#e2e8f0] bg-[#f9fafb] p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {statusBar.map((item) => (
              <div key={item.label} className="rounded-md border border-[#e2e8f0] bg-white px-4 py-3">
                <div className="truncate text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{item.label}</div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="truncate text-[20px] font-medium tracking-normal text-[#111827]">{item.value}</span>
                  <StatusPill tone={item.tone}>{item.tone === 'bad' ? 'Alert' : item.tone === 'warn' ? 'Watch' : item.tone === 'good' ? 'OK' : 'Live'}</StatusPill>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </section>

      <div id="national-overview-supply" className="grid scroll-mt-3 gap-3 xl:grid-cols-[minmax(0,1.62fr)_minmax(320px,0.78fr)]">
        <MeraFuelHeatmap rows={mapRows} title="Live Malawi Fuel Network" className="h-[520px] min-h-[520px]" />
        <section className={lightPanel}>
          <LightPanelHeader icon={BellRing} title="Intelligence Alert Feed" meta={<div className="text-[12px] font-medium text-[#dc2626]">{alertFeed.length}</div>} />
          <div className="max-h-[468px] divide-y divide-[#e2e8f0] overflow-y-auto">
            {alertFeed.length ? alertFeed.map((alert, index) => (
              <div key={`${alert.title}-${index}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-medium text-[#111827]">{alert.title}</div>
                    <div className="mt-1 truncate text-[12px] text-[#6b7280]">{alert.station} - {alert.district}</div>
                  </div>
                  <StatusPill tone={statusToneFor(alert.severity)}>{alert.severity}</StatusPill>
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-medium text-[#2563eb]">{alert.action}</span>
                  <span className="text-[#6b7280]">Risk engine</span>
                </div>
              </div>
            )) : (
              <div className="px-4 py-8 text-center text-[12px] text-[#6b7280]">No active intelligence alerts.</div>
            )}
          </div>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-4">
        <CommandSummaryTable
          title="District Fuel Stress"
          icon={Activity}
          rows={districtStressRows}
          columns={[
            { key: 'district', label: 'District' },
            { key: 'availability', label: 'Avail.', align: 'right', render: (row) => `${row.availability ?? row.availabilityRate ?? row.value ?? 0}%` },
            { key: 'stress', label: 'Stress', render: (row) => <StatusPill tone={statusToneFor(row.stress || row.status)}>{row.stress || row.status || 'Stable'}</StatusPill> },
          ]}
        />
        <CommandSummaryTable
          title="Delivery Timeline"
          icon={Truck}
          rows={deliverySummaryRows}
          columns={[
            { key: 'station', label: 'Station' },
            { key: 'fuel', label: 'Fuel' },
            { key: 'eta', label: 'Time', render: (row) => tableDate(row.eta) },
          ]}
        />
        <CommandSummaryTable
          title="Open Case Summary"
          icon={ShieldAlert}
          rows={openCaseRows}
          columns={[
            { key: 'title', label: 'Case', render: (row) => row.title || row.flagTitle || row.station || row.stationName || '-' },
            { key: 'district', label: 'District', render: (row) => row.district || '-' },
            { key: 'severity', label: 'Severity', render: (row) => <StatusPill tone={statusToneFor(row.severity || row.priority)}>{row.severity || row.priority || row.status || 'open'}</StatusPill> },
          ]}
        />
        <CommandSummaryTable
          title="Inspection Priority"
          icon={ClipboardCheck}
          rows={priorityInspectionRows}
          columns={[
            { key: 'station', label: 'Station', render: (row) => row.stationName || row.station_name || row.station || row.stationPublicId || '-' },
            { key: 'district', label: 'District', render: (row) => row.district || '-' },
            { key: 'priority', label: 'Priority', render: (row) => <StatusPill tone={statusToneFor(row.priority || row.status)}>{row.priority || row.status || '-'}</StatusPill> },
          ]}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div id="national-overview-reserve" className="scroll-mt-3">
          <FuelReserveStatusPanel />
        </div>
        <div id="national-overview-pipeline" className="scroll-mt-3">
          <SupplyPipelinePanel />
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div id="national-overview-compliance" className="scroll-mt-3">
          <ComplianceAlertsPanel items={incidentItems} />
        </div>
        <ConsumptionPanel />
      </div>
    </div>
  )
}

function WatchMetric({ label, value, detail, tone = 'neutral' }: { label: string; value: ReactNode; detail: string; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass =
    tone === 'bad'
      ? 'bg-[#fef2f2] text-[#dc2626]'
      : tone === 'warn'
        ? 'bg-[#fffbeb] text-[#d97706]'
        : tone === 'good'
          ? 'bg-[#ecfdf5] text-[#059669]'
          : 'bg-[#f3f4f6] text-[#111827]'
  return (
    <div className="rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3 shadow-[0_14px_35px_rgba(15,23,42,0.045)]">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">{label}</div>
      <div className="mt-2 text-[26px] font-semibold leading-none tracking-[-0.04em] text-[#111827]">{value}</div>
      <div className={`mt-3 inline-flex rounded-full px-2 py-1 text-[11px] font-semibold ${toneClass}`}>{detail}</div>
    </div>
  )
}

function ComplianceWatchCommand({
  incidentItems,
  riskRows,
  priceVarianceRows,
  complianceMatrixRows,
  caseRows,
  inspectionRows,
  complaintRows,
  onOpenRoute,
}: {
  incidentItems: IncidentQueueItem[]
  riskRows: StationRiskRow[]
  priceVarianceRows: any[]
  complianceMatrixRows: any[]
  caseRows: any[]
  inspectionRows: any[]
  complaintRows: any[]
  onOpenRoute: (path: string) => void
}) {
  const criticalAlerts = incidentItems.filter((item) => ['critical', 'high'].includes(String(item.severity || '').toLowerCase()))
  const failedInspections = inspectionRows.filter((row) => /FAILED|ESCALATED|VIOLATION|NON/i.test(String(row.inspectionStatus || row.inspection_status || row.status || '')))
  const highRiskRows = riskRows.filter((row) => number(row.riskScore) >= 70)
  const varianceTotal = priceVarianceRows.reduce((sum, row) => sum + number(row.petrol) + number(row.diesel) + number(row.lpg), 0)
  const detectionRows = (incidentItems.length ? incidentItems : caseRows).slice(0, 8)

  return (
    <div className="grid gap-3">
      <section className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white">
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#dc2626]">Compliance Watch</div>
            <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.055em] text-[#111827]">Detection, evidence, and station compliance posture.</h2>
            <p className="mt-2 max-w-3xl text-[13px] font-medium leading-6 text-[#6b7280]">
              This view is for finding non-compliance early: price variance, complaint pressure, inspection failures, and station risk signals.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Button type="button" size="sm" className="bg-[#111111] hover:bg-[#2a2a2a]" onClick={() => onOpenRoute('/compliance-flags')}>
              Open cases
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenRoute('/price-compliance')}>
              Price evidence
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <WatchMetric label="Open signals" value={Math.max(incidentItems.length, caseRows.length)} detail={`${criticalAlerts.length} critical/high`} tone={criticalAlerts.length ? 'bad' : 'good'} />
        <WatchMetric label="Price variance" value={`+${varianceTotal}`} detail={`${priceVarianceRows.length} regions`} tone={varianceTotal ? 'warn' : 'good'} />
        <WatchMetric label="Failed inspections" value={failedInspections.length} detail="field evidence" tone={failedInspections.length ? 'bad' : 'good'} />
        <WatchMetric label="Complaints" value={complaintRows.length} detail="public reports" tone={complaintRows.length ? 'warn' : 'good'} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_14px_35px_rgba(15,23,42,0.045)]">
          <div className="border-b border-[#e5e7eb] px-4 py-3">
            <div className="text-[13px] font-semibold text-[#111827]">Detection Queue</div>
            <div className="mt-1 text-[12px] font-medium text-[#6b7280]">Signals that need review before enforcement is opened.</div>
          </div>
          <div className="divide-y divide-[#e5e7eb]">
            {detectionRows.length ? detectionRows.map((row: any, index) => (
              <button key={`${row.title || row.public_id || index}`} type="button" onClick={() => onOpenRoute('/compliance-flags')} className="grid w-full gap-2 px-4 py-3 text-left transition hover:bg-[#fafafa] md:grid-cols-[minmax(0,1fr)_120px_110px]">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#111827]">{renderDrilldownValue(row.title || row.flag_type || row.station_name || row.station || 'Compliance signal')}</div>
                  <div className="mt-1 truncate text-[12px] font-medium text-[#6b7280]">{stationDisplayValue(row.station || row.station_name || row.description || row.district)}</div>
                </div>
                <div className="text-[12px] font-medium text-[#6b7280]">{row.district || '-'}</div>
                <div className="text-right"><StatusPill tone={statusToneFor(row.severity || row.status)}>{row.severity || row.status || 'open'}</StatusPill></div>
              </button>
            )) : <div className="px-4 py-10 text-center text-[12px] font-medium text-[#6b7280]">No compliance signals available.</div>}
          </div>
        </div>

        <div className="grid gap-3">
          <CommandSummaryTable
            title="Station Risk Evidence"
            icon={ShieldAlert}
            rows={highRiskRows.length ? highRiskRows.slice(0, 7) : riskRows.slice(0, 7)}
            columns={[
              { key: 'station', label: 'Station' },
              { key: 'district', label: 'District' },
              { key: 'riskScore', label: 'Risk', align: 'right', render: (row) => row.riskScore },
            ]}
          />
          <CommandSummaryTable
            title="Compliance Matrix"
            icon={ShieldCheck}
            rows={complianceMatrixRows}
            columns={[
              { key: 'label', label: 'Check' },
              { key: 'compliant', label: 'OK', align: 'right', render: (row) => `${row.compliant}%` },
              { key: 'breach', label: 'Breach', align: 'right', render: (row) => `${row.breach}%` },
            ]}
          />
        </div>
      </section>

      <PriceVarianceLightPanel displayMode="bar" rows={priceVarianceRows} />
    </div>
  )
}

function EnforcementWatchCommand({
  enforcementRows,
  riskRows,
  incidentItems,
  caseRows,
  onOpenRoute,
}: {
  enforcementRows: any[]
  riskRows: StationRiskRow[]
  incidentItems: IncidentQueueItem[]
  caseRows: any[]
  onOpenRoute: (path: string) => void
}) {
  const activeRows = enforcementRows.filter((row) => /OPEN|IN_PROGRESS|ESCALATED|PENDING/i.test(String(row.action_status || row.actionStatus || row.status || '')))
  const escalatedRows = enforcementRows.filter((row) => /ESCALATED|SUSPENSION|FINE|CLOSURE/i.test(`${row.action_status || row.actionStatus || row.status || ''} ${row.action_type || row.actionType || ''}`))
  const overdueRows = enforcementRows.filter((row) => {
    const due = row.deadline_at || row.deadlineAt || row.due_at || row.dueAt
    if (!due) return false
    const date = new Date(due)
    return !Number.isNaN(date.getTime()) && date.getTime() < Date.now() && !/CLOSED|COMPLIED|RESOLVED/i.test(String(row.action_status || row.actionStatus || row.status || ''))
  })
  const priorityRows = activeRows.length ? activeRows : enforcementRows
  const escalationSeeds = escalatedRows.length
    ? escalatedRows
    : incidentItems.filter((item) => ['critical', 'high'].includes(String(item.severity || '').toLowerCase()))

  return (
    <div className="grid gap-3">
      <section className="overflow-hidden rounded-[8px] border border-[#111827] bg-[#111111] text-white">
        <div className="grid gap-5 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#d1d5db]">Enforcement Watch</div>
            <h2 className="mt-2 text-[28px] font-semibold tracking-[-0.055em]">Legal action, escalation posture, and deadline control.</h2>
            <p className="mt-2 max-w-3xl text-[13px] font-medium leading-6 text-[#d1d5db]">
              This view starts after evidence becomes actionable: enforcement actions, penalties, suspensions, deadlines, and unresolved escalations.
            </p>
          </div>
          <div className="flex flex-wrap items-start gap-2">
            <Button type="button" size="sm" className="bg-white text-[#111111] hover:bg-[#f3f4f6]" onClick={() => onOpenRoute('/enforcement-actions')}>
              Enforcement registry
            </Button>
            <Button type="button" size="sm" variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10" onClick={() => onOpenRoute('/compliance-flags')}>
              Source cases
            </Button>
          </div>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        <WatchMetric label="Active actions" value={activeRows.length} detail={`${enforcementRows.length} total`} tone={activeRows.length ? 'warn' : 'good'} />
        <WatchMetric label="Escalated" value={escalatedRows.length} detail="legal pressure" tone={escalatedRows.length ? 'bad' : 'good'} />
        <WatchMetric label="Overdue" value={overdueRows.length} detail="deadline breach" tone={overdueRows.length ? 'bad' : 'good'} />
        <WatchMetric label="Source cases" value={caseRows.length || incidentItems.length} detail="evidence base" tone={(caseRows.length || incidentItems.length) ? 'warn' : 'neutral'} />
      </section>

      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
        <div className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_14px_35px_rgba(15,23,42,0.045)]">
          <div className="border-b border-[#e5e7eb] px-4 py-3">
            <div className="text-[13px] font-semibold text-[#111827]">Action Control Board</div>
            <div className="mt-1 text-[12px] font-medium text-[#6b7280]">Open enforcement actions ordered for legal follow-through.</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-[13px]">
              <thead>
                <tr className="border-b border-[#e5e7eb] text-[10px] uppercase tracking-[0.08em] text-[#6b7280]">
                  <th className="px-4 py-2 text-left">Action</th>
                  <th className="px-4 py-2 text-left">Station</th>
                  <th className="px-4 py-2 text-left">Type</th>
                  <th className="px-4 py-2 text-left">Status</th>
                  <th className="px-4 py-2 text-right">Deadline</th>
                </tr>
              </thead>
              <tbody>
                {priorityRows.slice(0, 8).map((row, index) => (
                  <tr key={row.public_id || row.publicId || index} className="border-b border-[#e5e7eb] hover:bg-[#fafafa]">
                    <td className="px-4 py-3 font-semibold text-[#111827]">{row.reference_number || row.ref || row.public_id || row.publicId || `Action ${index + 1}`}</td>
                    <td className="px-4 py-3 text-[#6b7280]">{stationDisplayValue(row.station_name || row.stationName || row.station)}</td>
                    <td className="px-4 py-3 text-[#6b7280]">{row.action_type || row.actionType || '-'}</td>
                    <td className="px-4 py-3"><StatusPill tone={statusToneFor(row.action_status || row.actionStatus || row.status)}>{row.action_status || row.actionStatus || row.status || 'open'}</StatusPill></td>
                    <td className="px-4 py-3 text-right text-[#6b7280]">{tableDate(row.deadline_at || row.deadlineAt || row.due_at || row.dueAt || row.issued_at || row.issuedAt)}</td>
                  </tr>
                ))}
                {!priorityRows.length ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-[12px] font-medium text-[#6b7280]">No enforcement actions available.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid gap-3">
          <CommandSummaryTable
            title="Escalation Inputs"
            icon={AlertTriangle}
            rows={escalationSeeds.slice(0, 7)}
            columns={[
              { key: 'title', label: 'Signal', render: (row) => row.title || row.action_type || row.actionType || row.station_name || '-' },
              { key: 'district', label: 'District', render: (row) => row.district || '-' },
              { key: 'severity', label: 'Level', render: (row) => <StatusPill tone={statusToneFor(row.severity || row.action_status || row.status)}>{row.severity || row.action_status || row.status || 'review'}</StatusPill> },
            ]}
          />
          <CommandSummaryTable
            title="Station Priority"
            icon={Table2}
            rows={riskRows.slice(0, 7)}
            columns={[
              { key: 'station', label: 'Station' },
              { key: 'riskScore', label: 'Risk', align: 'right', render: (row) => row.riskScore },
              { key: 'actionLabel', label: 'Next' },
            ]}
          />
        </div>
      </section>
    </div>
  )
}

function taskField(task: any, keys: string[], fallback = '-') {
  const value = keys.map((key) => task?.[key]).find((item) => item !== undefined && item !== null && item !== '')
  return value === undefined || value === null || value === '' ? fallback : value
}

function taskDateValue(task: any) {
  return taskField(task, ['dueAt', 'dueDate', 'due_at'], '')
}

function isTaskDueToday(task: any) {
  const due = taskDateValue(task)
  if (!due) return false
  const date = new Date(due)
  if (Number.isNaN(date.getTime())) return false
  return date.toDateString() === new Date().toDateString()
}

function isTaskOverdue(task: any) {
  if (task?.isOverdue) return true
  const due = taskDateValue(task)
  if (!due) return false
  const status = String(task.status || '').toUpperCase()
  if (['COMPLETED', 'CANCELLED', 'REJECTED', 'CLOSED'].includes(status)) return false
  const date = new Date(due)
  return !Number.isNaN(date.getTime()) && date.getTime() < Date.now()
}

function uniqueTaskOptions(rows: any[], keys: string[]) {
  return Array.from(new Set(rows.map((row) => String(taskField(row, keys, '')).trim()).filter(Boolean))).sort()
}

function RegulatorTasksDashboardView({
  title,
  subtitle,
  rows,
  filterable,
  onOpenTask,
  onOpenAll,
}: {
  title: string
  subtitle: string
  rows: any[]
  filterable?: boolean
  onOpenTask: (task: any) => void
  onOpenAll: () => void
}) {
  const [filters, setFilters] = useState({
    status: 'All',
    severity: 'All',
    district: 'All',
    category: 'All',
    dueMode: 'All',
  })
  const statusOptions = uniqueTaskOptions(rows, ['status'])
  const severityOptions = uniqueTaskOptions(rows, ['severity', 'priority'])
  const districtOptions = uniqueTaskOptions(rows, ['district', 'stationDistrict'])
  const categoryOptions = uniqueTaskOptions(rows, ['category', 'taskType', 'linkedEntityType', 'type'])
  const visibleRows = rows.filter((task) => {
    const status = String(taskField(task, ['status'], ''))
    const severity = String(taskField(task, ['severity', 'priority'], ''))
    const district = String(taskField(task, ['district', 'stationDistrict'], ''))
    const category = String(taskField(task, ['category', 'taskType', 'linkedEntityType', 'type'], ''))
    if (filters.status !== 'All' && status !== filters.status) return false
    if (filters.severity !== 'All' && severity !== filters.severity) return false
    if (filters.district !== 'All' && district !== filters.district) return false
    if (filters.category !== 'All' && category !== filters.category) return false
    if (filters.dueMode === 'Due Today' && !isTaskDueToday(task)) return false
    if (filters.dueMode === 'Overdue' && !isTaskOverdue(task)) return false
    return true
  })
  const taskKpis = [
    { label: 'Total', value: rows.length, tone: 'neutral' as const },
    { label: 'Critical', value: rows.filter((task) => String(taskField(task, ['severity', 'priority'], '')).toUpperCase() === 'CRITICAL').length, tone: 'bad' as const },
    { label: 'Due Today', value: rows.filter(isTaskDueToday).length, tone: 'warn' as const },
    { label: 'Overdue', value: rows.filter(isTaskOverdue).length, tone: 'bad' as const },
  ]

  return (
    <section className={lightPanel}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[#111827]">{title}</h2>
          <p className="mt-1 text-[12px] text-[#6b7280]">{subtitle}</p>
        </div>
        <button type="button" onClick={onOpenAll} className="h-8 rounded-md bg-[#111827] px-3 text-[12px] font-medium text-white hover:bg-[#111827]">Open Task Centre</button>
      </div>
      <div className="grid border-b border-[#e2e8f0] sm:grid-cols-4">
        {taskKpis.map((item) => (
          <div key={item.label} className="border-r border-[#e2e8f0] px-4 py-3 last:border-r-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{item.label}</div>
            <div className={`mt-1 text-xl font-medium ${item.tone === 'bad' ? 'text-[#dc2626]' : item.tone === 'warn' ? 'text-[#d97706]' : 'text-[#111827]'}`}>{item.value}</div>
          </div>
        ))}
      </div>
      {filterable ? (
        <div className="flex flex-wrap gap-2 border-b border-[#e2e8f0] px-4 py-3">
          {[
            ['status', 'Status', ['All', ...statusOptions]],
            ['severity', 'Severity', ['All', ...severityOptions]],
            ['district', 'District', ['All', ...districtOptions]],
            ['category', 'Category', ['All', ...categoryOptions]],
            ['dueMode', 'Due', ['All', 'Due Today', 'Overdue']],
          ].map(([key, label, options]: any) => (
            <label key={key} className="grid gap-1">
              <span className="text-[9px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{label}</span>
              <select
                value={(filters as any)[key]}
                onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.value }))}
                className="h-8 min-w-[132px] rounded-md border border-[#e2e8f0] bg-white px-2 text-[12px] font-medium text-[#6b7280]"
              >
                {options.map((option: string) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          ))}
        </div>
      ) : null}
      <PortalTable
        rows={visibleRows}
        emptyMessage="No regulatory tasks match the current view."
        columns={[
          {
            key: 'title',
            label: 'Task Title',
            render: (task) => <span className="font-medium text-[#111827]">{renderDrilldownValue(taskField(task, ['title', 'taskTitle', 'name'], 'Regulatory task'))}</span>,
          },
          { key: 'category', label: 'Category', render: (task) => renderDrilldownValue(taskField(task, ['category', 'taskType', 'linkedEntityType', 'type'], 'Regulatory')) },
          { key: 'station', label: 'Station / District', render: (task) => renderDrilldownValue(taskField(task, ['stationName', 'station', 'district', 'stationDistrict'], '-')) },
          { key: 'severity', label: 'Severity', render: (task) => <StatusPill tone={statusToneFor(taskField(task, ['severity', 'priority'], ''))}>{renderDrilldownValue(taskField(task, ['severity', 'priority'], '-'))}</StatusPill> },
          { key: 'assignedOfficer', label: 'Assigned Officer', render: (task) => renderDrilldownValue(taskField(task, ['assignedOfficerName', 'assignedToName', 'assigneeName', 'assignedOfficer', 'assignedTo'], 'Unassigned')) },
          {
            key: 'dueDate',
            label: 'Due Date',
            render: (task) => {
              const due = taskDateValue(task)
              return <span className={isTaskOverdue(task) ? 'font-medium text-[#dc2626]' : ''}>{due ? tableDate(due) : '-'}</span>
            },
          },
          { key: 'status', label: 'Status', render: (task) => <StatusPill tone={statusToneFor(task.status)}>{task.status || '-'}</StatusPill> },
          { key: 'sourceEngine', label: 'Source Engine', render: (task) => renderDrilldownValue(taskField(task, ['sourceEngine', 'source', 'linkedEntityType'], 'Regulator Task Engine')) },
          {
            key: 'action',
            label: 'Action',
            className: 'text-right',
            render: (task) => (
              <div className="text-right">
                <button type="button" onClick={() => onOpenTask(task)} className="h-7 rounded-md border border-[#e2e8f0] bg-white px-2 text-[11px] font-medium text-[#6b7280] hover:bg-[#f9fafb]">Open</button>
              </div>
            ),
          },
        ]}
      />
    </section>
  )
}

function SavedViewsDashboardView({
  customViews,
  pinnedTabIds,
  onCreate,
  onOpen,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  customViews: DashboardCustomView[]
  pinnedTabIds: string[]
  onCreate: () => void
  onOpen: (id: string) => void
  onEdit: (id: string) => void
  onDuplicate: (id: string) => void
  onDelete: (id: string) => void
}) {
  const builtinViews = builtinDashboardTabs
    .filter((tab) => !['builtin-tasks', 'builtin-my-tasks', 'builtin-views'].includes(tab.id))
    .map((tab) => builtinViewFor(tab.id))
    .filter(Boolean) as DashboardCustomView[]
  const rows = [
    ...builtinViews.map((view) => ({ ...view, source: 'Built-in', pinned: true })),
    ...customViews.map((view) => ({ ...view, source: 'Saved View', pinned: pinnedTabIds.includes(view.id) })),
  ]

  return (
    <section className={lightPanel}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
        <div>
          <h2 className="text-[13px] font-medium uppercase tracking-[0.08em] text-[#111827]">Views</h2>
          <p className="mt-1 text-[12px] text-[#6b7280]">Saved and built-in command-centre views for national, regional, and district operations.</p>
        </div>
        <button type="button" onClick={onCreate} className="inline-flex h-8 items-center gap-1 rounded-md bg-[#111827] px-3 text-[12px] font-medium text-white hover:bg-[#111827]">
          <Plus className="size-4" />
          New View
        </button>
      </div>
      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
        {rows.map((view) => (
          <article key={view.id} className="rounded-md border border-[#e2e8f0] bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="size-2 rounded-full" style={{ background: colorPresets[view.colorPreset || 'slate'].accent }} />
                  <h3 className="truncate text-[14px] font-medium text-[#111827]">{view.label}</h3>
                </div>
                <div className="mt-1 text-[12px] text-[#6b7280]">{view.scopeType} - {view.scopeValue} - {view.product}</div>
              </div>
              <StatusPill tone={view.source === 'Built-in' ? 'neutral' : 'good'}>{view.source}</StatusPill>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              <div className="rounded-md bg-[#f9fafb] px-3 py-2">
                <div className="font-medium uppercase tracking-[0.08em] text-[#6b7280]">Blocks</div>
                <div className="mt-1 text-[15px] font-medium text-[#111827]">{view.blocks.length}</div>
              </div>
              <div className="rounded-md bg-[#f9fafb] px-3 py-2">
                <div className="font-medium uppercase tracking-[0.08em] text-[#6b7280]">Pinned</div>
                <div className="mt-1 text-[15px] font-medium text-[#111827]">{view.pinned ? 'Yes' : 'No'}</div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" onClick={() => onOpen(view.id)} className="h-8 rounded-md bg-[#111827] px-3 text-[12px] font-medium text-white hover:bg-[#111827]">Open</button>
              {view.source === 'Saved View' ? (
                <>
                  <button type="button" onClick={() => onEdit(view.id)} className="h-8 rounded-md border border-[#e2e8f0] px-3 text-[12px] font-medium text-[#6b7280] hover:bg-[#f9fafb]">Edit</button>
                  <button type="button" onClick={() => onDelete(view.id)} className="h-8 rounded-md border border-[#e2e8f0] px-3 text-[12px] font-medium text-[#dc2626] hover:bg-[#fef2f2]">Delete</button>
                </>
              ) : (
                <button type="button" onClick={() => onDuplicate(view.id)} className="h-8 rounded-md border border-[#e2e8f0] px-3 text-[12px] font-medium text-[#6b7280] hover:bg-[#f9fafb]">Duplicate</button>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}

function WidgetLibraryDrawer({
  open,
  onOpenChange,
  widgets,
  pinnedIds,
  onToggleWidget,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  widgets: DashboardWidget[]
  pinnedIds: string[]
  onToggleWidget: (id: string) => void
}) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="w-[560px] max-w-[94vw] border-[#e2e8f0] bg-white text-[#111827] sm:max-w-[560px]">
        <DrawerHeader className="border-b border-[#e2e8f0] p-5">
          <DrawerTitle className="text-[#111827]">Add Widget</DrawerTitle>
          <DrawerDescription className="text-[#6b7280]">Pin operational modules to this dashboard view and keep the national command surface focused.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-3">
            {widgets.map((widget) => {
              const pinned = pinnedIds.includes(widget.id)
              return (
                <button
                  key={widget.id}
                  type="button"
                  onClick={() => onToggleWidget(widget.id)}
                  className={`rounded-md border p-4 text-left transition ${
                    pinned ? 'border-[#e2e8f0] bg-[#ecfdf5]' : 'border-[#e2e8f0] bg-white hover:bg-[#f9fafb]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-md bg-[#f9fafb] px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.1em] text-[#6b7280]">{widget.category}</span>
                        <span className="text-[10px] font-medium uppercase tracking-[0.1em] text-[#2563eb]">{widget.size}</span>
                      </div>
                      <div className="mt-2 text-[14px] font-medium text-[#111827]">{widget.title}</div>
                      <div className="mt-1 text-[12px] leading-5 text-[#6b7280]">{widget.description}</div>
                    </div>
                    <span className={`grid size-8 shrink-0 place-items-center rounded-md border ${pinned ? 'border-[#e2e8f0] bg-[#ecfdf5] text-white' : 'border-[#e2e8f0] text-[#6b7280]'}`}>
                      {pinned ? <CheckCircle2 className="size-4" /> : <Plus className="size-4" />}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[#6b7280]">Metric</div>
                      <div className="mt-1 text-[16px] font-medium text-[#111827]">{widget.metric}</div>
                    </div>
                    <div className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[#6b7280]">Trend</div>
                      <div className="mt-1 text-[16px] font-medium text-[#2563eb]">{widget.trend}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <DrawerFooter className="border-t border-[#e2e8f0] p-5">
          <DrawerClose asChild>
            <Button type="button" variant="outline">
              Done
            </Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}

function DashboardExportModal({
  open,
  onOpenChange,
  defaultRange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultRange: string
}) {
  const { token } = usePortal()
  const [exportRange, setExportRange] = useState(defaultRange)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')

  useEffect(() => {
    if (open) setExportRange(defaultRange)
  }, [defaultRange, open])

  const exportGraph = async () => {
    if (!token) return
    setExporting(true)
    setExportError('')
    const exportedAt = new Date()
    try {
      const [payload, logoImage] = await Promise.all([
        portalApi.getNationalOperationsDashboard(token, exportRange),
        loadSmartlinkLogoPdfImage().catch(() => null),
      ])
      const rows = payload?.fuelAvailabilityHistory?.points || []
      const rangeLabel = getAvailabilityExportRangeLabel(exportRange, exportedAt)
      const pdf = buildAvailabilityExportPdf({
        rows,
        rangeLabel,
        generatedAt: exportedAt,
        logoImage,
      })
      const stamp = exportedAt.toISOString().slice(0, 16).replace(/[-:T]/g, '')
      downloadBinaryFile(`mera-national-operations-availability-${exportRange}-${stamp}.pdf`, pdf, 'application/pdf')
      onOpenChange(false)
    } catch (error: any) {
      setExportError(error?.message || 'Unable to export the dashboard PDF.')
    } finally {
      setExporting(false)
    }
  }

  return (
    <ModalShell
      open={open}
      onOpenChange={onOpenChange}
      title="Export National Operations"
      description="Choose the operational window to export. This keeps the existing availability PDF export path."
      className="border-[#e2e8f0] bg-white"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button type="button" onClick={exportGraph} disabled={exporting || !token}>
            <Download className="size-4" />
            {exporting ? 'Exporting' : 'Export PDF'}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {availabilityExportRanges.map((range) => (
            <button
              key={range.value}
              type="button"
              onClick={() => setExportRange(range.value)}
              className={`rounded-md border px-3 py-3 text-left text-sm font-medium transition ${
                exportRange === range.value
                  ? 'border-[#e2e8f0] bg-[#111827] text-white'
                  : 'border-[#e2e8f0] bg-white text-[#111827] hover:bg-[#f9fafb]'
              }`}
            >
              <span className="block">{range.label}</span>
              {'detail' in range ? <span className="mt-1 block text-xs font-medium text-[#6b7280]">{range.detail}</span> : null}
            </button>
          ))}
        </div>
        <div className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-3 py-3 text-sm text-[#111827]">
          The export package starts with the fuel availability series and keeps the MERA operational footer for audit circulation.
        </div>
        {exportError ? <div className="rounded-md border border-[#e2e8f0] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">{exportError}</div> : null}
      </div>
    </ModalShell>
  )
}

function normalizeIncidentItems(operations: any): IncidentQueueItem[] {
  const rows = Array.isArray(operations?.incidentQueue)
    ? operations.incidentQueue
    : Array.isArray(operations?.incidents)
      ? operations.incidents
      : Array.isArray(operations?.alerts)
        ? operations.alerts
        : []
  return rows.slice(0, 6).map((row: any, index: number) => ({
    id: row.id || row.publicId || row.sourceKey || `incident-${index}`,
    severity: String(row.severity || row.riskLevel || row.priority || 'info').toLowerCase().includes('critical')
      ? 'critical'
      : String(row.severity || row.riskLevel || row.priority || '').toLowerCase().includes('high')
        ? 'high'
        : String(row.severity || row.riskLevel || row.priority || '').toLowerCase().includes('medium')
          ? 'medium'
          : 'info',
    title: row.title || row.type || row.alertType || row.category || 'Incident',
    station: stationDisplayValue(row.station || row.stationName || row.name),
    district: row.district || row.city || '-',
    owner: row.owner || row.assignedOfficer || row.source || '-',
    slaMinutes: number(row.slaMinutes ?? row.sla_minutes),
    status: row.status || row.state || '-',
    action: row.action || row.recommendedAction || row.detail || row.description || '-',
  }))
}

function stationRiskFromHeatmap(rows: any[]): StationRiskRow[] {
  return (Array.isArray(rows) ? rows : []).slice(0, 12).map((row: any, index: number) => ({
    stationId: row.stationId || row.publicId || row.station_public_id || row.id || `station-${index}`,
    station: stationDisplayValue(row.station || row.stationName || row.name),
    district: row.district || row.city || '-',
    fuelDays: number(row.fuelDays ?? row.fuel_days ?? row.daysOfFuel ?? row.stockDays),
    lastSignal: row.lastSignal || row.last_signal || row.updatedAt || row.timestamp || '-',
    licenseStatus: row.licenseStatus || row.license_status || row.licenceStatus || '-',
    priceCheck: row.priceCheck || row.price_check || row.priceCompliance || '-',
    riskScore: number(row.riskScore ?? row.risk_score ?? row.risk),
    actionLabel: row.actionLabel || row.recommendedAction || row.status || '-',
  }))
}

function priceVarianceFromComplianceRows(rows: any[]) {
  const grouped = new Map<string, any>()
  rows.forEach((row: any) => {
    const region = row.district || row.city || row.region || 'National'
    const fuel = String(row.fuelType || row.fuel_type || '').toLowerCase()
    const mismatch = Math.abs(number(row.mismatchAmount ?? row.mismatch_amount ?? row.variance ?? row.priceVariance))
    if (!mismatch) return
    const current = grouped.get(region) || { region, petrol: 0, diesel: 0, lpg: 0 }
    if (fuel.includes('diesel')) current.diesel = Math.max(current.diesel, mismatch)
    else if (fuel.includes('lpg') || fuel.includes('gas')) current.lpg = Math.max(current.lpg, mismatch)
    else current.petrol = Math.max(current.petrol, mismatch)
    grouped.set(region, current)
  })
  return [...grouped.values()].slice(0, 8)
}

export function NationalDashboard() {
  const { data, token, realtimePulse, requestPackets, packetStatus } = usePortal()
  const navigate = useNavigate()
  const { setDashboardChrome, clearDashboardChrome } = useDashboardChrome()
  const [availabilityInterval, setAvailabilityInterval] = useState('1h')
  const [intervalOperations, setIntervalOperations] = useState<any>(null)
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [viewBuilderOpen, setViewBuilderOpen] = useState(false)
  const [editingViewId, setEditingViewId] = useState<string | null>(null)
  const [activeTabId, setActiveTabId] = useState('builtin-my-view')
  const [customViews, setCustomViews] = useState<DashboardCustomView[]>(loadCustomViews)
  const [pinnedTabIds, setPinnedTabIds] = useState<string[]>(loadPinnedTabs)
  const [pinnedWidgetIds, setPinnedWidgetIds] = useState(() => widgetLibrary.filter((widget) => widget.enabled).map((widget) => widget.id))
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
  const [filters, setFilters] = useState<NationalCommandFilterState>({
    search: '',
    jurisdiction: 'National',
    district: 'All Districts',
    product: 'All Products',
    dateRange: 'Live 24h',
    savedView: 'My View',
  })
  const operations = intervalOperations || data.nationalOperations || {}
  const kpis = operations.kpis || {}
  const kpiComparisons = operations.kpiComparisons || {}
  const fuelRows = Array.isArray(operations.fuelAvailability) ? operations.fuelAvailability : []
  const totalStations = number(kpis.totalStations?.value || 0, 0)
  const pieRows = fuelRows.map((row: any) => ({
    name: row.label,
    value: number(row.value),
    percent: row.total ? Math.round((number(row.value) / number(row.total, 1)) * 100) : 0,
  }))
  const compliance = operations.complianceSummary || {}
  const complianceRows = [
    { name: 'Inspections', value: number(compliance.inspections), color: '#185FA5' },
    { name: 'Compliant', value: number(compliance.compliant), color: '#1D9E75' },
    { name: 'Warnings', value: number(compliance.warnings), color: '#EF9F27' },
    { name: 'Violations', value: number(compliance.violations), color: '#E24B4A' },
  ]
  const complianceTotal = number(compliance.inspections) || number(compliance.compliant) + number(compliance.warnings) + number(compliance.violations)
  const complianceMatrixRows = complianceTotal ? [{
    label: 'Inspection Outcomes',
    compliant: Math.round(percentOf(compliance.compliant, complianceTotal)),
    watch: Math.round(percentOf(compliance.warnings, complianceTotal)),
    breach: Math.round(percentOf(compliance.violations, complianceTotal)),
  }] : []
  const priceComplianceRows = Array.isArray(data.priceCompliance?.compliance?.items) ? data.priceCompliance.compliance.items : []
  const priceVarianceRows = priceVarianceFromComplianceRows(priceComplianceRows)
  const availabilityHistory = Array.isArray(operations.fuelAvailabilityHistory?.points) ? operations.fuelAvailabilityHistory.points : []
  const mapStations = Array.isArray(data.nationalOperations?.heatmap)
    ? data.nationalOperations.heatmap
    : Array.isArray(operations.heatmap)
      ? operations.heatmap
      : Array.isArray(data.heatmap)
        ? data.heatmap
        : []
  const latestAvailability = availabilityHistory[availabilityHistory.length - 1] || {}
  const stationsOnline = number(kpis.stationsOnline?.value)
  const nationalCoverage = availabilityHistory.length
    ? percentOf(latestAvailability.stationsWithFuel, latestAvailability.totalStations)
    : number(kpis.stationsOnline?.percent)
  const criticalAlerts = number(kpis.criticalAlerts?.value)
  const complianceRiskCount = number(compliance.violations) + criticalAlerts
  const openEnforcementCases = criticalAlerts + number(compliance.violations)
  const stationRiskRows = stationRiskFromHeatmap(mapStations)
  const normalizedSearch = filters.search.trim().toLowerCase()
  const visibleRiskRows = stationRiskRows.filter((row) => {
    const districtOk = filters.district === 'All Districts' || row.district === filters.district
    const searchOk = !normalizedSearch || `${row.stationId} ${row.station} ${row.district}`.toLowerCase().includes(normalizedSearch)
    return districtOk && searchOk
  })
  const incidentItems = normalizeIncidentItems(operations).filter((item) => filters.district === 'All Districts' || item.district === filters.district)
  const pinnedWidgets = widgetLibrary.filter((widget) => pinnedWidgetIds.includes(widget.id))
  const activeCustomView = customViews.find((view) => view.id === activeTabId) || null
  const activeBuiltinView = activeCustomView || activeTabId === 'builtin-my-view' ? null : builtinViewFor(activeTabId)
  const editingView = customViews.find((view) => view.id === editingViewId) || null
  const dashboardTabs = useMemo(
    () => {
      const pinnedCustomViews = customViews.filter((view) => pinnedTabIds.includes(view.id))
      const unpinnedCustomViews = customViews.filter((view) => !pinnedTabIds.includes(view.id))
      return [
        ...builtinDashboardTabs,
        ...pinnedCustomViews.map((view) => ({ id: view.id, label: view.label, kind: 'custom' as const })),
        ...unpinnedCustomViews.map((view) => ({ id: view.id, label: view.label, kind: 'custom' as const })),
      ]
    },
    [customViews, pinnedTabIds],
  )
  const recentActivityRows = Array.isArray(operations.recentActivity) && operations.recentActivity.length
    ? operations.recentActivity
    : []
  const taskStats = data.taskStats || {}
  const systemTaskRows = Array.isArray(data.tasks?.items) ? data.tasks.items : []
  const assignedTaskRows = Array.isArray(data.myTasks?.items) ? data.myTasks.items : []
  const dashboardTaskRows = (assignedTaskRows.length ? assignedTaskRows : systemTaskRows).slice(0, 5)
  const allTaskRows = systemTaskRows.length ? systemTaskRows : assignedTaskRows
  const taskPanelTitle = Array.isArray(data.taskStats?.workloadByOfficer) && data.taskStats.workloadByOfficer.length ? 'Task Operations' : 'My Assigned Tasks'
  const stationKpiColumns = [
    { key: 'station', label: 'Station', render: (row: any) => row.station || row.name || row.stationName || row.station_id || '-' },
    { key: 'district', label: 'District', render: (row: any) => row.district || row.city || '-' },
    { key: 'fuelDays', label: 'Fuel Days', align: 'right' as const, render: (row: any) => row.fuelDays?.toFixed?.(1) || row.fuel_days || '-' },
    { key: 'riskScore', label: 'Risk', align: 'right' as const, render: (row: any) => row.riskScore ?? row.risk_score ?? '-' },
  ]
  const reserveKpiColumns = [
    { key: 'label', label: 'Product / Area', render: (row: any) => row.label || row.product || row.fuelType || row.district || '-' },
    { key: 'value', label: 'Value', align: 'right' as const, render: (row: any) => row.value ?? row.stockLevel ?? row.available_litres ?? '-' },
    { key: 'percent', label: 'Percent', align: 'right' as const, render: (row: any) => row.percent !== undefined ? `${row.percent}%` : '-' },
  ]
  const queueKpiColumns = [
    { key: 'stationName', label: 'Station', render: (row: any) => row.stationName || row.station || '-' },
    { key: 'district', label: 'District', render: (row: any) => row.district || '-' },
    { key: 'queueLength', label: 'Queue', align: 'right' as const, render: (row: any) => row.queueLength ?? row.queue_length ?? '-' },
    { key: 'status', label: 'Status', render: (row: any) => row.status || row.inspectionStatus || '-' },
  ]
  const forecastKpiColumns = [
    { key: 'station', label: 'Station', render: (row: any) => row.stationName || row.station || row.district || '-' },
    { key: 'fuelType', label: 'Fuel', render: (row: any) => row.fuelType || row.fuel_type || '-' },
    { key: 'avgWaitMinutes', label: 'Avg Wait', align: 'right' as const, render: (row: any) => row.avgWaitMinutes || row.avg_wait_minutes || '-' },
  ]
  const taskKpiColumns = [
    { key: 'taskNumber', label: 'Task', render: (row: any) => row.taskNumber || '-' },
    { key: 'title', label: 'Title', render: (row: any) => row.title || '-' },
    { key: 'priority', label: 'Priority', render: (row: any) => row.priority || '-' },
    { key: 'status', label: 'Status', render: (row: any) => row.status || '-' },
    { key: 'dueAt', label: 'Due', render: (row: any) => row.dueAt ? new Date(row.dueAt).toLocaleDateString() : '-' },
  ]
  const dashboardTaskIsOverdue = (task: any) => {
    if (task?.isOverdue) return true
    if (!task?.dueAt || ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(String(task.status || '').toUpperCase())) return false
    return new Date(task.dueAt).getTime() < Date.now()
  }
  const dashboardTaskKpis = [
    { label: 'Assigned', value: taskStats.myAssigned || 0, rows: allTaskRows.filter((task: any) => task.status === 'ASSIGNED') },
    { label: 'In Progress', value: taskStats.inProgress || 0, rows: allTaskRows.filter((task: any) => task.status === 'IN_PROGRESS') },
    { label: 'Overdue', value: taskStats.overdue || 0, rows: allTaskRows.filter(dashboardTaskIsOverdue) },
    { label: 'Critical', value: taskStats.critical || 0, rows: allTaskRows.filter((task: any) => task.priority === 'CRITICAL') },
    { label: 'Completed Week', value: taskStats.completedThisWeek || 0, rows: allTaskRows.filter((task: any) => task.status === 'COMPLETED') },
  ]

  useEffect(() => {
    if (!token) return
    if (availabilityInterval === '1h' && data.nationalOperations?.fuelAvailabilityHistory?.interval === '1h') {
      setIntervalOperations(null)
      return
    }

    setAvailabilityLoading(true)
    setIntervalOperations(null)
    requestPackets(['nationalOperations'], {
      paramsByKey: { nationalOperations: { availabilityInterval } },
      reason: 'availability-interval',
      force: true,
    }).finally(() => setAvailabilityLoading(false))
  }, [availabilityInterval, data.nationalOperations?.fuelAvailabilityHistory?.interval, realtimePulse, requestPackets, token])

  useEffect(() => {
    saveCustomViews(customViews)
  }, [customViews])

  useEffect(() => {
    savePinnedTabs(pinnedTabIds)
  }, [pinnedTabIds])

  const handleTabChange = useCallback((id: string) => {
    setActiveTabId(id)
    const builtin = builtinDashboardTabs.find((tab) => tab.id === id)
    const custom = customViews.find((view) => view.id === id)
    setFilters((current) => ({ ...current, savedView: builtin?.label || custom?.label || current.savedView }))
  }, [customViews])

  const openCreateView = useCallback(() => {
    setEditingViewId(null)
    setViewBuilderOpen(true)
  }, [])

  const openEditView = useCallback((id: string) => {
    if (!customViews.some((view) => view.id === id)) return
    setEditingViewId(id)
    setViewBuilderOpen(true)
  }, [customViews])

  const saveCustomView = useCallback((view: DashboardCustomView) => {
    setCustomViews((current) => {
      const exists = current.some((item) => item.id === view.id)
      if (!exists && current.length >= maxCustomViews) return current
      return exists
        ? current.map((item) => item.id === view.id ? view : item)
        : [...current, view]
    })
    setActiveTabId(view.id)
    setFilters((current) => ({ ...current, savedView: view.label, district: view.scopeType === 'District' ? view.scopeValue : current.district, product: view.product }))
    setViewBuilderOpen(false)
    setEditingViewId(null)
  }, [])

  const deleteCustomView = useCallback((id: string) => {
    const view = customViews.find((item) => item.id === id)
    if (!view) return
    if (!window.confirm(`Delete "${view.label}"?`)) return
    setCustomViews((current) => current.filter((item) => item.id !== id))
    if (activeTabId === id) {
      setActiveTabId('builtin-my-view')
      setFilters((current) => ({ ...current, savedView: 'My View' }))
    }
    if (editingViewId === id) {
      setEditingViewId(null)
      setViewBuilderOpen(false)
    }
  }, [activeTabId, customViews, editingViewId])

  const duplicateCustomView = useCallback((id: string) => {
    const view = customViews.find((item) => item.id === id) || builtinViewFor(id)
    if (!view || customViews.length >= maxCustomViews) return
    const now = new Date().toISOString()
    const copyView: DashboardCustomView = {
      ...view,
      id: createDashboardId('view'),
      label: uniqueViewLabel(`${view.label} Copy`, [...builtinDashboardTabs.map((tab) => tab.label), ...customViews.map((item) => item.label)]),
      blocks: cloneBlocks(view.blocks.length ? view.blocks : defaultDashboardBlocks()),
      createdAt: now,
      updatedAt: now,
    }
    setCustomViews((current) => [...current, copyView])
    setActiveTabId(copyView.id)
    setEditingViewId(copyView.id)
    setViewBuilderOpen(true)
  }, [customViews])

  const copyTabConfig = useCallback((id: string) => {
    const view = customViews.find((item) => item.id === id) || builtinViewFor(id)
    const label = dashboardTabs.find((tab) => tab.id === id)?.label || id
    const text = view ? JSON.stringify(view, null, 2) : label
    navigator.clipboard?.writeText(text).catch(() => {})
  }, [customViews, dashboardTabs])

  const togglePinnedTab = useCallback((id: string) => {
    setPinnedTabIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }, [])

  const refreshDashboard = useCallback(() => {
    if (!token) return
    setIntervalOperations(null)
    setAvailabilityLoading(true)
    requestPackets(['notifications', 'tasks', 'myTasks', 'taskStats', 'priceCompliance'], {
      reason: 'dashboard-sync-background',
      force: true,
      preferHttp: true,
      timeoutMs: 6000,
    }).catch(() => {})
    requestPackets(['nationalOperations', 'overview', 'heatmap'], {
      paramsByKey: { nationalOperations: { availabilityInterval } },
      reason: 'dashboard-sync-button',
      force: true,
      preferHttp: true,
      timeoutMs: 4500,
    })
      .finally(() => setAvailabilityLoading(false))
  }, [availabilityInterval, requestPackets, token])

  const toggleWidget = (id: string) => {
    setPinnedWidgetIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const stationSeries = kpis.stationsOnline?.sparkline || (
    availabilityHistory.length
      ? availabilityHistory.map((row: any) => number(row.stationsWithFuel)).slice(-8)
      : []
  )
  const activeStations = stationsOnline || number(latestAvailability.stationsWithFuel) || totalStations
  const previousActiveStations = comparisonPrevious(kpiComparisons, 'activeStations', number(stationSeries[stationSeries.length - 2], activeStations))
  const reserveSeries = kpis.nationalFuelReserve?.sparkline || kpis.depotStockDays?.sparkline || []
  const reserveDays = number(kpis.nationalFuelReserve?.value || kpis.depotStockDays?.value, number(reserveSeries[reserveSeries.length - 1]))
  const previousReserveDays = comparisonPrevious(kpiComparisons, 'nationalFuelReserve', number(reserveSeries[reserveSeries.length - 2], reserveDays))
  const inspectionRows = Array.isArray(data.inspections?.items) ? data.inspections.items : []
  const queuedDrivers = inspectionRows.reduce((sum: number, row: any) => sum + number(row.queueLength), 0)
  const queueSeries = kpis.activeDriverQueues?.sparkline || []
  const activeDriverQueues = number(kpis.activeDriverQueues?.value || operations.activeDriverQueues, queuedDrivers || number(queueSeries[queueSeries.length - 1]))
  const previousDriverQueues = comparisonPrevious(kpiComparisons, 'activeDriverQueues', number(queueSeries[queueSeries.length - 2], activeDriverQueues))
  const forecastRows = Array.isArray(data.demandForecastSummary?.rows) ? data.demandForecastSummary.rows : []
  const avgForecastWait = averageNumber(forecastRows.map((row: any) => row.avgWaitMinutes))
  const waitSeries = kpis.avgWaitTime?.sparkline || []
  const avgWaitMinutes = number(kpis.avgWaitTime?.value || operations.avgWaitMinutes, avgForecastWait || number(waitSeries[waitSeries.length - 1]))
  const previousAvgWaitMinutes = comparisonPrevious(kpiComparisons, 'avgWaitTime', number(waitSeries[waitSeries.length - 2], avgWaitMinutes))
  const fuelSupplyRows = Array.isArray(data.fuelDeliveryLogs?.items) ? data.fuelDeliveryLogs.items : []
  const caseRows = Array.isArray(data.flags?.items) ? data.flags.items : []
  const enforcementRows = Array.isArray(data.enforcementActions?.items)
    ? data.enforcementActions.items
    : Array.isArray(data.enforcementActions)
      ? data.enforcementActions
      : []
  const complaintRows = Array.isArray(data.complaints?.items) ? data.complaints.items : []
  const districtStressRows = Array.isArray(data.districtShortages) ? data.districtShortages : []

  const kpiCards = [
    {
      label: 'Total Active Stations',
      value: activeStations.toLocaleString(),
      delta: formatKpiDelta(activeStations, previousActiveStations),
      deltaTone: activeStations >= previousActiveStations ? 'good' : 'bad',
      accent: '#185FA5',
      icon: Gauge,
      sparkline: stationSeries,
      drilldown: {
        title: 'Total active stations',
        value: activeStations.toLocaleString(),
        subtitle: 'Station rows behind the active station signal.',
        rows: stationRiskRows.length ? stationRiskRows : mapStations,
        columns: stationKpiColumns,
      },
    },
    {
      label: 'National Fuel Reserve',
      value: `${reserveDays.toFixed(1)} days`,
      delta: formatKpiDelta(reserveDays, previousReserveDays, 'd', 1),
      deltaTone: reserveDays >= previousReserveDays ? 'good' : 'bad',
      accent: '#1D9E75',
      icon: Fuel,
      sparkline: reserveSeries,
      drilldown: {
        title: 'National fuel reserve',
        value: `${reserveDays.toFixed(1)} days`,
        subtitle: 'Fuel reserve and availability rows represented by this KPI.',
        rows: pieRows.length ? pieRows : fuelRows,
        columns: reserveKpiColumns,
      },
    },
    {
      label: 'Active Driver Queues',
      value: activeDriverQueues.toLocaleString(),
      delta: formatKpiDelta(activeDriverQueues, previousDriverQueues),
      deltaTone: activeDriverQueues <= previousDriverQueues ? 'good' : 'bad',
      accent: '#EF9F27',
      icon: Truck,
      sparkline: queueSeries,
    },
    {
      label: 'Avg Wait Time',
      value: `${Math.round(avgWaitMinutes)} min`,
      delta: formatKpiDelta(avgWaitMinutes, previousAvgWaitMinutes, ' min'),
      deltaTone: avgWaitMinutes <= previousAvgWaitMinutes ? 'good' : 'bad',
      accent: '#185FA5',
      icon: Clock3,
      sparkline: waitSeries,
      drilldown: {
        title: 'Average wait time',
        value: `${Math.round(avgWaitMinutes)} min`,
        subtitle: 'Demand forecast rows behind the average wait metric.',
        rows: forecastRows,
        columns: forecastKpiColumns,
      },
    },
  ].map((card: any) => ({
    ...card,
    onClick: card.drilldown ? () => setDrilldown(card.drilldown) : undefined,
  }))
  const chromeLastSync = operations.lastSync || operations.generatedAt

  useEffect(() => {
    setDashboardChrome({
      tabs: dashboardTabs,
      activeTabId,
      pinnedTabIds,
      onTabChange: handleTabChange,
      onCreateView: openCreateView,
      onEditView: openEditView,
      onDeleteView: deleteCustomView,
      onDuplicateTab: duplicateCustomView,
      onCopyTab: copyTabConfig,
      onPinTab: togglePinnedTab,
      onRefresh: refreshDashboard,
      loading: availabilityLoading || packetStatus?.nationalOperations === 'loading',
      lastSync: chromeLastSync,
    })
  }, [
    activeTabId,
    availabilityLoading,
    chromeLastSync,
    copyTabConfig,
    dashboardTabs,
    deleteCustomView,
    duplicateCustomView,
    handleTabChange,
    openCreateView,
    openEditView,
    pinnedTabIds,
    refreshDashboard,
    setDashboardChrome,
    togglePinnedTab,
    packetStatus?.nationalOperations,
  ])

  useEffect(() => clearDashboardChrome, [clearDashboardChrome])

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-[#f9fafb] px-3 pb-3 pt-3 text-[#111827]">
      <div className="mx-auto flex max-w-[1920px] flex-col gap-3">
        {activeTabId === 'builtin-national-overview' ? (
          <NationalOverviewDashboard
            activeStations={activeStations}
            reserveDays={reserveDays}
            activeDriverQueues={activeDriverQueues}
            complianceRiskCount={complianceRiskCount}
            kpiCards={kpiCards}
            totalStations={totalStations || activeStations}
            onlineStations={stationsOnline || activeStations}
            criticalAlerts={criticalAlerts}
            incidentItems={incidentItems}
            mapStations={mapStations}
            deliveryRows={fuelSupplyRows}
            caseRows={caseRows}
            inspectionRows={inspectionRows}
            complaintRows={complaintRows}
            districtRows={districtStressRows}
            onOpenKpi={setDrilldown}
          />
        ) : activeTabId === 'builtin-tasks' ? (
          <RegulatorTasksDashboardView
            title="Tasks"
            subtitle="System-generated regulatory tasks from risk, complaints, delivery, price, inspection, notice, evidence, and overdue case engines."
            rows={allTaskRows}
            onOpenTask={(task) => navigate(`/tasks/${task.taskNumber || task.publicId || task.public_id || task.id || ''}`)}
            onOpenAll={() => navigate('/tasks')}
          />
        ) : activeTabId === 'builtin-my-tasks' ? (
          <RegulatorTasksDashboardView
            title="My Tasks"
            subtitle="Assigned MERA work for the signed-in officer with status, severity, district, category, due today, and overdue filters."
            rows={assignedTaskRows.length ? assignedTaskRows : allTaskRows}
            filterable
            onOpenTask={(task) => navigate(`/tasks/${task.taskNumber || task.publicId || task.public_id || task.id || ''}`)}
            onOpenAll={() => navigate('/tasks/my')}
          />
        ) : activeTabId === 'builtin-views' ? (
          <SavedViewsDashboardView
            customViews={customViews}
            pinnedTabIds={pinnedTabIds}
            onCreate={openCreateView}
            onOpen={handleTabChange}
            onEdit={openEditView}
            onDuplicate={duplicateCustomView}
            onDelete={deleteCustomView}
          />
        ) : activeTabId === 'builtin-compliance-watch' ? (
          <ComplianceWatchCommand
            incidentItems={incidentItems}
            riskRows={stationRiskRows}
            priceVarianceRows={priceVarianceRows}
            complianceMatrixRows={complianceMatrixRows}
            caseRows={caseRows}
            inspectionRows={inspectionRows}
            complaintRows={complaintRows}
            onOpenRoute={navigate}
          />
        ) : activeTabId === 'builtin-enforcement' ? (
          <EnforcementWatchCommand
            enforcementRows={enforcementRows}
            riskRows={stationRiskRows}
            incidentItems={incidentItems}
            caseRows={caseRows}
            onOpenRoute={navigate}
          />
        ) : activeCustomView || activeBuiltinView ? (
          <CustomDashboardView
            view={(activeCustomView || activeBuiltinView)!}
            kpiCards={kpiCards}
            totalStations={totalStations || activeStations}
            onlineStations={stationsOnline || activeStations}
            criticalAlerts={criticalAlerts}
            incidentItems={incidentItems}
            riskRows={stationRiskRows}
            priceVarianceRows={priceVarianceRows}
            complianceMatrixRows={complianceMatrixRows}
            editable={Boolean(activeCustomView)}
            onEdit={activeCustomView ? () => openEditView(activeCustomView.id) : undefined}
            onDuplicate={!activeCustomView && activeBuiltinView ? () => duplicateCustomView(activeBuiltinView.id) : undefined}
          />
        ) : (
          <>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              {kpiCards.map((item) => <NationalKpiCard key={item.label} {...item} />)}
            </div>

            {data.taskStats ? (
              <div className="overflow-hidden rounded-md border border-[#e2e8f0] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
                  <div>
                    <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-[#111827]">{taskPanelTitle}</h3>
                    <p className="mt-1 text-[11px] text-[#6b7280]">Assigned work, escalations, and overdue regulatory actions</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => navigate('/tasks/my')} className="h-8 rounded-md border border-[#e2e8f0] bg-white px-3 text-[12px] font-medium text-[#6b7280] hover:bg-[#f9fafb]">
                      My Tasks
                    </button>
                    <button type="button" onClick={() => navigate('/tasks')} className="h-8 rounded-md bg-[#111827] px-3 text-[12px] font-medium text-white hover:bg-[#111827]">
                      View All
                    </button>
                  </div>
                </div>
                <div className="grid gap-0 border-b border-[#e2e8f0] sm:grid-cols-5">
                  {dashboardTaskKpis.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => setDrilldown({ title: item.label, value: Number(item.value || 0), subtitle: 'Task records represented by this KPI.', rows: item.rows, columns: taskKpiColumns })}
                      className="border-r border-[#e2e8f0] px-4 py-3 text-left last:border-r-0 hover:bg-[#f9fafb]"
                    >
                      <div className="text-[10px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">{item.label}</div>
                      <div className={`mt-1 text-xl font-medium ${['Overdue', 'Critical'].includes(String(item.label)) ? 'text-[#dc2626]' : 'text-[#111827]'}`}>{Number(item.value || 0)}</div>
                    </button>
                  ))}
                </div>
                <div className="divide-y divide-[#e2e8f0]">
                  {dashboardTaskRows.length ? dashboardTaskRows.map((task: any) => (
                    <button key={task.taskNumber} type="button" onClick={() => navigate(`/tasks/${task.taskNumber}`)} className="grid w-full gap-2 px-4 py-3 text-left text-[12px] hover:bg-[#f9fafb] md:grid-cols-[120px_minmax(0,1fr)_110px_110px_130px]">
                      <span className="font-medium text-[#111827]">{task.taskNumber}</span>
                      <span className="min-w-0 truncate text-[#6b7280]">{task.title}</span>
                      <span className={task.priority === 'CRITICAL' ? 'font-medium text-[#dc2626]' : 'text-[#6b7280]'}>{task.priority}</span>
                      <span className="text-[#6b7280]">{task.status}</span>
                      <span className={task.isOverdue ? 'font-medium text-[#dc2626]' : 'text-[#6b7280]'}>{task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No due date'}</span>
                    </button>
                  )) : (
                    <div className="px-4 py-6 text-center text-[12px] text-[#6b7280]">No assigned task activity.</div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
              <NationalSupplyCommandPanel
                totalStations={totalStations || activeStations}
                onlineStations={stationsOnline || activeStations}
                criticalAlerts={criticalAlerts}
              />
              <FuelReserveStatusPanel />
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.08fr)_minmax(0,0.96fr)_minmax(0,0.96fr)]">
              <SupplyPipelinePanel />
              <ComplianceAlertsPanel items={incidentItems} />
              <ConsumptionPanel />
            </div>
          </>
        )}
      </div>

      <ViewBuilderDrawer
        open={viewBuilderOpen}
        onOpenChange={setViewBuilderOpen}
        editingView={editingView}
        customViews={customViews}
        onSave={saveCustomView}
        onDuplicate={duplicateCustomView}
        onDelete={deleteCustomView}
      />
      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />
    </div>
  )
}
