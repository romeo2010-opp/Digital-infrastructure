import { useCallback, useEffect, useMemo, useState } from 'react'
import { UserAccountOverview } from '../../features/settings/UserAccountOverview'
import { userQueueApi } from '../api/userQueueApi'

function isAbortError(error) {
  if (!error) return false
  if (error?.name === 'AbortError') return true
  return String(error?.message || '').toLowerCase().includes('abort')
}

export function AccountScreen({ onLogout, onNavigate, profile, station }) {
  const walletApi = useMemo(() => (userQueueApi.isApiMode() ? userQueueApi : null), [])
  const [receiveQr, setReceiveQr] = useState(null)
  const [qrLoading, setQrLoading] = useState(Boolean(walletApi))
  const [qrError, setQrError] = useState('')
  const [copyFeedback, setCopyFeedback] = useState('')

  const loadReceiveQr = useCallback(async ({ signal } = {}) => {
    if (!walletApi) {
      setQrLoading(false)
      setReceiveQr(null)
      return
    }

    setQrLoading(true)
    setQrError('')
    try {
      const response = await walletApi.getWalletTransferRecipientQr({ signal })
      if (signal?.aborted) return
      setReceiveQr(response)
    } catch (requestError) {
      if (signal?.aborted || isAbortError(requestError)) return
      setReceiveQr(null)
      setQrError(requestError?.message || 'Unable to load your receive QR.')
    } finally {
      if (!signal?.aborted) {
        setQrLoading(false)
      }
    }
  }, [walletApi])

  useEffect(() => {
    const controller = new AbortController()
    loadReceiveQr({ signal: controller.signal })
    return () => controller.abort()
  }, [loadReceiveQr])

  const handleCopyUserId = useCallback(async () => {
    const publicId = String(profile?.publicId || receiveQr?.recipient?.publicId || '').trim()
    if (!publicId) return
    try {
      await navigator.clipboard.writeText(publicId)
      setCopyFeedback('SmartLink user ID copied.')
    } catch {
      setCopyFeedback('Could not copy the SmartLink user ID on this device.')
    }
  }, [profile?.publicId, receiveQr?.recipient?.publicId])

  return (
    <section>
      <header className='screen-header'>
        <h2>Account</h2>
        <p>Profile summary, receive QR, and quick account actions.</p>
      </header>

      <UserAccountOverview
        profile={profile}
        station={station}
        onOpenSettings={() => onNavigate?.('/m/settings')}
        onOpenWallet={() => onNavigate?.('/m/wallet')}
        onLogout={onLogout}
      />

      <section className='wallet-section'>
        <div className='wallet-section-head'>
          <div>
            <h3>My Receive QR</h3>
            <p>Share this signed code when someone needs to send SmartLink credit to you.</p>
          </div>
        </div>

        <article className='wallet-receive-qr-card'>
          {qrLoading ? (
            <p className='wallet-receive-qr-note'>Refreshing your receive QR…</p>
          ) : receiveQr?.qr?.imageDataUrl ? (
            <img
              src={receiveQr.qr.imageDataUrl}
              alt='SmartLink receive QR'
              className='wallet-receive-qr-image'
            />
          ) : (
            <div className='wallet-receive-qr-fallback'>
              <strong>{profile?.publicId || receiveQr?.recipient?.publicId || 'SmartLink user'}</strong>
              <span>QR image unavailable. Use your SmartLink user ID instead.</span>
            </div>
          )}

          <div className='wallet-receive-qr-meta'>
            <p>
              <span>User ID</span>
              <strong>{profile?.publicId || receiveQr?.recipient?.publicId || 'Unavailable'}</strong>
            </p>
            <p>
              <span>QR expires</span>
              <strong>{receiveQr?.qr?.expiresAt ? new Date(receiveQr.qr.expiresAt).toLocaleString() : 'Refresh to renew'}</strong>
            </p>
          </div>

          {qrError ? <p className='details-inline-error'>{qrError}</p> : null}
          {copyFeedback ? <p className='wallet-receive-qr-note'>{copyFeedback}</p> : null}

          <div className='wallet-inline-actions'>
            <button type='button' className='details-action-button is-secondary' onClick={handleCopyUserId}>
              Copy User ID
            </button>
            {walletApi ? (
              <button type='button' className='details-action-button is-secondary' onClick={() => loadReceiveQr({})} disabled={qrLoading}>
                {qrLoading ? 'Refreshing…' : 'Refresh QR'}
              </button>
            ) : null}
            <button type='button' className='details-action-button is-primary' onClick={() => onNavigate?.('/m/wallet/send-credit')}>
              Open Send Credit
            </button>
          </div>
        </article>
      </section>
    </section>
  )
}
