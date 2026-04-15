import {
  AccountIcon,
  AssistantIcon,
  BellIcon,
  FuelPumpIcon,
  HomeIcon,
  ReservationIcon,
  SearchIcon,
  ShieldIcon,
  StationsIcon,
  WalletIcon,
} from '../mobile/icons'

export const DESKTOP_NAV_ITEMS = [
  { key: 'overview', label: 'Overview', path: '/d/overview', title: 'Overview', section: 'primary', Icon: HomeIcon },
  { key: 'stations', label: 'Stations', path: '/d/stations', title: 'Stations', section: 'primary', Icon: StationsIcon },
  { key: 'active-queue', label: 'Active Queue', path: '/d/queue', title: 'Active Queue', section: 'primary', Icon: FuelPumpIcon },
  { key: 'reservations', label: 'Reservations', path: '/d/reservations', title: 'Reservations', section: 'primary', Icon: ReservationIcon },
  { key: 'assistant', label: 'Assistant', path: '/d/assistant', title: 'SmartLink Assistant', section: 'primary', Icon: AssistantIcon },
  { key: 'transactions', label: 'Transactions', path: '/d/transactions', title: 'Transactions / History', section: 'primary', Icon: WalletIcon },
  { key: 'alerts', label: 'Alerts', path: '/d/alerts', title: 'Alerts', section: 'secondary', Icon: BellIcon },
  { key: 'help', label: 'Help / Support', path: '/d/help', title: 'Help / Support', section: 'secondary', Icon: SearchIcon },
  { key: 'settings', label: 'Settings', path: '/d/settings', title: 'Settings', section: 'secondary', Icon: AccountIcon },
  { key: 'legal', label: 'Legal / Privacy', path: '/d/legal', title: 'Legal / Privacy', section: 'secondary', Icon: ShieldIcon },
]

export const DESKTOP_PROFILE_MENU = [
  { key: 'account', label: 'Account', path: '/d/account' },
  { key: 'settings', label: 'Settings', path: '/d/settings' },
  { key: 'logout', label: 'Sign out', action: 'logout' },
]

const DESKTOP_ROUTE_MAP = DESKTOP_NAV_ITEMS.reduce((acc, item) => {
  acc[item.path] = { name: item.key, title: item.title, path: item.path }
  return acc
}, {
  '/d/account': { name: 'account', title: 'My Account', path: '/d/account' },
  '/d/login': { name: 'login', title: 'Login', path: '/d/login' },
  '/d/transactions/send-credit': {
    name: 'send-credit',
    title: 'Send Credit',
    path: '/d/transactions/send-credit',
  },
})

export function matchDesktopRoute(pathname) {
  const scopedPath = String(pathname || '').replace(/\/+$/, '') || '/'
  if (scopedPath === '/d') {
    return DESKTOP_ROUTE_MAP['/d/overview']
  }
  const stationMatch = scopedPath.match(/^\/d\/stations\/([^/]+)$/)
  if (stationMatch) {
    return { name: 'station-details', title: 'Station Details', path: '/d/stations' }
  }
  const queueMatch = scopedPath.match(/^\/d\/queue\/([^/]+)$/)
  if (queueMatch) {
    return DESKTOP_ROUTE_MAP['/d/queue']
  }
  return DESKTOP_ROUTE_MAP[scopedPath] || DESKTOP_ROUTE_MAP['/d/overview']
}

export function desktopTitleForRoute(routeName) {
  const match = Object.values(DESKTOP_ROUTE_MAP).find((item) => item.name === routeName)
  return match?.title || 'Overview'
}
