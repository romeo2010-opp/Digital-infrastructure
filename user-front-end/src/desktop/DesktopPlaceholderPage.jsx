export function DesktopPlaceholderPage({ title, description, children }) {
  return (
    <section className='desktop-page-shell' aria-label={title}>
      <header className='desktop-page-header'>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </header>

      {children ? <div className='desktop-page-content'>{children}</div> : null}
    </section>
  )
}
