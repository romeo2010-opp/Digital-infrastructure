import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import {
  AlertTriangle,
  Banknote,
  CalendarClock,
  FileBarChart,
  FileText,
  Landmark,
  Link2,
  Plus,
  ReceiptText,
  RefreshCcw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  Users,
  WalletCards,
  XCircle,
} from 'lucide-react'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SchoolActionModal, type SchoolActionKind } from '../components/SchoolActionModal'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip, type SectionKpiItem } from '../components/SectionKpiStrip'
import { Toolbar } from '../components/Toolbar'
import { usePortal } from '../lib/portalContext'

type FinanceSection =
  | 'dashboard'
  | 'accounts'
  | 'invoices'
  | 'payments'
  | 'receipts'
  | 'arrears'
  | 'payment-plans'
  | 'fee-structures'
  | 'discounts'
  | 'expenses'
  | 'suppliers'
  | 'reconciliation'
  | 'reports'
  | 'settings'

const financePages: Record<FinanceSection, { title: string; subtitle: string; action?: string; icon: any }> = {
  dashboard: {
    title: 'Bursar Dashboard',
    subtitle: 'Collections, arrears, cash movement and daily finance signals.',
    action: 'Record payment',
    icon: ReceiptText,
  },
  accounts: {
    title: 'Student Accounts',
    subtitle: 'Learner balances, guardians, payment status and fee account health.',
    action: 'Record payment',
    icon: WalletCards,
  },
  invoices: {
    title: 'Invoices',
    subtitle: 'Generated invoices, due dates, paid status and current term billing.',
    action: 'Generate invoices',
    icon: FileText,
  },
  payments: {
    title: 'Payments',
    subtitle: 'Posted payments, methods, references and finance staff activity.',
    action: 'Record payment',
    icon: Banknote,
  },
  receipts: {
    title: 'Receipts',
    subtitle: 'Receipt numbers, balances after payment and issue-ready payment history.',
    action: 'Record payment',
    icon: ReceiptText,
  },
  arrears: {
    title: 'Arrears',
    subtitle: 'Overdue balances, days overdue, risk level and guardian follow-up.',
    action: 'Create payment plan',
    icon: AlertTriangle,
  },
  'payment-plans': {
    title: 'Payment Plans',
    subtitle: 'Installment agreements, next due dates and overdue installment value.',
    action: 'Create plan',
    icon: CalendarClock,
  },
  'fee-structures': {
    title: 'Fee Structures',
    subtitle: 'Reusable fee templates for terms, classes and billing runs.',
    action: 'New fee structure',
    icon: WalletCards,
  },
  discounts: {
    title: 'Discounts & Waivers',
    subtitle: 'Scholarships, hardship waivers and approval-controlled reductions.',
    action: 'Request waiver',
    icon: ShieldCheck,
  },
  expenses: {
    title: 'Expenses',
    subtitle: 'Operational spend, suppliers, approval status and category totals.',
    action: 'Log expense',
    icon: Banknote,
  },
  suppliers: {
    title: 'Suppliers',
    subtitle: 'Supplier spend summary derived from logged finance expenses.',
    action: 'Log supplier expense',
    icon: Users,
  },
  reconciliation: {
    title: 'Bank Reconciliation',
    subtitle: 'Unmatched receipts, bank transactions and reconciliation status.',
    action: 'Import bank row',
    icon: Landmark,
  },
  reports: {
    title: 'Reports',
    subtitle: 'Payment method, invoice, expense and balance reporting.',
    action: 'Refresh reports',
    icon: FileBarChart,
  },
  settings: {
    title: 'Finance Settings',
    subtitle: 'Receipt controls, approvals, reminders and audit posture.',
    action: 'Refresh',
    icon: SlidersHorizontal,
  },
}

const expenseDefaults = {
  title: '',
  category: 'other',
  supplier: '',
  amount: '',
  expense_date: new Date().toISOString().slice(0, 10),
  payment_method: 'cash',
  reference: '',
  description: '',
}

const structureDefaults = {
  name: '',
  due_date: '',
  item_name: 'Tuition',
  item_type: 'tuition',
  amount: '',
  late_penalty_type: 'none',
  late_penalty_value: '',
}

const planDefaults = {
  fee_account_id: '',
  installment_count: '3',
  installment_amount: '',
  start_date: new Date().toISOString().slice(0, 10),
  notes: '',
}

const discountDefaults = {
  fee_account_id: '',
  discount_type: 'manual',
  amount_type: 'amount',
  amount_value: '',
  reason: '',
}

const bankImportDefaults = {
  transaction_date: new Date().toISOString().slice(0, 10),
  amount: '',
  reference: '',
  payer_name: '',
  channel: '',
}

function money(value: any) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function numberValue(value: any) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function percent(value: any) {
  return `${numberValue(value).toFixed(1)}%`
}

function clampPercent(value: any) {
  return Math.max(0, Math.min(100, numberValue(value)))
}

function formatDate(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString()
}

function statusLabel(value: any) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function learnerName(row: any) {
  return [row.first_name, row.last_name].filter(Boolean).join(' ') || row.student_name || row.learner || '-'
}

function labelClassName() {
  return 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]'
}

function selectClassName() {
  return 'h-8 rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function statusBadge(value: any) {
  const status = String(value || '').toLowerCase()
  const tone = status === 'paid' || status.includes('posted') || status.includes('approved') || status.includes('matched') || status.includes('ready')
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : status.includes('overdue') || status.includes('unpaid') || status.includes('pending') || status.includes('unmatched') || status.includes('high')
      ? 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]'
      : status.includes('reversed') || status.includes('rejected') || status.includes('void')
        ? 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]'
        : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'

  return (
    <span className={`inline-flex h-6 items-center rounded-full border px-2 text-[11px] font-semibold ${tone}`}>
      {statusLabel(value)}
    </span>
  )
}

function paymentMethod(value: any) {
  return statusLabel(value || 'cash')
}

function accountDisplayStatus(row: any) {
  if (numberValue(row.balance) > 0 && numberValue(row.amount_paid) <= 0 && String(row.status || '').toLowerCase() !== 'overdue') return 'unpaid'
  return row.status
}

function sectionFromPath(pathname: string): FinanceSection {
  const slug = pathname.replace(/^\/fees\/?/, '') || 'dashboard'
  return Object.prototype.hasOwnProperty.call(financePages, slug) ? (slug as FinanceSection) : 'dashboard'
}

function greeting() {
  const hour = new Date().getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

function FinanceKpiCard({ item }: { item: { label: string; value: string; helper: string; delta?: string; tone: string; icon: any } }) {
  const Icon = item.icon
  const accentClass: Record<string, string> = {
    navy: 'bg-[#111827]',
    teal: 'bg-[#0f766e]',
    amber: 'bg-[#b45309]',
    slate: 'bg-[#64748b]',
    red: 'bg-[#b91c1c]',
  }
  const chipClass: Record<string, string> = {
    navy: 'bg-[#f8fafc] text-[#111827]',
    teal: 'bg-[#f0fdfa] text-[#0f766e]',
    amber: 'bg-[#fff7ed] text-[#92400e]',
    slate: 'bg-[#f8fafc] text-[#475569]',
    red: 'bg-[#fef2f2] text-[#b91c1c]',
  }

  return (
    <article className="min-h-[108px] rounded-[8px] border border-[#e5eaf1] bg-white px-4 py-3.5 shadow-[0_2px_10px_rgba(15,23,42,0.045)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`size-2 rounded-full ${accentClass[item.tone] || accentClass.navy}`} />
            <div className="truncate text-[12px] font-medium tracking-[0] text-[#64748b]">{item.label}</div>
          </div>
          <div className="mt-2 break-words text-[22px] font-medium leading-none tracking-[0] text-[#0f172a]">{item.value}</div>
        </div>
        <Icon className="mt-0.5 size-4 shrink-0 text-[#cbd5e1]" />
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        {item.delta ? <span className={`rounded-full px-2 py-1 text-[11px] font-medium leading-none ${chipClass[item.tone] || chipClass.navy}`}>{item.delta}</span> : null}
        <span className="min-w-0 truncate text-[11px] font-normal text-[#64748b]">{item.helper}</span>
      </div>
    </article>
  )
}

function MiniTable({ columns, rows, emptyMessage = 'No records yet.' }: { columns: any[]; rows: any[]; emptyMessage?: string }) {
  return (
    <div className="overflow-hidden rounded-[7px] border border-[#e2e8f0] bg-white">
      <PortalTable columns={columns} rows={rows} emptyMessage={emptyMessage} />
    </div>
  )
}

function CollectionPace({ expected, collected }: { expected: number; collected: number }) {
  const checkpoints = [0.16, 0.28, 0.42, 0.58, 0.76, 1]
  const max = Math.max(expected, collected, 1)
  return (
    <div className="grid gap-3">
      {checkpoints.map((point, index) => {
        const expectedValue = expected * point
        const collectedValue = collected * Math.min(1, point * 1.05)
        return (
          <div key={point} className="grid gap-1.5">
            <div className="flex items-center justify-between text-[11px] font-semibold text-[#64748b]">
              <span>{['Opening', 'Week 2', 'Week 4', 'Midterm', 'Week 8', 'Today'][index]}</span>
              <span>{money(collectedValue)}</span>
            </div>
            <div className="relative h-2 rounded-full bg-[#e5eaf1]">
              <div className="absolute inset-y-0 left-0 rounded-full bg-[#0f766e]" style={{ width: `${Math.min(100, (collectedValue / max) * 100)}%` }} />
              <div className="absolute inset-y-0 left-0 rounded-full border border-dashed border-[#111827]" style={{ width: `${Math.min(100, (expectedValue / max) * 100)}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

function DonutBreakdown({ rows, total }: { rows: any[]; total: number }) {
  const colors = ['#111827', '#0f766e', '#64748b', '#b45309', '#0891b2']
  let cursor = 0
  const segments = rows.length && total > 0
    ? rows.map((row, index) => {
        const start = cursor
        const size = (numberValue(row.total) / total) * 100
        cursor += size
        return `${colors[index % colors.length]} ${start}% ${cursor}%`
      }).join(', ')
    : '#e5e7eb 0% 100%'

  return (
    <div className="grid gap-4 md:grid-cols-[170px_minmax(0,1fr)]">
      <div className="grid place-items-center">
        <div className="grid size-40 place-items-center rounded-full" style={{ background: `conic-gradient(${segments})` }}>
          <div className="grid size-24 place-items-center rounded-full bg-white text-center">
            <div>
              <div className="text-[13px] font-semibold text-[#0f172a]">{money(total)}</div>
              <div className="mt-0.5 text-[10px] font-medium text-[#64748b]">Collected</div>
            </div>
          </div>
        </div>
      </div>
      <div className="grid content-center gap-2">
        {rows.length ? rows.map((row, index) => (
          <div key={row.payment_method || index} className="flex items-start justify-between gap-3 text-[12px]">
            <span className="flex min-w-0 items-center gap-2 font-semibold text-[#334155]">
              <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: colors[index % colors.length] }} />
              <span className="truncate">{paymentMethod(row.payment_method)}</span>
            </span>
            <span className="shrink-0 text-right text-[#64748b]">{money(row.total)} ({total ? percent((numberValue(row.total) / total) * 100) : '0.0%'})</span>
          </div>
        )) : (
          <div className="text-[12px] font-medium text-[#64748b]">No posted payments yet.</div>
        )}
      </div>
    </div>
  )
}

export function BursarFinancePage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { token, api, runAction, user } = usePortal()
  const section = sectionFromPath(location.pathname)
  const page = financePages[section]
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [paymentModalOpen, setPaymentModalOpen] = useState(false)
  const [expenseModalOpen, setExpenseModalOpen] = useState(false)
  const [structureModalOpen, setStructureModalOpen] = useState(false)
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [discountModalOpen, setDiscountModalOpen] = useState(false)
  const [bankImportModalOpen, setBankImportModalOpen] = useState(false)
  const [expenseForm, setExpenseForm] = useState<any>(expenseDefaults)
  const [structureForm, setStructureForm] = useState<any>(structureDefaults)
  const [planForm, setPlanForm] = useState<any>(planDefaults)
  const [discountForm, setDiscountForm] = useState<any>(discountDefaults)
  const [bankImportForm, setBankImportForm] = useState<any>(bankImportDefaults)
  const [dashboard, setDashboard] = useState<any>({})
  const [accounts, setAccounts] = useState<any[]>([])
  const [invoices, setInvoices] = useState<any[]>([])
  const [payments, setPayments] = useState<any[]>([])
  const [arrears, setArrears] = useState<any[]>([])
  const [expenses, setExpenses] = useState<any[]>([])
  const [structures, setStructures] = useState<any[]>([])
  const [paymentPlans, setPaymentPlans] = useState<any[]>([])
  const [discounts, setDiscounts] = useState<any[]>([])
  const [reports, setReports] = useState<any>({})
  const [auditLogs, setAuditLogs] = useState<any[]>([])
  const [reconciliation, setReconciliation] = useState<any>({ unreconciledPayments: [], bankTransactions: [] })

  const refresh = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const accountPayload = await api.listFeeAccounts(token)
      const [
        dashboardPayload,
        invoicePayload,
        paymentPayload,
        arrearsPayload,
        expensePayload,
        structurePayload,
        planPayload,
        discountPayload,
        reportPayload,
        auditPayload,
        reconciliationPayload,
      ] = await Promise.all([
        api.getBursarDashboard(token),
        api.listFinanceInvoices(token),
        api.listFinancePayments(token),
        api.listFinanceArrears(token),
        api.listFinanceExpenses(token),
        api.listFeeStructures(token),
        api.listPaymentPlans(token),
        api.listFinanceDiscounts(token),
        api.getFinanceReports(token),
        api.listFinanceAuditLogs(token),
        api.getFinanceReconciliation(token),
      ])

      setDashboard(dashboardPayload || {})
      setAccounts(accountPayload?.feeAccounts || [])
      setInvoices(invoicePayload?.invoices || [])
      setPayments(paymentPayload?.payments || [])
      setArrears(arrearsPayload?.arrears || [])
      setExpenses(expensePayload?.expenses || [])
      setStructures(structurePayload?.structures || [])
      setPaymentPlans(planPayload?.paymentPlans || [])
      setDiscounts(discountPayload?.discounts || [])
      setReports(reportPayload || {})
      setAuditLogs(auditPayload?.auditLogs || [])
      setReconciliation(reconciliationPayload || { unreconciledPayments: [], bankTransactions: [] })
    } catch (err: any) {
      setError(err?.message || 'Unable to load bursar finance records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    setQuery('')
  }, [section])

  const summary = dashboard?.summary || {}
  const collectionRate = clampPercent(summary.collectionRate)
  const canApproveFinance = ['school_owner', 'headteacher', 'super_admin'].includes(String(user?.role || '').toLowerCase())
  const paymentMethodRows = reports?.paymentMethodBreakdown || []
  const collectedTotal = paymentMethodRows.reduce((sum: number, row: any) => sum + numberValue(row.total), 0) || numberValue(summary.collectedFees)

  const accountRows = accounts.map((row) => ({
    id: row.id,
    learner: learnerName(row),
    admissionNo: row.admission_no || '-',
    className: row.class_name || '-',
    termName: row.term_name || '-',
    dueDate: formatDate(row.due_date),
    paid: money(row.amount_paid),
    balance: money(row.balance),
    rawPaid: numberValue(row.amount_paid),
    rawBalance: numberValue(row.balance),
    guardian: row.guardian_phone || row.guardian_email || '-',
    status: accountDisplayStatus(row),
  }))

  const invoiceRows = invoices.map((row) => ({
    id: row.id,
    invoiceNo: row.invoice_no,
    learner: learnerName(row),
    className: row.class_name || '-',
    total: money(row.total_amount),
    paid: money(row.amount_paid),
    dueDate: formatDate(row.due_date),
    guardian: row.guardian_phone || '-',
    status: row.status,
  }))

  const paymentRows = payments.map((row) => ({
    id: row.id,
    paymentId: row.id,
    receiptNo: row.receipt_no || '-',
    learner: learnerName(row),
    className: row.class_name || '-',
    amount: money(row.amount),
    method: paymentMethod(row.payment_method),
    reference: row.reference || '-',
    paidAt: formatDate(row.paid_at || row.paid_on),
    recordedBy: row.recorded_by_name || '-',
    status: row.status,
  }))

  const receiptRows = payments.map((row) => ({
    id: row.id,
    paymentId: row.id,
    receiptNo: row.receipt_no || '-',
    learner: learnerName(row),
    amount: money(row.amount),
    balanceBefore: money(row.balance_before),
    balanceAfter: money(row.balance_after),
    issuedOn: formatDate(row.paid_at || row.paid_on),
    issuedBy: row.recorded_by_name || '-',
    status: row.status,
  }))

  const arrearsRows = arrears.map((row) => ({
    id: row.id,
    learner: learnerName(row),
    className: row.class_name || '-',
    balance: money(row.balance),
    dueDate: formatDate(row.due_date),
    daysOverdue: `${Number(row.days_overdue || 0).toLocaleString()} days`,
    risk: row.risk_level || 'Low',
    guardian: row.guardian_phone || row.guardian_email || '-',
  }))

  const planRows = paymentPlans.map((row) => ({
    id: row.id,
    learner: learnerName(row),
    className: row.class_name || '-',
    total: money(row.total_balance),
    installment: money(row.installment_amount),
    count: Number(row.installment_count || 0).toLocaleString(),
    nextDue: formatDate(row.next_due_date),
    overdue: money(row.overdue_amount),
    status: row.status,
  }))

  const structureRows = structures.map((row) => ({
    id: row.id,
    name: row.name,
    className: row.class_name || 'Whole school',
    termName: [row.term_name, row.academic_year_name].filter(Boolean).join(' ') || '-',
    dueDate: formatDate(row.due_date),
    items: Number(row.item_count || 0).toLocaleString(),
    total: money(row.total_amount),
    status: row.status,
  }))

  const discountRows = discounts.map((row) => ({
    id: row.id,
    learner: learnerName(row),
    admissionNo: row.admission_no || '-',
    type: statusLabel(row.discount_type),
    amount: row.amount_type === 'percent' ? `${numberValue(row.amount_value)}%` : money(row.amount_value),
    requestedBy: row.requested_by_name || '-',
    approvedBy: row.approved_by_name || '-',
    status: row.status,
  }))

  const expenseRows = expenses.map((row) => ({
    id: row.id,
    title: row.title,
    category: statusLabel(row.category),
    supplier: row.supplier || '-',
    amount: money(row.amount),
    expenseDate: formatDate(row.expense_date),
    method: paymentMethod(row.payment_method),
    reference: row.reference || '-',
    status: row.status,
  }))

  const supplierRows = useMemo(() => {
    const suppliers = new Map<string, any>()
    expenses.forEach((expense) => {
      const key = String(expense.supplier || 'Unassigned supplier').trim() || 'Unassigned supplier'
      const current = suppliers.get(key) || { id: key, supplier: key, transactions: 0, total: 0, lastDate: null, categories: new Set<string>() }
      current.transactions += 1
      current.total += numberValue(expense.amount)
      current.lastDate = !current.lastDate || String(expense.expense_date || '') > String(current.lastDate || '') ? expense.expense_date : current.lastDate
      current.categories.add(statusLabel(expense.category))
      suppliers.set(key, current)
    })
    return [...suppliers.values()].map((row) => ({
      id: row.id,
      supplier: row.supplier,
      spend: money(row.total),
      transactions: Number(row.transactions || 0).toLocaleString(),
      categories: [...row.categories].slice(0, 3).join(', ') || '-',
      lastExpense: formatDate(row.lastDate),
      status: row.supplier === 'Unassigned supplier' ? 'Review' : 'Active',
    }))
  }, [expenses])

  const reconciliationRows = useMemo(() => {
    const unreconciled = (reconciliation?.unreconciledPayments || []).map((row: any) => ({
      id: `receipt-${row.id}`,
      kind: 'receipt',
      paymentId: row.id,
      type: 'Unmatched receipt',
      reference: row.receipt_no || row.reference || '-',
      payer: learnerName(row),
      amount: money(row.amount),
      rawAmount: numberValue(row.amount),
      date: formatDate(row.paid_at || row.paid_on),
      status: 'unmatched',
    }))
    const bankRows = (reconciliation?.bankTransactions || []).map((row: any) => ({
      id: `bank-${row.id}`,
      kind: 'bank',
      bankTransactionId: row.id,
      type: 'Bank transaction',
      reference: row.matched_receipt_no ? `${row.reference || '-'} -> ${row.matched_receipt_no}` : row.reference || '-',
      payer: row.matched_first_name ? learnerName({ first_name: row.matched_first_name, last_name: row.matched_last_name }) : row.payer_name || '-',
      amount: money(row.amount),
      rawAmount: numberValue(row.amount),
      date: formatDate(row.transaction_date),
      status: row.status,
    }))
    return [...unreconciled, ...bankRows]
  }, [reconciliation])

  const reportRows = useMemo(() => {
    const paymentReports = (reports?.paymentMethodBreakdown || []).map((row: any) => ({
      id: `payment-${row.payment_method}`,
      section: 'Payment method',
      metric: paymentMethod(row.payment_method),
      count: Number(row.payment_count || 0).toLocaleString(),
      total: money(row.total),
      status: 'Ready',
    }))
    const invoiceReports = (reports?.invoiceReport || []).map((row: any) => ({
      id: `invoice-${row.status}`,
      section: 'Invoices',
      metric: statusLabel(row.status),
      count: Number(row.invoice_count || 0).toLocaleString(),
      total: money(row.total),
      status: row.status,
    }))
    const expenseReports = (reports?.expenseReport || []).map((row: any) => ({
      id: `expense-${row.category}`,
      section: 'Expenses',
      metric: statusLabel(row.category),
      count: Number(row.expense_count || 0).toLocaleString(),
      total: money(row.total),
      status: 'Tracked',
    }))
    const agedReports = (reports?.agedReceivables || []).map((row: any) => ({
      id: `aged-${row.bucket}`,
      section: 'Aged receivables',
      metric: row.bucket,
      count: Number(row.student_count || 0).toLocaleString(),
      total: money(row.total),
      status: Number(row.total || 0) > 0 ? 'Needs review' : 'Clear',
    }))
    const classReports = (reports?.classCollection || []).slice(0, 12).map((row: any) => ({
      id: `class-${row.class_name}`,
      section: 'Class collection',
      metric: row.class_name || 'Unassigned',
      count: Number(row.account_count || 0).toLocaleString(),
      total: `${money(row.outstanding)} open`,
      status: `${percent(row.collection_rate)} collected`,
    }))
    const cashbookReports = (reports?.dailyCashbook || []).slice(0, 10).map((row: any) => ({
      id: `cashbook-${row.report_date}`,
      section: 'Daily cashbook',
      metric: formatDate(row.report_date),
      count: `${Number(row.payment_count || 0).toLocaleString()} receipts`,
      total: `${money(row.net_cash)} net`,
      status: Number(row.net_cash || 0) >= 0 ? 'Positive' : 'Negative',
    }))
    const discountReports = (reports?.discountReport || []).map((row: any) => ({
      id: `discount-${row.status}-${row.amount_type}`,
      section: 'Discounts',
      metric: `${statusLabel(row.status)} ${statusLabel(row.amount_type)}`,
      count: Number(row.discount_count || 0).toLocaleString(),
      total: money(row.applied_value || row.requested_value),
      status: row.status,
    }))
    const reversal = reports?.reversalReport
      ? [{
          id: 'reversals-total',
          section: 'Reversals',
          metric: 'Payment reversals',
          count: Number(reports.reversalReport.reversal_count || 0).toLocaleString(),
          total: money(reports.reversalReport.reversed_total),
          status: Number(reports.reversalReport.reversal_count || 0) ? 'Audit' : 'Clear',
        }]
      : []
    const incomeExpense = reports?.incomeExpenseSummary
      ? [{
          id: 'income-expense-net',
          section: 'Income vs expenses',
          metric: 'Net cash',
          count: `${money(reports.incomeExpenseSummary.collections)} collected`,
          total: money(reports.incomeExpenseSummary.netCash),
          status: Number(reports.incomeExpenseSummary.netCash || 0) >= 0 ? 'Positive' : 'Negative',
        }]
      : []
    return [...paymentReports, ...invoiceReports, ...expenseReports, ...agedReports, ...classReports, ...cashbookReports, ...discountReports, ...reversal, ...incomeExpense]
  }, [reports])

  const settingRows = [
    { id: 'receipt-numbering', policy: 'Receipt numbering', value: 'Automatic yearly sequence', owner: 'System', status: 'Active' },
    { id: 'overpayment', policy: 'Overpayment guard', value: 'Blocked unless explicitly allowed', owner: 'Bursar', status: 'Active' },
    { id: 'reversals', policy: 'Payment reversals', value: 'Leadership only with reason', owner: 'Headteacher / owner', status: 'Protected' },
    { id: 'discounts', policy: 'Discount approvals', value: 'Large waivers require leadership', owner: 'Headteacher / owner', status: 'Protected' },
    { id: 'bank-reconciliation', policy: 'Bank reconciliation', value: 'Imported rows require receipt match or leadership ignore', owner: 'Bursar / leadership', status: 'Protected' },
    { id: 'audit', policy: 'Finance audit', value: `${auditLogs.length.toLocaleString()} finance audit events`, owner: 'System', status: 'Active' },
  ]

  const rowsBySection: Record<FinanceSection, any[]> = {
    dashboard: [],
    accounts: accountRows,
    invoices: invoiceRows,
    payments: paymentRows,
    receipts: receiptRows,
    arrears: arrearsRows,
    'payment-plans': planRows,
    'fee-structures': structureRows,
    discounts: discountRows,
    expenses: expenseRows,
    suppliers: supplierRows,
    reconciliation: reconciliationRows,
    reports: reportRows,
    settings: settingRows,
  }

  const columnsBySection: Record<FinanceSection, any[]> = {
    dashboard: [],
    accounts: [
      { key: 'learner', label: 'Learner' },
      { key: 'admissionNo', label: 'Admission' },
      { key: 'className', label: 'Class' },
      { key: 'termName', label: 'Term' },
      { key: 'dueDate', label: 'Due' },
      { key: 'paid', label: 'Paid' },
      { key: 'balance', label: 'Balance' },
      { key: 'guardian', label: 'Guardian' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    invoices: [
      { key: 'invoiceNo', label: 'Invoice' },
      { key: 'learner', label: 'Learner' },
      { key: 'className', label: 'Class' },
      { key: 'total', label: 'Total' },
      { key: 'paid', label: 'Paid' },
      { key: 'dueDate', label: 'Due' },
      { key: 'guardian', label: 'Guardian' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    payments: [
      { key: 'receiptNo', label: 'Receipt' },
      { key: 'learner', label: 'Learner' },
      { key: 'className', label: 'Class' },
      { key: 'amount', label: 'Amount' },
      { key: 'method', label: 'Method' },
      { key: 'reference', label: 'Reference' },
      { key: 'paidAt', label: 'Date' },
      { key: 'recordedBy', label: 'Recorded By' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    receipts: [
      { key: 'receiptNo', label: 'Receipt' },
      { key: 'learner', label: 'Learner' },
      { key: 'amount', label: 'Amount' },
      { key: 'balanceBefore', label: 'Before' },
      { key: 'balanceAfter', label: 'After' },
      { key: 'issuedOn', label: 'Issued' },
      { key: 'issuedBy', label: 'Issued By' },
      {
        key: 'pdf',
        label: 'PDF',
        render: (row: any) => (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              openReceiptPrint(row.paymentId)
            }}
            className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#d7dde6] bg-white px-2 text-[11px] font-semibold text-[#0f766e] transition hover:border-[#0f766e]/35 hover:bg-[#f0fdfa]"
          >
            <ReceiptText className="size-3" />
            Receipt
          </button>
        ),
      },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    arrears: [
      { key: 'learner', label: 'Learner' },
      { key: 'className', label: 'Class' },
      { key: 'balance', label: 'Balance' },
      { key: 'dueDate', label: 'Due' },
      { key: 'daysOverdue', label: 'Overdue' },
      { key: 'risk', label: 'Risk', render: (row: any) => statusBadge(row.risk) },
      { key: 'guardian', label: 'Guardian' },
    ],
    'payment-plans': [
      { key: 'learner', label: 'Learner' },
      { key: 'className', label: 'Class' },
      { key: 'total', label: 'Total' },
      { key: 'installment', label: 'Installment' },
      { key: 'count', label: 'Count' },
      { key: 'nextDue', label: 'Next Due' },
      { key: 'overdue', label: 'Overdue' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    'fee-structures': [
      { key: 'name', label: 'Structure' },
      { key: 'className', label: 'Scope' },
      { key: 'termName', label: 'Term' },
      { key: 'dueDate', label: 'Due' },
      { key: 'items', label: 'Items' },
      { key: 'total', label: 'Total' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
      {
        key: 'apply',
        label: 'Apply',
        render: (row: any) => (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              applyFeeStructure(row.id)
            }}
            className="inline-flex h-7 items-center rounded-[5px] border border-[#d7dde6] bg-white px-2 text-[11px] font-semibold text-[#0f766e] transition hover:border-[#0f766e]/35 hover:bg-[#f0fdfa]"
          >
            Apply
          </button>
        ),
      },
    ],
    discounts: [
      { key: 'learner', label: 'Learner' },
      { key: 'admissionNo', label: 'Admission' },
      { key: 'type', label: 'Type' },
      { key: 'amount', label: 'Value' },
      { key: 'requestedBy', label: 'Requested By' },
      { key: 'approvedBy', label: 'Approved By' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
      {
        key: 'decision',
        label: 'Decision',
        render: (row: any) => {
          const pending = String(row.status || '').toLowerCase() === 'pending'
          if (!canApproveFinance || !pending) return <span className="text-[11px] font-medium text-[#94a3b8]">-</span>
          return (
            <span className="inline-flex gap-1.5">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  decideDiscount(row.id, 'approve')
                }}
                className="h-7 rounded-[5px] border border-[#bbf7d0] bg-[#f0fdf4] px-2 text-[11px] font-semibold text-[#166534]"
              >
                Approve
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  decideDiscount(row.id, 'reject')
                }}
                className="h-7 rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-2 text-[11px] font-semibold text-[#991b1b]"
              >
                Reject
              </button>
            </span>
          )
        },
      },
    ],
    expenses: [
      { key: 'title', label: 'Expense' },
      { key: 'category', label: 'Category' },
      { key: 'supplier', label: 'Supplier' },
      { key: 'amount', label: 'Amount' },
      { key: 'expenseDate', label: 'Date' },
      { key: 'method', label: 'Method' },
      { key: 'reference', label: 'Reference' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
      {
        key: 'decision',
        label: 'Decision',
        render: (row: any) => {
          const status = String(row.status || '').toLowerCase()
          if (!canApproveFinance) return <span className="text-[11px] font-medium text-[#94a3b8]">-</span>
          if (['draft', 'pending_approval'].includes(status)) {
            return (
              <span className="inline-flex gap-1.5">
                <button type="button" onClick={(event) => { event.stopPropagation(); decideExpense(row.id, 'approve') }} className="h-7 rounded-[5px] border border-[#bbf7d0] bg-[#f0fdf4] px-2 text-[11px] font-semibold text-[#166534]">Approve</button>
                <button type="button" onClick={(event) => { event.stopPropagation(); decideExpense(row.id, 'reject') }} className="h-7 rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-2 text-[11px] font-semibold text-[#991b1b]">Reject</button>
              </span>
            )
          }
          if (status === 'approved') {
            return (
              <button type="button" onClick={(event) => { event.stopPropagation(); decideExpense(row.id, 'pay') }} className="h-7 rounded-[5px] border border-[#d7dde6] bg-white px-2 text-[11px] font-semibold text-[#0f766e]">Mark paid</button>
            )
          }
          return <span className="text-[11px] font-medium text-[#94a3b8]">-</span>
        },
      },
    ],
    suppliers: [
      { key: 'supplier', label: 'Supplier' },
      { key: 'spend', label: 'Spend' },
      { key: 'transactions', label: 'Transactions' },
      { key: 'categories', label: 'Categories' },
      { key: 'lastExpense', label: 'Last Expense' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    reconciliation: [
      { key: 'type', label: 'Type' },
      { key: 'reference', label: 'Reference' },
      { key: 'payer', label: 'Payer' },
      { key: 'amount', label: 'Amount' },
      { key: 'date', label: 'Date' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
      {
        key: 'action',
        label: 'Action',
        render: (row: any) => {
          if (row.kind !== 'bank') return <span className="text-[11px] font-medium text-[#94a3b8]">-</span>
          const status = String(row.status || '').toLowerCase()
          if (status === 'unmatched') {
            return (
              <span className="inline-flex gap-1.5">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    matchBankRow(row.bankTransactionId)
                  }}
                  className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#bbf7d0] bg-[#f0fdf4] px-2 text-[11px] font-semibold text-[#166534]"
                >
                  <Link2 className="size-3" />
                  Match
                </button>
                {canApproveFinance ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      transitionBankRow(row.bankTransactionId, 'ignore')
                    }}
                    className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-2 text-[11px] font-semibold text-[#9a3412]"
                  >
                    <XCircle className="size-3" />
                    Ignore
                  </button>
                ) : null}
              </span>
            )
          }
          if (status === 'matched') {
            return (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  transitionBankRow(row.bankTransactionId, 'unmatch')
                }}
                className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-[#d7dde6] bg-white px-2 text-[11px] font-semibold text-[#475569]"
              >
                <XCircle className="size-3" />
                Unmatch
              </button>
            )
          }
          return <span className="text-[11px] font-medium text-[#94a3b8]">-</span>
        },
      },
    ],
    reports: [
      { key: 'section', label: 'Section' },
      { key: 'metric', label: 'Metric' },
      { key: 'count', label: 'Count' },
      { key: 'total', label: 'Total' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
    settings: [
      { key: 'policy', label: 'Policy' },
      { key: 'value', label: 'Value' },
      { key: 'owner', label: 'Owner' },
      { key: 'status', label: 'Status', render: (row: any) => statusBadge(row.status) },
    ],
  }

  const activeRows = rowsBySection[section] || []
  const visibleRows = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return activeRows
    return activeRows.filter((row) =>
      Object.values(row).some((field) =>
        String(field || '')
          .toLowerCase()
          .includes(value),
      ),
    )
  }, [activeRows, query])

  const sectionKpis: Record<FinanceSection, SectionKpiItem[]> = {
    dashboard: [],
    accounts: [
      { label: 'Accounts', value: accountRows.length, helper: 'fee accounts', delta: 'current scope', rows: accountRows, columns: columnsBySection.accounts },
      { label: 'Outstanding', value: money(summary.outstandingBalance), helper: 'open balances', delta: `${summary.studentsInArrears || 0} overdue`, tone: 'warn', rows: accountRows.filter((row) => row.rawBalance > 0), columns: columnsBySection.accounts },
      { label: 'Fully Paid', value: summary.fullyPaidStudents || 0, helper: 'learners', delta: 'complete', tone: 'good', rows: accountRows.filter((row) => String(row.status).toLowerCase() === 'paid'), columns: columnsBySection.accounts },
      { label: 'Unpaid', value: summary.unpaidStudents ?? accountRows.filter((row) => row.rawBalance > 0 && row.rawPaid <= 0).length, helper: 'no payment yet', delta: 'follow up', tone: 'warn', rows: accountRows.filter((row) => row.rawBalance > 0 && row.rawPaid <= 0), columns: columnsBySection.accounts },
    ],
    invoices: [
      { label: 'Invoices', value: invoiceRows.length, helper: 'generated', delta: 'billing records', rows: invoiceRows, columns: columnsBySection.invoices },
      { label: 'Unpaid', value: invoiceRows.filter((row) => String(row.status).toLowerCase() === 'unpaid').length, helper: 'invoices', delta: 'needs follow up', tone: 'warn', rows: invoiceRows.filter((row) => String(row.status).toLowerCase() === 'unpaid'), columns: columnsBySection.invoices },
      { label: 'Paid', value: invoiceRows.filter((row) => String(row.status).toLowerCase() === 'paid').length, helper: 'invoices', delta: 'settled', tone: 'good', rows: invoiceRows.filter((row) => String(row.status).toLowerCase() === 'paid'), columns: columnsBySection.invoices },
      { label: 'Invoice Value', value: money(invoices.reduce((sum, row) => sum + numberValue(row.total_amount), 0)), helper: 'total billed', delta: 'all invoices', rows: invoiceRows, columns: columnsBySection.invoices },
    ],
    payments: [
      { label: 'Payments', value: paymentRows.length, helper: 'posted records', delta: 'latest first', rows: paymentRows, columns: columnsBySection.payments },
      { label: 'Collected', value: money(summary.collectedFees), helper: 'posted receipts', delta: `${collectionRate.toFixed(1)}% rate`, tone: 'good', rows: paymentRows, columns: columnsBySection.payments },
      { label: 'Today', value: money(summary.todayCollections), helper: 'collections', delta: `${money(summary.weekCollections)} week`, rows: paymentRows, columns: columnsBySection.payments },
      { label: 'Reversed', value: payments.filter((row) => row.status === 'reversed').length, helper: 'payments', delta: 'audit check', tone: 'warn', rows: paymentRows.filter((row) => row.status === 'reversed'), columns: columnsBySection.payments },
    ],
    receipts: [
      { label: 'Receipts', value: receiptRows.length, helper: 'issued', delta: 'payment proof', rows: receiptRows, columns: columnsBySection.receipts },
      { label: 'Receipt Value', value: money(payments.reduce((sum, row) => sum + numberValue(row.amount), 0)), helper: 'all receipts', delta: 'posted and reversed', tone: 'good', rows: receiptRows, columns: columnsBySection.receipts },
      { label: 'Today', value: money(summary.todayCollections), helper: 'receipt value', delta: 'current day', rows: receiptRows, columns: columnsBySection.receipts },
      { label: 'Methods', value: paymentMethodRows.length, helper: 'payment channels', delta: 'breakdown ready', rows: reportRows, columns: columnsBySection.reports },
    ],
    arrears: [
      { label: 'Arrears', value: arrearsRows.length, helper: 'students', delta: money(summary.outstandingBalance), tone: 'warn', rows: arrearsRows, columns: columnsBySection.arrears },
      { label: 'High Risk', value: arrearsRows.filter((row) => String(row.risk).toLowerCase() === 'high').length, helper: 'students', delta: 'priority calls', tone: 'bad', rows: arrearsRows.filter((row) => String(row.risk).toLowerCase() === 'high'), columns: columnsBySection.arrears },
      { label: 'Plans', value: planRows.length, helper: 'agreements', delta: 'active support', rows: planRows, columns: columnsBySection['payment-plans'] },
      { label: 'Oldest', value: arrearsRows[0]?.daysOverdue || '0 days', helper: 'overdue', delta: 'top record', tone: 'warn', rows: arrearsRows.slice(0, 1), columns: columnsBySection.arrears },
    ],
    'payment-plans': [
      { label: 'Plans', value: planRows.length, helper: 'agreements', delta: 'all statuses', rows: planRows, columns: columnsBySection['payment-plans'] },
      { label: 'Active', value: planRows.filter((row) => String(row.status).toLowerCase() === 'active').length, helper: 'plans', delta: 'in progress', tone: 'good', rows: planRows.filter((row) => String(row.status).toLowerCase() === 'active'), columns: columnsBySection['payment-plans'] },
      { label: 'Overdue Value', value: money(paymentPlans.reduce((sum, row) => sum + numberValue(row.overdue_amount), 0)), helper: 'installments', delta: 'follow up', tone: 'warn', rows: planRows, columns: columnsBySection['payment-plans'] },
      { label: 'Planned Balance', value: money(paymentPlans.reduce((sum, row) => sum + numberValue(row.total_balance), 0)), helper: 'covered', delta: 'under plans', rows: planRows, columns: columnsBySection['payment-plans'] },
    ],
    'fee-structures': [
      { label: 'Structures', value: structureRows.length, helper: 'templates', delta: 'billing setup', rows: structureRows, columns: columnsBySection['fee-structures'] },
      { label: 'Active', value: structureRows.filter((row) => String(row.status).toLowerCase() === 'active').length, helper: 'templates', delta: 'usable now', tone: 'good', rows: structureRows.filter((row) => String(row.status).toLowerCase() === 'active'), columns: columnsBySection['fee-structures'] },
      { label: 'Template Value', value: money(structures.reduce((sum, row) => sum + numberValue(row.total_amount), 0)), helper: 'configured', delta: 'all templates', rows: structureRows, columns: columnsBySection['fee-structures'] },
      { label: 'Items', value: structures.reduce((sum, row) => sum + numberValue(row.item_count), 0), helper: 'charge lines', delta: 'across templates', rows: structureRows, columns: columnsBySection['fee-structures'] },
    ],
    discounts: [
      { label: 'Requests', value: discountRows.length, helper: 'waivers', delta: 'all statuses', rows: discountRows, columns: columnsBySection.discounts },
      { label: 'Pending', value: discountRows.filter((row) => String(row.status).toLowerCase() === 'pending').length, helper: 'requests', delta: 'needs oversight', tone: 'warn', rows: discountRows.filter((row) => String(row.status).toLowerCase() === 'pending'), columns: columnsBySection.discounts },
      { label: 'Approved', value: discountRows.filter((row) => String(row.status).toLowerCase() === 'approved').length, helper: 'waivers', delta: 'applied policy', tone: 'good', rows: discountRows.filter((row) => String(row.status).toLowerCase() === 'approved'), columns: columnsBySection.discounts },
      { label: 'Bursar Limit', value: canApproveFinance ? 'Oversight' : 'Request only', helper: 'approval boundary', delta: canApproveFinance ? 'can approve' : 'cannot approve', rows: discountRows, columns: columnsBySection.discounts },
    ],
    expenses: [
      { label: 'Expenses', value: expenseRows.length, helper: 'logged', delta: 'all statuses', rows: expenseRows, columns: columnsBySection.expenses },
      { label: 'Spend', value: money(expenses.reduce((sum, row) => sum + numberValue(row.amount), 0)), helper: 'expense value', delta: 'all records', rows: expenseRows, columns: columnsBySection.expenses },
      { label: 'Pending', value: money(summary.pendingExpenses), helper: 'approval queue', delta: 'review', tone: 'warn', rows: expenseRows.filter((row) => String(row.status).includes('pending')), columns: columnsBySection.expenses },
      { label: 'Approved', value: money(summary.approvedExpenses), helper: 'accepted spend', delta: 'finance book', tone: 'good', rows: expenseRows.filter((row) => ['approved', 'paid'].includes(String(row.status).toLowerCase())), columns: columnsBySection.expenses },
    ],
    suppliers: [
      { label: 'Suppliers', value: supplierRows.length, helper: 'expense sources', delta: 'derived', rows: supplierRows, columns: columnsBySection.suppliers },
      { label: 'Supplier Spend', value: money(expenses.reduce((sum, row) => sum + numberValue(row.amount), 0)), helper: 'logged', delta: 'all suppliers', rows: supplierRows, columns: columnsBySection.suppliers },
      { label: 'Top Supplier', value: supplierRows[0]?.supplier || '-', helper: 'by spend', delta: supplierRows[0]?.spend || money(0), rows: supplierRows.slice(0, 1), columns: columnsBySection.suppliers },
      { label: 'Unassigned', value: supplierRows.filter((row) => row.supplier === 'Unassigned supplier').length, helper: 'records', delta: 'clean up', tone: 'warn', rows: supplierRows.filter((row) => row.supplier === 'Unassigned supplier'), columns: columnsBySection.suppliers },
    ],
    reconciliation: [
      { label: 'Unmatched', value: reconciliationRows.filter((row) => row.status === 'unmatched').length, helper: 'records', delta: 'needs matching', tone: 'warn', rows: reconciliationRows.filter((row) => row.status === 'unmatched'), columns: columnsBySection.reconciliation },
      { label: 'Bank Rows', value: (reconciliation?.bankTransactions || []).length, helper: 'imports', delta: 'bank side', rows: reconciliationRows, columns: columnsBySection.reconciliation },
      { label: 'Receipt Rows', value: (reconciliation?.unreconciledPayments || []).length, helper: 'receipt side', delta: 'cashbook', rows: reconciliationRows, columns: columnsBySection.reconciliation },
      { label: 'Matched', value: reconciliationRows.filter((row) => row.status === 'matched').length, helper: 'records', delta: 'reconciled', tone: 'good', rows: reconciliationRows.filter((row) => row.status === 'matched'), columns: columnsBySection.reconciliation },
    ],
    reports: [
      { label: 'Report Lines', value: reportRows.length, helper: 'available', delta: 'finance summaries', rows: reportRows, columns: columnsBySection.reports },
      { label: 'Collections', value: money(summary.collectedFees), helper: 'posted', delta: 'reports basis', tone: 'good', rows: reportRows, columns: columnsBySection.reports },
      { label: 'Expenses', value: money(expenses.reduce((sum, row) => sum + numberValue(row.amount), 0)), helper: 'reported spend', delta: 'expense summary', rows: reportRows, columns: columnsBySection.reports },
      { label: 'Balances', value: accountRows.length, helper: 'balance rows', delta: 'export scope', rows: accountRows, columns: columnsBySection.accounts },
    ],
    settings: [
      { label: 'Policies', value: settingRows.length, helper: 'finance controls', delta: 'configured', rows: settingRows, columns: columnsBySection.settings },
      { label: 'Audit Events', value: auditLogs.length, helper: 'finance trail', delta: 'latest records', rows: auditLogs, columns: [{ key: 'action', label: 'Action' }, { key: 'entity_type', label: 'Entity' }, { key: 'user_name', label: 'User' }, { key: 'created_at', label: 'Date' }] },
      { label: 'Protected Gates', value: 3, helper: 'oversight rules', delta: 'reversals, waivers, bank ignores', tone: 'good', rows: settingRows, columns: columnsBySection.settings },
      { label: 'Role Scope', value: 'Finance', helper: 'bursar access', delta: 'limited by design', tone: 'good', rows: settingRows, columns: columnsBySection.settings },
    ],
  }

  const dashboardKpis = [
    { label: 'Expected Fees', value: money(summary.expectedFees), helper: 'Academic scope', delta: `${money(summary.collectedFees)} collected`, tone: 'navy', icon: WalletCards },
    { label: 'Outstanding', value: money(summary.outstandingBalance), helper: 'Open receivables', delta: `${Number(summary.unpaidStudents || 0).toLocaleString()} unpaid`, tone: 'amber', icon: ReceiptText },
    { label: 'Collection Rate', value: percent(summary.collectionRate), helper: 'Collected against expected', delta: `${Number(summary.fullyPaidStudents || 0).toLocaleString()} settled`, tone: 'teal', icon: FileBarChart },
    { label: 'Arrears', value: Number(summary.studentsInArrears || 0).toLocaleString(), helper: 'Overdue learner accounts', delta: 'priority', tone: 'red', icon: AlertTriangle },
    { label: "Today's Receipts", value: money(summary.todayCollections), helper: 'Posted today', delta: `${money(summary.weekCollections)} week`, tone: 'slate', icon: Landmark },
    { label: 'Pending Spend', value: money(summary.pendingExpenses), helper: 'Awaiting approval', delta: 'expenses', tone: 'slate', icon: Banknote },
  ]

  const actionForSection = () => {
    if (['accounts', 'payments', 'receipts', 'dashboard'].includes(section)) {
      setPaymentModalOpen(true)
      return
    }
    if (section === 'invoices') {
      generateInvoices()
      return
    }
    if (['arrears', 'payment-plans'].includes(section)) {
      setPlanModalOpen(true)
      return
    }
    if (section === 'fee-structures') {
      setStructureModalOpen(true)
      return
    }
    if (section === 'discounts') {
      setDiscountModalOpen(true)
      return
    }
    if (['expenses', 'suppliers'].includes(section)) {
      setExpenseModalOpen(true)
      return
    }
    if (section === 'reconciliation') {
      setBankImportModalOpen(true)
      return
    }
    refresh()
  }

  const generateInvoices = async () => {
    if (!token) return
    await runAction(() => api.generateFinanceInvoices(token, {}), 'Generating invoices...', { refresh: false })
    await refresh()
  }

  const syncAccounts = async () => {
    if (!token) return
    await runAction(() => api.syncFeeAccounts(token), 'Syncing fee accounts...', { refresh: false })
    await refresh()
  }

  const applyFeeStructure = async (id: any) => {
    if (!token || !id) return
    await runAction(() => api.applyFeeStructure(token, id), 'Applying fee structure...', { refresh: false })
    await refresh()
  }

  const decideDiscount = async (id: any, action: 'approve' | 'reject') => {
    if (!token || !id) return
    await runAction(() => api.transitionFinanceDiscount(token, id, action), `${action === 'approve' ? 'Approving' : 'Rejecting'} waiver...`, { refresh: false })
    await refresh()
  }

  const decideExpense = async (id: any, action: 'approve' | 'reject' | 'pay') => {
    if (!token || !id) return
    const label = action === 'pay' ? 'Marking expense paid' : `${action === 'approve' ? 'Approving' : 'Rejecting'} expense`
    await runAction(() => api.transitionFinanceExpense(token, id, action), `${label}...`, { refresh: false })
    await refresh()
  }

  const matchBankRow = async (bankTransactionId: any) => {
    if (!token || !bankTransactionId) return
    const bankRow = (reconciliation?.bankTransactions || []).find((row: any) => String(row.id) === String(bankTransactionId))
    const unmatchedPayments = reconciliation?.unreconciledPayments || []
    const amountMatches = unmatchedPayments.filter((row: any) => numberValue(row.amount) === numberValue(bankRow?.amount))
    const reference = String(bankRow?.reference || '').toLowerCase()
    const referenceMatches = reference
      ? amountMatches.filter((row: any) =>
          [row.receipt_no, row.reference]
            .filter(Boolean)
            .some((value) => String(value).toLowerCase().includes(reference) || reference.includes(String(value).toLowerCase())),
        )
      : []
    const candidate = referenceMatches[0] || amountMatches[0]
    if (!candidate) {
      setError('No unmatched receipt has the same amount. Record the receipt first or match it after correcting the bank row.')
      return
    }
    await runAction(
      () => api.matchBankTransaction(token, bankTransactionId, { payment_id: candidate.id }),
      'Matching bank transaction...',
      { refresh: false },
    )
    await refresh()
  }

  const transitionBankRow = async (bankTransactionId: any, action: 'unmatch' | 'ignore') => {
    if (!token || !bankTransactionId || typeof window === 'undefined') return
    const reason = window.prompt(action === 'ignore' ? 'Reason for ignoring this bank transaction' : 'Reason for unmatching this bank transaction')
    if (!reason?.trim()) return
    await runAction(
      () => api.transitionBankTransaction(token, bankTransactionId, action, { reason: reason.trim() }),
      `${action === 'ignore' ? 'Ignoring' : 'Unmatching'} bank transaction...`,
      { refresh: false },
    )
    await refresh()
  }

  function openReceiptPrint(paymentId: any) {
    if (!token || !paymentId || typeof window === 'undefined') return
    const receiptPath = `/fees/payments/${paymentId}/receipt`
    const receiptWindow = window.open(receiptPath, '_blank')
    if (!receiptWindow) navigate(receiptPath)
  }

  async function downloadBalancesCsv() {
    if (!token || typeof window === 'undefined') return
    const blob = await runAction(() => api.downloadFinanceReportCsv(token), 'Preparing balance CSV...', { refresh: false })
    if (!blob) return
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `fee-balances-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => window.URL.revokeObjectURL(url), 30000)
  }

  const submitExpense = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    await runAction(
      () =>
        api.createFinanceExpense(token, {
          ...expenseForm,
          amount: Number(expenseForm.amount || 0),
          status: 'pending_approval',
        }),
      'Logging expense...',
      { refresh: false },
    )
    setExpenseForm(expenseDefaults)
    setExpenseModalOpen(false)
    await refresh()
  }

  const submitStructure = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    await runAction(
      () =>
        api.createFeeStructure(token, {
          name: structureForm.name || undefined,
          due_date: structureForm.due_date || undefined,
          late_penalty_type: structureForm.late_penalty_type,
          late_penalty_value: Number(structureForm.late_penalty_value || 0),
          items: [
            {
              item_name: structureForm.item_name,
              item_type: structureForm.item_type,
              amount: Number(structureForm.amount || 0),
            },
          ],
        }),
      'Creating fee structure...',
      { refresh: false },
    )
    setStructureForm(structureDefaults)
    setStructureModalOpen(false)
    await refresh()
  }

  const submitPaymentPlan = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    const account = accounts.find((row) => String(row.id) === String(planForm.fee_account_id))
    await runAction(
      () =>
        api.createPaymentPlan(token, {
          fee_account_id: planForm.fee_account_id,
          student_id: account?.student_id,
          total_balance: numberValue(account?.balance),
          installment_count: Number(planForm.installment_count || 1),
          installment_amount: Number(planForm.installment_amount || 0),
          start_date: planForm.start_date,
          notes: planForm.notes || null,
        }),
      'Creating payment plan...',
      { refresh: false },
    )
    setPlanForm(planDefaults)
    setPlanModalOpen(false)
    await refresh()
  }

  const submitDiscount = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    const account = accounts.find((row) => String(row.id) === String(discountForm.fee_account_id))
    await runAction(
      () =>
        api.createFinanceDiscount(token, {
          fee_account_id: discountForm.fee_account_id || null,
          student_id: account?.student_id,
          discount_type: discountForm.discount_type,
          amount_type: discountForm.amount_type,
          amount_value: Number(discountForm.amount_value || 0),
          reason: discountForm.reason,
        }),
      'Requesting waiver...',
      { refresh: false },
    )
    setDiscountForm(discountDefaults)
    setDiscountModalOpen(false)
    await refresh()
  }

  const submitBankImport = async (event: FormEvent) => {
    event.preventDefault()
    if (!token) return
    await runAction(
      () =>
        api.importBankTransactions(token, {
          ...bankImportForm,
          amount: Number(bankImportForm.amount || 0),
        }),
      'Importing bank transaction...',
      { refresh: false },
    )
    setBankImportForm(bankImportDefaults)
    setBankImportModalOpen(false)
    await refresh()
  }

  const updateExpense = (key: string, value: any) => setExpenseForm((current: any) => ({ ...current, [key]: value }))
  const updateStructure = (key: string, value: any) => setStructureForm((current: any) => ({ ...current, [key]: value }))
  const updatePlan = (key: string, value: any) => setPlanForm((current: any) => ({ ...current, [key]: value }))
  const updateDiscount = (key: string, value: any) => setDiscountForm((current: any) => ({ ...current, [key]: value }))
  const updateBankImport = (key: string, value: any) => setBankImportForm((current: any) => ({ ...current, [key]: value }))

  const selectedPlanAccount = accounts.find((row) => String(row.id) === String(planForm.fee_account_id))
  const selectedDiscountAccount = accounts.find((row) => String(row.id) === String(discountForm.fee_account_id))

  const renderDashboard = () => {
    const recentPayments = paymentRows.slice(0, 5)
    const recentInvoices = invoiceRows.slice(0, 5)
    const priorityArrears = arrearsRows.slice(0, 5)
    const unpaidAccounts = accountRows.filter((row) => row.rawBalance > 0 && row.rawPaid <= 0)
    const todayPaymentCount = payments.filter((row) => String(row.paid_on || row.paid_at || '').slice(0, 10) === new Date().toISOString().slice(0, 10)).length
    const agingBuckets = [
      { label: '0 - 30 days', amount: arrears.filter((row) => numberValue(row.days_overdue) <= 30).reduce((sum, row) => sum + numberValue(row.balance), 0), color: '#111827' },
      { label: '31 - 60 days', amount: arrears.filter((row) => numberValue(row.days_overdue) > 30 && numberValue(row.days_overdue) <= 60).reduce((sum, row) => sum + numberValue(row.balance), 0), color: '#f59e0b' },
      { label: '61 - 90 days', amount: arrears.filter((row) => numberValue(row.days_overdue) > 60 && numberValue(row.days_overdue) <= 90).reduce((sum, row) => sum + numberValue(row.balance), 0), color: '#64748b' },
      { label: '90+ days', amount: arrears.filter((row) => numberValue(row.days_overdue) > 90).reduce((sum, row) => sum + numberValue(row.balance), 0), color: '#ef4444' },
    ]
    const agingTotal = agingBuckets.reduce((sum, row) => sum + row.amount, 0)

    return (
      <div className="grid gap-4">
        <section className="rounded-[10px] border border-[#dce3ed] bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_430px]">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Finance Command Center</div>
              <h1 className="mt-2 text-[24px] font-semibold tracking-[-0.025em] text-[#0f172a]">{greeting()}, {String(user?.fullName || user?.full_name || user?.email || 'Bursar').split(' ')[0]}</h1>
              <p className="mt-1 max-w-2xl text-[13px] font-medium leading-5 text-[#64748b]">Review collections, unpaid accounts, arrears and the next finance actions without leaving the dashboard.</p>
            </div>
            <div className="grid gap-3 border-t border-[#eef2f7] pt-4 xl:border-l xl:border-t-0 xl:pl-5 xl:pt-0">
              <div className="flex items-center justify-between gap-3 text-[11px] font-semibold text-[#64748b]">
                <span className="inline-flex items-center gap-2">
                  <span className="size-2 rounded-full bg-[#0f766e]" />
                  Last updated {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
                <button type="button" onClick={refresh} className="grid size-8 place-items-center rounded-[5px] border border-[#dce3ed] bg-white text-[#475569] transition hover:bg-[#f8fafc]">
                  <RefreshCcw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  ['Open', money(summary.outstandingBalance)],
                  ['Unpaid', Number(summary.unpaidStudents || unpaidAccounts.length).toLocaleString()],
                  ['Overdue', Number(summary.studentsInArrears || 0).toLocaleString()],
                ].map(([label, value]) => (
                  <div key={label} className="border-l border-[#dce3ed] pl-3 first:border-l-0 first:pl-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#94a3b8]">{label}</div>
                    <div className="mt-1 text-[14px] font-semibold text-[#0f172a]">{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap gap-2 border-t border-[#eef2f7] pt-4">
            {[
              { label: 'Record Payment', detail: 'Post receipt', icon: ReceiptText, action: () => setPaymentModalOpen(true), primary: true },
              { label: 'Generate Invoice', detail: 'Create billing', icon: FileText, action: generateInvoices },
              { label: 'Log Expense', detail: 'Supplier spend', icon: Banknote, action: () => setExpenseModalOpen(true) },
              { label: 'View Arrears', detail: 'Follow up', icon: AlertTriangle, action: () => navigate('/fees/arrears') },
              { label: 'Reconcile', detail: 'Match bank', icon: Landmark, action: () => navigate('/fees/reconciliation') },
            ].map((action) => {
              const Icon = action.icon
              return (
                <button
                  key={action.label}
                  type="button"
                  onClick={action.action}
                  className={`inline-flex h-10 items-center gap-2 rounded-[6px] border px-3 text-left text-[12px] font-semibold transition ${
                    action.primary
                      ? 'border-[#111827] bg-[#111827] text-white hover:bg-[#0f172a]'
                      : 'border-[#dce3ed] bg-white text-[#334155] hover:border-[#0f766e]/35 hover:bg-[#f8fafc]'
                  }`}
                >
                  <Icon className={`size-3.5 ${action.primary ? 'text-white' : 'text-[#64748b]'}`} />
                  <span>{action.label}</span>
                  <span className={`hidden text-[11px] font-medium sm:inline ${action.primary ? 'text-white/70' : 'text-[#94a3b8]'}`}>{action.detail}</span>
                </button>
              )
            })}
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
          {dashboardKpis.map((item) => <FinanceKpiCard key={item.label} item={item} />)}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(340px,0.75fr)_340px]">
          <SectionCard title="Collection Pace" subtitle="Collected values against expected fee progress.">
            <div className="p-4">
              <CollectionPace expected={numberValue(summary.expectedFees)} collected={numberValue(summary.collectedFees)} />
            </div>
          </SectionCard>

          <SectionCard title="Payment Method Breakdown" subtitle="Posted payment channels.">
            <div className="p-4">
              <DonutBreakdown rows={paymentMethodRows} total={collectedTotal} />
            </div>
          </SectionCard>

          <SectionCard title="Operating Brief" subtitle="Today and next follow-up.">
            <div className="grid gap-4 p-4">
              <div className="grid gap-2">
              {[
                ['Collections today', money(summary.todayCollections)],
                ['Payments recorded', Number(todayPaymentCount).toLocaleString()],
                ['New invoices', Number(invoices.length).toLocaleString()],
                ['Expenses logged', Number(expenses.length).toLocaleString()],
                ['Pending expenses', money(summary.pendingExpenses)],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 border-b border-[#eef2f7] py-2 last:border-b-0">
                  <span className="text-[12px] font-medium text-[#64748b]">{label}</span>
                  <strong className="text-[12px] font-semibold text-[#0f172a]">{value}</strong>
                </div>
              ))}
              </div>
              <div className="border-t border-[#eef2f7] pt-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748b]">Attention Queue</div>
                {[
                  { label: 'Unpaid accounts', value: Number(summary.unpaidStudents || unpaidAccounts.length).toLocaleString(), detail: money(unpaidAccounts.reduce((sum, row) => sum + numberValue(row.rawBalance), 0)), action: () => navigate('/fees/accounts') },
                  { label: 'Overdue learners', value: Number(summary.studentsInArrears || 0).toLocaleString(), detail: money(arrears.reduce((sum, row) => sum + numberValue(row.balance), 0)), action: () => navigate('/fees/arrears') },
                  { label: 'Receipts ready', value: Number(receiptRows.length).toLocaleString(), detail: 'PDF issue history', action: () => navigate('/fees/receipts') },
                ].map((item) => (
                  <button key={item.label} type="button" onClick={item.action} className="flex w-full items-center justify-between gap-3 rounded-[6px] border border-transparent px-2 py-2 text-left transition hover:border-[#dce3ed] hover:bg-[#f8fafc]">
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold text-[#0f172a]">{item.label}</span>
                      <span className="mt-0.5 block text-[11px] font-medium text-[#64748b]">{item.detail}</span>
                    </span>
                    <span className="shrink-0 text-[16px] font-semibold tracking-[0] text-[#111827]">{item.value}</span>
                  </button>
                ))}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
          <SectionCard title="Recent Payments" subtitle="Latest posted payment records.">
            <div className="p-4">
              <MiniTable columns={columnsBySection.payments.slice(0, 7)} rows={recentPayments} emptyMessage="No payments recorded yet." />
            </div>
          </SectionCard>

          <SectionCard title="Aging of Receivables" subtitle="Overdue exposure by age band.">
            <div className="grid gap-3 p-4">
              {agingBuckets.map((bucket) => (
                <div key={bucket.label} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="flex items-center gap-2 font-semibold text-[#334155]">
                      <span className="size-2.5 rounded-full" style={{ backgroundColor: bucket.color }} />
                      {bucket.label}
                    </span>
                    <span className="font-semibold text-[#0f172a]">{money(bucket.amount)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-[#e5eaf1]">
                    <div className="h-full rounded-full" style={{ width: `${agingTotal ? Math.min(100, (bucket.amount / agingTotal) * 100) : 0}%`, backgroundColor: bucket.color }} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          <SectionCard title="Students in Arrears" subtitle="Priority follow-up list.">
            <div className="p-4">
              <MiniTable columns={columnsBySection.arrears.slice(0, 6)} rows={priorityArrears} emptyMessage="No overdue balances found." />
            </div>
          </SectionCard>
          <SectionCard title="Recent Invoices" subtitle="Latest generated invoice records.">
            <div className="p-4">
              <MiniTable columns={columnsBySection.invoices.slice(0, 7)} rows={recentInvoices} emptyMessage="No invoices generated yet." />
            </div>
          </SectionCard>
        </div>
      </div>
    )
  }

  const renderSection = () => {
    if (section === 'dashboard') return renderDashboard()
    const Icon = page.icon
    return (
      <div className="grid gap-4">
        <section className="rounded-[10px] border border-[#dce3ed] bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-[9px] bg-[#071a33] text-white">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Bursar Portal</div>
                <h1 className="mt-1 text-[24px] font-semibold tracking-[-0.04em] text-[#0f172a]">{page.title}</h1>
                <p className="mt-1 max-w-3xl text-[13px] font-medium leading-5 text-[#64748b]">{page.subtitle}</p>
              </div>
            </div>
            {page.action ? (
              <button
                type="button"
                onClick={actionForSection}
                className="inline-flex h-9 items-center gap-2 rounded-[6px] bg-[#111827] px-3 text-[12px] font-semibold text-white shadow-sm transition hover:bg-[#0f172a]"
              >
                <Plus className="size-3.5" />
                {page.action}
              </button>
            ) : null}
          </div>
        </section>

        <SectionKpiStrip items={sectionKpis[section] || []} />

        <SectionCard title={page.title} subtitle={loading ? 'Loading finance records...' : `${visibleRows.length} visible records`}>
          <div className="grid gap-3 p-4">
            <Toolbar>
              <div className="relative min-w-[260px] flex-1">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-8 pl-9 text-[12px]"
                  placeholder={`Search ${page.title.toLowerCase()}...`}
                />
              </div>
              <button
                type="button"
                onClick={refresh}
                className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#d7dde6] bg-white px-3 text-[12px] font-semibold text-[#475569]"
              >
                <RefreshCcw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
                Sync
              </button>
              {['accounts', 'settings', 'fee-structures'].includes(section) ? (
                <button
                  type="button"
                  onClick={syncAccounts}
                  className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#d7dde6] bg-white px-3 text-[12px] font-semibold text-[#475569]"
                >
                  <WalletCards className="size-3.5" />
                  Sync accounts
                </button>
              ) : null}
              {section === 'reports' ? (
                <button
                  type="button"
                  onClick={downloadBalancesCsv}
                  className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#d7dde6] bg-white px-3 text-[12px] font-semibold text-[#475569]"
                >
                  <FileText className="size-3.5" />
                  Export balances
                </button>
              ) : null}
              {section === 'reconciliation' ? (
                <button
                  type="button"
                  onClick={() => setBankImportModalOpen(true)}
                  className="inline-flex h-8 items-center gap-2 rounded-[5px] border border-[#d7dde6] bg-white px-3 text-[12px] font-semibold text-[#475569]"
                >
                  <Upload className="size-3.5" />
                  Import bank row
                </button>
              ) : null}
            </Toolbar>

            {error ? (
              <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">
                {error}
              </div>
            ) : null}

            <PortalTable
              columns={columnsBySection[section]}
              rows={visibleRows}
              emptyMessage={loading ? 'Loading finance records...' : 'No finance records found.'}
            />
          </div>
        </SectionCard>

        {section === 'settings' ? (
          <div className="grid gap-3 xl:grid-cols-2">
            <SectionCard title="Role Boundary" subtitle="Bursar access stays finance-focused.">
              <div className="grid gap-2 p-4">
                {[
                  'Can post payments, generate invoices, request waivers, create payment plans, log expenses and review finance reports.',
                  'Cannot edit timetables, syllabus, marks, teachers, user administration or academic setup.',
                  'Payment reversals, large waivers and ignored bank transactions are protected by owner or headteacher oversight.',
                ].map((item) => (
                  <div key={item} className="rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium leading-5 text-[#475569]">
                    {item}
                  </div>
                ))}
              </div>
            </SectionCard>
            <SectionCard title="Audit Trail" subtitle="Latest finance activity.">
              <div className="p-4">
                <MiniTable
                  columns={[
                    { key: 'action', label: 'Action' },
                    { key: 'entity_type', label: 'Entity' },
                    { key: 'user_name', label: 'User' },
                    { key: 'created_at', label: 'Date', render: (row: any) => formatDate(row.created_at) },
                  ]}
                  rows={auditLogs.slice(0, 8)}
                  emptyMessage="No finance audit records yet."
                />
              </div>
            </SectionCard>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="min-h-full bg-[#f4f7fb] p-4 text-[#0f172a] md:p-5">
      {renderSection()}

      <SchoolActionModal
        open={paymentModalOpen}
        action={'payment' as SchoolActionKind}
        onOpenChange={setPaymentModalOpen}
        onSaved={refresh}
      />

      <ModalShell
        open={expenseModalOpen}
        onOpenChange={setExpenseModalOpen}
        title="Log expense"
        description="Save a bursar expense request for approval and reporting."
        footer={(
          <>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setExpenseModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="finance-expense-form" className="h-8 rounded-[5px] text-[12px]">
              Save expense
            </Button>
          </>
        )}
      >
        <form id="finance-expense-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitExpense}>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Expense title
            <Input required value={expenseForm.title} onChange={(event) => updateExpense('title', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Category
            <select value={expenseForm.category} onChange={(event) => updateExpense('category', event.target.value)} className={selectClassName()}>
              <option value="salaries">Salaries</option>
              <option value="utilities">Utilities</option>
              <option value="stationery">Stationery</option>
              <option value="maintenance">Maintenance</option>
              <option value="transport">Transport</option>
              <option value="food_catering">Food catering</option>
              <option value="exam_expenses">Exam expenses</option>
              <option value="sports_events">Sports events</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className={labelClassName()}>
            Amount
            <Input required type="number" min="1" value={expenseForm.amount} onChange={(event) => updateExpense('amount', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Expense date
            <Input required type="date" value={expenseForm.expense_date} onChange={(event) => updateExpense('expense_date', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Payment method
            <select value={expenseForm.payment_method} onChange={(event) => updateExpense('payment_method', event.target.value)} className={selectClassName()}>
              <option value="cash">Cash</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_money">Mobile money</option>
              <option value="cheque">Cheque</option>
              <option value="pos_card">POS card</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className={labelClassName()}>
            Supplier
            <Input value={expenseForm.supplier} onChange={(event) => updateExpense('supplier', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Reference
            <Input value={expenseForm.reference} onChange={(event) => updateExpense('reference', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Notes
            <textarea
              value={expenseForm.description}
              onChange={(event) => updateExpense('description', event.target.value)}
              className="min-h-20 rounded-[5px] border border-[#d9dce3] bg-white px-2 py-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35"
            />
          </label>
        </form>
      </ModalShell>

      <ModalShell
        open={structureModalOpen}
        onOpenChange={setStructureModalOpen}
        title="New fee structure"
        description="Create a reusable billing template with one starter fee item."
        footer={(
          <>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setStructureModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="finance-structure-form" className="h-8 rounded-[5px] text-[12px]">
              Save structure
            </Button>
          </>
        )}
      >
        <form id="finance-structure-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitStructure}>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Structure name
            <Input value={structureForm.name} onChange={(event) => updateStructure('name', event.target.value)} placeholder="Term fees" className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Due date
            <Input type="date" value={structureForm.due_date} onChange={(event) => updateStructure('due_date', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Late penalty
            <select value={structureForm.late_penalty_type} onChange={(event) => updateStructure('late_penalty_type', event.target.value)} className={selectClassName()}>
              <option value="none">None</option>
              <option value="fixed">Fixed amount</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <label className={labelClassName()}>
            Penalty value
            <Input type="number" min="0" value={structureForm.late_penalty_value} onChange={(event) => updateStructure('late_penalty_value', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Fee item type
            <select value={structureForm.item_type} onChange={(event) => updateStructure('item_type', event.target.value)} className={selectClassName()}>
              <option value="tuition">Tuition</option>
              <option value="boarding">Boarding</option>
              <option value="transport">Transport</option>
              <option value="uniform">Uniform</option>
              <option value="exam">Exam</option>
              <option value="development">Development</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className={labelClassName()}>
            Fee item
            <Input required value={structureForm.item_name} onChange={(event) => updateStructure('item_name', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Amount
            <Input required type="number" min="1" value={structureForm.amount} onChange={(event) => updateStructure('amount', event.target.value)} className="h-8 text-[12px]" />
          </label>
        </form>
      </ModalShell>

      <ModalShell
        open={planModalOpen}
        onOpenChange={setPlanModalOpen}
        title="Create payment plan"
        description="Split an outstanding account into scheduled installments."
        footer={(
          <>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setPlanModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="finance-plan-form" className="h-8 rounded-[5px] text-[12px]">
              Save plan
            </Button>
          </>
        )}
      >
        <form id="finance-plan-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitPaymentPlan}>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Student account
            <select required value={planForm.fee_account_id} onChange={(event) => updatePlan('fee_account_id', event.target.value)} className={selectClassName()}>
              <option value="">Select account</option>
              {accounts.filter((row) => numberValue(row.balance) > 0).map((row) => (
                <option key={row.id} value={row.id}>{learnerName(row)} - {money(row.balance)}</option>
              ))}
            </select>
          </label>
          <label className={labelClassName()}>
            Total balance
            <Input value={money(selectedPlanAccount?.balance)} className="h-8 text-[12px]" disabled />
          </label>
          <label className={labelClassName()}>
            Installments
            <Input required type="number" min="1" value={planForm.installment_count} onChange={(event) => updatePlan('installment_count', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Installment amount
            <Input required type="number" min="1" value={planForm.installment_amount} onChange={(event) => updatePlan('installment_amount', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Start date
            <Input required type="date" value={planForm.start_date} onChange={(event) => updatePlan('start_date', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Notes
            <textarea value={planForm.notes} onChange={(event) => updatePlan('notes', event.target.value)} className="min-h-20 rounded-[5px] border border-[#d9dce3] bg-white px-2 py-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35" />
          </label>
        </form>
      </ModalShell>

      <ModalShell
        open={discountModalOpen}
        onOpenChange={setDiscountModalOpen}
        title="Request waiver"
        description="Record a scholarship, hardship discount or manual waiver request."
        footer={(
          <>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setDiscountModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="finance-discount-form" className="h-8 rounded-[5px] text-[12px]">
              Save waiver
            </Button>
          </>
        )}
      >
        <form id="finance-discount-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitDiscount}>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Student account
            <select required value={discountForm.fee_account_id} onChange={(event) => updateDiscount('fee_account_id', event.target.value)} className={selectClassName()}>
              <option value="">Select account</option>
              {accounts.map((row) => (
                <option key={row.id} value={row.id}>{learnerName(row)} - {money(row.balance)}</option>
              ))}
            </select>
          </label>
          <label className={labelClassName()}>
            Learner
            <Input value={selectedDiscountAccount ? learnerName(selectedDiscountAccount) : ''} className="h-8 text-[12px]" disabled />
          </label>
          <label className={labelClassName()}>
            Waiver type
            <select value={discountForm.discount_type} onChange={(event) => updateDiscount('discount_type', event.target.value)} className={selectClassName()}>
              <option value="manual">Manual</option>
              <option value="scholarship">Scholarship</option>
              <option value="staff_child">Staff child</option>
              <option value="sibling">Sibling</option>
              <option value="hardship">Hardship</option>
            </select>
          </label>
          <label className={labelClassName()}>
            Amount type
            <select value={discountForm.amount_type} onChange={(event) => updateDiscount('amount_type', event.target.value)} className={selectClassName()}>
              <option value="amount">Amount</option>
              <option value="percent">Percent</option>
            </select>
          </label>
          <label className={labelClassName()}>
            Value
            <Input required type="number" min="1" value={discountForm.amount_value} onChange={(event) => updateDiscount('amount_value', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Reason
            <textarea required value={discountForm.reason} onChange={(event) => updateDiscount('reason', event.target.value)} className="min-h-20 rounded-[5px] border border-[#d9dce3] bg-white px-2 py-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35" />
          </label>
        </form>
      </ModalShell>

      <ModalShell
        open={bankImportModalOpen}
        onOpenChange={setBankImportModalOpen}
        title="Import bank row"
        description="Add a bank statement receipt line for reconciliation."
        footer={(
          <>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setBankImportModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" form="finance-bank-import-form" className="h-8 rounded-[5px] text-[12px]">
              Import row
            </Button>
          </>
        )}
      >
        <form id="finance-bank-import-form" className="grid gap-3 sm:grid-cols-2" onSubmit={submitBankImport}>
          <label className={labelClassName()}>
            Transaction date
            <Input required type="date" value={bankImportForm.transaction_date} onChange={(event) => updateBankImport('transaction_date', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Amount
            <Input required type="number" min="1" value={bankImportForm.amount} onChange={(event) => updateBankImport('amount', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Reference
            <Input value={bankImportForm.reference} onChange={(event) => updateBankImport('reference', event.target.value)} className="h-8 text-[12px]" />
          </label>
          <label className={labelClassName()}>
            Channel
            <select value={bankImportForm.channel} onChange={(event) => updateBankImport('channel', event.target.value)} className={selectClassName()}>
              <option value="">Select channel</option>
              <option value="bank_transfer">Bank transfer</option>
              <option value="mobile_money">Mobile money</option>
              <option value="cheque">Cheque</option>
              <option value="pos_card">POS card</option>
              <option value="cash_deposit">Cash deposit</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label className={`${labelClassName()} sm:col-span-2`}>
            Payer or narration
            <Input value={bankImportForm.payer_name} onChange={(event) => updateBankImport('payer_name', event.target.value)} className="h-8 text-[12px]" />
          </label>
        </form>
      </ModalShell>
    </div>
  )
}
