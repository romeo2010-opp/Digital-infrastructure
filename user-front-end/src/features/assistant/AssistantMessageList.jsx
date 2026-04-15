import { useEffect, useRef } from 'react'
import { AssistantActiveBookingCard } from './AssistantActiveBookingCard'
import { AssistantConfirmationCard } from './AssistantConfirmationCard'
import { AssistantQueueOptionCard } from './AssistantQueueOptionCard'
import { AssistantReservationSlotCard } from './AssistantReservationSlotCard'
import { AssistantStationCard } from './AssistantStationCard'
import { AssistantSystemNotice } from './AssistantSystemNotice'

function actionToneClass(tone) {
  const normalized = String(tone || 'secondary').trim().toLowerCase()
  if (normalized === 'primary') return 'assistant-action-button--primary'
  if (normalized === 'danger') return 'assistant-action-button--danger'
  return 'assistant-action-button--secondary'
}

function formatMoney(amount, currencyCode = 'MWK') {
  const numeric = Number(amount || 0)
  return `${currencyCode} ${numeric.toLocaleString(undefined, {
    minimumFractionDigits: Math.abs(numeric % 1) < 0.001 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function WalletSummaryCard({ card }) {
  const wallet = card?.wallet || {}

  return (
    <article className='assistant-card assistant-card--wallet'>
      <div className='assistant-card-header'>
        <div>
          <h4>Wallet summary</h4>
          <p>Live SmartLink wallet balances</p>
        </div>
        <span className='assistant-distance-pill'>{wallet?.status || 'ACTIVE'}</span>
      </div>

      <div className='assistant-card-stat-grid'>
        <div>
          <span>Available</span>
          <strong>{formatMoney(wallet?.availableBalance, wallet?.currencyCode)}</strong>
        </div>
        <div>
          <span>Ledger</span>
          <strong>{formatMoney(wallet?.ledgerBalance, wallet?.currencyCode)}</strong>
        </div>
        <div>
          <span>Locked</span>
          <strong>{formatMoney(wallet?.lockedBalance, wallet?.currencyCode)}</strong>
        </div>
        <div>
          <span>Holds</span>
          <strong>{formatMoney(wallet?.activeHoldAmount, wallet?.currencyCode)}</strong>
        </div>
      </div>
    </article>
  )
}

function renderCard(card, onAction) {
  switch (card?.kind) {
    case 'station':
      return <AssistantStationCard card={card} onAction={onAction} />
    case 'queue_option':
      return <AssistantQueueOptionCard card={card} onAction={onAction} />
    case 'reservation_slot':
      return <AssistantReservationSlotCard card={card} onAction={onAction} />
    case 'confirmation':
      return <AssistantConfirmationCard card={card} />
    case 'active_booking':
      return <AssistantActiveBookingCard card={card} />
    case 'wallet_summary':
      return <WalletSummaryCard card={card} />
    case 'system_notice':
      return <AssistantSystemNotice tone={card.tone} title={card.title} message={card.message} />
    default:
      return null
  }
}

function AssistantResponse({ response, onAction }) {
  const cards = Array.isArray(response?.cards) ? response.cards : []
  const actions = Array.isArray(response?.actions) ? response.actions : []

  return (
    <article className='assistant-bubble assistant-bubble--assistant'>
      <div className='assistant-bubble-copy'>
        {response?.title ? <h3>{response.title}</h3> : null}
        {response?.message ? <p>{response.message}</p> : null}
      </div>

      {cards.length ? (
        <div className='assistant-card-stack'>
          {cards.map((card, index) => (
            <div key={`${card?.kind || 'card'}-${index}`}>{renderCard(card, onAction)}</div>
          ))}
        </div>
      ) : null}

      {actions.length ? (
        <div className='assistant-response-actions'>
          {actions.map((action) => (
            <button
              key={`${action.id}-${action.label}`}
              type='button'
              className={`assistant-action-button ${actionToneClass(action.tone)}`}
              onClick={() => onAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  )
}

export function AssistantMessageList({ loading = false, messages = [], onAction }) {
  const scrollerRef = useRef(null)

  useEffect(() => {
    const element = scrollerRef.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [loading, messages])

  return (
    <div ref={scrollerRef} className='assistant-message-list'>
      {messages.map((entry) =>
        entry.role === 'user' ? (
          <div key={entry.id} className='assistant-message assistant-message--user'>
            <article className='assistant-bubble assistant-bubble--user'>
              <p>{entry.text}</p>
            </article>
          </div>
        ) : (
          <div key={entry.id} className='assistant-message assistant-message--assistant'>
            <AssistantResponse response={entry.response} onAction={onAction} />
          </div>
        )
      )}

      {loading ? (
        <div className='assistant-message assistant-message--assistant'>
          <article className='assistant-bubble assistant-bubble--assistant assistant-bubble--loading'>
            <span className='assistant-loading-dot' />
            <span className='assistant-loading-dot' />
            <span className='assistant-loading-dot' />
          </article>
        </div>
      ) : null}
    </div>
  )
}
