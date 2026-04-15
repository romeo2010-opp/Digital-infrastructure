function toneClass(tone) {
  const normalized = String(tone || 'info').trim().toLowerCase()
  if (normalized === 'warning') return 'assistant-system-notice--warning'
  if (normalized === 'danger') return 'assistant-system-notice--danger'
  if (normalized === 'success') return 'assistant-system-notice--success'
  return 'assistant-system-notice--info'
}

export function AssistantSystemNotice({ tone = 'info', title, message }) {
  return (
    <article className={`assistant-system-notice ${toneClass(tone)}`}>
      {title ? <h4>{title}</h4> : null}
      {message ? <p>{message}</p> : null}
    </article>
  )
}
