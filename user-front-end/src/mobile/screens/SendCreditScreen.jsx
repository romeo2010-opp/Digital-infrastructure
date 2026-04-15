import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { userQueueApi } from '../api/userQueueApi'

const SEND_CREDIT_DRAFT_STORAGE_KEY = 'smartlink.send-credit.draft'

function toMoneyNumber(value) {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric)) return 0
  return Number(numeric.toFixed(2))
}

function formatMoney(amount, currencyCode = 'MWK') {
  const normalizedAmount = toMoneyNumber(amount)
  const isWhole = Math.abs(normalizedAmount % 1) < 0.001
  return `${currencyCode} ${normalizedAmount.toLocaleString(undefined, {
    minimumFractionDigits: isWhole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

function buildTransferIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `wallet-transfer-${crypto.randomUUID()}`
  }
  return `wallet-transfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function normalizeStationOptions(stations = []) {
  return (Array.isArray(stations) ? stations : [])
    .map((station) => ({
      id: String(station?.id || station?.publicId || '').trim(),
      name: String(station?.name || '').trim(),
    }))
    .filter((station) => station.id && station.name)
}

function isAbortError(error) {
  if (!error) return false
  if (error?.name === 'AbortError') return true
  return String(error?.message || '').toLowerCase().includes('abort')
}

function loadSendCreditDraft() {
  if (typeof window === 'undefined') return {}

  try {
    const rawDraft = window.sessionStorage.getItem(SEND_CREDIT_DRAFT_STORAGE_KEY)
    if (!rawDraft) return {}
    const draft = JSON.parse(rawDraft)
    return {
      recipientMethod: draft?.recipientMethod === 'QR' ? 'QR' : 'USER_ID',
      recipientUserId: String(draft?.recipientUserId || ''),
      recipientQrPayload: String(draft?.recipientQrPayload || ''),
      amountMwk: String(draft?.amountMwk || ''),
      transferMode: draft?.transferMode === 'STATION_LOCKED' ? 'STATION_LOCKED' : 'NORMAL',
      stationPublicId: String(draft?.stationPublicId || ''),
      note: String(draft?.note || ''),
    }
  } catch {
    return {}
  }
}

function saveSendCreditDraft(draft) {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.setItem(SEND_CREDIT_DRAFT_STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Ignore storage write failures and keep the live form usable.
  }
}

function clearSendCreditDraft() {
  if (typeof window === 'undefined') return

  try {
    window.sessionStorage.removeItem(SEND_CREDIT_DRAFT_STORAGE_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

export function SendCreditScreen({ onBack, stations = [] }) {
  const storedDraft = useMemo(() => loadSendCreditDraft(), [])
  const walletApi = useMemo(() => (userQueueApi.isApiMode() ? userQueueApi : null), [])
  const stationOptions = useMemo(() => normalizeStationOptions(stations), [stations])
  const supportsBarcodeDetection = useMemo(
    () =>
      typeof window !== 'undefined'
      && typeof window.BarcodeDetector === 'function'
      && typeof navigator !== 'undefined'
      && navigator?.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function',
    [],
  )

  const scannerVideoRef = useRef(null)
  const scannerStreamRef = useRef(null)
  const scannerDetectorRef = useRef(null)
  const scannerFrameRef = useRef(0)
  const scannerLockRef = useRef(false)
  const scannerLastScanAtRef = useRef(0)
  const idempotencyKeyRef = useRef('')

  const [walletSummary, setWalletSummary] = useState(null)
  const [walletLoading, setWalletLoading] = useState(true)
  const [walletError, setWalletError] = useState('')
  const [recipientMethod, setRecipientMethod] = useState(storedDraft.recipientMethod || 'USER_ID')
  const [recipientUserId, setRecipientUserId] = useState(storedDraft.recipientUserId || '')
  const [recipientQrPayload, setRecipientQrPayload] = useState(storedDraft.recipientQrPayload || '')
  const [amountMwk, setAmountMwk] = useState(storedDraft.amountMwk || '')
  const [transferMode, setTransferMode] = useState(storedDraft.transferMode || 'NORMAL')
  const [stationPublicId, setStationPublicId] = useState(storedDraft.stationPublicId || '')
  const [note, setNote] = useState(storedDraft.note || '')
  const [preview, setPreview] = useState(null)
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerStarting, setScannerStarting] = useState(false)
  const [scannerError, setScannerError] = useState('')

  const stopScanner = useCallback(() => {
    if (scannerFrameRef.current) {
      window.cancelAnimationFrame(scannerFrameRef.current)
      scannerFrameRef.current = 0
    }

    scannerDetectorRef.current = null
    scannerLockRef.current = false
    scannerLastScanAtRef.current = 0

    const stream = scannerStreamRef.current
    if (stream) {
      stream.getTracks().forEach((track) => track.stop())
      scannerStreamRef.current = null
    }

    const video = scannerVideoRef.current
    if (video) {
      try {
        video.pause()
      } catch {
        // Ignore pause teardown errors.
      }
      video.srcObject = null
    }

    setScannerStarting(false)
    setScannerActive(false)
  }, [])

  const loadWalletSummary = useCallback(async ({ signal } = {}) => {
    if (!walletApi) {
      setWalletLoading(false)
      setWalletError('Wallet transfers are available only when the user app is connected to the API.')
      setWalletSummary(null)
      return
    }

    setWalletLoading(true)
    setWalletError('')
    try {
      const payload = await walletApi.getWalletSummary({ signal })
      if (signal?.aborted) return
      const wallet = payload?.wallet || payload || {}
      setWalletSummary({
        availableBalance: toMoneyNumber(wallet?.availableBalance ?? wallet?.available_balance),
        lockedBalance: toMoneyNumber(wallet?.lockedBalance ?? wallet?.locked_balance),
        currencyCode: String(wallet?.currencyCode || wallet?.currency_code || 'MWK').trim() || 'MWK',
        status: String(wallet?.status || 'ACTIVE').trim().toUpperCase(),
      })
    } catch (requestError) {
      if (signal?.aborted || isAbortError(requestError)) return
      setWalletSummary(null)
      setWalletError(requestError?.message || 'Unable to load wallet summary.')
    } finally {
      if (!signal?.aborted) {
        setWalletLoading(false)
      }
    }
  }, [walletApi])

  useEffect(() => {
    const controller = new AbortController()
    loadWalletSummary({ signal: controller.signal })
    return () => controller.abort()
  }, [loadWalletSummary])

  useEffect(() => {
    saveSendCreditDraft({
      recipientMethod,
      recipientUserId,
      recipientQrPayload,
      amountMwk,
      transferMode,
      stationPublicId,
      note,
    })
  }, [amountMwk, note, recipientMethod, recipientQrPayload, recipientUserId, stationPublicId, transferMode])

  const previewPayload = useMemo(
    () => ({
      recipientUserId: recipientMethod === 'USER_ID' ? recipientUserId.trim() || undefined : undefined,
      recipientQrPayload: recipientMethod === 'QR' ? recipientQrPayload.trim() || undefined : undefined,
      amountMwk: amountMwk ? Number(amountMwk) : undefined,
      transferMode,
      stationPublicId: transferMode === 'STATION_LOCKED' ? stationPublicId || undefined : undefined,
    }),
    [amountMwk, recipientMethod, recipientQrPayload, recipientUserId, stationPublicId, transferMode],
  )

  const refreshPreview = useCallback(async () => {
    setPreviewError('')
    setFeedback('')
    if (!walletApi) {
      setPreviewError('Wallet transfers are available only in API mode.')
      return
    }

    setPreviewLoading(true)
    try {
      const response = await walletApi.previewWalletTransfer(previewPayload)
      setPreview(response)
      idempotencyKeyRef.current = buildTransferIdempotencyKey()
    } catch (requestError) {
      setPreview(null)
      setPreviewError(requestError?.message || 'Unable to preview this wallet transfer.')
    } finally {
      setPreviewLoading(false)
    }
  }, [previewPayload, walletApi])

  const handleConfirmTransfer = useCallback(async () => {
    if (!walletApi || !preview) return
    setSubmitting(true)
    setPreviewError('')
    try {
      const result = await walletApi.createWalletTransfer({
        ...previewPayload,
        note: note.trim() || undefined,
        idempotencyKey: idempotencyKeyRef.current || buildTransferIdempotencyKey(),
      })
      setConfirmOpen(false)
      setPreview(null)
      setRecipientUserId('')
      setRecipientQrPayload('')
      setAmountMwk('')
      setStationPublicId('')
      setNote('')
      clearSendCreditDraft()
      setFeedback(
        `Transfer ${result?.created === false ? 'confirmed' : 'completed'} for ${formatMoney(
          result?.transfer?.amountMwk || preview?.transfer?.amountMwk || 0,
          walletSummary?.currencyCode || 'MWK',
        )}.`,
      )
      await loadWalletSummary({})
    } catch (requestError) {
      setPreviewError(requestError?.message || 'Unable to complete this wallet transfer.')
    } finally {
      setSubmitting(false)
    }
  }, [loadWalletSummary, note, preview, previewPayload, walletApi, walletSummary?.currencyCode])

  const startScanner = useCallback(async () => {
    if (!supportsBarcodeDetection) {
      setScannerError('Live QR scanning is not supported on this device. Paste the QR payload instead.')
      return
    }

    stopScanner()
    setScannerError('')
    setScannerStarting(true)

    try {
      if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
        const supportedFormats = await window.BarcodeDetector.getSupportedFormats()
        if (Array.isArray(supportedFormats) && !supportedFormats.includes('qr_code')) {
          throw new Error('This device camera cannot scan QR codes here. Paste the QR payload instead.')
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
        },
      })
      scannerStreamRef.current = stream

      const video = scannerVideoRef.current
      if (!video) {
        throw new Error('Camera preview could not start.')
      }

      video.srcObject = stream
      video.muted = true
      video.setAttribute('playsinline', 'true')
      await video.play()

      scannerDetectorRef.current = new window.BarcodeDetector({
        formats: ['qr_code'],
      })
      setScannerStarting(false)
      setScannerActive(true)

      const scanFrame = async () => {
        if (!scannerDetectorRef.current || !scannerVideoRef.current) {
          return
        }

        scannerFrameRef.current = window.requestAnimationFrame(scanFrame)
        const videoElement = scannerVideoRef.current
        if (
          scannerLockRef.current
          || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
        ) {
          return
        }

        const now = performance.now()
        if (now - scannerLastScanAtRef.current < 180) {
          return
        }
        scannerLastScanAtRef.current = now

        try {
          const detected = await scannerDetectorRef.current.detect(videoElement)
          const qrValue = String(detected?.[0]?.rawValue || '').trim()
          if (!qrValue) return
          scannerLockRef.current = true
          setRecipientQrPayload(qrValue)
          setRecipientMethod('QR')
          stopScanner()
          setScannerOpen(false)
        } catch {
          // Ignore transient detector errors while the camera stream is active.
        }
      }

      scannerFrameRef.current = window.requestAnimationFrame(scanFrame)
    } catch (requestError) {
      stopScanner()
      setScannerError(requestError?.message || 'Could not access the camera. Paste the QR payload instead.')
    }
  }, [stopScanner, supportsBarcodeDetection])

  useEffect(() => {
    if (!scannerOpen) {
      stopScanner()
      return undefined
    }

    if (supportsBarcodeDetection) {
      startScanner()
    }

    return () => {
      stopScanner()
    }
  }, [scannerOpen, startScanner, stopScanner, supportsBarcodeDetection])

  return (
    <section className='wallet-screen'>
      <header className='screen-header'>
        <h2>Send Credit</h2>
        <p>Transfer SmartLink wallet credit to another user. Station-locked credit stays restricted to one station.</p>
      </header>

      <section className='wallet-section'>
        <div className='wallet-section-head'>
          <div>
            <h3>Available to send</h3>
            <p>Only general wallet balance can be transferred onward.</p>
          </div>
          {onBack ? (
            <button type='button' className='details-action-button is-secondary' onClick={onBack}>
              Back
            </button>
          ) : null}
        </div>

        {walletError ? (
          <section className='station-card coming-soon'>
            <h3>Unable to load wallet</h3>
            <p>{walletError}</p>
          </section>
        ) : null}

        {!walletError ? (
          <article className='wallet-summary-card compact'>
            <div className='wallet-summary-head'>
              <div>
                <span className='wallet-summary-eyebrow'>SmartLink Wallet</span>
                <h3>{walletLoading ? 'Refreshing balance' : 'Transfer-ready balance'}</h3>
              </div>
              <span className={`wallet-status-pill ${walletSummary?.status === 'ACTIVE' ? 'is-active' : 'is-suspended'}`}>
                {walletSummary?.status === 'ACTIVE' ? 'Active' : walletSummary?.status || 'Wallet'}
              </span>
            </div>
            <p className='wallet-summary-amount'>
              {walletLoading ? 'MWK --' : formatMoney(walletSummary?.availableBalance || 0, walletSummary?.currencyCode || 'MWK')}
            </p>
            <div className='wallet-metric-grid two-up'>
              <div className='wallet-metric-card'>
                <span>Transferable</span>
                <strong>{walletLoading ? 'MWK --' : formatMoney(walletSummary?.availableBalance || 0, walletSummary?.currencyCode || 'MWK')}</strong>
              </div>
              <div className='wallet-metric-card'>
                <span>Station-locked</span>
                <strong>{walletLoading ? 'MWK --' : formatMoney(walletSummary?.lockedBalance || 0, walletSummary?.currencyCode || 'MWK')}</strong>
              </div>
            </div>
          </article>
        ) : null}
      </section>

      {feedback ? (
        <section className='station-card wallet-feedback-card'>
          <p>{feedback}</p>
        </section>
      ) : null}

      <section className='wallet-section'>
        <div className='wallet-section-head'>
          <div>
            <h3>Transfer details</h3>
            <p>Choose a recipient, enter an amount, then review before sending.</p>
          </div>
        </div>

        <div className='wallet-send-grid'>
          <label className='queue-modal-input'>
            <span>Recipient method</span>
            <select
              value={recipientMethod}
              onChange={(event) => {
                const nextMethod = event.target.value
                setRecipientMethod(nextMethod)
                setPreview(null)
                setPreviewError('')
              }}
            >
              <option value='USER_ID'>SmartLink User ID</option>
              <option value='QR'>Scan QR</option>
            </select>
          </label>

          {recipientMethod === 'USER_ID' ? (
            <label className='queue-modal-input'>
              <span>Recipient user ID</span>
              <input
                type='text'
                value={recipientUserId}
                onChange={(event) => {
                  setRecipientUserId(event.target.value.toUpperCase())
                  setPreview(null)
                }}
                placeholder='Enter SmartLink user ID'
              />
            </label>
          ) : (
            <div className='wallet-inline-actions stacked'>
              <button
                type='button'
                className='details-action-button is-secondary'
                onClick={() => setScannerOpen(true)}
              >
                Open QR Scanner
              </button>
              <label className='queue-modal-input'>
                <span>Recipient QR payload</span>
                <textarea
                  rows='4'
                  value={recipientQrPayload}
                  onChange={(event) => {
                    setRecipientQrPayload(event.target.value)
                    setPreview(null)
                  }}
                  placeholder='Scan or paste the signed recipient QR payload'
                />
              </label>
            </div>
          )}

          <label className='queue-modal-input'>
            <span>Amount (MWK)</span>
            <input
              type='number'
              inputMode='numeric'
              min='1'
              step='1'
              value={amountMwk}
              onChange={(event) => {
                setAmountMwk(event.target.value)
                setPreview(null)
              }}
              placeholder='Enter whole MWK amount'
            />
          </label>

          <label className='queue-modal-input'>
            <span>Transfer mode</span>
            <select
              value={transferMode}
              onChange={(event) => {
                setTransferMode(event.target.value)
                setPreview(null)
              }}
            >
              <option value='NORMAL'>Normal credit</option>
              <option value='STATION_LOCKED'>Lock to station</option>
            </select>
          </label>

          {transferMode === 'STATION_LOCKED' ? (
            <label className='queue-modal-input'>
              <span>Locked station</span>
              <select
                value={stationPublicId}
                onChange={(event) => {
                  setStationPublicId(event.target.value)
                  setPreview(null)
                }}
              >
                <option value=''>Choose station</option>
                {stationOptions.map((station) => (
                  <option key={station.id} value={station.id}>
                    {station.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <label className='queue-modal-input'>
            <span>Note (optional)</span>
            <textarea
              rows='3'
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder='Add context for the recipient'
            />
          </label>
        </div>

        {previewError ? <p className='details-inline-error'>{previewError}</p> : null}

        <div className='wallet-inline-actions'>
          <button
            type='button'
            className='details-action-button is-primary'
            onClick={refreshPreview}
            disabled={previewLoading || walletLoading}
          >
            {previewLoading ? 'Reviewing…' : 'Review Transfer'}
          </button>
        </div>
      </section>

      {preview ? (
        <section className='wallet-section'>
          <div className='wallet-section-head'>
            <div>
              <h3>Transfer summary</h3>
              <p>Double-check the recipient, amount, and any station lock before sending.</p>
            </div>
          </div>

          <article className='wallet-transfer-history-card'>
            <div className='wallet-transaction-top'>
              <div>
                <h4>{preview?.recipient?.fullName || 'Recipient'}</h4>
                <p>{preview?.recipient?.publicId || 'SmartLink user'}</p>
              </div>
              <div className='wallet-transaction-amount is-outflow'>
                {formatMoney(preview?.transfer?.amountMwk || 0, preview?.transfer?.currencyCode || walletSummary?.currencyCode || 'MWK')}
              </div>
            </div>
            <div className='wallet-transaction-meta'>
              <span>
                <small>Mode</small>
                <strong>{preview?.transfer?.transferMode === 'STATION_LOCKED' ? 'Station locked' : 'Normal credit'}</strong>
              </span>
              <span>
                <small>Recipient method</small>
                <strong>{preview?.transfer?.initiatedVia === 'QR' ? 'QR scan' : 'User ID'}</strong>
              </span>
              <span>
                <small>Remaining balance</small>
                <strong>{formatMoney(preview?.senderWallet?.remainingAvailableBalance || 0, preview?.senderWallet?.currencyCode || walletSummary?.currencyCode || 'MWK')}</strong>
              </span>
              <span>
                <small>Locked station</small>
                <strong>{preview?.transfer?.station?.name || 'None'}</strong>
              </span>
            </div>

            <div className='wallet-inline-actions'>
              <button
                type='button'
                className='details-action-button is-primary'
                onClick={() => setConfirmOpen(true)}
                disabled={submitting}
              >
                Confirm Transfer
              </button>
            </div>
          </article>
        </section>
      ) : null}

      {scannerOpen ? (
        <div
          className='queue-modal-backdrop'
          role='dialog'
          aria-modal='true'
          aria-label='Scan recipient QR'
          onClick={() => setScannerOpen(false)}
        >
          <div className='queue-modal wallet-topup-modal' onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>Scan Recipient QR</h3>
                <p>Use the recipient’s signed SmartLink receive QR to fill the transfer target.</p>
              </div>
              <button type='button' onClick={() => setScannerOpen(false)}>
                Close
              </button>
            </header>

            {supportsBarcodeDetection ? (
              <div className='queue-scanner-panel'>
                <div className='queue-scanner-preview'>
                  <video ref={scannerVideoRef} className='queue-scanner-video' muted playsInline />
                  <div className='queue-scanner-reticle' aria-hidden='true' />
                </div>
                <div className='queue-scanner-status'>
                  <strong>{scannerStarting ? 'Starting camera…' : scannerActive ? 'Camera ready' : 'Scanner idle'}</strong>
                  <span>Point your camera at the recipient QR and hold steady.</span>
                </div>
              </div>
            ) : (
              <section className='station-card coming-soon'>
                <h3>Camera scanning unavailable</h3>
                <p>Paste the QR payload below instead.</p>
              </section>
            )}

            {scannerError ? <p className='details-inline-error'>{scannerError}</p> : null}

            <label className='queue-modal-input'>
              <span>Paste QR payload</span>
              <textarea
                rows='4'
                value={recipientQrPayload}
                onChange={(event) => setRecipientQrPayload(event.target.value)}
                placeholder='Paste the signed QR payload if scanning is unavailable'
              />
            </label>

            <div className='queue-modal-actions'>
              <button type='button' className='details-action-button is-secondary' onClick={() => setScannerOpen(false)}>
                Cancel
              </button>
              <button
                type='button'
                className='details-action-button is-primary'
                onClick={() => {
                  setRecipientMethod('QR')
                  setPreview(null)
                  setScannerOpen(false)
                }}
              >
                Use QR Payload
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {confirmOpen && preview ? (
        <div
          className='queue-modal-backdrop'
          role='dialog'
          aria-modal='true'
          aria-label='Confirm wallet transfer'
          onClick={() => {
            if (!submitting) {
              setConfirmOpen(false)
            }
          }}
        >
          <div className='queue-modal wallet-topup-modal' onClick={(event) => event.stopPropagation()}>
            <header>
              <div>
                <h3>Confirm Transfer</h3>
                <p>Wallet transfers are irreversible for normal users once completed.</p>
              </div>
              <button type='button' onClick={() => setConfirmOpen(false)} disabled={submitting}>
                Close
              </button>
            </header>

            <div className='wallet-refund-summary'>
              <p>
                <span>Recipient</span>
                <strong>{preview?.recipient?.fullName || preview?.recipient?.publicId}</strong>
              </p>
              <p>
                <span>Amount</span>
                <strong>{formatMoney(preview?.transfer?.amountMwk || 0, preview?.transfer?.currencyCode || walletSummary?.currencyCode || 'MWK')}</strong>
              </p>
              <p>
                <span>Mode</span>
                <strong>{preview?.transfer?.transferMode === 'STATION_LOCKED' ? `Locked to ${preview?.transfer?.station?.name || 'station'}` : 'Normal credit'}</strong>
              </p>
            </div>

            <div className='queue-modal-actions'>
              <button type='button' className='details-action-button is-secondary' onClick={() => setConfirmOpen(false)} disabled={submitting}>
                Cancel
              </button>
              <button type='button' className='details-action-button is-primary' onClick={handleConfirmTransfer} disabled={submitting}>
                {submitting ? 'Sending…' : 'Send Credit'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
