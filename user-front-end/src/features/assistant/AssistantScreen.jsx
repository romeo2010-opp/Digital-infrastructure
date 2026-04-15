import { AssistantIcon, BackIcon } from '../../mobile/icons'
import { AssistantComposer } from './AssistantComposer'
import { AssistantMessageList } from './AssistantMessageList'
import { AssistantSuggestionChips } from './AssistantSuggestionChips'
import { AssistantSystemNotice } from './AssistantSystemNotice'
import { useAssistantSession } from './useAssistantSession'
import './assistant.css'

export function AssistantScreen({ layout = 'mobile', onBack }) {
  const {
    apiEnabled,
    composerValue,
    loading,
    locationStatus,
    messages,
    requestError,
    requiresConfirmation,
    statusNotice,
    suggestions,
    setComposerValue,
    submitComposer,
    handleAction,
    requestLocationAccess,
    retryLastRequest,
  } = useAssistantSession()

  const locationTone = locationStatus === 'active'
    ? 'success'
    : locationStatus === 'denied' || locationStatus === 'fallback'
      ? 'warning'
      : 'info'
  const showLocationRetry = apiEnabled && locationStatus !== 'active'

  return (
    <section className={`assistant-screen assistant-screen--${layout}`}>
      <header className={`assistant-screen-header ${layout === 'mobile' ? 'with-back' : ''}`}>
        {layout === 'mobile' ? (
          <button type='button' className='archive-toggle-button archive-toggle-button--secondary' onClick={onBack}>
            <BackIcon size={18} />
            <span className='sr-only'>Back</span>
          </button>
        ) : null}

        <div className='assistant-screen-title'>
          <div className='assistant-screen-badge'>
            <AssistantIcon size={18} />
            <span>SmartLink Assistant</span>
          </div>
          <h2>Guided help for SmartLink tasks</h2>
          <p>Queue, reservation, station, and wallet support using live SmartLink data only.</p>
        </div>
      </header>

      {statusNotice ? (
        <div className='assistant-inline-banner'>
          <AssistantSystemNotice tone={locationTone} title='Location' message={statusNotice} />
          {showLocationRetry ? (
            <button
              type='button'
              className='assistant-inline-button'
              onClick={requestLocationAccess}
              disabled={loading}
            >
              Use my location
            </button>
          ) : null}
        </div>
      ) : null}

      {requestError && apiEnabled ? (
        <div className='assistant-inline-banner'>
          <AssistantSystemNotice tone='warning' title='Retry available' message={requestError} />
          <button type='button' className='assistant-inline-button' onClick={retryLastRequest} disabled={loading}>
            Retry
          </button>
        </div>
      ) : null}

      <AssistantMessageList messages={messages} loading={loading} onAction={handleAction} />

      <AssistantSuggestionChips suggestions={suggestions} disabled={loading} onAction={handleAction} />

      {requiresConfirmation ? (
        <AssistantSystemNotice
          tone='warning'
          title='Confirmation needed'
          message='Finish this confirmation step before starting a new SmartLink action.'
        />
      ) : null}

      <AssistantComposer
        value={composerValue}
        onChange={setComposerValue}
        onSubmit={submitComposer}
        disabled={loading || requiresConfirmation || !apiEnabled}
        placeholder={
          apiEnabled
            ? 'Ask about queues, reservations, nearby stations, or your wallet'
            : 'SmartLink Assistant needs live API mode'
        }
      />
    </section>
  )
}
