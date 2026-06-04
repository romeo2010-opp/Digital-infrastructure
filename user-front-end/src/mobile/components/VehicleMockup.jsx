import { resolveVehicleVisual } from '../vehicleVisualMap'

function capXForSide(side) {
  if (side === 'DRIVER_SIDE') return 34
  if (side === 'PASSENGER_SIDE') return 148
  return 91
}

function bodyPath(type) {
  const normalized = String(type || '').toLowerCase()
  if (normalized.includes('pickup')) return 'M22 71 C30 47 50 38 74 39 L104 39 C122 39 138 48 148 71 Z'
  if (normalized.includes('minibus')) return 'M18 70 C20 46 37 35 72 35 L124 35 C145 35 158 47 164 70 Z'
  if (normalized.includes('truck')) return 'M20 71 L20 48 C20 42 25 38 32 38 L112 38 C127 38 142 49 151 71 Z'
  if (normalized.includes('motorcycle')) return 'M48 70 C60 50 88 45 112 61 L132 70 Z'
  if (normalized.includes('hatchback')) return 'M25 71 C31 50 50 39 80 39 L105 39 C124 41 142 52 151 71 Z'
  if (normalized.includes('suv')) return 'M22 71 C28 48 49 37 84 37 L115 38 C137 42 154 54 161 71 Z'
  return 'M26 71 C35 50 58 41 91 41 C124 41 145 50 154 71 Z'
}

export function VehicleMockup({
  make,
  model,
  vehicleType,
  tankSide = 'UNKNOWN',
  optionSide = 'UNKNOWN',
  selected = false,
  compact = false,
}) {
  const visual = resolveVehicleVisual({ make, model, vehicleType })
  const side = optionSide === 'UNKNOWN' ? tankSide : optionSide
  const capX = capXForSide(side)
  const silhouette = visual.silhouetteType || 'car'

  return (
    <div className={`vehicle-mockup ${selected ? 'is-selected' : ''} ${compact ? 'is-compact' : ''}`}>
      <svg viewBox='0 0 184 104' role='img' aria-label='Vehicle tank side mockup'>
        <defs>
          <linearGradient id={`vehicleBody-${visual.mockupKey}-${side}`} x1='0' x2='1'>
            <stop offset='0%' stopColor='#15283a' />
            <stop offset='100%' stopColor='#0d1b29' />
          </linearGradient>
        </defs>
        <path className='vehicle-ground' d='M18 78 H166' />
        <path className='vehicle-body' d={bodyPath(silhouette)} fill={`url(#vehicleBody-${visual.mockupKey}-${side})`} />
        <path className='vehicle-window' d='M58 45 H104 C117 45 129 51 138 63 H45 C48 54 53 48 58 45 Z' />
        <circle className='vehicle-wheel' cx='50' cy='73' r='11' />
        <circle className='vehicle-wheel' cx='134' cy='73' r='11' />
        <circle className='vehicle-wheel-core' cx='50' cy='73' r='4' />
        <circle className='vehicle-wheel-core' cx='134' cy='73' r='4' />
        <rect className='vehicle-front-marker' x='154' y='59' width='7' height='12' rx='2' />
        <path className='vehicle-front-arrow' d='M158 25 L168 32 L158 39' />
        <text className='vehicle-front-label' x='143' y='22'>FRONT</text>
        <rect className='vehicle-driver-seat' x='72' y='49' width='18' height='11' rx='4' />
        {side === 'UNKNOWN' ? (
          <g className='vehicle-cap-unknown'>
            <circle cx='91' cy='55' r='12' />
            <text x='91' y='60'>?</text>
          </g>
        ) : (
          <g className='vehicle-cap-highlight'>
            <circle cx={capX} cy='55' r='9' />
            <path d={`M${capX} 31 V45`} />
            <text x={capX} y='28'>CAP</text>
          </g>
        )}
      </svg>
    </div>
  )
}
