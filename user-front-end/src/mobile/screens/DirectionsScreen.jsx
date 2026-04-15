import { BackIcon, PinIcon } from '../icons'

export function DirectionsScreen({ station, onBack }) {
  return (
    <div className='directions-screen'>
      <header className='screen-header with-back'>
        <button type='button' className='icon-back' onClick={onBack}>
          <BackIcon size={18} />
        </button>
        <h2>Get Direction</h2>
      </header>

      <section className='directions-map'>
        <div className='map-grid' />

        <div className='route-marker start'>
          <PinIcon size={14} />
          <span>Start</span>
        </div>
        <div className='route-marker end'>
          <PinIcon size={14} />
          <span>{station?.name || 'Station'}</span>
        </div>

        <svg className='route-line' viewBox='0 0 100 100' preserveAspectRatio='none' aria-hidden='true'>
          <path d='M15,78 C28,62 34,60 44,52 C55,44 62,30 84,18' />
        </svg>
      </section>

      <div className='directions-start-wrap'>
        <button type='button' className='primary-button start-button'>
          Start
        </button>
      </div>
    </div>
  )
}
