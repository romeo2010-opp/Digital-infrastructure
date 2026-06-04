import { useCallback, useEffect, useMemo, useState } from 'react'
import { fleetApi } from '../../mobile/api/fleetApi'

const NAV_ITEMS = [
  ['overview', 'Overview', 'vehicle'],
  ['live', 'Live Operations', 'rocket'],
  ['allocations', 'Fuel Allocations', 'pump'],
  ['cards', 'Fuel Cards', 'card'],
  ['requests', 'Fuel Requests', 'clipboard', 'requests'],
  ['transactions', 'Transactions', 'swap'],
  ['vehicles', 'Vehicles', 'car'],
  ['team', 'Drivers & Team', 'users'],
  ['maintenance', 'Maintenance', 'tool'],
  ['wallet', 'Wallet & Billing', 'wallet'],
  ['policies', 'Policies & Limits', 'shield'],
  ['reports', 'Reports', 'report'],
  ['alerts', 'Alerts', 'bell', 'alerts'],
  ['audit', 'Audit Logs', 'audit'],
  ['settings', 'Settings', 'gear'],
]

const CARD_COLORS = ['#0B63F6', '#12B7D8', '#F59E0B', '#6D5DF6', '#4F46E5', '#9FE7CF', '#10B981', '#64748B']

function money(value, compact = false) {
  const amount = Number(value || 0)
  if (compact && Math.abs(amount) >= 1000000) return `MWK ${(amount / 1000000).toFixed(2)}M`
  if (compact && Math.abs(amount) >= 1000) return `MWK ${(amount / 1000).toFixed(0)}K`
  return `MWK ${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function litres(value) {
  return `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} L`
}

function formatDate(value) {
  if (!value) return 'Not recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function initials(name) {
  return String(name || 'Fleet Manager')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'FM'
}

function humanize(value) {
  return String(value || '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function Icon({ name }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': 'true' }
  const paths = {
    vehicle: <><rect x='3' y='8' width='18' height='8' rx='2' /><path d='M7 16v2m10-2v2M6 8l2-4h8l2 4' /></>,
    rocket: <><path d='M5 14c4-6 8-9 14-9-1 6-4 10-10 14l-1-4-3-1Z' /><path d='M14 6l4 4' /></>,
    pump: <><path d='M4 20V5a2 2 0 0 1 2-2h8v17' /><path d='M7 7h4m5 2h2l2 2v6a2 2 0 0 1-4 0v-4' /></>,
    card: <><rect x='3' y='5' width='18' height='14' rx='2' /><path d='M3 10h18M7 15h4' /></>,
    clipboard: <><path d='M9 4h6l1 2h3v15H5V6h3l1-2Z' /><path d='M9 12h6m-6 4h4' /></>,
    swap: <><path d='M7 7h12l-3-3m3 3-3 3M17 17H5l3-3m-3 3 3 3' /></>,
    car: <><path d='M5 13l2-5h10l2 5' /><rect x='3' y='13' width='18' height='5' rx='2' /><path d='M7 18v2m10-2v2' /></>,
    users: <><path d='M16 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2' /><circle cx='9.5' cy='7' r='4' /><path d='M20 21v-2a4 4 0 0 0-3-3.8M16 3.2a4 4 0 0 1 0 7.6' /></>,
    tool: <><path d='M14.7 6.3a4 4 0 0 0-5 5L4 17l3 3 5.7-5.7a4 4 0 0 0 5-5L15 12l-3-3 2.7-2.7Z' /></>,
    wallet: <><path d='M4 7h16v12H4z' /><path d='M16 11h4v4h-4a2 2 0 0 1 0-4Z' /><path d='M4 7l3-4h10l3 4' /></>,
    shield: <><path d='M12 3 5 6v5c0 5 3 8 7 10 4-2 7-5 7-10V6l-7-3Z' /><path d='m9 12 2 2 4-4' /></>,
    report: <><path d='M7 3h7l4 4v14H7z' /><path d='M14 3v5h4M9 13h6M9 17h4' /></>,
    bell: <><path d='M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9' /><path d='M10 21h4' /></>,
    audit: <><path d='M8 4h12v16H8z' /><path d='M4 8h4m-4 4h4m-4 4h4m4-7h4m-4 4h5' /></>,
    gear: <><circle cx='12' cy='12' r='3' /><path d='M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1-2 3.4-.2-.1a1.7 1.7 0 0 0-1.8.1 1.7 1.7 0 0 0-.8 1.5V22h-4v-.2a1.7 1.7 0 0 0-.8-1.5 1.7 1.7 0 0 0-1.8-.1l-.2.1-2-3.4.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.4-1H5v-4h.2a1.7 1.7 0 0 0 1.4-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1 2-3.4.2.1a1.7 1.7 0 0 0 1.8-.1 1.7 1.7 0 0 0 .8-1.5V2h4v.2a1.7 1.7 0 0 0 .8 1.5 1.7 1.7 0 0 0 1.8.1l.2-.1 2 3.4-.1.1a1.7 1.7 0 0 0-.3 1.8 1.7 1.7 0 0 0 1.4 1h.2v4h-.2a1.7 1.7 0 0 0-1.4 1Z' /></>,
    calendar: <><rect x='3' y='5' width='18' height='16' rx='2' /><path d='M8 3v4m8-4v4M3 10h18' /></>,
    download: <><path d='M12 3v12m0 0 4-4m-4 4-4-4' /><path d='M4 21h16' /></>,
    plus: <><path d='M12 5v14M5 12h14' /></>,
    chevron: <path d='m9 18 6-6-6-6' />,
  }
  return <svg {...common}>{paths[name] || paths.vehicle}</svg>
}

function StatusBadge({ value }) {
  const status = String(value || 'unknown').toLowerCase()
  const tone = ['active', 'completed', 'matched', 'paid', 'normal'].includes(status)
    ? 'good'
    : ['pending', 'warning', 'needs_review', 'scheduled'].includes(status)
      ? 'warn'
      : ['critical', 'blocked', 'suspicious', 'overdue', 'rejected', 'suspended'].includes(status)
        ? 'bad'
        : 'info'
  return <span className={`fleet-v2-status ${tone}`}>{humanize(value || 'Unknown')}</span>
}

function DataTable({ columns, rows, emptyText = 'No records yet.' }) {
  if (!rows?.length) return <div className='fleet-v2-empty'>{emptyText}</div>
  return (
    <div className='fleet-v2-table-scroll'>
      <table className='fleet-v2-table'>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.publicId || row.memberPublicId || row.id || index}>
              {columns.map((column) => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function KpiCard({ item }) {
  return (
    <article className={`fleet-v2-kpi tone-${item.tone || 'blue'}`}>
      <span className='fleet-v2-kpi-icon'><Icon name={item.icon} /></span>
      <div>
        <p>{item.label}</p>
        <strong>{item.display}</strong>
        <small>↗ {item.trend}</small>
      </div>
    </article>
  )
}

function DonutChart({ segments = [], totalLitres }) {
  const total = Math.max(segments.reduce((sum, item) => sum + Number(item.litres || 0), 0), 1)
  let offset = 0
  return (
    <div className='fleet-v2-donut-wrap'>
      <svg className='fleet-v2-donut' viewBox='0 0 120 120'>
        <circle cx='60' cy='60' r='42' fill='none' stroke='#ECF2FA' strokeWidth='18' />
        {segments.map((segment, index) => {
          const length = (Number(segment.litres || 0) / total) * 263.89
          const strokeDasharray = `${length} ${263.89 - length}`
          const strokeDashoffset = -offset
          offset += length
          return (
            <circle
              key={`${segment.label}-${index}`}
              cx='60'
              cy='60'
              r='42'
              fill='none'
              stroke={CARD_COLORS[index % CARD_COLORS.length]}
              strokeWidth='18'
              strokeDasharray={strokeDasharray}
              strokeDashoffset={strokeDashoffset}
              transform='rotate(-90 60 60)'
            />
          )
        })}
        <text x='60' y='56' textAnchor='middle' className='fleet-v2-donut-label'>Total Allocation</text>
        <text x='60' y='73' textAnchor='middle' className='fleet-v2-donut-value'>{litres(totalLitres || total)}</text>
      </svg>
    </div>
  )
}

function SpendTrendChart({ series = [] }) {
  const rows = series.length ? series : Array.from({ length: 7 }, (_, index) => ({ date: `Day ${index + 1}`, amount: 0 }))
  const width = 520
  const height = 250
  const max = Math.max(...rows.map((item) => Number(item.amount || 0)), 1)
  const points = rows.map((item, index) => {
    const x = 22 + (index / Math.max(rows.length - 1, 1)) * (width - 44)
    const y = height - 24 - (Number(item.amount || 0) / max) * (height - 58)
    return [x, y]
  })
  const line = points.map(([x, y]) => `${x},${y}`).join(' ')
  const area = `22,${height - 24} ${line} ${width - 22},${height - 24}`
  const latest = rows[rows.length - 1]
  return (
    <div className='fleet-v2-chart'>
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio='none'>
        {[0, 1, 2, 3, 4].map((step) => <line key={step} x1='22' x2={width - 22} y1={24 + step * 45} y2={24 + step * 45} />)}
        <polygon points={area} className='area' />
        <polyline points={line} className='line' />
        {points.length ? <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r='4' className='dot' /> : null}
      </svg>
      <span className='fleet-v2-tooltip'>May 31<br /><strong>{money(latest?.amount || 0, true)}</strong></span>
    </div>
  )
}

function AllocationOverview({ overview }) {
  const allocation = overview?.allocationOverview || {}
  const segments = allocation.segments || []
  return (
    <article className='fleet-v2-card fleet-v2-allocation-overview'>
      <header><h3>Fuel Allocation Overview</h3></header>
      <div className='fleet-v2-allocation-body'>
        <DonutChart segments={segments} totalLitres={allocation.totalLitres} />
        <div className='fleet-v2-donut-legend'>
          {segments.map((segment, index) => (
            <div key={`${segment.label}-${index}`}>
              <span style={{ background: CARD_COLORS[index % CARD_COLORS.length] }} />
              <strong>{segment.label}</strong>
              <em>{litres(segment.litres)}</em>
              <small>{segment.percent}%</small>
            </div>
          ))}
        </div>
      </div>
      <footer>
        <div><span>Used</span><strong>{litres(allocation.usedLitres)} <small>({allocation.usedPercent || 0}%)</small></strong></div>
        <div><span>Remaining</span><strong>{litres(allocation.remainingLitres)} <small>({allocation.remainingPercent || 0}%)</small></strong></div>
      </footer>
    </article>
  )
}

function AllocationSummary({ overview, onManage }) {
  const summary = overview?.allocationSummary || {}
  const percent = Number(summary.usedPercent || 0)
  return (
    <article className='fleet-v2-card fleet-v2-side-card'>
      <header><h3>Allocation Summary</h3><button type='button'>This Month</button></header>
      <div className='fleet-v2-ring' style={{ '--fleet-ring': `${percent * 3.6}deg` }}>
        <strong>{percent}%</strong>
        <span>Used</span>
      </div>
      <div className='fleet-v2-summary-grid'>
        <div><span>Used</span><strong>{litres(summary.usedLitres)}</strong></div>
        <div><span>Remaining</span><strong className='green'>{litres(summary.remainingLitres)}</strong></div>
        <div><span>Monthly Cap</span><strong>{litres(summary.monthlyCapLitres)}</strong></div>
        <div><span>Carry Over</span><strong>{litres(summary.carryOverLitres)}</strong></div>
      </div>
      <button type='button' className='fleet-v2-soft-button' onClick={onManage}>Manage Allocations <Icon name='chevron' /></button>
    </article>
  )
}

function UpcomingRequests({ requests = [], onViewAll }) {
  return (
    <article className='fleet-v2-card fleet-v2-list-card'>
      <header><h3>Upcoming Fuel Requests</h3><span>{requests.length || 0}</span></header>
      <div className='fleet-v2-mini-list'>
        {requests.slice(0, 3).map((request) => (
          <div key={request.publicId}>
            <span className='fleet-v2-avatar'>{initials(request.driver?.fullName)}</span>
            <p><strong>{request.driver?.fullName || 'Driver'}</strong><small>{request.vehicle?.plateNumber || 'Vehicle'} · {request.reason || 'Extra allocation request'}</small><em>{formatTime(request.createdAt)}</em></p>
            <div><strong>{request.requestedLitres ? `Extra ${litres(request.requestedLitres)}` : money(request.requestedAmount)}</strong><StatusBadge value={request.status} /></div>
          </div>
        ))}
      </div>
      <button type='button' className='fleet-v2-soft-button' onClick={onViewAll}>View All Requests <Icon name='chevron' /></button>
    </article>
  )
}

function AlertPanel({ alerts = [], onViewAll }) {
  return (
    <article className='fleet-v2-card fleet-v2-list-card'>
      <header><h3>Alerts & Notifications</h3><span>{alerts.length || 0}</span></header>
      <div className='fleet-v2-alert-list'>
        {alerts.slice(0, 3).map((alert) => (
          <div key={alert.publicId}>
            <i className={alert.severity || 'info'}>!</i>
            <p><strong>{alert.title}</strong><small>{alert.message}</small></p>
            <em>{formatTime(alert.createdAt)}</em>
          </div>
        ))}
      </div>
      <button type='button' className='fleet-v2-soft-button' onClick={onViewAll}>View All Alerts <Icon name='chevron' /></button>
    </article>
  )
}

function RecentTransactions({ rows = [], onViewAll }) {
  const columns = [
    { key: 'date', label: 'Date', render: (row) => <><strong>{formatDate(row.createdAt)}</strong><small>{formatTime(row.createdAt)}</small></> },
    { key: 'driver', label: 'Driver', render: (row) => row.driver?.fullName || 'Driver' },
    { key: 'vehicle', label: 'Vehicle', render: (row) => row.vehicle?.plateNumber || 'Vehicle' },
    { key: 'station', label: 'Station', render: (row) => row.station?.name || row.fuelCard?.cardLabel || 'Manual card' },
    { key: 'fuelType', label: 'Fuel Type', render: (row) => humanize(row.fuelType) },
    { key: 'litres', label: 'Litres', render: (row) => litres(row.litres) },
    { key: 'amount', label: 'Amount', render: (row) => money(row.amount) },
    { key: 'odometer', label: 'Odometer', render: (row) => row.odometerReading ? `${Number(row.odometerReading).toLocaleString()} km` : 'Not recorded' },
    { key: 'department', label: 'Department', render: (row) => <StatusBadge value={row.department?.name || 'Operations'} /> },
  ]
  return (
    <article className='fleet-v2-card fleet-v2-transactions-card'>
      <header><h3>Recent Fuel Transactions</h3><button type='button' onClick={onViewAll}>View All Transactions</button></header>
      <DataTable columns={columns} rows={rows.slice(0, 5)} emptyText='No fuel transactions posted yet.' />
      <button type='button' className='fleet-v2-soft-button center' onClick={onViewAll}>View All Transactions <Icon name='chevron' /></button>
    </article>
  )
}

function OverviewPage({ dashboard, onNavigateSection }) {
  const overview = dashboard?.overview || {}
  const kpis = overview.kpis?.length ? overview.kpis : []
  return (
    <>
      <section className='fleet-v2-kpi-grid'>
        {kpis.map((item) => <KpiCard item={item} key={item.key} />)}
      </section>
      <section className='fleet-v2-overview-grid'>
        <div className='fleet-v2-main-analytics'>
          <div className='fleet-v2-chart-row'>
            <AllocationOverview overview={overview} />
            <article className='fleet-v2-card fleet-v2-trend-card'>
              <header><h3>Fuel Spend Trend</h3><button type='button'>This Month</button></header>
              <SpendTrendChart series={overview.spendTrend || dashboard?.spendTrend || []} />
            </article>
          </div>
          <RecentTransactions rows={overview.recentTransactions || dashboard?.recentTransactions || []} onViewAll={() => onNavigateSection('transactions')} />
        </div>
        <aside className='fleet-v2-right-column'>
          <AllocationSummary overview={overview} onManage={() => onNavigateSection('allocations')} />
          <UpcomingRequests requests={overview.upcomingFuelRequests || dashboard?.pendingFuelRequests || []} onViewAll={() => onNavigateSection('requests')} />
          <AlertPanel alerts={overview.alerts || dashboard?.alerts || []} onViewAll={() => onNavigateSection('alerts')} />
        </aside>
      </section>
      <section className='fleet-v2-value-strip'>
        {(overview.valueStrip || []).map((item) => (
          <article key={item.title}>
            <span><Icon name={item.icon === 'report' ? 'report' : item.icon === 'shield' ? 'shield' : 'rocket'} /></span>
            <div><strong>{item.title}</strong><small>{item.subtitle}</small></div>
          </article>
        ))}
      </section>
    </>
  )
}

function FleetSectionPage({ section, data, onNavigateSection }) {
  if (section === 'overview') return <OverviewPage dashboard={data.dashboard} onNavigateSection={onNavigateSection} />
  const tableProps = {
    allocations: {
      title: 'Fuel Allocations',
      rows: data.allocations,
      columns: [
        { key: 'target', label: 'Target', render: (row) => row.department?.name || row.vehicle?.plateNumber || row.driver?.fullName || humanize(row.allocationTargetType) },
        { key: 'unit', label: 'Unit', render: (row) => humanize(row.allocationUnit) },
        { key: 'cap', label: 'Monthly Cap', render: (row) => row.monthlyLitreCap ? litres(row.monthlyLitreCap) : money(row.monthlyMoneyCap) },
        { key: 'remaining', label: 'Remaining', render: (row) => row.currentLitreBalance ? litres(row.currentLitreBalance) : money(row.currentMoneyBalance) },
        { key: 'rollover', label: 'Rollover', render: (row) => humanize(row.rolloverPolicy) },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    cards: {
      title: 'Fuel Cards & Reconciliation',
      rows: data.fuelCards,
      columns: [
        { key: 'card', label: 'Card', render: (row) => <><strong>{row.cardLabel}</strong><small>{row.maskedCardNumber}</small></> },
        { key: 'provider', label: 'Provider', render: (row) => row.provider?.name || 'Provider' },
        { key: 'department', label: 'Department', render: (row) => row.department?.name || 'Shared pool' },
        { key: 'limit', label: 'Monthly Limit', render: (row) => row.monthlyLitreLimit ? litres(row.monthlyLitreLimit) : money(row.monthlyMoneyLimit) },
        { key: 'providerStatus', label: 'Provider Status', render: (row) => <StatusBadge value={row.providerStatus} /> },
        { key: 'status', label: 'SmartLink Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    requests: {
      title: 'Exception Fuel Requests',
      rows: data.fuelRequests,
      columns: [
        { key: 'driver', label: 'Driver', render: (row) => row.driver?.fullName || 'Driver' },
        { key: 'vehicle', label: 'Vehicle', render: (row) => row.vehicle?.plateNumber || 'Vehicle' },
        { key: 'amount', label: 'Requested', render: (row) => row.requestedLitres ? litres(row.requestedLitres) : money(row.requestedAmount) },
        { key: 'reason', label: 'Reason', render: (row) => row.reason || 'Exception request' },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
        { key: 'created', label: 'Requested', render: (row) => formatDate(row.createdAt) },
      ],
    },
    transactions: {
      title: 'Transactions',
      rows: data.transactions,
      columns: [
        { key: 'date', label: 'Date', render: (row) => formatDate(row.createdAt) },
        { key: 'driver', label: 'Driver', render: (row) => row.driver?.fullName || 'Driver' },
        { key: 'vehicle', label: 'Vehicle', render: (row) => row.vehicle?.plateNumber || 'Vehicle' },
        { key: 'source', label: 'Payment Source', render: (row) => humanize(row.paymentContextType) },
        { key: 'litres', label: 'Litres', render: (row) => litres(row.litres) },
        { key: 'amount', label: 'Amount', render: (row) => money(row.amount) },
        { key: 'risk', label: 'Risk', render: (row) => <StatusBadge value={row.riskStatus} /> },
      ],
    },
    vehicles: {
      title: 'Vehicles',
      rows: data.vehicles,
      columns: [
        { key: 'plate', label: 'Plate', render: (row) => row.plateNumber },
        { key: 'name', label: 'Vehicle', render: (row) => row.vehicleName || row.vehicleType || 'Fleet vehicle' },
        { key: 'fuel', label: 'Fuel', render: (row) => humanize(row.fuelType) },
        { key: 'odometer', label: 'Odometer', render: (row) => row.currentOdometer ? `${Number(row.currentOdometer).toLocaleString()} km` : 'Not recorded' },
        { key: 'spend', label: 'Monthly Spend', render: (row) => money(row.monthlySpend) },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    team: {
      title: 'Drivers & Team',
      rows: [...data.members, ...data.invitations.map((invite) => ({ ...invite, isInvite: true }))],
      columns: [
        { key: 'name', label: 'Name', render: (row) => row.isInvite ? (row.inviteeName || row.inviteeEmail || row.inviteePhone) : row.user?.fullName },
        { key: 'identity', label: 'SmartLink ID / Contact', render: (row) => row.isInvite ? (row.targetUserPublicId || row.inviteeEmail || row.inviteePhone) : row.user?.publicId },
        { key: 'role', label: 'Role', render: (row) => row.roleLabel || humanize(row.role) },
        { key: 'delivery', label: 'Delivery', render: (row) => row.isInvite ? (row.delivery?.matchedExistingUser ? 'In-app notification sent' : 'SMS/email pending') : 'Member active' },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    maintenance: {
      title: 'Maintenance',
      rows: data.maintenance,
      columns: [
        { key: 'vehicle', label: 'Vehicle', render: (row) => row.vehicle?.plateNumber || 'Vehicle' },
        { key: 'title', label: 'Work', render: (row) => row.title },
        { key: 'next', label: 'Next Service', render: (row) => row.nextServiceDate || formatDate(row.dueAt) },
        { key: 'cost', label: 'Cost', render: (row) => money(row.costActual || row.costEstimate) },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    wallet: {
      title: 'Wallet & Billing',
      rows: data.invoices,
      columns: [
        { key: 'number', label: 'Invoice', render: (row) => row.invoiceNumber },
        { key: 'period', label: 'Period', render: (row) => `${row.billingPeriodStart || 'Start'} - ${row.billingPeriodEnd || 'End'}` },
        { key: 'total', label: 'Total', render: (row) => money(row.totalAmount) },
        { key: 'balance', label: 'Balance', render: (row) => money(row.balanceDue) },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    policies: {
      title: 'Policies & Limits',
      rows: data.policies,
      columns: [
        { key: 'name', label: 'Policy', render: (row) => row.name },
        { key: 'target', label: 'Target', render: (row) => humanize(row.appliesToType) },
        { key: 'daily', label: 'Daily Limit', render: (row) => row.dailyLitreLimit ? litres(row.dailyLitreLimit) : money(row.dailyAmountLimit) },
        { key: 'approval', label: 'Approval Above', render: (row) => row.requiresApprovalAboveAmount ? money(row.requiresApprovalAboveAmount) : 'No threshold' },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.active ? 'active' : 'archived'} /> },
      ],
    },
    reports: {
      title: 'Reports',
      rows: [
        { publicId: 'monthly-fuel-report', name: 'Monthly Fuel Report', owner: 'Finance', status: 'ready' },
        { publicId: 'allocation-report', name: 'Allocation Report', owner: 'Operations', status: 'ready' },
        { publicId: 'fuel-card-reconciliation', name: 'Fuel Card Reconciliation Report', owner: 'Finance', status: 'ready' },
        { publicId: 'suspicious-activity', name: 'Suspicious Activity Report', owner: 'Audit', status: 'ready' },
      ],
      columns: [
        { key: 'name', label: 'Report', render: (row) => row.name },
        { key: 'owner', label: 'Owner', render: (row) => row.owner },
        { key: 'status', label: 'Status', render: (row) => <StatusBadge value={row.status} /> },
      ],
    },
    alerts: {
      title: 'Alerts',
      rows: data.alerts,
      columns: [
        { key: 'severity', label: 'Severity', render: (row) => <StatusBadge value={row.severity} /> },
        { key: 'title', label: 'Title', render: (row) => row.title },
        { key: 'message', label: 'Message', render: (row) => row.message },
        { key: 'created', label: 'Created', render: (row) => formatDate(row.createdAt) },
      ],
    },
    audit: {
      title: 'Audit Logs',
      rows: data.auditLogs,
      columns: [
        { key: 'action', label: 'Action', render: (row) => humanize(row.action) },
        { key: 'entity', label: 'Entity', render: (row) => row.entityType },
        { key: 'actor', label: 'Actor', render: (row) => row.actor?.fullName || 'System' },
        { key: 'created', label: 'Created', render: (row) => formatDate(row.createdAt) },
      ],
    },
  }
  if (section === 'live') {
    return (
      <section className='fleet-v2-section-grid'>
        <article className='fleet-v2-card fleet-v2-map-panel'>
          <header><h3>Live Operations</h3><button type='button'>DB-backed live layer</button></header>
          <div><strong>Map-ready operations layer</strong><p>Mapbox remains pending; SmartLink will use fleet live-state and fueling-session records here.</p></div>
        </article>
        <article className='fleet-v2-card'><header><h3>Queue Readiness</h3></header><div className='fleet-v2-empty'>Approved sessions, queue reservations, and station availability will appear here when active.</div></article>
      </section>
    )
  }
  if (section === 'settings') {
    return (
      <section className='fleet-v2-section-grid'>
        <article className='fleet-v2-card'><header><h3>Fleet Profile</h3></header><p className='fleet-v2-muted'>Billing contact, notification preferences, team permissions, provider settings, and workspace controls remain inside this scoped Fleet workspace.</p></article>
        <article className='fleet-v2-card'><header><h3>MyFuel Provider Status</h3></header><div className='fleet-v2-empty'>Manual tracking is active. API sync is intentionally not connected.</div></article>
      </section>
    )
  }
  const props = tableProps[section] || tableProps.transactions
  return (
    <article className='fleet-v2-card fleet-v2-page-card'>
      <header><h3>{props.title}</h3><button type='button'>Export CSV</button></header>
      <DataTable columns={props.columns} rows={props.rows || []} emptyText={`No ${props.title.toLowerCase()} records yet.`} />
      {section === 'cards' ? (
        <div className='fleet-v2-recon-strip'>
          <strong>Reconciliation</strong>
          <span>{data.reconciliation.length} card transaction review items</span>
          <StatusBadge value='api_not_connected' />
        </div>
      ) : null}
    </article>
  )
}

export function FleetDashboard({ fleetId, activeSection = 'overview', onNavigateSection, onSwitchFleet, onMissingFleet }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [data, setData] = useState({
    dashboard: null,
    departments: [],
    allocations: [],
    fuelCards: [],
    reconciliation: [],
    fuelRequests: [],
    transactions: [],
    vehicles: [],
    members: [],
    invitations: [],
    maintenance: [],
    invoices: [],
    wallet: null,
    policies: [],
    alerts: [],
    auditLogs: [],
  })

  const load = useCallback(async () => {
    if (!fleetId) {
      onMissingFleet?.()
      return
    }
    setLoading(true)
    setError('')
    try {
      const tasks = await Promise.allSettled([
        fleetApi.dashboard(fleetId),
        fleetApi.departments(fleetId),
        fleetApi.allocations(fleetId),
        fleetApi.fuelCards(fleetId),
        fleetApi.fuelCardReconciliation(fleetId),
        fleetApi.fuelRequests(fleetId, { status: 'all', limit: 100 }),
        fleetApi.transactions(fleetId, { limit: 100 }),
        fleetApi.vehicles(fleetId),
        fleetApi.members(fleetId),
        fleetApi.invitations(fleetId, { status: 'all', limit: 100 }),
        fleetApi.maintenance(fleetId, { limit: 100 }),
        fleetApi.invoices(fleetId, { limit: 100 }),
        fleetApi.wallet(fleetId),
        fleetApi.policies(fleetId),
        fleetApi.alerts(fleetId),
        fleetApi.auditLogs(fleetId),
      ])
      const value = (index, fallback) => tasks[index].status === 'fulfilled' ? tasks[index].value : fallback
      setData({
        dashboard: value(0, null),
        departments: value(1, { items: [] }).items || [],
        allocations: value(2, { items: [] }).items || [],
        fuelCards: value(3, { items: [] }).items || [],
        reconciliation: value(4, { items: [] }).items || [],
        fuelRequests: value(5, { items: [] }).items || [],
        transactions: value(6, { items: [] }).items || [],
        vehicles: value(7, { vehicles: [] }).vehicles || value(7, { items: [] }).items || [],
        members: value(8, { members: [] }).members || value(8, { items: [] }).items || [],
        invitations: value(9, { items: [] }).items || [],
        maintenance: value(10, { items: [] }).items || [],
        invoices: value(11, { items: [] }).items || [],
        wallet: value(12, null),
        policies: value(13, { policies: [] }).policies || value(13, { items: [] }).items || [],
        alerts: value(14, { alerts: [] }).alerts || value(14, { items: [] }).items || [],
        auditLogs: value(15, { logs: [] }).logs || value(15, { items: [] }).items || [],
      })
    } catch (requestError) {
      setError(requestError?.message || 'Unable to load Fleet dashboard.')
    } finally {
      setLoading(false)
    }
  }, [fleetId, onMissingFleet])

  useEffect(() => {
    load()
  }, [load])

  const dashboard = data.dashboard || {}
  const currentUser = dashboard.membership?.user?.fullName || 'John Mepani'
  const firstName = currentUser.split(/\s+/)[0] || 'John'
  const badges = useMemo(() => ({
    requests: dashboard.kpis?.pendingApprovals || data.fuelRequests.filter((item) => item.status === 'pending').length,
    alerts: dashboard.kpis?.openAlerts || data.alerts.filter((item) => !item.readAt).length,
  }), [dashboard.kpis, data.alerts, data.fuelRequests])

  return (
    <main className='fleet-v2-shell'>
      <aside className='fleet-v2-sidebar'>
        <div className='fleet-v2-logo'><span /> <strong>SmartLink</strong></div>
        <p>FLEET MANAGEMENT</p>
        <nav>
          {NAV_ITEMS.map(([key, label, icon, badgeKey]) => (
            <button type='button' key={key} className={activeSection === key ? 'active' : ''} onClick={() => onNavigateSection?.(key)}>
              <Icon name={icon} />
              <span>{label}</span>
              {badgeKey && badges[badgeKey] ? <em>{badges[badgeKey]}</em> : null}
            </button>
          ))}
        </nav>
        <div className='fleet-v2-sidebar-bottom'>
          <button type='button' className='fleet-v2-workspace-card' onClick={onSwitchFleet}>
            <span><Icon name='wallet' /></span>
            <strong>{dashboard.fleet?.name || 'Blantyre Operations'}</strong>
            <small>{dashboard.membership?.roleLabel || 'Fleet Manager'}</small>
          </button>
          <button type='button' className='fleet-v2-profile-card'>
            <i>{initials(currentUser)}</i>
            <strong>{currentUser}</strong>
            <small>{dashboard.membership?.roleLabel || 'Fleet Administrator'}</small>
          </button>
        </div>
      </aside>

      <section className='fleet-v2-main'>
        <header className='fleet-v2-topbar'>
          <div>
            <h1>Good morning, {firstName} <span aria-hidden='true'>👋</span></h1>
            <p>Here&apos;s what&apos;s happening with your fleet today.</p>
          </div>
          <div className='fleet-v2-actions'>
            <button type='button'><Icon name='calendar' /> May 1 – May 31, 2025</button>
            <button type='button'><Icon name='download' /> Download Report</button>
            <button type='button' className='primary'><Icon name='plus' /> Add New</button>
          </div>
        </header>

        {loading ? <div className='fleet-v2-loading'>Loading fleet operations...</div> : null}
        {error ? <div className='fleet-v2-error'>{error}</div> : null}
        {!loading && !error ? <FleetSectionPage section={activeSection} data={{ ...data, dashboard }} onNavigateSection={onNavigateSection} /> : null}
      </section>
    </main>
  )
}
