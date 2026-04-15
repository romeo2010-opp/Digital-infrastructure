export function AssistantSuggestionChips({ suggestions = [], disabled = false, onAction }) {
  const items = Array.isArray(suggestions) ? suggestions.filter(Boolean) : []
  if (!items.length) return null

  return (
    <section className='assistant-suggestions' aria-label='Assistant suggestions'>
      <div className='assistant-suggestions-row'>
        {items.map((suggestion) => (
          <button
            key={`${suggestion.id}-${suggestion.label}`}
            type='button'
            className='assistant-suggestion-chip'
            disabled={disabled}
            onClick={() => onAction(suggestion)}
          >
            {suggestion.label}
          </button>
        ))}
      </div>
    </section>
  )
}
