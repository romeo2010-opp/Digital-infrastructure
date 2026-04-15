export function AssistantConfirmationCard({ card }) {
  const summaryLines = Array.isArray(card?.summaryLines) ? card.summaryLines.filter(Boolean) : []

  return (
    <article className='assistant-card assistant-card--confirmation'>
      <div className='assistant-card-header'>
        <div>
          <h4>{card?.title || 'Confirm action'}</h4>
          <p>Please review the live SmartLink details below.</p>
        </div>
        <span className='assistant-recommendation-pill is-neutral'>
          {String(card?.actionType || 'action').replace(/_/g, ' ')}
        </span>
      </div>

      {summaryLines.length ? (
        <ul className='assistant-summary-list'>
          {summaryLines.map((line, index) => (
            <li key={`${card?.actionType || 'confirm'}-${index}`}>{line}</li>
          ))}
        </ul>
      ) : null}
    </article>
  )
}
