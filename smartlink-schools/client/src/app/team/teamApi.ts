export type TeamPrincipal = {
  id: number
  publicRef: string
  fullName: string
  email: string
  jobTitle?: string | null
  mustChangePassword: boolean
  roles: string[]
  roleLabels: string[]
  permissions: string[]
  workspace: 'team'
}

export type TeamSession = { accessToken: string; user: TeamPrincipal }

const SESSION_KEY = 'smartlink.team.session.v1'

export class TeamApiError extends Error {
  status: number
  code?: string
  details?: any

  constructor(message: string, status: number, code?: string, details?: any) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export function loadTeamSession(): TeamSession | null {
  try {
    const value = window.localStorage.getItem(SESSION_KEY)
    if (!value) return null
    const session = JSON.parse(value)
    if (!session?.accessToken || session?.user?.workspace !== 'team') return null
    return session
  } catch {
    return null
  }
}

export function saveTeamSession(session: TeamSession | null) {
  if (!session) window.localStorage.removeItem(SESSION_KEY)
  else window.localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export async function teamRequest<T = any>(path: string, options: RequestInit = {}, accessToken?: string): Promise<T> {
  const headers = new Headers(options.headers || {})
  if (options.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`)
  const response = await fetch(`/api/team${path.startsWith('/') ? path : `/${path}`}`, { ...options, headers })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new TeamApiError(body?.message || 'SmartLink Team Suite could not complete this request.', response.status, body?.code, body?.details)
  return body as T
}

export function queryString(values: Record<string, any>) {
  const params = new URLSearchParams()
  Object.entries(values).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  })
  const query = params.toString()
  return query ? `?${query}` : ''
}

export function titleCase(value: any) {
  return String(value || '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

export function money(value: any) {
  return new Intl.NumberFormat('en-MW', { style: 'currency', currency: 'MWK', maximumFractionDigits: 0 }).format(Number(value || 0))
}

export function shortDate(value: any, includeTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.valueOf())) return String(value)
  return new Intl.DateTimeFormat('en-MW', includeTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' }).format(date)
}
