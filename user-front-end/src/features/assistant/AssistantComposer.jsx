import { useCallback } from 'react'

export function AssistantComposer({
  disabled = false,
  value,
  onChange,
  onSubmit,
  placeholder = 'Ask about SmartLink queue, reservation, stations, or wallet',
}) {
  const handleSubmit = useCallback((event) => {
    event.preventDefault()
    onSubmit()
  }, [onSubmit])

  return (
    <form className='assistant-composer' onSubmit={handleSubmit}>
      <label className='assistant-composer-field'>
        <span className='sr-only'>Ask SmartLink Assistant</span>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className='assistant-composer-input'
          rows={2}
          disabled={disabled}
          placeholder={placeholder}
        />
      </label>
      <button type='submit' className='assistant-send-button' disabled={disabled || !String(value || '').trim()}>
        Send
      </button>
    </form>
  )
}
