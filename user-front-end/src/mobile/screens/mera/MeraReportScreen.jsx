import { useEffect, useMemo, useState } from 'react'
import { meraApi } from '../../api/meraApi'

const complaintOptions = [
  { label: 'Hoarding', value: 'HOARDING' },
  { label: 'Illegal Vending', value: 'ILLEGAL_VENDING' },
  { label: 'Overpricing', value: 'OVERPRICING' },
  { label: 'Refusal to Sell', value: 'REFUSAL_TO_SELL' },
  { label: 'Suspicious Queue Manipulation', value: 'SUSPICIOUS_QUEUE_MANIPULATION' },
  { label: 'Other', value: 'OTHER' },
]

export function MeraReportScreen({
  stations = [],
  userPublicId = '',
  onBack,
  onSuccess,
}) {
  const [query, setQuery] = useState('')
  const [remoteStations, setRemoteStations] = useState([])
  const [stationsLoading, setStationsLoading] = useState(false)
  const [stationsError, setStationsError] = useState('')
  const [stationPublicId, setStationPublicId] = useState('')
  const [complaintType, setComplaintType] = useState('HOARDING')
  const [description, setDescription] = useState('')
  const [mediaFile, setMediaFile] = useState(null)
  const [locationStatus, setLocationStatus] = useState('Not requested')
  const [geoPoint, setGeoPoint] = useState({ lat: null, lng: null })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')

  const localStations = useMemo(
    () =>
      Array.isArray(stations)
        ? stations.map((item) => ({
            publicId: String(item.publicId || item.id || '').trim(),
            name: item.name,
            city: item.city || '',
            address: item.address || '',
          }))
        : [],
    [stations],
  )

  const stationOptions = useMemo(() => {
    const source = localStations.length ? localStations : remoteStations
    if (!query.trim()) return source
    const needle = query.trim().toLowerCase()
    return source.filter((item) =>
      [item.name, item.city, item.address].some((value) => String(value || '').toLowerCase().includes(needle)),
    )
  }, [localStations, query, remoteStations])

  useEffect(() => {
    if (localStations.length) return undefined
    const abortController = new AbortController()
    setStationsLoading(true)
    setStationsError('')
    meraApi
      .listStations({ signal: abortController.signal })
      .then((items) => {
        setRemoteStations(Array.isArray(items) ? items : [])
      })
      .catch((error) => {
        if (abortController.signal.aborted) return
        setStationsError(error.message || 'Unable to load stations.')
      })
      .finally(() => {
        if (!abortController.signal.aborted) {
          setStationsLoading(false)
        }
      })
    return () => abortController.abort()
  }, [localStations.length])

  useEffect(() => {
    if (stationPublicId) return
    if (stationOptions[0]?.publicId) {
      setStationPublicId(stationOptions[0].publicId)
    }
  }, [stationOptions, stationPublicId])

  const selectedStation = stationOptions.find((item) => item.publicId === stationPublicId) || null

  const handleCaptureLocation = () => {
    if (!navigator.geolocation) {
      setLocationStatus('Geolocation is not supported on this device.')
      return
    }
    setLocationStatus('Locating...')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeoPoint({
          lat: Number(position.coords.latitude.toFixed(7)),
          lng: Number(position.coords.longitude.toFixed(7)),
        })
        setLocationStatus('Location captured')
      },
      (error) => {
        setLocationStatus(error.message || 'Location permission was denied.')
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000,
      },
    )
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!stationPublicId) {
      setSubmitError('Choose a fuel station before submitting.')
      return
    }
    if (description.trim().length < 10) {
      setSubmitError('Please describe the issue in a little more detail.')
      return
    }

    setSubmitting(true)
    setSubmitError('')
    try {
      const result = await meraApi.submitComplaint({
        stationPublicId,
        complaintType,
        complaintDescription: description.trim(),
        geoLat: geoPoint.lat,
        geoLng: geoPoint.lng,
        userPublicId: userPublicId || null,
        mediaFile,
      })
      onSuccess?.(result)
    } catch (error) {
      setSubmitError(error.message || 'Unable to submit complaint right now.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className='mera-report-screen'>
      <header className='screen-header'>
        <button type='button' className='ghost-inline-button' onClick={() => onBack?.()}>
          Back
        </button>
        <h2>Report to MERA</h2>
      </header>

      <section className='station-card mera-report-intro'>
        <p>
          Send a direct complaint to the Malawi Energy Regulatory Authority with the station, issue type,
          evidence, and location where possible.
        </p>
      </section>

      <form className='station-card mera-report-form' onSubmit={handleSubmit}>
        <label className='mera-report-field'>
          <span>Search station</span>
          <input
            type='search'
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder='Search by station name or city'
          />
        </label>

        <label className='mera-report-field'>
          <span>Fuel station</span>
          <select value={stationPublicId} onChange={(event) => setStationPublicId(event.target.value)}>
            {stationOptions.map((item) => (
              <option key={item.publicId} value={item.publicId}>
                {item.name}{item.city ? ` - ${item.city}` : ''}
              </option>
            ))}
          </select>
        </label>

        {selectedStation ? (
          <div className='mera-report-selected-station'>
            <strong>{selectedStation.name}</strong>
            <small>{selectedStation.address || selectedStation.city || 'Station selected'}</small>
          </div>
        ) : null}

        <label className='mera-report-field'>
          <span>Complaint type</span>
          <select value={complaintType} onChange={(event) => setComplaintType(event.target.value)}>
            {complaintOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className='mera-report-field'>
          <span>Description</span>
          <textarea
            rows={5}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder='Explain what happened, when it happened, and what the station staff told you.'
          />
        </label>

        <label className='mera-report-field'>
          <span>Optional photo or document</span>
          <input
            type='file'
            accept='image/*,.pdf,.doc,.docx,video/*'
            onChange={(event) => setMediaFile(event.target.files?.[0] || null)}
          />
          <small>{mediaFile ? mediaFile.name : 'No file chosen'}</small>
        </label>

        <div className='mera-report-location'>
          <div>
            <strong>Location</strong>
            <p>{locationStatus}</p>
            {geoPoint.lat !== null && geoPoint.lng !== null ? (
              <small>
                {geoPoint.lat}, {geoPoint.lng}
              </small>
            ) : null}
          </div>
          <button type='button' className='secondary-button' onClick={handleCaptureLocation}>
            Capture location
          </button>
        </div>

        {stationsLoading ? <p className='mera-report-hint'>Loading stations...</p> : null}
        {stationsError ? <p className='form-error'>{stationsError}</p> : null}
        {submitError ? <p className='form-error'>{submitError}</p> : null}

        <button type='submit' className='primary-button' disabled={submitting}>
          {submitting ? 'Submitting...' : 'Submit Complaint'}
        </button>
      </form>
    </section>
  )
}
