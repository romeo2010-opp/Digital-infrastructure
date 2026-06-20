export type DashboardWidget = {
  id: string
  title: string
  description: string
  category: string
  enabled: boolean
  size: 'small' | 'medium' | 'wide'
  source: 'mock' | 'real'
  metric?: string
  trend?: string
}

export type IncidentQueueItem = {
  id: string
  severity: 'critical' | 'high' | 'medium' | 'info'
  title: string
  district: string
  station: string
  owner: string
  slaMinutes: number
  status: string
  action: string
}

export type StationRiskRow = {
  stationId: string
  station: string
  district: string
  fuelDays: number
  lastSignal: string
  licenseStatus: string
  priceCheck: string
  riskScore: number
  actionLabel: string
}

export const savedNationalViews = ['National View', 'Fuel Risk', 'Compliance', 'Enforcement']

export const districtFilters = [
  'All Districts',
  'Lilongwe',
  'Blantyre',
  'Mzuzu',
  'Zomba',
  'Mangochi',
  'Kasungu',
  'Salima',
  'Mchinji',
  'Karonga',
]

export const productFilters = ['All Products', 'Petrol', 'Diesel', 'Paraffin', 'LPG']

export const dateRangeFilters = ['Live 24h', 'Last 7 days', 'Last 30 days', 'Quarter']

export const widgetLibrary: DashboardWidget[] = [
  {
    id: 'depot-stock',
    title: 'Depot Stock Days',
    description: 'National depot stock cover with regional depletion risk.',
    category: 'Supply',
    enabled: true,
    size: 'small',
    source: 'mock',
    metric: '3.8 days',
    trend: '-0.4d',
  },
  {
    id: 'price-variance',
    title: 'Price Variance',
    description: 'Regulated pump price variance by district and product.',
    category: 'Pricing',
    enabled: true,
    size: 'medium',
    source: 'mock',
    metric: 'MWK +61/L',
    trend: '+8%',
  },
  {
    id: 'border-imports',
    title: 'Border Import Activity',
    description: 'Shipment clearance and route delay posture at entry points.',
    category: 'Supply',
    enabled: false,
    size: 'medium',
    source: 'mock',
    metric: '18 loads',
    trend: '6 delayed',
  },
  {
    id: 'license-expiry',
    title: 'License Expiry Watch',
    description: 'Stations approaching license expiry or renewal breach.',
    category: 'Licensing',
    enabled: false,
    size: 'small',
    source: 'mock',
    metric: '42',
    trend: 'next 30d',
  },
  {
    id: 'telemetry-health',
    title: 'Telemetry Health',
    description: 'Device reporting, stale heartbeat, and data quality coverage.',
    category: 'Network',
    enabled: false,
    size: 'small',
    source: 'mock',
    metric: '94.2%',
    trend: 'stable',
  },
]

export const mockIncidentQueue: IncidentQueueItem[] = [
  {
    id: 'inc-001',
    severity: 'critical',
    title: 'Limbe — Critical Shortage',
    district: 'Limbe',
    station: 'Puma is reporting dry fuel availability',
    owner: 'Duty Officer',
    slaMinutes: 18,
    status: 'Escalated',
    action: 'Open case',
  },
  {
    id: 'inc-002',
    severity: 'critical',
    title: 'Blantyre — Critical Shortage',
    district: 'Blantyre',
    station: 'Total is reporting dry fuel availability',
    owner: 'Duty Officer',
    slaMinutes: 18,
    status: 'Escalated',
    action: 'Open case',
  },
  {
    id: 'inc-003',
    severity: 'info',
    title: 'Blantyre — Complaint Received',
    district: 'Blantyre',
    station: 'BP Ginnery Corner: HOARDING',
    owner: 'Operations',
    slaMinutes: 144,
    status: 'Review',
    action: 'Review',
  },
  {
    id: 'inc-004',
    severity: 'high',
    title: 'Mzuzu — Delivery Verification',
    district: 'Mzuzu',
    station: 'Depot route evidence needs officer confirmation',
    owner: 'Compliance',
    slaMinutes: 62,
    status: 'Investigate',
    action: 'Investigate',
  },
]

export const mockPriceVariance = [
  { region: 'North', petrol: 22, diesel: 18, lpg: 9 },
  { region: 'Central', petrol: 41, diesel: 35, lpg: 14 },
  { region: 'South', petrol: 61, diesel: 44, lpg: 19 },
  { region: 'Lakeshore', petrol: 36, diesel: 27, lpg: 12 },
]

export const mockComplianceMatrix = [
  { label: 'Licensing', compliant: 91, watch: 6, breach: 3 },
  { label: 'Pricing', compliant: 86, watch: 9, breach: 5 },
  { label: 'Safety', compliant: 94, watch: 4, breach: 2 },
  { label: 'Telemetry', compliant: 89, watch: 8, breach: 3 },
]

export const mockAnomalies = [
  { signal: 'Repeated low-stock declaration after delivery', district: 'Salima', confidence: 91, action: 'Review delivery evidence' },
  { signal: 'Pump price variance outside allowed band', district: 'Blantyre', confidence: 87, action: 'Assign pricing officer' },
  { signal: 'Heartbeat gaps near high-demand corridor', district: 'Mchinji', confidence: 78, action: 'Check telemetry cluster' },
]

export const mockStationRisks: StationRiskRow[] = [
  {
    stationId: 'SL-MW-LLWE-7882',
    station: 'Capital Energy Area 25',
    district: 'Lilongwe',
    fuelDays: 0.8,
    lastSignal: '4 min ago',
    licenseStatus: 'Active',
    priceCheck: 'OK',
    riskScore: 94,
    actionLabel: 'Escalate',
  },
  {
    stationId: 'SL-MW-BT-1044',
    station: 'Blantyre Depot Road',
    district: 'Blantyre',
    fuelDays: 1.4,
    lastSignal: '11 min ago',
    licenseStatus: 'Active',
    priceCheck: '+MWK 61/L',
    riskScore: 82,
    actionLabel: 'Verify',
  },
  {
    stationId: 'SL-MW-MG-3921',
    station: 'Mangochi Lakeshore',
    district: 'Mangochi',
    fuelDays: 2.1,
    lastSignal: '28 min ago',
    licenseStatus: 'Renewal due',
    priceCheck: 'OK',
    riskScore: 67,
    actionLabel: 'Monitor',
  },
  {
    stationId: 'SL-MW-KA-2190',
    station: 'Karonga North Service',
    district: 'Karonga',
    fuelDays: 3.6,
    lastSignal: '1 hr ago',
    licenseStatus: 'Active',
    priceCheck: 'OK',
    riskScore: 44,
    actionLabel: 'Inspect',
  },
  {
    stationId: 'STS-6105',
    station: 'Likangala Service Station',
    district: 'Zomba',
    fuelDays: 3.1,
    lastSignal: '52m ago',
    licenseStatus: 'Active',
    priceCheck: 'OK',
    riskScore: 38,
    actionLabel: 'Review',
  },
  {
    stationId: 'STS-4013',
    station: 'Lilongwe South Bypass',
    district: 'Lilongwe',
    fuelDays: 6.1,
    lastSignal: '1h ago',
    licenseStatus: 'Active',
    priceCheck: 'OK',
    riskScore: 16,
    actionLabel: 'Monitor',
  },
]
