export type SearchResult = {
  id: string
  title: string
  subtitle?: string
  resultType: string
  route?: string
  status?: string | null
  district?: string | null
  region?: string | null
  station?: string | null
  matchedField?: string | null
  groupType?: string
  groupLabel?: string
}

export function routeForSearchResult(result: SearchResult) {
  if (result?.route) return result.route
  const id = encodeURIComponent(String(result?.id || '').trim())
  switch (String(result?.resultType || '').toUpperCase()) {
    case 'NAVIGATION':
      return result.route || '/dashboard'
    case 'LICENCE':
    case 'LICENSE':
      return `/licences/${id}`
    case 'STATION':
      return `/stations/${id}`
    case 'DISTRICT':
      return `/search?q=${id}&district=${id}`
    case 'REGION':
      return `/search?q=${id}`
    case 'STATION_MANAGER':
      return `/station-managers/${id}`
    case 'CASE':
      return `/cases/${id}`
    case 'COMPLAINT':
      return `/complaints/${id}`
    case 'TASK':
      return `/tasks/${id}`
    case 'USER':
      return `/users/${id}`
    case 'REPORT':
      return '/reports-intelligence'
    default:
      return '/search'
  }
}

export function badgeLabelForResult(result: SearchResult) {
  if (result.groupLabel) return result.groupLabel
  return String(result.resultType || 'Result').replaceAll('_', ' ')
}
