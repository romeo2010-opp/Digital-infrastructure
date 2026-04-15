export function LandingGlyph({ name, className = '', title }) {
  const label = title || name

  return (
    <svg
      className={className}
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.8'
      strokeLinecap='round'
      strokeLinejoin='round'
      role='img'
      aria-label={label}
    >
      {name === 'signal' ? (
        <>
          <path d='M5 18h2' />
          <path d='M9 15h2v3H9z' />
          <path d='M13 12h2v6h-2z' />
          <path d='M17 9h2v9h-2z' />
        </>
      ) : null}

      {name === 'queue' ? (
        <>
          <path d='M6 7h12' />
          <path d='M6 12h8' />
          <path d='M6 17h6' />
          <circle cx='18' cy='16' r='3' />
          <path d='M18 14.5v1.5l1 1' />
        </>
      ) : null}

      {name === 'reservation' ? (
        <>
          <rect x='4' y='6' width='16' height='14' rx='3' />
          <path d='M8 4v4' />
          <path d='M16 4v4' />
          <path d='M4 10h16' />
          <path d='m9 15 2 2 4-4' />
        </>
      ) : null}

      {name === 'station' ? (
        <>
          <path d='M7 5h7v14H7z' />
          <path d='M14 8h3a2 2 0 0 1 2 2v4' />
          <path d='M9.5 9.5h2' />
          <path d='M9.5 13h2' />
          <path d='M7 19h10' />
        </>
      ) : null}

      {name === 'report' ? (
        <>
          <path d='M6 19V9' />
          <path d='M11 19V5' />
          <path d='M16 19v-7' />
          <path d='M4 19h16' />
        </>
      ) : null}

      {name === 'wallet' ? (
        <>
          <path d='M5 8.5A2.5 2.5 0 0 1 7.5 6H17a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7.5A2.5 2.5 0 0 1 5 15.5z' />
          <path d='M5 9h13' />
          <path d='M15.5 14h2' />
        </>
      ) : null}

      {name === 'driver' ? (
        <>
          <path d='M7 15a5 5 0 0 1 10 0' />
          <circle cx='12' cy='15' r='1.8' />
          <path d='M7.5 15H5.5' />
          <path d='M18.5 15h-2' />
          <path d='M9 11.5c.8-.8 1.8-1.2 3-1.2s2.2.4 3 1.2' />
        </>
      ) : null}

      {name === 'network' ? (
        <>
          <circle cx='6' cy='12' r='2' />
          <circle cx='18' cy='7' r='2' />
          <circle cx='18' cy='17' r='2' />
          <path d='M8 11l8-3' />
          <path d='M8 13l8 3' />
        </>
      ) : null}

      {name === 'shield' ? (
        <>
          <path d='M12 4 6.5 6.5v5.5c0 3.4 2 6.5 5.5 8 3.5-1.5 5.5-4.6 5.5-8V6.5z' />
          <path d='m9.6 12.2 1.7 1.8 3.3-3.5' />
        </>
      ) : null}

      {name === 'api' ? (
        <>
          <path d='M8 8 4.5 12 8 16' />
          <path d='M16 8 19.5 12 16 16' />
          <path d='m13 6-2 12' />
        </>
      ) : null}
    </svg>
  )
}
