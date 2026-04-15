export function ComingSoonScreen({ title }) {
  return (
    <div>
      <header className='screen-header'>
        <h2>{title}</h2>
      </header>

      <section className='station-card coming-soon'>
        <h3>Coming soon</h3>
        <p>This section is ready in navigation and will connect to live data next.</p>
      </section>
    </div>
  )
}
