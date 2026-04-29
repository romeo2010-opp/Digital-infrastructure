import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SearchIcon } from '../icons'
import { userQueueApi } from '../api/userQueueApi'

function formatMoney(amount, currencyCode = 'MWK') {
  const numeric = Number(amount)
  if (!Number.isFinite(numeric)) return 'Unavailable'
  try {
    return new Intl.NumberFormat('en-MW', {
      style: 'currency',
      currency: String(currencyCode || 'MWK').trim() || 'MWK',
      maximumFractionDigits: 2,
    }).format(numeric)
  } catch {
    return `${currencyCode} ${numeric.toFixed(2)}`
  }
}

function formatDateTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Unavailable'
  return date.toLocaleString()
}

export function ScanAndGoScreen() {
  const detectorSupported = useMemo(
    () =>
      typeof window !== 'undefined'
      && typeof window.BarcodeDetector === 'function'
      && typeof navigator !== 'undefined'
      && !!navigator.mediaDevices
      && typeof navigator.mediaDevices.getUserMedia === 'function',
    [],
  )
  const scannerVideoRef = useRef(null)
  const scannerStreamRef = useRef(null)
  const scannerDetectorRef = useRef(null)
  const scannerFrameRef = useRef(0)
  const scannerLockRef = useRef(false)
  const scannerLastScanAtRef = useRef(0)

  const [code, setCode] = useState('')
  const [resolved, setResolved] = useState(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [paying, setPaying] = useState(false)
  const [scannerActive, setScannerActive] = useState(false)
  const [scannerStarting, setScannerStarting] = useState(false)

  const stopScanner = useCallback(() => {
    if (scannerFrameRef.current) {
      window.cancelAnimationFrame(scannerFrameRef.current)
      scannerFrameRef.current = 0
    }
    scannerLockRef.current = false
    scannerLastScanAtRef.current = 0
    scannerDetectorRef.current = null

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
        // ignore pause failures while shutting down
      }
      video.srcObject = null
    }

    setScannerStarting(false)
    setScannerActive(false)
  }, [])

  useEffect(() => () => stopScanner(), [stopScanner])

  const resolveTransaction = useCallback(async (nextCode) => {
    const scopedCode = String(nextCode || '').trim()
    if (!scopedCode) {
      setError('Enter or scan a Scan & Go code first.')
      return
    }

    setLoading(true)
    setError('')
    setFeedback('')

    try {
      const response = await userQueueApi.resolveScanAndGo(scopedCode)
      setResolved(response?.transaction || null)
      setCode(scopedCode)
      setFeedback(
        response?.transaction?.isPaid
          ? 'This transaction is already paid.'
          : 'Transaction found. You can pay this exact transaction now.',
      )
    } catch (requestError) {
      setResolved(null)
      setError(requestError?.message || 'Unable to resolve this Scan & Go code.')
    } finally {
      setLoading(false)
    }
  }, [])

  const startScanner = useCallback(async () => {
    if (!detectorSupported) {
      setError('This device cannot scan QR codes here. Enter the Scan & Go code manually.')
      return
    }

    stopScanner()
    setError('')
    setFeedback('')
    setScannerStarting(true)

    try {
      if (typeof window.BarcodeDetector.getSupportedFormats === 'function') {
        const supportedFormats = await window.BarcodeDetector.getSupportedFormats()
        if (Array.isArray(supportedFormats) && !supportedFormats.includes('qr_code')) {
          throw new Error('This device camera cannot scan QR codes here. Enter the code manually.')
        }
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
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

      scannerDetectorRef.current = new window.BarcodeDetector({ formats: ['qr_code'] })
      setScannerStarting(false)
      setScannerActive(true)

      const scanFrame = async () => {
        if (!scannerDetectorRef.current || !scannerVideoRef.current) return

        scannerFrameRef.current = window.requestAnimationFrame(scanFrame)

        const videoElement = scannerVideoRef.current
        if (scannerLockRef.current || videoElement.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          return
        }

        const now = performance.now()
        if (now - scannerLastScanAtRef.current < 180) return
        scannerLastScanAtRef.current = now

        try {
          const detected = await scannerDetectorRef.current.detect(videoElement)
          const rawValue = String(detected?.[0]?.rawValue || '').trim()
          if (!rawValue) return

          scannerLockRef.current = true
          setCode(rawValue)
          stopScanner()
          await resolveTransaction(rawValue)
        } catch {
          // ignore transient detection errors
        }
      }

      scannerFrameRef.current = window.requestAnimationFrame(scanFrame)
    } catch (requestError) {
      stopScanner()
      setError(requestError?.message || 'Unable to access the camera. Enter the code manually.')
    }
  }, [detectorSupported, resolveTransaction, stopScanner])

  const handleSubmit = async (event) => {
    event.preventDefault()
    await resolveTransaction(code)
  }

  const handlePay = async () => {
    const scopedCode = String(code || resolved?.scanCode || '').trim()
    if (!scopedCode) {
      setError('Resolve a Scan & Go transaction first.')
      return
    }

    setPaying(true)
    setError('')
    setFeedback('')

    try {
      const response = await userQueueApi.payScanAndGo(scopedCode)
      setResolved(response?.transaction || null)
      setFeedback(
        response?.alreadyPaid
          ? 'This transaction was already paid.'
          : 'Wallet payment completed for this transaction.',
      )
    } catch (requestError) {
      setError(requestError?.message || 'Unable to pay this Scan & Go transaction.')
    } finally {
      setPaying(false)
    }
  }

  return (
    <div className='wallet-screen orders-screen'>
      <section className='orders-hero-card scan-go-hero-card'>
        <div className='orders-hero-copy'>
          <span className='wallet-screen-eyebrow'>Scan &amp; Go</span>
          <h2>Pay a completed transaction</h2>
          <p>Scan the kiosk QR code or enter the fallback code to pay that exact transaction only when it is still unpaid.</p>
        </div>

        <div className='orders-hero-metrics'>
          <article className='orders-hero-metric'>
            <span>Scan</span>
            <strong>QR or code</strong>
            <p>Use the camera scanner or type the fallback code from the kiosk receipt screen.</p>
          </article>
          <article className='orders-hero-metric'>
            <span>Payment</span>
            <strong>One transaction only</strong>
            <p>SmartLink only unlocks wallet payment when the resolved transaction is still unpaid.</p>
          </article>
        </div>
      </section>

      <section className='orders-guidance-card scan-go-entry-card'>
        <div className='orders-guidance-head'>
          <div>
            <span className='orders-guidance-eyebrow'>Enter Transaction</span>
            <h3>Resolve the kiosk payment request</h3>
          </div>
        </div>

        {detectorSupported ? (
          <div className='scan-go-scanner-panel'>
            <div className='scan-go-scanner-preview'>
              <video
                ref={scannerVideoRef}
                className='scan-go-scanner-video'
                autoPlay
                muted
                playsInline
              />
              <div className='scan-go-scanner-reticle' aria-hidden='true' />
            </div>
            <div className='scan-go-scanner-copy'>
              <strong>{scannerStarting ? 'Starting camera…' : scannerActive ? 'Scanning live…' : 'Scanner idle'}</strong>
              <span>Point your camera at the kiosk Scan &amp; Go QR code.</span>
            </div>
            <button
              type='button'
              className='details-action-button is-secondary'
              onClick={() => void startScanner()}
              disabled={scannerStarting || loading || paying}
            >
              {scannerActive ? 'Restart Scanner' : 'Start QR Scanner'}
            </button>
          </div>
        ) : (
          <p className='queue-muted queue-metric-note'>
            This browser cannot start the QR scanner here. Enter the fallback code manually.
          </p>
        )}

        <form className='scan-go-form' onSubmit={handleSubmit}>
          <label className='queue-modal-input'>
            <span>Scan &amp; Go code</span>
            <input
              type='text'
              value={code}
              maxLength={600}
              placeholder='Paste the QR payload or enter the fallback code'
              onChange={(event) => setCode(event.target.value)}
            />
          </label>

          <div className='queue-modal-actions'>
            <button
              type='submit'
              className='details-action-button is-primary'
              disabled={loading || paying}
            >
              <SearchIcon size={16} />
              {loading ? 'Resolving…' : 'Resolve Transaction'}
            </button>
          </div>
        </form>

        {feedback ? <p className='queue-banner is-success'>{feedback}</p> : null}
        {error ? <p className='queue-banner is-error'>{error}</p> : null}
      </section>

      {resolved ? (
        <section className='orders-guidance-card scan-go-result-card'>
          <div className='orders-guidance-head'>
            <div>
              <span className='orders-guidance-eyebrow'>Resolved Transaction</span>
              <h3>{resolved.transactionPublicId || 'Transaction'}</h3>
            </div>
            <span className={`wallet-status-pill ${resolved.isPaid ? 'is-success' : 'is-warning'}`}>
              {resolved.isPaid ? 'Paid' : 'Unpaid'}
            </span>
          </div>

          <div className='orders-guidance-grid scan-go-result-grid'>
            <article className='orders-guidance-step'>
              <strong>Station</strong>
              <p>{resolved.station?.name || 'Unknown station'}</p>
              <small>{resolved.station?.area || 'Location unavailable'}</small>
            </article>
            <article className='orders-guidance-step'>
              <strong>Fuel</strong>
              <p>{resolved.fuelType || 'Unknown fuel'}</p>
              <small>{Number.isFinite(Number(resolved.litres)) ? `${Number(resolved.litres).toFixed(2)} L` : 'Volume unavailable'}</small>
            </article>
            <article className='orders-guidance-step'>
              <strong>Pump</strong>
              <p>{resolved.pumpNumber ? `Pump ${resolved.pumpNumber}` : 'Unavailable'}</p>
              <small>{resolved.nozzleNumber ? `Nozzle ${resolved.nozzleNumber}` : 'Nozzle unavailable'}</small>
            </article>
            <article className='orders-guidance-step'>
              <strong>Amount</strong>
              <p>{formatMoney(resolved.amountMwk, 'MWK')}</p>
              <small>{resolved.completedAt ? formatDateTime(resolved.completedAt) : 'Completion time unavailable'}</small>
            </article>
          </div>

          <div className='wallet-summary-meta scan-go-meta'>
            <span>Fallback code: {resolved.scanCode || 'Unavailable'}</span>
            <span>Receipt ref: {resolved.receiptVerificationRef || 'Pending'}</span>
            <span>Payment ref: {resolved.paymentReference || 'Pending'}</span>
          </div>

          {!resolved.isPaid ? (
            <div className='wallet-inline-actions stacked'>
              <button
                type='button'
                className='details-action-button is-primary'
                onClick={handlePay}
                disabled={paying || loading}
              >
                {paying ? 'Paying…' : `Pay ${formatMoney(resolved.amountMwk, 'MWK')} with Wallet`}
              </button>
            </div>
          ) : (
            <p className='queue-banner is-info'>This transaction has already been paid, so Scan &amp; Go payment is locked.</p>
          )}
        </section>
      ) : null}
    </div>
  )
}
