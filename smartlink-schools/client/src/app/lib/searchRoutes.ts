export type SearchResult = {
  id: string
  title: string
  subtitle?: string
  resultType: string
  route?: string
  status?: string | null
  className?: string | null
  student?: string | null
  parent?: string | null
  matchedField?: string | null
  groupType?: string
  groupLabel?: string
  relevance?: number
}

export function routeForSearchResult(result: SearchResult) {
  if (result?.route) return result.route
  switch (String(result?.resultType || '').toUpperCase()) {
    case 'NAVIGATION':
      return result.route || '/dashboard'
    case 'STUDENT':
      return '/students'
    case 'TEACHER':
      return '/teachers'
    case 'CLASS':
      return '/classes'
    case 'SUBJECT':
      return '/syllabus'
    case 'PARENT':
    case 'GUARDIAN':
      return '/parents'
    case 'FEE':
    case 'RECEIPT':
    case 'PAYMENT':
      return '/fees'
    case 'DISCOUNT':
      return '/finance/discounts-bursaries'
    case 'LEAVE':
      return '/staff/leave'
    case 'PAYROLL':
      return '/finance/payroll'
    case 'ATTENDANCE':
      return '/attendance'
    case 'HOMEWORK':
      return '/homework'
    case 'RESULT':
    case 'MARKS':
      return '/results'
    case 'ASSESSMENT':
    case 'INSIGHT':
      return '/assessment-insights'
    case 'DRILL':
      return '/daily-drill'
    case 'SUPPORT':
      return '/learner-support'
    case 'EVENT':
      return '/calendar'
    case 'FORECAST':
      return '/exam-forecast'
    case 'MESSAGE':
      return '/messages'
    case 'REPORT':
      return '/reports'
    case 'USER':
    case 'ROLE':
      return '/settings/users'
    default:
      return '/search'
  }
}

export function badgeLabelForResult(result: SearchResult) {
  if (result.groupLabel) return result.groupLabel
  return String(result.resultType || 'Result').replaceAll('_', ' ')
}
