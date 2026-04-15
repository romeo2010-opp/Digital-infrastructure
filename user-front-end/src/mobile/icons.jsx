function IconBase({ children, size = 20, className = '' }) {
  return (
    <svg
      className={className}
      viewBox='0 0 24 24'
      width={size}
      height={size}
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      aria-hidden='true'
    >
      {children}
    </svg>
  )
}

export function HomeIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M3.5 10.5 12 3l8.5 7.5' />
      <path d='M5 10v10h14V10' />
      <path d='M9 20v-6h6v6' />
    </IconBase>
  )
}

export function StationsIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z' />
      <circle cx='12' cy='11' r='2.2' />
    </IconBase>
  )
}

export function SavedIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M6 4h12v16l-6-3-6 3V4Z' />
    </IconBase>
  )
}

export function WalletIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M3.5 7.5h17v11h-17z' />
      <path d='M3.5 10h17' />
      <circle cx='16.5' cy='14' r='1.3' />
    </IconBase>
  )
}

export function AccountIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx='12' cy='8' r='3.5' />
      <path d='M4 20a8 8 0 0 1 16 0' />
    </IconBase>
  )
}

export function SearchIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx='11' cy='11' r='6.5' />
      <path d='m16 16 4.5 4.5' />
    </IconBase>
  )
}

export function BellIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5' />
      <path d='M9.5 17a2.5 2.5 0 0 0 5 0' />
    </IconBase>
  )
}

export function EyeIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M2.8 12s3.3-5.2 9.2-5.2 9.2 5.2 9.2 5.2-3.3 5.2-9.2 5.2S2.8 12 2.8 12Z' />
      <circle cx='12' cy='12' r='2.6' />
    </IconBase>
  )
}

export function HeadphonesIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M4.5 13v-1a7.5 7.5 0 0 1 15 0v1' />
      <rect x='4' y='12.5' width='3.6' height='6' rx='1.4' />
      <rect x='16.4' y='12.5' width='3.6' height='6' rx='1.4' />
      <path d='M7.6 18.5c1.2 1.2 2.4 1.7 4.4 1.7h1.8' />
    </IconBase>
  )
}

export function AssistantIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M6 10.5a6 6 0 1 1 12 0v2.8a2.7 2.7 0 0 1-2.7 2.7h-1.2l-2.1 2.1-2.1-2.1H8.7A2.7 2.7 0 0 1 6 13.3Z' />
      <path d='M9.2 10.5h.01M12 10.5h.01M14.8 10.5h.01' />
    </IconBase>
  )
}

export function InfoIcon(props) {
  return (
    <IconBase {...props}>
      <circle cx='12' cy='12' r='8.8' />
      <path d='M12 10.2v5.2' />
      <circle cx='12' cy='7.4' r='.7' fill='currentColor' stroke='none' />
    </IconBase>
  )
}

export function FuelPumpIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M6.5 4h8v13h-8z' />
      <path d='M6.5 8h8' />
      <path d='M14.5 6.5h1.8l1.8 1.8v5.2a2.2 2.2 0 0 0 4.4 0v-2.9' />
      <path d='m18.1 8.3-1.4-1.4' />
    </IconBase>
  )
}

export function FilterIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M4 7h16' />
      <path d='M7 12h10' />
      <path d='M10 17h4' />
    </IconBase>
  )
}

export function MapIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20V6.5Z' />
      <path d='M9 4v13.5' />
      <path d='M15 6.5V20' />
    </IconBase>
  )
}

export function OrdersIcon(props) {
  return (
    <IconBase {...props}>
      <rect x='4' y='4.5' width='16' height='15' rx='2.4' />
      <path d='M8 8.5h8' />
      <path d='M8 12h8' />
      <path d='M8 15.5h5.5' />
      <path d='m6 8.5.6.6L8 7.6' />
      <path d='m6 12 .6.6L8 11.1' />
    </IconBase>
  )
}

export function ReservationIcon(props) {
  return (
    <IconBase {...props}>
      <rect x='4' y='5' width='16' height='15' rx='2.4' />
      <path d='M8 3.5v3M16 3.5v3M4 9h16' />
      <circle cx='12' cy='14.2' r='3.1' />
      <path d='M12 12.8v1.8l1.2.8' />
    </IconBase>
  )
}

export function ListIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M8 7h12' />
      <path d='M8 12h12' />
      <path d='M8 17h12' />
      <circle cx='5' cy='7' r='1' fill='currentColor' stroke='none' />
      <circle cx='5' cy='12' r='1' fill='currentColor' stroke='none' />
      <circle cx='5' cy='17' r='1' fill='currentColor' stroke='none' />
    </IconBase>
  )
}

export function ChevronRightIcon(props) {
  return (
    <IconBase {...props}>
      <path d='m9 6 6 6-6 6' />
    </IconBase>
  )
}

export function BackIcon(props) {
  return (
    <IconBase {...props}>
      <path d='m15 6-6 6 6 6' />
    </IconBase>
  )
}

export function CarIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M4 14h16l-1.4-5a2.5 2.5 0 0 0-2.4-1.8H7.8A2.5 2.5 0 0 0 5.4 9L4 14Z' />
      <path d='M5.2 14v3.5M18.8 14v3.5' />
      <circle cx='7.5' cy='17.5' r='1.6' />
      <circle cx='16.5' cy='17.5' r='1.6' />
    </IconBase>
  )
}

export function ToolsIcon(props) {
  return (
    <IconBase {...props}>
      <path d='m4.5 19.5 5.5-5.5' />
      <path d='m7 8 2-2 3 3-2 2' />
      <path d='m14 5 5 5-2.2 2.2-5-5L14 5Z' />
      <path d='m3 21 2.5-2.5' />
    </IconBase>
  )
}

export function FoodIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M6.5 3.5v8' />
      <path d='M4.5 3.5v4a2 2 0 0 0 4 0v-4' />
      <path d='M6.5 11.5V20' />
      <path d='M15 3.5v16' />
      <path d='M15 3.5c2.2 1 3.5 2.4 3.5 4.2S17.2 10.9 15 12' />
    </IconBase>
  )
}

export function PinIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M12 21s6-5.2 6-10a6 6 0 1 0-12 0c0 4.8 6 10 6 10Z' />
      <circle cx='12' cy='11' r='2.2' />
    </IconBase>
  )
}

export function ShieldIcon(props) {
  return (
    <IconBase {...props}>
      <path d='M12 3.2 4.8 6v5.4c0 5.1 3.1 8 7.2 9.4 4.1-1.4 7.2-4.3 7.2-9.4V6L12 3.2Z' />
      <path d='M9.2 12.2 11.1 14l3.7-3.7' />
    </IconBase>
  )
}
