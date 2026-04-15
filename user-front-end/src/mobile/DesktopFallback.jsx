export function DesktopFallback() {
  return (
    <div className='desktop-fallback'>
      <div className='desktop-fallback-card'>
        <h1>Open on mobile to use SmartLink User App</h1>
        <p>The SmartLink User Mobile flow is optimized for screens 768px wide and below.</p>

        <div className='desktop-phone-preview' aria-hidden='true'>
          <div className='desktop-phone-notch' />
          <div className='desktop-phone-screen'>
            <div className='desktop-preview-header' />
            <div className='desktop-preview-map' />
            <div className='desktop-preview-card' />
            <div className='desktop-preview-tabbar' />
          </div>
        </div>
      </div>
    </div>
  )
}
