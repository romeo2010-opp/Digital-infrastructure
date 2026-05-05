import React from 'react'

export function normalizeRows<T = any>(items: any): T[] {
  return Array.isArray(items) ? items : []
}

export function normalizeDate(value: any) {
  if (!value) return '-'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return String(value)
  }
}

export function matchesSearch(row: any, query: string) {
  if (!query.trim()) return true
  return JSON.stringify(row).toLowerCase().includes(query.trim().toLowerCase())
}

export function cleanCaseId(prefix: string, value: any, fallbackIndex = 0) {
  const raw = String(value || '').trim()
  if (!raw) return `${prefix}-${String(fallbackIndex + 1).padStart(4, '0')}`
  return raw.length > 14 ? `${prefix}-${raw.slice(-8)}` : raw
}

export function statusVariant(value: any) {
  const text = String(value || '').toUpperCase()
  if (
    text.includes('CRITICAL') ||
    text.includes('HIGH') ||
    text.includes('FAILED') ||
    text.includes('DRY') ||
    text.includes('SUSP') ||
    text.includes('ESCAL')
  ) {
    return 'red'
  }
  if (
    text.includes('MEDIUM') ||
    text.includes('MODERATE') ||
    text.includes('LIMITED') ||
    text.includes('PENDING') ||
    text.includes('UNDER')
  ) {
    return 'amber'
  }
  if (
    text.includes('ACTIVE') ||
    text.includes('AVAILABLE') ||
    text.includes('LOW') ||
    text.includes('READY') ||
    text.includes('CLEAR') ||
    text.includes('RESOLVED') ||
    text.includes('COMPLIED')
  ) {
    return 'green'
  }
  return 'slate'
}

export function renderPill(value: any) {
  const variant = statusVariant(value)
  const classes =
    variant === 'red'
      ? 'border-red-200 bg-red-50 text-red-700'
      : variant === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-700'
        : variant === 'green'
          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
          : 'border-slate-200 bg-slate-50 text-slate-700'

  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] ${classes}`}>
      {String(value || '-')}
    </span>
  )
}
