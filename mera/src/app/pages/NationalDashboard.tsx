import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  BellRing,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
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
import { KpiDrilldownDrawer, type DrilldownConfig } from '../components/KpiDrilldown'
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
  mockAnomalies,
  mockComplianceMatrix,
  mockIncidentQueue,
  mockPriceVariance,
  mockStationRisks,
  productFilters,
  savedNationalViews,
  widgetLibrary,
  type DashboardWidget,
  type IncidentQueueItem,
  type StationRiskRow,
} from '../data/nationalOperationsMock'

const card = 'mera-glass-strong rounded-[10px] text-white shadow-[0_18px_52px_-34px_rgba(0,0,0,0.92)]'
const commandSurface = 'mera-glass-strong rounded-[10px] text-white shadow-[0_18px_48px_-34px_rgba(0,0,0,0.9)]'
const darkPanel = 'mera-glass-strong rounded-[10px] text-white shadow-[0_18px_52px_-34px_rgba(0,0,0,0.92)]'
const lightPanel = 'overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white'

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
  { id: 'builtin-fuel-supply', label: 'Fuel Supply', kind: 'builtin' as const },
  { id: 'builtin-compliance-watch', label: 'Compliance Watch', kind: 'builtin' as const },
  { id: 'builtin-enforcement', label: 'Enforcement', kind: 'builtin' as const },
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

type DashboardCustomView = {
  id: string
  label: string
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
  context.fillStyle = '#ffffff'
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
  const statusColor = latestAvailabilityPct >= 90 ? '#0f9f58' : latestAvailabilityPct >= 75 ? '#b7791f' : '#b91c1c'
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
  const addText = (text: any, x: number, y: number, size: number, color = '#050505', font = 'F1', align: 'left' | 'center' | 'right' = 'left') => {
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
    addRect(x, y, cardWidth, 58, '#ffffff', '#d7dde5', 0.8)
    addRect(x, y, 4, 58, accent)
    addText(label.toUpperCase(), x + 15, y + 17, 7.6, '#657080', 'F2')
    addText(value, x + 15, y + 40, 18, '#111827', 'F2')
    addText(detail, x + cardWidth - 12, y + 39, 8.2, '#657080', 'F1', 'right')
  }

  addRect(0, 0, width, height, '#eef3f7')
  addRect(22, 22, width - 44, height - 44, '#ffffff', '#c8d2dc', 1)
  addRect(22, 22, width - 44, 92, '#102033')
  addRect(22, 112, width - 44, 3, statusColor)

  const logoX = 48
  const logoY = 44
  if (logoImage) {
    commands.push(`q 34 0 0 34 ${pdfNumber(logoX)} ${pdfNumber(pdfY(logoY + 34))} cm /Im1 Do Q`)
  } else {
    addRect(logoX, logoY, 34, 34, '#ffffff')
    addText('S', logoX + 11, logoY + 23, 16, '#102033', 'F2')
  }
  addText('MERA NATIONAL FUEL INFRASTRUCTURE', logoX + 46, 49, 17, '#ffffff', 'F2')
  addText('Availability and Delivery Verification Command Export', logoX + 46, 70, 9.2, '#b9c6d4')
  addText(`Coverage Window: ${rangeLabel}`, logoX + 46, 91, 9.2, '#dce5ef', 'F2')
  addRect(width - 212, 43, 164, 30, '#182c43', '#33506d', 0.8)
  addText('NATIONAL LEVEL', width - 130, 62, 9, '#ffffff', 'F2', 'center')
  addText(`Generated ${generatedLabel}`, width - 48, 92, 8.4, '#b9c6d4', 'F1', 'right')

  addMetricCard(48, 136, 174, 'Network Availability', `${latestAvailabilityPct.toFixed(1)}%`, `${number(latest.stationsWithFuel).toLocaleString()} / ${totalStations.toLocaleString()} stations`, '#0f9f58')
  addMetricCard(236, 136, 174, 'Delivery Verified', `${latestVerifiedPct.toFixed(1)}%`, `${number(latest.deliveryVerifiedStationsWithFuel).toLocaleString()} verified`, '#2563eb')
  addMetricCard(424, 136, 174, 'Availability Floor', `${minAvailabilityPct.toFixed(1)}%`, `avg ${avgAvailabilityPct.toFixed(1)}%`, '#64748b')
  addMetricCard(612, 136, 182, 'Operational Gap', availabilityGap.toLocaleString(), statusLabel, statusColor)

  addText('National Availability Corridor', 48, 214, 13.5, '#111827', 'F2')
  addText('Stations carrying fuel as a share of the active national network. Threshold bands are regulator operating bands.', 48, 230, 8.2, '#64748b')
  addRect(plot.left, plot.top, plotWidth, plotHeight, '#fbfdff', '#d4dde7', 0.9)
  addRect(plot.left, yForPct(100), plotWidth, yForPct(90) - yForPct(100), '#edf9f1')
  addRect(plot.left, yForPct(90), plotWidth, yForPct(75) - yForPct(90), '#fff8df')
  addRect(plot.left, yForPct(75), plotWidth, yForPct(0) - yForPct(75), '#fff1f0')
  addText('Stable', plot.left + plotWidth - 10, yForPct(96), 7.2, '#0f9f58', 'F2', 'right')
  addText('Watch', plot.left + plotWidth - 10, yForPct(84), 7.2, '#b7791f', 'F2', 'right')
  addText('Critical', plot.left + plotWidth - 10, yForPct(52), 7.2, '#b91c1c', 'F2', 'right')

  yTicks.forEach((tick) => {
    const y = yForPct(tick)
    addLine(plot.left, y, plot.left + plotWidth, y, tick === 75 || tick === 90 ? '#b9c4cf' : '#e2e8f0', tick === 75 || tick === 90 ? 0.95 : 0.55, tick === 75 || tick === 90 ? '[4 3] 0 d' : '')
    addText(`${tick}%`, plot.left - 13, y + 3, 8, '#667085', 'F1', 'right')
  })
  xTicks.forEach(({ row, index }) => {
    const x = xFor(index)
    addLine(x, plot.top, x, plot.top + plotHeight, '#eef2f7', 0.4)
    addText(row.label, x, plot.top + plotHeight + 18, 7.5, '#667085', 'F1', 'center')
  })

  addFilledSeries(fuelPoints, plot.top + plotHeight, '#c8f4d6')
  addPolyline(fuelPoints, '#0f9f58', 2.8)
  addPolyline(verifiedPoints, '#2563eb', 2.2)
  if (fuelPoints.length <= 72) fuelPoints.forEach((point) => addCircle(point.x, point.y, 2.7, '#ffffff', '#0f9f58', 1.2))
  if (verifiedPoints.length <= 72) verifiedPoints.forEach((point) => addCircle(point.x, point.y, 2.2, '#ffffff', '#2563eb', 1.1))

  const legendY = 432
  addRect(48, legendY, 252, 34, '#ffffff', '#d7dde5', 0.8)
  addCircle(66, legendY + 17, 4, '#0f9f58')
  addText('National availability', 80, legendY + 21, 8.8, '#111827', 'F2')
  addText('stations carrying fuel / active network', 184, legendY + 21, 7.4, '#667085')
  addRect(312, legendY, 216, 34, '#ffffff', '#d7dde5', 0.8)
  addCircle(330, legendY + 17, 4, '#2563eb')
  addText('Delivery verified', 344, legendY + 21, 8.8, '#111827', 'F2')
  addText('recent delivery evidence', 432, legendY + 21, 7.4, '#667085')
  addRect(540, legendY, 254, 34, '#ffffff', '#d7dde5', 0.8)
  addText('Thresholds', 558, legendY + 21, 8.8, '#111827', 'F2')
  addText('90% stable | 75% watch | below 75% critical', 620, legendY + 21, 7.4, '#667085')

  const tableX = 48
  const tableY = 476
  const rowHeight = 7.8
  addText('Recent National Data Points', tableX, tableY - 10, 9.6, '#111827', 'F2')
  addRect(tableX, tableY, width - 96, 18 + tableRows.length * rowHeight, '#ffffff', '#d7dde5', 0.8)
  addRect(tableX, tableY, width - 96, 18, '#f1f5f9')
  const columns = [
    { label: 'Time', x: tableX + 14, align: 'left' as const },
    { label: 'Available', x: tableX + 190, align: 'right' as const },
    { label: 'Availability %', x: tableX + 312, align: 'right' as const },
    { label: 'Verified', x: tableX + 452, align: 'right' as const },
    { label: 'Verified %', x: tableX + 574, align: 'right' as const },
    { label: 'Active Network', x: tableX + 720, align: 'right' as const },
  ]
  columns.forEach((column) => addText(column.label, column.x, tableY + 12, 7.2, '#475467', 'F2', column.align))
  tableRows.forEach((row, index) => {
    const y = tableY + 28 + index * rowHeight
    if (index % 2 === 0) addRect(tableX + 1, y - 7, width - 98, rowHeight, '#fbfdff')
    addText(row.label, tableX + 14, y, 7.2, '#1f2937')
    addText(number(row.stationsWithFuel).toLocaleString(), tableX + 190, y, 7.2, '#1f2937', 'F1', 'right')
    addText(`${availabilityPct(row).toFixed(1)}%`, tableX + 312, y, 7.2, '#0f9f58', 'F2', 'right')
    addText(number(row.deliveryVerifiedStationsWithFuel).toLocaleString(), tableX + 452, y, 7.2, '#1f2937', 'F1', 'right')
    addText(`${verifiedPct(row).toFixed(1)}%`, tableX + 574, y, 7.2, '#2563eb', 'F2', 'right')
    addText(number(row.totalStations, totalStations).toLocaleString(), tableX + 720, y, 7.2, '#1f2937', 'F1', 'right')
  })

  addLine(48, height - 34, width - 48, height - 34, '#cfd8e3', 0.8)
  addText('Smartlink MERA Portal | National operations export | Inventory-derived availability and delivery verification series.', 48, height - 18, 7.6, '#667085')
  addText('For operational oversight and infrastructure planning use.', width - 48, height - 18, 7.6, '#667085', 'F1', 'right')

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
      <h2 className="text-[14px] font-semibold uppercase tracking-[-0.02em] text-[var(--mera-panel-text)]">{title}</h2>
      <button type="button" className="rounded-[5px] px-1.5 py-0.5 text-[12px] font-medium text-[var(--mera-info)] transition duration-150 hover:bg-[var(--mera-hover)] hover:text-[var(--mera-panel-text)]">{action}</button>
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
          <h2 className="truncate text-[14px] font-semibold uppercase tracking-[-0.02em] text-[var(--mera-panel-text)]">Fuel Availability Overview</h2>
          <div className="mt-1 truncate text-[12px] text-[var(--mera-panel-text-muted)]">
            {mode === 'history' ? 'National availability percentage against time' : 'By fuel type'}
          </div>
        </div>
        {mode === 'history' ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            <div className="flex max-w-full shrink-0 overflow-x-auto rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-0.5">
              {availabilityIntervals.map((interval) => (
                <button
                  key={interval}
                  type="button"
                  onClick={() => onIntervalChange?.(interval)}
                  className={`h-6 rounded-[5px] px-2 text-[10px] font-semibold transition ${
                    selectedInterval === interval ? 'bg-[var(--mera-shell-active)] text-[var(--mera-brand)]' : 'text-[var(--mera-panel-text-muted)] hover:text-[var(--mera-panel-text)]'
                  }`}
                >
                  {interval}
                </button>
              ))}
            </div>
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] px-2.5 text-[11px] font-semibold text-[var(--mera-panel-text)] transition hover:bg-[var(--mera-hover)]"
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
              <div className="text-[26px] font-semibold leading-none tracking-[-0.04em] text-[var(--mera-panel-text)]">
                {number(latest.stationsWithFuel).toLocaleString()}
              </div>
              <div className="mt-1 truncate text-[11px] text-[var(--mera-panel-text-muted)]">
                of {number(latest.totalStations).toLocaleString()} stations currently carrying fuel
              </div>
              <div className="mt-1 inline-flex items-center gap-2 text-[11px] text-[var(--mera-panel-text-muted)]">
                <span className="h-px w-5 bg-[var(--mera-info)]" />
                {number(latest.deliveryVerifiedStationsWithFuel).toLocaleString()} delivery-verified
              </div>
            </div>
            {loading ? <div className="text-[11px] font-medium text-[var(--mera-info)]">Updating</div> : null}
          </div>
          <div className="mt-3 h-[176px] min-h-[176px] min-w-0 overflow-visible pb-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartRows} margin={{ top: 10, right: 14, bottom: 8, left: 2 }}>
                <defs>
                  <linearGradient id="availabilityFuelFill" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#32db64" stopOpacity={0.28} />
                    <stop offset="78%" stopColor="#32db64" stopOpacity={0.03} />
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
                  contentStyle={{ background: 'var(--mera-chart-tooltip-bg)', border: '1px solid var(--mera-chart-tooltip-border)', borderRadius: 7, color: 'var(--mera-chart-tooltip-text)' }}
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
                  stroke="#32db64"
                  strokeWidth={2.4}
                  fill="url(#availabilityFuelFill)"
                  dot={{ r: 2.4, strokeWidth: 1.4, fill: 'var(--mera-panel)', stroke: '#32db64' }}
                  activeDot={{ r: 4 }}
                  connectNulls
                />
                <Line
                  type="monotone"
                  dataKey="deliveryVerifiedPercent"
                  stroke="var(--mera-info)"
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
                {['#32db64', '#ffd21f', '#ff991f', '#ff3434'].map((color) => <Cell key={color} fill={color} />)}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          {pieRows.map((row: any, index: number) => (
            <div key={row.name} className="flex items-start gap-2 text-[12px]">
              <span className="mt-1 size-2 rounded-full" style={{ background: ['#32db64', '#ffd21f', '#ff991f', '#ff3434'][index] }} />
              <div className="min-w-0 flex-1">
                <div className="flex justify-between gap-2 text-[var(--mera-panel-text)]">
                  <span className="truncate">{row.name}</span>
                  <span>{row.percent}%</span>
                </div>
                <div className="text-[10px] text-[var(--mera-panel-text-muted)]">({row.value} stations)</div>
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
          className="border-[var(--mera-panel-border)] bg-[var(--mera-panel)]"
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
            <label className="text-sm font-semibold text-[var(--mera-panel-text)]">Range</label>
            <div className="grid gap-2 sm:grid-cols-2">
              {availabilityExportRanges.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  onClick={() => setExportRange(range.value)}
                  className={`rounded-[10px] border px-3 py-3 text-left text-sm font-semibold transition ${
                    exportRange === range.value
                      ? 'border-[var(--mera-panel-text)] bg-[var(--mera-shell-active)] text-[var(--mera-brand)]'
                      : 'border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text-soft)] hover:bg-[var(--mera-hover)]'
                  }`}
                >
                  <span className="block">{range.label}</span>
                  {'detail' in range ? <span className="mt-1 block text-xs font-medium text-[var(--mera-panel-text-muted)]">{range.detail}</span> : null}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3 rounded-[10px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel-muted)] px-3 py-3">
              <img src="/smartlink-mark-tight.png" alt="" className="size-9 object-contain" />
              <div>
                <div className="text-sm font-semibold text-[var(--mera-panel-text)]">Smartlink footer included</div>
                <div className="text-xs text-[var(--mera-panel-text-muted)]">Every PDF export includes the Smartlink logo and footer.</div>
              </div>
            </div>
            {exportError ? <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</div> : null}
          </div>
        </ModalShell>
      ) : null}
    </section>
  )
}

function severityMeta(severity: string) {
  const key = String(severity || '').toLowerCase()
  if (key === 'critical') return { label: 'Critical', color: '#ff3434', bg: 'rgba(255,52,52,0.12)' }
  if (key === 'high') return { label: 'High', color: '#ff991f', bg: 'rgba(255,153,31,0.14)' }
  if (key === 'medium' || key === 'warning') return { label: 'Watch', color: '#ffd21f', bg: 'rgba(255,210,31,0.14)' }
  return { label: 'Info', color: '#2e9dff', bg: 'rgba(46,157,255,0.12)' }
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
    <label className="relative h-10 min-w-[148px] shrink-0 rounded-[7px] border border-white/10 bg-white/[0.045] px-3 py-1.5 text-left text-white transition hover:bg-white/[0.075]">
      <span className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.11em] text-slate-400">
        <Icon className="size-3" />
        {label}
      </span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-0.5 h-5 w-full appearance-none bg-transparent pr-5 text-[12px] font-semibold leading-none text-white outline-none"
      >
        {options.map((option) => (
          <option key={option} value={option} className="bg-[#081522] text-white">
            {option}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute bottom-2.5 right-2.5 size-3.5 text-slate-400" />
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
  const tabs = ['My View', 'National Overview', 'Fuel Supply', 'Compliance Watch', 'Enforcement']

  return (
    <section className="flex min-h-12 flex-wrap items-center gap-2 rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-1.5">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1 gap-y-1">
        {tabs.map((view) => (
          <button
            key={view}
            type="button"
            onClick={() => updateFilter('savedView', view)}
            className={`flex h-8 min-w-0 items-center rounded-[4px] border px-3 text-[13px] transition ${
              filters.savedView === view
                ? 'border-[#111827] bg-[#111827] font-semibold text-white'
                : 'border-transparent text-[#6b7280] hover:bg-[#f9fafb] hover:text-[#111827]'
            }`}
          >
            <span className="truncate">{view}</span>
          </button>
        ))}
        <button type="button" onClick={onOpenWidgets} className="flex h-8 items-center gap-1 rounded-[4px] border border-transparent px-3 text-[13px] font-medium text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]">
          <Plus className="size-4" />
          New View
        </button>
      </div>
      <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">
        <span className="hidden items-center gap-1 text-[12px] font-medium text-[#9ca3af] lg:inline-flex">
          <span className={`size-1.5 rounded-full ${loading ? 'animate-pulse bg-[#f59e0b]' : 'bg-[#10b981]'}`} />
          {lastSync ? `Last sync ${timeAgo(lastSync)}` : 'Sync pending'}
        </span>
        <button type="button" onClick={onRefresh} className="grid size-8 place-items-center rounded-[4px] border border-[#e2e8f0] bg-white text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]" aria-label="Refresh national operations">
          <RefreshCcw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
        <button type="button" onClick={onOpenExport} className="grid size-8 place-items-center rounded-[4px] border border-[#e2e8f0] bg-white text-[#6b7280] transition hover:bg-[#f9fafb] hover:text-[#111827]" aria-label="Export national operations">
          <FileDown className="size-4" />
        </button>
        <button type="button" onClick={onOpenWidgets} className="inline-flex h-8 items-center gap-1 rounded-[4px] bg-[#111827] px-3 text-[12px] font-semibold text-white transition hover:bg-[#1f2937]">
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
        : 'bg-[#f3f4f6] text-[#6b7280]'

  const className = `group relative min-h-[132px] overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white px-4 py-4 text-left ${
    onClick ? 'transition hover:-translate-y-0.5 hover:border-[#cbd5e0] hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-[#111827]/15' : ''
  }`
  const content = (
    <>
      <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: accent }} />
      <div className="min-w-0">
        <div className="truncate text-[11px] font-semibold uppercase tracking-[0.09em] text-[#9ca3af]">{label}</div>
        <div className="mt-3 truncate text-[30px] font-bold leading-none tracking-[-0.02em] text-[#111827]">{value}</div>
        <div className="mt-3 flex items-center gap-2">
          <span className={`rounded-[3px] px-2 py-1 text-[12px] font-bold leading-none ${deltaClass}`}>{delta}</span>
          <span className="text-[12px] font-medium text-[#9ca3af]">vs yesterday</span>
        </div>
      </div>
      <div className="absolute bottom-3 right-3 h-8 w-[82px] opacity-40">
        <Sparkline data={sparkline} color={accent} />
      </div>
      {onClick ? <ArrowUpRight className="absolute right-3 top-3 size-4 text-[#cbd5e0] transition group-hover:text-[#111827]" /> : null}
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
    <div className="flex min-h-12 items-center justify-between gap-3 border-b border-[#f1f5f9] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon className="size-4 shrink-0 text-[#2563eb]" />
        <h2 className="truncate text-[13px] font-bold uppercase tracking-[0.08em] text-[#374151]">{title}</h2>
      </div>
      {meta ? <div className="shrink-0">{meta}</div> : children}
    </div>
  )
}

function StatusPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass =
    tone === 'good'
      ? 'border-[#a7f3d0] bg-[#ecfdf5] text-[#059669]'
      : tone === 'warn'
        ? 'border-[#fde68a] bg-[#fffbeb] text-[#d97706]'
        : tone === 'bad'
          ? 'border-[#fecaca] bg-[#fef2f2] text-[#dc2626]'
          : 'border-[#e5e7eb] bg-[#f3f4f6] text-[#6b7280]'

  return <span className={`inline-flex items-center rounded-[3px] border px-2 py-0.5 text-[11px] font-semibold ${toneClass}`}>{children}</span>
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
    { name: 'Northern', coverage: 86, tone: '#f59e0b', status: 'Watch', statusTone: 'warn' as const },
    { name: 'Central', coverage: 94, tone: '#10b981', status: 'Stable', statusTone: 'good' as const },
    { name: 'Southern', coverage: 79, tone: '#ef4444', status: 'Pressure', statusTone: 'bad' as const },
  ]
  const metaItems = [
    { label: 'Stations', value: totalStations.toLocaleString(), className: 'text-[#374151]' },
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
                <div className={`text-[14px] font-bold leading-none ${item.className}`}>{item.value}</div>
                <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">{item.label}</div>
              </div>
            ))}
          </div>
        }
      />
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="border-b border-[#f1f5f9] p-4 lg:border-b-0 lg:border-r">
          <svg className="h-full min-h-[280px] w-full rounded-[5px] border border-[#f1f5f9] bg-[#f8fafc]" viewBox="0 0 460 260" role="img" aria-label="Malawi national supply status map">
            <rect width="460" height="260" fill="#f8fafc" />
            {[52, 104, 156, 208].map((y) => <line key={`h-${y}`} x1="0" y1={y} x2="460" y2={y} stroke="#eef2f7" strokeWidth="1" />)}
            {[115, 230, 345].map((x) => <line key={`v-${x}`} x1={x} y1="0" x2={x} y2="260" stroke="#eef2f7" strokeWidth="1" />)}
            <path d="M234 22 L253 34 L265 57 L270 82 L267 105 L273 128 L281 154 L283 184 L276 209 L262 230 L249 242 L236 246 L224 238 L212 218 L204 193 L199 168 L193 143 L190 119 L194 94 L200 70 L211 46 L224 28 Z" fill="#eff6ff" stroke="#bfdbfe" strokeWidth="2" />
            <path d="M257 35 L269 58 L270 82 L264 105 L256 98 L251 76 L248 55 Z" fill="#dbeafe" stroke="#93c5fd" strokeWidth="1" opacity="0.85" />
            {[
              { label: 'Karonga', x: 258, y: 44, color: '#f59e0b' },
              { label: 'Mzuzu', x: 248, y: 82, color: '#10b981' },
              { label: 'Lilongwe', x: 225, y: 142, color: '#10b981', r: 7 },
              { label: 'Zomba', x: 236, y: 187, color: '#f59e0b' },
              { label: 'Blantyre', x: 220, y: 216, color: '#ef4444', r: 7 },
            ].map((point) => (
              <g key={point.label}>
                <circle cx={point.x} cy={point.y} r={(point as any).r || 6} fill={point.color} opacity="0.95" />
                <circle cx={point.x} cy={point.y} r={12} fill="none" stroke={point.color} strokeWidth="1.2" opacity="0.28" />
                <text x={point.x + 14} y={point.y + 5} fill="#6b7280" fontSize="12" fontFamily="Inter, sans-serif">{point.label}</text>
              </g>
            ))}
            {[
              { x: 214, y: 63, color: '#10b981' },
              { x: 232, y: 113, color: '#10b981' },
              { x: 207, y: 164, color: '#f59e0b' },
              { x: 214, y: 126, color: '#10b981' },
            ].map((dot, index) => <circle key={index} cx={dot.x} cy={dot.y} r="4" fill={dot.color} opacity="0.55" />)}
            <g transform="translate(20 232)">
              <circle cx="0" cy="0" r="5" fill="#10b981" />
              <text x="10" y="4" fill="#9ca3af" fontSize="11">Operational</text>
              <circle cx="104" cy="0" r="5" fill="#f59e0b" />
              <text x="114" y="4" fill="#9ca3af" fontSize="11">Low Stock</text>
              <circle cx="197" cy="0" r="5" fill="#ef4444" />
              <text x="207" y="4" fill="#9ca3af" fontSize="11">Critical</text>
            </g>
          </svg>
        </div>
        <div className="grid content-start gap-3 p-4">
          {regions.map((region) => (
            <div key={region.name} className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <div className="text-[13px] font-semibold text-[#374151]">{region.name}</div>
                <div className="text-[13px] font-bold" style={{ color: region.tone }}>{region.coverage}%</div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
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
    { fuel: 'Petrol', reserve: 71, burn: '4.2 ML/d', depletion: '8.2 days', tone: '#2563eb', status: 'ok' },
    { fuel: 'Diesel', reserve: 84, burn: '5.8 ML/d', depletion: '11.4 days', tone: '#10b981', status: 'ok' },
    { fuel: 'Kerosene', reserve: 38, burn: '1.1 ML/d', depletion: '3.8 days', tone: '#f59e0b', status: 'warn' },
    { fuel: 'Jet A-1', reserve: 22, burn: '0.8 ML/d', depletion: '2.1 days', tone: '#ef4444', status: 'crit' },
    { fuel: 'LPG', reserve: 61, burn: '0.6 ML/d', depletion: '7.0 days', tone: '#64748b', status: 'neutral' },
  ]
  const variance = [
    { label: 'Petrol variance', value: '+MWK 61/L', tone: '#d97706' },
    { label: 'Diesel variance', value: '+MWK 12/L', tone: '#059669' },
    { label: 'Kerosene variance', value: '+MWK 94/L', tone: '#dc2626' },
  ]

  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={Fuel} title="Fuel Reserve Status" />
      <div className="grid grid-cols-[minmax(130px,1fr)_110px_92px_92px] gap-3 border-b border-[#f1f5f9] px-4 py-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#9ca3af] max-sm:hidden">
        <div>Fuel Type</div>
        <div className="text-right">Reserve</div>
        <div className="text-right">Burn/day</div>
        <div className="text-right">Depletion</div>
      </div>
      <div>
        {rows.map((row) => (
          <div key={row.fuel} className="grid grid-cols-[minmax(130px,1fr)_110px_92px_92px] items-center gap-3 border-b border-[#f9fafb] px-4 py-3 text-[13px] max-sm:grid-cols-1 max-sm:gap-2">
            <div className="flex items-center gap-2 font-semibold text-[#374151]">
              <span className="size-2 rounded-full" style={{ background: row.tone }} />
              {row.fuel}
            </div>
            <div className="flex items-center justify-end gap-2 text-right text-[13px] font-semibold text-[#6b7280] max-sm:justify-start">
              <span style={{ color: row.tone }}>{row.reserve}%</span>
              <span className="h-2 w-[56px] overflow-hidden rounded-full bg-[#f1f5f9]">
                <span className="block h-full rounded-full" style={{ width: `${row.reserve}%`, background: row.tone }} />
              </span>
            </div>
            <div className="text-right text-[#6b7280] max-sm:text-left">{row.burn}</div>
            <div className="text-right font-semibold max-sm:text-left" style={{ color: row.tone }}>{row.depletion}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-2 border-t border-[#f1f5f9] p-4 sm:grid-cols-3">
        {variance.map((item) => (
          <div key={item.label} className="rounded-[5px] border border-[#f1f5f9] bg-[#f9fafb] px-3 py-2">
            <div className="text-[11px] font-medium text-[#9ca3af]">{item.label}</div>
            <div className="mt-1 text-[14px] font-bold" style={{ color: item.tone }}>{item.value}</div>
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
      <LightPanelHeader icon={Truck} title="Supply Pipeline - In Transit" meta={<div className="text-[12px] font-semibold text-[#9ca3af]">{displayMode}</div>} />
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-[#f1f5f9] text-[10px] uppercase tracking-[0.08em] text-[#9ca3af]">
                <th className="px-4 py-2 text-left">Route</th>
                <th className="px-4 py-2 text-left">Load</th>
                <th className="px-4 py-2 text-right">ETA</th>
                <th className="px-4 py-2 text-right">Volume</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.route} className="border-b border-[#f9fafb]">
                  <td className="px-4 py-3 font-semibold text-[#111827]">{row.route}</td>
                  <td className="px-4 py-3 text-[#6b7280]">{row.meta}</td>
                  <td className={`px-4 py-3 text-right font-bold ${row.tone === 'warn' ? 'text-[#d97706]' : 'text-[#374151]'}`}>{row.eta}</td>
                  <td className="px-4 py-3 text-right text-[#6b7280]">{row.volume}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {rows.map((row) => (
            <div key={row.route} className="grid grid-cols-[32px_minmax(0,1fr)_64px_54px] items-center gap-3 border-b border-[#f9fafb] px-4 py-3 last:border-b-0 max-sm:grid-cols-[32px_minmax(0,1fr)]">
              <div className="grid size-8 place-items-center rounded-[4px] border border-[#e5e7eb] bg-[#f3f4f6] text-[#374151]">
                <Truck className="size-4" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-[13px] font-semibold text-[#111827]">{row.route}</div>
                <div className="mt-0.5 truncate text-[12px] text-[#9ca3af]">{row.meta}</div>
              </div>
              <div className="text-right max-sm:col-start-2 max-sm:text-left">
                <div className={`text-[13px] font-bold ${row.tone === 'warn' ? 'text-[#d97706]' : 'text-[#374151]'}`}>{row.eta}</div>
                <div className="text-[11px] font-medium text-[#9ca3af]">{row.etaLabel}</div>
              </div>
              <div className="rounded-[3px] border border-[#e5e7eb] bg-[#f3f4f6] px-2 py-1 text-center text-[11px] font-bold text-[#6b7280] max-sm:col-start-2 max-sm:w-max">{row.volume}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ComplianceAlertsPanel({ items, displayMode = 'list' as DashboardBlockDisplay }: { items: IncidentQueueItem[]; displayMode?: DashboardBlockDisplay }) {
  const fallback = [
    { severity: 'critical', station: 'Total Limbe - #0012', description: 'Price ceiling exceeded by MWK 94/L - Kerosene', time: '09:14' },
    { severity: 'critical', station: 'Puma Blantyre - #0031', description: 'Tank calibration expired - 3 pumps flagged', time: '08:52' },
    { severity: 'high', station: 'NOCMA Depot - Lilongwe', description: 'Stock discrepancy - Reported vs metered: -8.2kL', time: '07:30' },
    { severity: 'high', station: 'Petroda Karonga - #0088', description: 'License renewal overdue by 14 days', time: '06:00' },
    { severity: 'medium', station: 'Engen Mzuzu - #0055', description: 'Queue manipulation detected - Digital audit', time: '05:12' },
  ]
  const rows = items.length
    ? items.slice(0, 5).map((item, index) => ({
        severity: item.severity,
        station: item.title,
        description: item.station,
        time: index === 0 ? '09:14' : index === 1 ? '08:52' : index === 2 ? '07:30' : index === 3 ? '06:00' : '05:12',
      }))
    : fallback
  const badgeForAlert = (severity: string) => {
    if (severity === 'critical') return { label: 'CRIT', className: 'border-[#fecaca] bg-[#fee2e2] text-[#b91c1c]' }
    if (severity === 'high') return { label: 'HIGH', className: 'border-[#fde68a] bg-[#fef3c7] text-[#92400e]' }
    return { label: 'MED', className: 'border-[#e5e7eb] bg-[#f3f4f6] text-[#374151]' }
  }

  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={AlertTriangle} title="Compliance Alerts" meta={<div className="text-[12px] font-bold text-[#dc2626]">{displayMode}</div>} />
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="border-b border-[#f1f5f9] text-[10px] uppercase tracking-[0.08em] text-[#9ca3af]">
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
                  <tr key={`${row.station}-${row.time}`} className="border-b border-[#f9fafb]">
                    <td className="px-4 py-3"><span className={`rounded-[3px] border px-1.5 py-1 text-[10px] font-bold leading-none ${badge.className}`}>{badge.label}</span></td>
                    <td className="px-4 py-3 font-semibold text-[#111827]">{row.station}</td>
                    <td className="px-4 py-3 text-[#6b7280]">{row.description}</td>
                    <td className="px-4 py-3 text-right text-[#9ca3af]">{row.time}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div>
          {rows.map((row) => {
            const badge = badgeForAlert(row.severity)
            return (
              <div key={`${row.station}-${row.time}`} className="grid grid-cols-[46px_minmax(0,1fr)_44px] gap-3 border-b border-[#f9fafb] px-4 py-3 last:border-b-0">
                <div className={`mt-0.5 h-max rounded-[3px] border px-1.5 py-1 text-center text-[10px] font-bold leading-none ${badge.className}`}>{badge.label}</div>
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-semibold text-[#111827]">{row.station}</div>
                  <div className="mt-0.5 truncate text-[12px] text-[#9ca3af]">{row.description}</div>
                </div>
                <div className="text-right text-[12px] font-medium text-[#cbd5e0]">{row.time}</div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function ConsumptionPanel({ displayMode = 'line' as DashboardBlockDisplay }: { displayMode?: DashboardBlockDisplay }) {
  const corridorRows = [
    { label: 'Beira Corridor', tone: 'good' as const, status: 'Normal' },
    { label: 'Nacala Corridor', tone: 'warn' as const, status: 'Delayed' },
    { label: 'Northern Corridor', tone: 'neutral' as const, status: 'Monitor' },
  ]
  const points = [
    { label: 'Mon', value: 7.2 },
    { label: 'Tue', value: 8.4 },
    { label: 'Wed', value: 8.9 },
    { label: 'Thu', value: 7.8 },
    { label: 'Fri', value: 10.8 },
    { label: 'Sat', value: 9.7 },
    { label: 'Sun', value: 11.5 },
  ]

  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={TrendingUp} title="National Consumption - 7d" meta={<div className="text-[12px] font-semibold text-[#9ca3af]">{displayMode}</div>} />
      <div className="px-4 py-4">
        {displayMode === 'bar' ? (
          <div className="grid h-[132px] grid-cols-7 items-end gap-2">
            {points.map((point) => (
              <div key={point.label} className="grid h-full grid-rows-[1fr_auto] gap-2 text-center">
                <div className="flex items-end rounded-t-[4px] bg-[#f1f5f9]">
                  <div className="w-full rounded-t-[4px] bg-[#2563eb]" style={{ height: `${Math.max(16, (point.value / 12) * 100)}%` }} />
                </div>
                <div className="text-[10px] font-semibold text-[#9ca3af]">{point.label}</div>
              </div>
            ))}
          </div>
        ) : (
          <svg width="100%" height="132" viewBox="0 0 300 132" role="img" aria-label="Seven day national consumption trend">
            {[
              { y: 12, label: '15ML' },
              { y: 44, label: '12ML' },
              { y: 76, label: '9ML' },
              { y: 108, label: '6ML' },
            ].map((row) => (
              <g key={row.label}>
                <text x="0" y={row.y + 4} fill="#d1d5db" fontSize="10">{row.label}</text>
                <line x1="34" y1={row.y} x2="300" y2={row.y} stroke="#f1f5f9" strokeWidth="1" />
              </g>
            ))}
            <polyline points="36,86 80,70 124,64 168,78 212,48 256,58 298,38" fill="none" stroke="#2563eb" strokeWidth="2" />
            {[['36', '86'], ['80', '70'], ['124', '64'], ['168', '78'], ['212', '48'], ['256', '58'], ['298', '38']].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="3" fill="#2563eb" />)}
            {points.map((point, index) => (
              <text key={point.label} x={32 + index * 44} y="130" fill="#9ca3af" fontSize="10">{point.label}</text>
            ))}
          </svg>
        )}
      </div>
      <div className="grid gap-2 border-t border-[#f1f5f9] px-4 py-3">
        {corridorRows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <div className="text-[13px] font-semibold text-[#374151]">{row.label}</div>
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
    { name: 'Northern', coverage: 86, tone: '#13d9c4', risk: 'Watch' },
    { name: 'Central', coverage: 94, tone: '#31dd75', risk: 'Stable' },
    { name: 'Southern', coverage: 79, tone: '#f6c445', risk: 'Pressure' },
    { name: 'Lakeshore', coverage: 88, tone: '#2e9dff', risk: 'Stable' },
  ]
  const corridors = [
    { name: 'Beira Corridor', flow: 'Normal', stock: '4.2d', tone: '#31dd75' },
    { name: 'Nacala Corridor', flow: 'Delayed', stock: '2.8d', tone: '#f6c445' },
    { name: 'Dar es Salaam', flow: 'Watch', stock: '3.1d', tone: '#2e9dff' },
  ]

  return (
    <section className={`${darkPanel} overflow-hidden p-2.5`}>
      <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
        <div className="mr-auto min-w-0">
          <div className="flex items-center gap-2">
            <Layers3 className="size-3.5 text-[#7cc7ff]" />
            <h2 className="truncate text-[12px] font-bold uppercase tracking-[0.1em] text-white">National Supply Command</h2>
          </div>
          <div className="mt-1 text-[11px] text-[#7f8d9d]">Depot cover, corridor flow, regional availability and intervention priority.</div>
        </div>
        {[
          { label: 'Stations', value: totalStations.toLocaleString(), color: '#2e9dff' },
          { label: 'Online', value: onlineStations.toLocaleString(), color: '#31dd75' },
          { label: 'Critical', value: criticalAlerts.toLocaleString(), color: '#f03245' },
        ].map((item) => (
          <div key={item.label} className="rounded-[8px] border border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.58)] px-2 py-1.5 text-right shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]">
            <div className="text-[13px] font-bold leading-none" style={{ color: item.color }}>{item.value}</div>
            <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#65758a]">{item.label}</div>
          </div>
        ))}
      </div>
      <div className="grid min-h-[360px] gap-2 rounded-[9px] border border-[var(--mera-glass-border)] bg-[rgba(2,10,18,0.46)] p-2 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative min-h-[340px] overflow-hidden rounded-[9px] border border-[var(--mera-glass-border)] bg-[linear-gradient(135deg,rgba(9,27,43,0.86),rgba(4,17,28,0.76)),linear-gradient(90deg,rgba(77,210,255,0.08)_1px,transparent_1px),linear-gradient(0deg,rgba(77,210,255,0.045)_1px,transparent_1px)] bg-[length:auto,34px_34px,34px_34px] p-4">
          <div className="absolute inset-0 opacity-[0.12] [background-image:linear-gradient(#89a7c422_1px,transparent_1px),linear-gradient(90deg,#89a7c422_1px,transparent_1px)] [background-size:32px_32px]" />
          <div className="relative grid h-full gap-3 md:grid-cols-[170px_minmax(0,1fr)]">
            <div className="flex min-h-[300px] flex-col justify-between rounded-[8px] border border-[var(--mera-glass-border)] bg-[rgba(7,19,31,0.62)] p-3 backdrop-blur-md">
              {districts.map((district) => (
                <div key={district.name}>
                  <div className="mb-1 flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-white">{district.name}</span>
                    <span style={{ color: district.tone }}>{district.coverage}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-[#102033]">
                    <div className="h-full rounded-full" style={{ width: `${district.coverage}%`, background: district.tone }} />
                  </div>
                  <div className="mt-1 text-[10px] font-medium text-[#7f8d9d]">{district.risk}</div>
                </div>
              ))}
            </div>

            <div className="relative min-h-[300px] rounded-[8px] border border-[var(--mera-glass-border)] bg-[rgba(7,19,31,0.54)] p-4 backdrop-blur-md">
              <div className="absolute left-1/2 top-7 h-[250px] w-1 -translate-x-1/2 rounded-full bg-[#1a3145]" />
              {[
                { label: 'Karonga', top: '12%', left: '50%', color: '#f6c445' },
                { label: 'Mzuzu', top: '28%', left: '42%', color: '#13d9c4' },
                { label: 'Lilongwe', top: '48%', left: '56%', color: '#31dd75' },
                { label: 'Zomba', top: '66%', left: '46%', color: '#2e9dff' },
                { label: 'Blantyre', top: '80%', left: '58%', color: '#f03245' },
              ].map((node) => (
                <div key={node.label} className="absolute flex items-center gap-2" style={{ top: node.top, left: node.left }}>
                  <span className="grid size-8 place-items-center rounded-full border border-white/20 bg-[#06111a] shadow-[0_0_18px_rgba(46,157,255,0.2)]">
                    <span className="size-3 rounded-full" style={{ background: node.color }} />
                  </span>
                  <span className="rounded-[6px] border border-[var(--mera-glass-border)] bg-[#06111a]/80 px-2 py-1 text-[11px] font-bold text-white backdrop-blur-md">{node.label}</span>
                </div>
              ))}
              <div className="absolute bottom-3 left-3 right-3 grid grid-cols-3 gap-2">
                {['Depot cover 3.8d', 'Queue risk +14%', 'Price watch +61/L'].map((item) => (
                  <div key={item} className="rounded-[6px] border border-[var(--mera-glass-border)] bg-[#06111a]/78 px-2 py-1.5 text-center text-[10px] font-semibold text-[#d5e7f6] backdrop-blur-md">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <aside className="grid gap-2">
          {corridors.map((row) => (
            <div key={row.name} className="rounded-[8px] border border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.58)] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-white">{row.name}</div>
                <span className="rounded-[4px] px-2 py-1 text-[10px] font-bold" style={{ background: `${row.tone}22`, color: row.tone }}>
                  {row.flow}
                </span>
              </div>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#65758a]">Stock Cover</div>
                  <div className="mt-1 text-[22px] font-bold text-white">{row.stock}</div>
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
            <BellRing className="size-3.5 text-[#f6c445]" />
            <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-white">Incident Command Queue</h2>
          </div>
          <div className="mt-1 text-[10px] text-[#65758a]">Ownership, SLA, and escalation posture.</div>
        </div>
        <span className="rounded-[4px] border border-[#f03245]/30 bg-[#32111a] px-2 py-1 text-[10px] font-bold text-[#ff9b9b]">
          4 urgent
        </span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 6).map((item) => {
          const meta = severityMeta(item.severity)
          return (
            <div key={item.id} className="rounded-[8px] border border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.58)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-[4px]" style={{ color: meta.color, background: meta.bg }}>
                  <ShieldAlert className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-[11px] font-bold text-white">{item.title}</div>
                      <div className="mt-1 truncate text-[10px] text-[#65758a]">{item.district} · {item.station}</div>
                    </div>
                    <span className="shrink-0 rounded-[3px] px-1.5 py-0.5 text-[8.5px] font-bold uppercase" style={{ color: meta.color, background: meta.bg }}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5 text-[9.5px] text-[#7f8d9d]">
                    <span className="truncate"><UserRound className="mr-1 inline size-3" />{item.owner}</span>
                    <span className="truncate"><Clock3 className="mr-1 inline size-3" />SLA {formatSla(item.slaMinutes)}</span>
                    <span className="truncate text-right text-[#cbd6e2]">{item.status}</span>
                  </div>
                </div>
              </div>
              <button type="button" className="mt-2 inline-flex h-6 items-center gap-1 rounded-[5px] border border-[var(--mera-glass-border)] bg-[rgba(4,14,25,0.62)] px-2 text-[10px] font-bold text-white transition hover:border-[#4dd2ff]/55">
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
          <h2 className="truncate text-[11px] font-bold uppercase tracking-[0.1em] text-white">Fuel Availability</h2>
          <div className="mt-1 text-[10px] font-medium text-[#65758a]">National product availability trend</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {availabilityIntervals.slice(1).map((interval) => (
            <button
              key={interval}
              type="button"
              onClick={() => onIntervalChange(interval)}
              className={`h-6 rounded-[3px] px-2 text-[10px] font-bold ${
                selectedInterval === interval ? 'bg-[#4dd2ff] text-[#04111c]' : 'bg-[rgba(8,22,36,0.62)] text-[#8ea6bc] hover:text-white'
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
            <CartesianGrid stroke="#17283a" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: '#65758a', fontSize: 8 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#65758a', fontSize: 8 }} axisLine={false} tickLine={false} domain={[0, 100]} width={36} tickFormatter={(value) => `${value}%`} />
            <Tooltip contentStyle={{ background: '#081522', border: '1px solid #213345', borderRadius: 5, color: '#eaf2fb', fontSize: 10 }} />
            <Line type="monotone" dataKey="availabilityPercent" stroke="#13d9c4" strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls />
            <Line type="monotone" dataKey="deliveryVerifiedPercent" stroke="#f6c445" strokeWidth={1.8} dot={false} activeDot={{ r: 3 }} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {loading ? <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.1em] text-[#f5c84c]">Updating</div> : null}
    </section>
  )
}

function PriceVariancePanel() {
  return (
    <section className={`${darkPanel} h-[184px] p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-white">Price Variance by Region</h2>
        <span className="text-[10px] font-semibold text-[#65758a]">MWK/L</span>
      </div>
      <div className="h-[142px]">
        <ResponsiveContainer>
          <BarChart data={mockPriceVariance} margin={{ top: 8, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid stroke="#17283a" vertical={false} />
            <XAxis dataKey="region" tick={{ fill: '#65758a', fontSize: 8 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: '#65758a', fontSize: 8 }} axisLine={false} tickLine={false} width={34} tickFormatter={(value) => `+${value}`} />
            <Tooltip contentStyle={{ background: '#081522', border: '1px solid #213345', borderRadius: 5, color: '#eaf2fb', fontSize: 10 }} formatter={(value: any) => [`MWK +${value}/L`, 'Variance']} />
            <Bar dataKey="petrol" fill="#f03245" radius={[3, 3, 0, 0]} />
            <Bar dataKey="diesel" fill="#f6c445" radius={[3, 3, 0, 0]} />
            <Bar dataKey="lpg" fill="#13d9c4" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function InspectionFunnelPanel() {
  const rows = [
    { label: 'Scheduled', value: 1248, color: '#2e9dff' },
    { label: 'In Progress', value: 876, color: '#13d9c4' },
    { label: 'Completed', value: 642, color: '#31dd75' },
    { label: 'Actions', value: 248, color: '#f6c445' },
  ]
  const max = Math.max(...rows.map((row) => row.value))
  return (
    <section className={`${darkPanel} h-[184px] p-3`}>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-white">Inspection Completion Funnel</h2>
        <span className="text-[10px] font-semibold text-[#65758a]">May 1 - May 15</span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-[10px] font-semibold text-[#7f8d9d]">
              <span>{row.label}</span>
              <span className="text-white">{row.value.toLocaleString()}</span>
            </div>
            <div className="h-5 overflow-hidden rounded-[5px] bg-[rgba(8,22,36,0.66)]">
              <div className="flex h-full items-center justify-end pr-2 text-[9px] font-bold text-[#06111a]" style={{ width: `${Math.max(18, (row.value / max) * 100)}%`, background: row.color }}>
                {Math.round((row.value / max) * 100)}%
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 text-right text-[10px] font-bold text-[#31dd75]">Compliance Rate 52.3%</div>
    </section>
  )
}

function ComplianceMatrixPanel({ complianceRows }: { complianceRows: Array<{ name: string; value: number; color: string }> }) {
  const totalIssues = complianceRows.reduce((sum, row) => sum + row.value, 0)
  return (
    <section className={`${darkPanel} h-[184px] p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-white">Compliance Heat Matrix</h2>
        <span className="text-[10px] font-semibold text-[#65758a]">{totalIssues} records</span>
      </div>
      <div className="space-y-2">
        {mockComplianceMatrix.map((row) => (
          <div key={row.label}>
            <div className="mb-1 flex items-center justify-between text-[10px]">
              <span className="font-semibold text-[#cbd6e2]">{row.label}</span>
              <span className="text-[#65758a]">{row.compliant}% clear</span>
            </div>
            <div className="grid h-5 grid-cols-[minmax(0,1fr)_42px_30px] overflow-hidden rounded-[5px] border border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.66)] text-[9px] font-bold">
              <div className="flex items-center px-2 text-[#06111a]" style={{ width: `${row.compliant}%`, minWidth: 36, background: '#31dd75' }}>OK</div>
              <div className="flex items-center justify-center bg-[#f6c445]/85 text-[#06111a]">{row.watch}</div>
              <div className="flex items-center justify-center bg-[#f03245] text-white">{row.breach}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function AnomalyReviewPanel() {
  return (
    <section className={`${darkPanel} h-full min-h-[360px] p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Bot className="size-3.5 text-[#f6c445]" />
            <h2 className="text-[12px] font-bold uppercase tracking-[0.1em] text-white">Anomaly Review</h2>
          </div>
          <div className="mt-1 text-[10px] text-[#65758a]">AI signals requiring review.</div>
        </div>
        <span className="rounded-[4px] border border-[#31dd75]/25 bg-[#0a2a1e] px-2 py-1 text-[10px] font-bold uppercase text-[#55e489]">AI Insights</span>
      </div>
      <div className="space-y-2">
        {mockAnomalies.map((item) => (
          <div key={item.signal} className="rounded-[8px] border border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.58)] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[11px] font-bold leading-4 text-white">{item.signal}</div>
                <div className="mt-1 truncate text-[10px] text-[#65758a]">{item.district} · {item.action}</div>
              </div>
              <span className="shrink-0 text-[10px] font-bold text-[#31dd75]">{item.confidence}%</span>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="mt-3 h-7 w-full rounded-[6px] border border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.62)] text-[10px] font-bold text-[#d7e7f5] hover:border-[#4dd2ff]/55">
        View All Insights
      </button>
    </section>
  )
}

function StationRiskTable({ rows }: { rows: StationRiskRow[] }) {
  return (
    <section className={`${darkPanel} overflow-hidden p-3`}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.1em] text-white">Station Risk Watchlist</h2>
        <span className="text-[10px] font-semibold text-[#65758a]">{rows.length} active · View all</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-fixed text-left">
          <thead>
            <tr className="border-y border-[var(--mera-glass-border)] bg-[rgba(8,22,36,0.62)] text-[9px] uppercase tracking-[0.1em] text-[#8ea6bc]">
              <th className="w-[132px] px-2 py-1.5 font-bold">Station ID</th>
              <th className="px-2 py-1.5 font-bold">Station</th>
              <th className="w-[96px] px-2 py-1.5 font-bold">District</th>
              <th className="w-[72px] px-2 py-1.5 text-right font-bold">Fuel Days</th>
              <th className="w-[96px] px-2 py-1.5 font-bold">Last Signal</th>
              <th className="w-[96px] px-2 py-1.5 font-bold">License</th>
              <th className="w-[90px] px-2 py-1.5 font-bold">Price</th>
              <th className="w-[70px] px-2 py-1.5 text-right font-bold">Risk</th>
              <th className="w-[86px] px-2 py-1.5 text-right font-bold">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const riskColor = row.riskScore >= 80 ? '#f03245' : row.riskScore >= 60 ? '#f6c445' : '#2e9dff'
              return (
                <tr key={row.stationId} className="border-b border-[rgba(163,221,255,0.09)] text-[10px] last:border-0">
                  <td className="truncate px-2 py-1.5 font-bold text-white">{row.stationId}</td>
                  <td className="truncate px-2 py-1.5 text-[#cbd6e2]">{row.station}</td>
                  <td className="truncate px-2 py-1.5 text-[#7f8d9d]">{row.district}</td>
                  <td className="px-2 py-1.5 text-right font-bold text-white">{row.fuelDays.toFixed(1)}</td>
                  <td className="truncate px-2 py-1.5 text-[#7f8d9d]">{row.lastSignal}</td>
                  <td className="truncate px-2 py-1.5 text-[#7f8d9d]">{row.licenseStatus}</td>
                  <td className="truncate px-2 py-1.5 font-bold text-white">{row.priceCheck}</td>
                  <td className="px-2 py-1.5 text-right font-bold" style={{ color: riskColor }}>{row.riskScore}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button type="button" className="rounded-[5px] border border-[var(--mera-glass-border)] px-1.5 py-0.5 text-[9px] font-bold text-[#d7e7f5] transition hover:border-[#4dd2ff]/55">
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
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">{widget.category}</div>
              <div className="mt-1 text-[13px] font-semibold text-white">{widget.title}</div>
            </div>
            <span className="rounded-[5px] border border-[#2e9dff]/30 bg-[#2e9dff]/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#8fd0ff]">Pinned</span>
          </div>
          <div className="mt-3 flex items-end justify-between gap-3">
            <div className="text-[24px] font-semibold tracking-[-0.04em] text-white">{widget.metric}</div>
            <div className="text-right text-[11px] font-semibold text-[#8fd0ff]">{widget.trend}</div>
          </div>
          <div className="mt-2 line-clamp-2 text-[11px] leading-4 text-slate-400">{widget.description}</div>
        </div>
      ))}
      <button type="button" onClick={onOpenWidgets} className="min-h-[112px] rounded-[7px] border border-dashed border-white/18 bg-white/[0.025] p-4 text-left text-slate-300 transition hover:border-[#32db64]/50 hover:bg-[#32db64]/5">
        <PackagePlus className="size-5 text-[#32db64]" />
        <div className="mt-3 text-[13px] font-semibold text-white">Add operational widget</div>
        <div className="mt-1 text-[11px] text-slate-400">Pin supply, licensing, telemetry, and pricing modules.</div>
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
      { id: 'compliance-alerts', type: 'compliance-alerts', title: 'Compliance Alerts', size: 'medium', displayMode: 'list', colorPreset: 'red' },
      { id: 'compliance-risk', type: 'station-risk-table', title: 'Station Risk Table', size: 'wide', displayMode: 'table', colorPreset: 'amber' },
      { id: 'compliance-matrix', type: 'compliance-matrix', title: 'Compliance Matrix', size: 'medium', displayMode: 'bar', colorPreset: 'teal' },
    ],
  },
  'builtin-enforcement': {
    id: 'builtin-enforcement',
    label: 'Enforcement',
    scopeType: 'National',
    scopeValue: 'National',
    product: 'All Products',
    colorPreset: 'amber',
    blocks: [
      { id: 'enforcement-alerts', type: 'compliance-alerts', title: 'Escalations', size: 'medium', displayMode: 'list', colorPreset: 'red' },
      { id: 'enforcement-risk', type: 'station-risk-table', title: 'Station Risk Table', size: 'wide', displayMode: 'table', colorPreset: 'amber' },
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
      className={`rounded-[6px] border border-[#e2e8f0] bg-white p-3 transition ${isDragging ? 'scale-[0.99] opacity-60' : 'opacity-100'}`}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 grid size-8 shrink-0 cursor-grab place-items-center rounded-[5px] border border-[#e5e7eb] bg-[#f9fafb] text-[#9ca3af]" title="Drag to reorder">
          <GripVertical className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-bold text-[#111827]">{block.title}</div>
            <span className="size-2 rounded-full" style={{ background: blockColorPreset.accent }} />
            <span className="rounded-[3px] bg-[#f3f4f6] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#6b7280]">{libraryItem.title}</span>
          </div>
          <div className="mt-1 text-[12px] leading-5 text-[#6b7280]">{libraryItem.description}</div>
        </div>
        <button type="button" onClick={() => onRemove(block.id)} className="grid size-8 shrink-0 place-items-center rounded-[5px] text-[#dc2626] transition hover:bg-[#fef2f2]" aria-label="Remove block">
          <Trash2 className="size-4" />
        </button>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-4">
        <label className="grid gap-1 sm:col-span-2">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Block Title</span>
          <input value={block.title} onChange={(event) => onUpdate(block.id, { title: event.target.value })} className="h-9 rounded-[5px] border border-[#e2e8f0] bg-white px-2 text-[12px] font-semibold text-[#374151] outline-none focus:border-[#111827]/40" />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Size</span>
          <select value={block.size} onChange={(event) => onUpdate(block.id, { size: event.target.value as DashboardBlockSize })} className="h-9 rounded-[5px] border border-[#e2e8f0] bg-white px-2 text-[12px] font-semibold text-[#374151]">
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="wide">Wide</option>
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Display</span>
          <select value={block.displayMode} onChange={(event) => onUpdate(block.id, { displayMode: event.target.value as DashboardBlockDisplay })} className="h-9 rounded-[5px] border border-[#e2e8f0] bg-white px-2 text-[12px] font-semibold text-[#374151]">
            {libraryItem.modes.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
          </select>
        </label>
        <div className="sm:col-span-3">
          <span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Block Color</span>
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(colorPresets) as DashboardColorPreset[]).map((presetKey) => {
              const preset = colorPresets[presetKey]
              const active = (block.colorPreset || 'slate') === presetKey
              return (
                <button
                  key={presetKey}
                  type="button"
                  onClick={() => onUpdate(block.id, { colorPreset: presetKey })}
                  className={`grid size-7 place-items-center rounded-[5px] border transition ${active ? 'border-[#111827] bg-white' : 'border-[#e2e8f0] bg-[#f9fafb] hover:border-[#cbd5e0]'}`}
                  aria-label={`Use ${preset.label} block color`}
                >
                  <span className="size-3.5 rounded-full" style={{ background: preset.accent }} />
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:pt-5">
          <button type="button" onClick={() => onMove(index, Math.max(0, index - 1))} disabled={index === 0} className="grid h-9 place-items-center rounded-[5px] border border-[#e2e8f0] text-[#6b7280] disabled:opacity-40" aria-label="Move block up">
            <ArrowUp className="size-4" />
          </button>
          <button type="button" onClick={() => onMove(index, index + 1)} className="grid h-9 place-items-center rounded-[5px] border border-[#e2e8f0] text-[#6b7280]" aria-label="Move block down">
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
        <DrawerHeader className="border-b border-[#f1f5f9] p-5">
          <DrawerTitle className="text-[#111827]">{editingView ? 'Edit Custom View' : 'Create Custom View'}</DrawerTitle>
          <DrawerDescription className="text-[#6b7280]">Build a scoped operational overview with ordered blocks, saved locally in this browser.</DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid gap-5">
            <section className="grid gap-3 rounded-[6px] border border-[#e2e8f0] bg-[#f9fafb] p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">View Name</span>
                  <input value={draft.label} onChange={(event) => updateDraft({ label: event.target.value })} className="h-10 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[13px] font-semibold text-[#111827] outline-none focus:border-[#111827]/40" />
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Fuel Product</span>
                  <select value={draft.product} onChange={(event) => updateDraft({ product: event.target.value })} className="h-10 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[13px] font-semibold text-[#374151]">
                    {productFilters.map((product) => <option key={product} value={product}>{product}</option>)}
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Scope Type</span>
                  <select value={draft.scopeType} onChange={(event) => updateScopeType(event.target.value as DashboardScopeType)} className="h-10 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[13px] font-semibold text-[#374151]">
                    <option value="National">National</option>
                    <option value="Region">Region</option>
                    <option value="District">District</option>
                  </select>
                </label>
                <label className="grid gap-1">
                  <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Scope</span>
                  <select value={draft.scopeValue} onChange={(event) => updateDraft({ scopeValue: event.target.value })} className="h-10 rounded-[5px] border border-[#e2e8f0] bg-white px-3 text-[13px] font-semibold text-[#374151]">
                    {scopeOptionsFor(draft.scopeType).map((scope) => <option key={scope} value={scope}>{scope}</option>)}
                  </select>
                </label>
              </div>
              <div>
                <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af]">
                  <Palette className="size-3.5" />
                  Color Preset
                </div>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(colorPresets) as DashboardColorPreset[]).map((presetKey) => {
                    const preset = colorPresets[presetKey]
                    const active = draft.colorPreset === presetKey
                    return (
                      <button key={presetKey} type="button" onClick={() => updateDraft({ colorPreset: presetKey })} className={`flex h-9 items-center gap-2 rounded-[5px] border px-3 text-[12px] font-semibold transition ${active ? 'border-[#111827] bg-white text-[#111827]' : 'border-[#e2e8f0] bg-white text-[#6b7280] hover:border-[#cbd5e0]'}`}>
                        <span className="size-3 rounded-full" style={{ background: preset.accent }} />
                        {preset.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            </section>

            <section className="grid gap-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-bold text-[#111827]">Block Library</div>
                  <div className="text-[12px] text-[#6b7280]">Add up to {maxBlocksPerView} clean snapped blocks.</div>
                </div>
                <button type="button" onClick={resetLayout} className="inline-flex h-8 items-center gap-1 rounded-[5px] border border-[#e2e8f0] px-2 text-[12px] font-semibold text-[#6b7280] hover:bg-[#f9fafb]">
                  <RotateCcw className="size-3.5" />
                  Reset
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {blockLibrary.map((item) => (
                  <button key={item.type} type="button" onClick={() => addBlock(item)} disabled={draft.blocks.length >= maxBlocksPerView} className="rounded-[6px] border border-[#e2e8f0] bg-white p-3 text-left transition hover:bg-[#f9fafb] disabled:cursor-not-allowed disabled:opacity-45">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[13px] font-bold text-[#111827]">{item.title}</div>
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
                  <div className="text-[13px] font-bold text-[#111827]">View Blocks</div>
                  <div className="text-[12px] text-[#6b7280]">Drag blocks into order or use the move controls.</div>
                </div>
                <div className="text-[12px] font-semibold text-[#9ca3af]">{draft.blocks.length}/{maxBlocksPerView}</div>
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
                <div className="rounded-[6px] border border-dashed border-[#cbd5e0] bg-[#f9fafb] p-6 text-center text-[13px] font-semibold text-[#6b7280]">
                  Add blocks from the library to compose this overview.
                </div>
              )}
            </section>
          </div>
        </div>
        <DrawerFooter className="border-t border-[#f1f5f9] p-5">
          <div className="mr-auto text-[12px] font-semibold text-[#dc2626]">{validation}</div>
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

function PriceVarianceLightPanel({ displayMode }: { displayMode: DashboardBlockDisplay }) {
  const maxValue = Math.max(...mockPriceVariance.flatMap((row) => [row.petrol, row.diesel, row.lpg]), 1)

  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={TrendingUp} title="Price Variance" meta={<div className="text-[12px] font-semibold text-[#9ca3af]">{displayMode}</div>} />
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-[13px]">
            <thead>
              <tr className="border-b border-[#f1f5f9] text-[10px] uppercase tracking-[0.08em] text-[#9ca3af]">
                <th className="px-4 py-2 text-left">Region</th>
                <th className="px-4 py-2 text-right">Petrol</th>
                <th className="px-4 py-2 text-right">Diesel</th>
                <th className="px-4 py-2 text-right">LPG</th>
              </tr>
            </thead>
            <tbody>
              {mockPriceVariance.map((row) => (
                <tr key={row.region} className="border-b border-[#f9fafb]">
                  <td className="px-4 py-3 font-semibold text-[#374151]">{row.region}</td>
                  <td className="px-4 py-3 text-right text-[#d97706]">+{row.petrol}</td>
                  <td className="px-4 py-3 text-right text-[#2563eb]">+{row.diesel}</td>
                  <td className="px-4 py-3 text-right text-[#059669]">+{row.lpg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 p-4">
          {mockPriceVariance.map((row) => (
            <div key={row.region} className="grid grid-cols-[76px_minmax(0,1fr)_42px] items-center gap-3 text-[12px]">
              <div className="font-semibold text-[#374151]">{row.region}</div>
              <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
                <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${(row.petrol / maxValue) * 100}%` }} />
              </div>
              <div className="text-right font-bold text-[#2563eb]">+{row.petrol}</div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function StationRiskLightTable({ rows }: { rows: StationRiskRow[] }) {
  const safeRows = rows.length ? rows : mockStationRisks.slice(0, 4)
  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={Table2} title="Station Risk Table" meta={<div className="text-[12px] font-semibold text-[#9ca3af]">{safeRows.length} rows</div>} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[13px]">
          <thead>
            <tr className="border-b border-[#f1f5f9] text-[10px] uppercase tracking-[0.08em] text-[#9ca3af]">
              <th className="px-4 py-2 text-left">Station</th>
              <th className="px-4 py-2 text-left">District</th>
              <th className="px-4 py-2 text-right">Fuel Days</th>
              <th className="px-4 py-2 text-right">Risk</th>
              <th className="px-4 py-2 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {safeRows.slice(0, 6).map((row) => (
              <tr key={row.stationId} className="border-b border-[#f9fafb]">
                <td className="px-4 py-3 font-semibold text-[#111827]">{row.station}</td>
                <td className="px-4 py-3 text-[#6b7280]">{row.district}</td>
                <td className="px-4 py-3 text-right text-[#6b7280]">{row.fuelDays.toFixed(1)}</td>
                <td className="px-4 py-3 text-right font-bold text-[#dc2626]">{row.riskScore}</td>
                <td className="px-4 py-3 text-right font-semibold text-[#2563eb]">{row.actionLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function ComplianceMatrixLightPanel({ displayMode }: { displayMode: DashboardBlockDisplay }) {
  return (
    <section className={lightPanel}>
      <LightPanelHeader icon={ShieldCheck} title="Compliance Matrix" meta={<div className="text-[12px] font-semibold text-[#9ca3af]">{displayMode}</div>} />
      {displayMode === 'table' ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[480px] text-[13px]">
            <thead>
              <tr className="border-b border-[#f1f5f9] text-[10px] uppercase tracking-[0.08em] text-[#9ca3af]">
                <th className="px-4 py-2 text-left">Check</th>
                <th className="px-4 py-2 text-right">Compliant</th>
                <th className="px-4 py-2 text-right">Watch</th>
                <th className="px-4 py-2 text-right">Breach</th>
              </tr>
            </thead>
            <tbody>
              {mockComplianceMatrix.map((row) => (
                <tr key={row.label} className="border-b border-[#f9fafb]">
                  <td className="px-4 py-3 font-semibold text-[#374151]">{row.label}</td>
                  <td className="px-4 py-3 text-right font-bold text-[#059669]">{row.compliant}%</td>
                  <td className="px-4 py-3 text-right text-[#d97706]">{row.watch}%</td>
                  <td className="px-4 py-3 text-right text-[#dc2626]">{row.breach}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid gap-3 p-4">
          {mockComplianceMatrix.map((row) => (
            <div key={row.label} className="grid gap-2">
              <div className="flex items-center justify-between gap-3 text-[13px]">
                <div className="font-semibold text-[#374151]">{row.label}</div>
                <div className="font-bold text-[#059669]">{row.compliant}%</div>
              </div>
              <div className="grid h-2 grid-cols-[var(--ok)_var(--watch)_var(--breach)] overflow-hidden rounded-full bg-[#f1f5f9]" style={{ '--ok': `${row.compliant}fr`, '--watch': `${row.watch}fr`, '--breach': `${row.breach}fr` } as any}>
                <div className="bg-[#10b981]" />
                <div className="bg-[#f59e0b]" />
                <div className="bg-[#ef4444]" />
              </div>
            </div>
          ))}
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
}: {
  block: DashboardViewBlock
  view: DashboardCustomView
  kpiCards: any[]
  totalStations: number
  onlineStations: number
  criticalAlerts: number
  incidentItems: IncidentQueueItem[]
  riskRows: StationRiskRow[]
}) {
  const scopedIncidents = incidentItems.filter((item) => scopeMatchesDistrict(view, item.district))
  const scopedRiskRows = riskRows.filter((row) => scopeMatchesDistrict(view, row.district))
  const preset = colorPresets[block.colorPreset || view.colorPreset]
  const frame = (children: ReactNode) => (
    <div className={blockSizeClass(block.size)}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
        <span className="size-2 rounded-full" style={{ background: preset.accent }} />
        {block.title}
      </div>
      {children}
    </div>
  )

  if (block.type === 'kpi-summary') {
    return (
      <div className={blockSizeClass(block.size)}>
        <div className="mb-1.5 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
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
  if (block.type === 'price-variance') return frame(<PriceVarianceLightPanel displayMode={block.displayMode} />)
  if (block.type === 'station-risk-table') return frame(<StationRiskLightTable rows={scopedRiskRows} />)
  return frame(<ComplianceMatrixLightPanel displayMode={block.displayMode} />)
}

function CustomDashboardView({
  view,
  kpiCards,
  totalStations,
  onlineStations,
  criticalAlerts,
  incidentItems,
  riskRows,
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
  onEdit?: () => void
  onDuplicate?: () => void
  editable?: boolean
}) {
  const preset = colorPresets[view.colorPreset]
  const scopeLabel = view.scopeType === 'National' ? 'National' : view.scopeValue

  return (
    <div className="grid gap-3">
      <section className="overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white">
        <div className="h-[3px]" style={{ background: preset.accent }} />
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold tracking-[-0.02em] text-[#111827]">{view.label}</div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] font-semibold text-[#6b7280]">
              <span className="rounded-[4px] px-2 py-1" style={{ background: preset.soft, color: preset.text }}>{scopeLabel}</span>
              <span>{view.product}</span>
              <span>{view.blocks.length} blocks</span>
            </div>
          </div>
          {editable && onEdit ? (
            <Button type="button" size="sm" onClick={onEdit}>
              <Pencil className="size-4" />
              Edit View
            </Button>
          ) : onDuplicate ? (
            <Button type="button" size="sm" onClick={onDuplicate}>
              <Copy className="size-4" />
              Duplicate
            </Button>
          ) : null}
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
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[6px] border border-dashed border-[#cbd5e0] bg-white p-8 text-center text-[13px] font-semibold text-[#6b7280]">
          This view is empty. Edit it to add operational blocks.
        </div>
      )}
    </div>
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
  onOpenKpi: (drilldown: DrilldownConfig) => void
}) {
  const [focus, setFocus] = useState('supply')
  const cards = [
    {
      id: 'supply',
      label: 'Network Coverage',
      value: activeStations.toLocaleString(),
      detail: 'Active stations feeding the national view',
      accent: '#2563eb',
      drilldown: kpiCards[0]?.drilldown,
    },
    {
      id: 'reserve',
      label: 'Reserve Pressure',
      value: `${reserveDays.toFixed(1)}d`,
      detail: 'National reserve cover and burn outlook',
      accent: '#10b981',
      drilldown: kpiCards[1]?.drilldown,
    },
    {
      id: 'pipeline',
      label: 'Queue & Pipeline Load',
      value: activeDriverQueues.toLocaleString(),
      detail: 'Driver queues and supply movements',
      accent: '#f59e0b',
    },
    {
      id: 'compliance',
      label: 'Compliance Risk',
      value: complianceRiskCount.toLocaleString(),
      detail: 'Violations, alerts, and station risk',
      accent: '#ef4444',
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

  return (
    <div className="grid gap-3">
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => activate(card.id, card.drilldown)}
            className={`relative min-h-[132px] overflow-hidden rounded-[6px] border bg-white px-4 py-4 text-left transition hover:-translate-y-0.5 hover:border-[#cbd5e0] hover:shadow-sm ${
              focus === card.id ? 'border-[#111827]' : 'border-[#e2e8f0]'
            }`}
          >
            <div className="absolute inset-x-0 top-0 h-[3px]" style={{ background: card.accent }} />
            <div className="text-[11px] font-semibold uppercase tracking-[0.09em] text-[#9ca3af]">{card.label}</div>
            <div className="mt-3 text-[30px] font-bold leading-none tracking-[-0.02em] text-[#111827]">{card.value}</div>
            <div className="mt-3 text-[12px] font-medium leading-5 text-[#6b7280]">{card.detail}</div>
            <div className="absolute bottom-3 right-3 text-[11px] font-bold text-[#9ca3af]">Open</div>
          </button>
        ))}
      </section>

      <div id="national-overview-supply" className="scroll-mt-3">
        <NationalSupplyCommandPanel totalStations={totalStations} onlineStations={onlineStations} criticalAlerts={criticalAlerts} />
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
        <DrawerHeader className="border-b border-[#f1f5f9] p-5">
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
                  className={`rounded-[7px] border p-4 text-left transition ${
                    pinned ? 'border-[#a7f3d0] bg-[#ecfdf5]' : 'border-[#e2e8f0] bg-white hover:bg-[#f9fafb]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="rounded-[5px] bg-[#f3f4f6] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#6b7280]">{widget.category}</span>
                        <span className="text-[10px] font-bold uppercase tracking-[0.1em] text-[#2563eb]">{widget.size}</span>
                      </div>
                      <div className="mt-2 text-[14px] font-semibold text-[#111827]">{widget.title}</div>
                      <div className="mt-1 text-[12px] leading-5 text-[#6b7280]">{widget.description}</div>
                    </div>
                    <span className={`grid size-8 shrink-0 place-items-center rounded-[7px] border ${pinned ? 'border-[#10b981] bg-[#10b981] text-white' : 'border-[#e2e8f0] text-[#6b7280]'}`}>
                      {pinned ? <CheckCircle2 className="size-4" /> : <Plus className="size-4" />}
                    </span>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="rounded-[6px] border border-[#f1f5f9] bg-[#f9fafb] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[#9ca3af]">Metric</div>
                      <div className="mt-1 text-[16px] font-semibold text-[#111827]">{widget.metric}</div>
                    </div>
                    <div className="rounded-[6px] border border-[#f1f5f9] bg-[#f9fafb] px-3 py-2">
                      <div className="text-[10px] uppercase tracking-[0.1em] text-[#9ca3af]">Trend</div>
                      <div className="mt-1 text-[16px] font-semibold text-[#2563eb]">{widget.trend}</div>
                    </div>
                  </div>
                </button>
              )
            })}
          </div>
        </div>
        <DrawerFooter className="border-t border-[#f1f5f9] p-5">
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
      className="border-[var(--mera-panel-border)] bg-[var(--mera-panel)]"
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
              className={`rounded-[10px] border px-3 py-3 text-left text-sm font-semibold transition ${
                exportRange === range.value
                  ? 'border-[#111827] bg-[#111827] text-white'
                  : 'border-[var(--mera-panel-border)] bg-[var(--mera-panel)] text-[var(--mera-panel-text-soft)] hover:bg-[var(--mera-hover)]'
              }`}
            >
              <span className="block">{range.label}</span>
              {'detail' in range ? <span className="mt-1 block text-xs font-medium text-[var(--mera-panel-text-muted)]">{range.detail}</span> : null}
            </button>
          ))}
        </div>
        <div className="rounded-[10px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel-muted)] px-3 py-3 text-sm text-[var(--mera-panel-text-soft)]">
          The export package starts with the fuel availability series and keeps the MERA operational footer for audit circulation.
        </div>
        {exportError ? <div className="rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{exportError}</div> : null}
      </div>
    </ModalShell>
  )
}

function normalizeIncidentItems(operations: any): IncidentQueueItem[] {
  return mockIncidentQueue.slice(0, 6)
}

function stationRiskFromHeatmap(rows: any[]): StationRiskRow[] {
  return mockStationRisks.slice(0, 6)
}

export function NationalDashboard() {
  const { data, token, realtimePulse } = usePortal()
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
  const fuelRows = Array.isArray(operations.fuelAvailability) ? operations.fuelAvailability : []
  const totalStations = number(kpis.totalStations?.value || 0, 0)
  const pieRows = fuelRows.map((row: any) => ({
    name: row.label,
    value: number(row.value),
    percent: row.total ? Math.round((number(row.value) / number(row.total, 1)) * 100) : 0,
  }))
  const compliance = operations.complianceSummary || {}
  const complianceRows = [
    { name: 'Inspections', value: number(compliance.inspections), color: '#2e9dff' },
    { name: 'Compliant', value: number(compliance.compliant), color: '#32db64' },
    { name: 'Warnings', value: number(compliance.warnings), color: '#ffd21f' },
    { name: 'Violations', value: number(compliance.violations), color: '#ff3434' },
  ]
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
  const openEnforcementCases = Math.max(14, criticalAlerts + number(compliance.violations))
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
    : [
        { tone: 'success', text: 'National operations feed synchronized', timestamp: operations.lastSync || operations.generatedAt },
        { tone: 'warning', text: 'Pricing anomaly review queued for Blantyre', timestamp: operations.generatedAt },
        { tone: 'info', text: 'Telemetry and compliance review queue updated', timestamp: null },
      ]
  const taskStats = data.taskStats || {}
  const dashboardTaskRows = (Array.isArray(data.myTasks?.items) && data.myTasks.items.length ? data.myTasks.items : data.tasks?.items || []).slice(0, 5)
  const allTaskRows = Array.isArray(data.myTasks?.items) && data.myTasks.items.length ? data.myTasks.items : data.tasks?.items || []
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

    const controller = new AbortController()
    setAvailabilityLoading(true)
    portalApi
      .getNationalOperationsDashboard(token, availabilityInterval, controller.signal)
      .then((payload) => {
        setIntervalOperations(payload)
      })
      .catch((error) => {
        if (error?.name !== 'AbortError') {
          setIntervalOperations(null)
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setAvailabilityLoading(false)
      })

    return () => controller.abort()
  }, [availabilityInterval, data.nationalOperations?.fuelAvailabilityHistory?.interval, realtimePulse, token])

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
    const controller = new AbortController()
    setAvailabilityLoading(true)
    portalApi
      .getNationalOperationsDashboard(token, availabilityInterval, controller.signal)
      .then((payload) => setIntervalOperations(payload))
      .catch(() => {})
      .finally(() => setAvailabilityLoading(false))
  }, [availabilityInterval, token])

  const toggleWidget = (id: string) => {
    setPinnedWidgetIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]))
  }

  const stationSeries = kpis.stationsOnline?.sparkline || (
    availabilityHistory.length
      ? availabilityHistory.map((row: any) => number(row.stationsWithFuel)).slice(-8)
      : [1198, 1212, 1204, 1226, 1240, 1232, 1248]
  )
  const activeStations = stationsOnline || number(latestAvailability.stationsWithFuel) || totalStations || 1248
  const previousActiveStations = number(stationSeries[stationSeries.length - 2], activeStations - 18)
  const reserveSeries = kpis.nationalFuelReserve?.sparkline || kpis.depotStockDays?.sparkline || [4.4, 4.2, 4.0, 4.1, 3.9, 4.0, 3.8]
  const reserveDays = number(kpis.nationalFuelReserve?.value || kpis.depotStockDays?.value, number(reserveSeries[reserveSeries.length - 1], 3.8))
  const previousReserveDays = number(reserveSeries[reserveSeries.length - 2], reserveDays + 0.2)
  const inspectionRows = Array.isArray(data.inspections?.items) ? data.inspections.items : []
  const queuedDrivers = inspectionRows.reduce((sum: number, row: any) => sum + number(row.queueLength), 0)
  const queueSeries = kpis.activeDriverQueues?.sparkline || [71, 74, 69, 80, 83, 79, 86]
  const activeDriverQueues = number(kpis.activeDriverQueues?.value || operations.activeDriverQueues, queuedDrivers || number(queueSeries[queueSeries.length - 1], 86))
  const previousDriverQueues = number(queueSeries[queueSeries.length - 2], activeDriverQueues - 7)
  const forecastRows = Array.isArray(data.demandForecastSummary?.rows) ? data.demandForecastSummary.rows : []
  const avgForecastWait = averageNumber(forecastRows.map((row: any) => row.avgWaitMinutes))
  const waitSeries = kpis.avgWaitTime?.sparkline || [34, 32, 31, 29, 30, 28, 26]
  const avgWaitMinutes = number(kpis.avgWaitTime?.value || operations.avgWaitMinutes, avgForecastWait || number(waitSeries[waitSeries.length - 1], 26))
  const previousAvgWaitMinutes = number(waitSeries[waitSeries.length - 2], avgWaitMinutes + 2)

  const kpiCards = [
    {
      label: 'Total Active Stations',
      value: activeStations.toLocaleString(),
      delta: formatKpiDelta(activeStations, previousActiveStations),
      deltaTone: activeStations >= previousActiveStations ? 'good' : 'bad',
      accent: '#2563eb',
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
      accent: '#10b981',
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
      accent: '#f59e0b',
      icon: Truck,
      sparkline: queueSeries,
    },
    {
      label: 'Avg Wait Time',
      value: `${Math.round(avgWaitMinutes)} min`,
      delta: formatKpiDelta(avgWaitMinutes, previousAvgWaitMinutes, ' min'),
      deltaTone: avgWaitMinutes <= previousAvgWaitMinutes ? 'good' : 'bad',
      accent: '#64748b',
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
      loading: availabilityLoading,
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
  ])

  useEffect(() => clearDashboardChrome, [clearDashboardChrome])

  return (
    <div className="h-full overflow-y-auto overflow-x-hidden bg-[#f4f5f7] px-3 pb-3 pt-3 text-[#111827]">
      <div className="mx-auto flex max-w-[1920px] flex-col gap-3">
        {activeTabId === 'builtin-national-overview' ? (
          <NationalOverviewDashboard
            activeStations={activeStations}
            reserveDays={reserveDays}
            activeDriverQueues={activeDriverQueues}
            complianceRiskCount={complianceRiskCount}
            kpiCards={kpiCards}
            totalStations={totalStations || activeStations || 1248}
            onlineStations={stationsOnline || activeStations || 1210}
            criticalAlerts={criticalAlerts || 37}
            incidentItems={incidentItems}
            onOpenKpi={setDrilldown}
          />
        ) : activeCustomView || activeBuiltinView ? (
          <CustomDashboardView
            view={(activeCustomView || activeBuiltinView)!}
            kpiCards={kpiCards}
            totalStations={totalStations || activeStations || 1248}
            onlineStations={stationsOnline || activeStations || 1210}
            criticalAlerts={criticalAlerts || 37}
            incidentItems={incidentItems}
            riskRows={stationRiskRows}
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
              <div className="overflow-hidden rounded-[6px] border border-[#e2e8f0] bg-white shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] px-4 py-3">
                  <div>
                    <h3 className="text-[12px] font-bold uppercase tracking-[0.08em] text-[#111827]">{taskPanelTitle}</h3>
                    <p className="mt-1 text-[11px] text-[#6b7280]">Assigned work, escalations, and overdue regulatory actions</p>
                  </div>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => navigate('/tasks/my')} className="h-8 rounded-[4px] border border-[#e2e8f0] bg-white px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#f9fafb]">
                      My Tasks
                    </button>
                    <button type="button" onClick={() => navigate('/tasks')} className="h-8 rounded-[4px] bg-[#111827] px-3 text-[12px] font-semibold text-white hover:bg-[#1f2937]">
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
                      <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">{item.label}</div>
                      <div className={`mt-1 text-xl font-semibold ${['Overdue', 'Critical'].includes(String(item.label)) ? 'text-[#b91c1c]' : 'text-[#111827]'}`}>{Number(item.value || 0)}</div>
                    </button>
                  ))}
                </div>
                <div className="divide-y divide-[#e2e8f0]">
                  {dashboardTaskRows.length ? dashboardTaskRows.map((task: any) => (
                    <button key={task.taskNumber} type="button" onClick={() => navigate(`/tasks/${task.taskNumber}`)} className="grid w-full gap-2 px-4 py-3 text-left text-[12px] hover:bg-[#f9fafb] md:grid-cols-[120px_minmax(0,1fr)_110px_110px_130px]">
                      <span className="font-semibold text-[#111827]">{task.taskNumber}</span>
                      <span className="min-w-0 truncate text-[#374151]">{task.title}</span>
                      <span className={task.priority === 'CRITICAL' ? 'font-semibold text-[#b91c1c]' : 'text-[#4b5563]'}>{task.priority}</span>
                      <span className="text-[#4b5563]">{task.status}</span>
                      <span className={task.isOverdue ? 'font-semibold text-[#b91c1c]' : 'text-[#6b7280]'}>{task.dueAt ? new Date(task.dueAt).toLocaleDateString() : 'No due date'}</span>
                    </button>
                  )) : (
                    <div className="px-4 py-6 text-center text-[12px] text-[#6b7280]">No assigned task activity.</div>
                  )}
                </div>
              </div>
            ) : null}

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1.55fr)_minmax(360px,0.85fr)]">
              <NationalSupplyCommandPanel
                totalStations={totalStations || activeStations || 1248}
                onlineStations={stationsOnline || activeStations || 1210}
                criticalAlerts={criticalAlerts || 37}
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
