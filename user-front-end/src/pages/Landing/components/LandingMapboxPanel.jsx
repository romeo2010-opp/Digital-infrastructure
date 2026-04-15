import { useEffect, useMemo, useRef, useState } from 'react'
import { loadMapboxGl } from '../../../mobile/loadMapboxGl'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_STYLE = import.meta.env.VITE_MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/light-v11'

function buildMarkerElement({ selected = false }) {
  const element = document.createElement('button')
  element.type = 'button'
  element.className = `landing-mapbox-marker ${selected ? 'is-selected' : ''}`
  return element
}

function normalizedCenterFromStations(stations) {
  if (!Array.isArray(stations) || !stations.length) return [35.0058, -15.7861]
  const first = stations.find((station) => Number.isFinite(Number(station?.lng)) && Number.isFinite(Number(station?.lat)))
  if (!first) return [35.0058, -15.7861]
  return [Number(first.lng), Number(first.lat)]
}

export function LandingMapboxPanel({
  stations = [],
  selectedStationId = '',
  onSelectStation,
  zoom = 12.6,
  interactive = false,
  className = '',
}) {
  const tokenMissing = !MAPBOX_TOKEN
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const mapboxRef = useRef(null)
  const markersRef = useRef([])
  const [runtimeMapError, setRuntimeMapError] = useState('')

  const mapCenter = useMemo(() => normalizedCenterFromStations(stations), [stations])

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return undefined

    if (tokenMissing) {
      return undefined
    }

    let cancelled = false
    let onResize = null

    loadMapboxGl()
      .then((mapboxgl) => {
        if (cancelled || !mapContainerRef.current) return

        mapboxgl.accessToken = MAPBOX_TOKEN
        mapboxRef.current = mapboxgl

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: MAPBOX_STYLE,
          center: mapCenter,
          zoom,
          bearing: 0,
          pitch: 0,
          attributionControl: false,
          interactive,
        })

        map.once('load', () => {
          if (cancelled) return
          map.resize()
        })

        map.on('error', (event) => {
          if (cancelled) return
          setRuntimeMapError(event?.error?.message || 'Map error')
        })

        onResize = () => map.resize()
        window.addEventListener('resize', onResize)

        mapRef.current = map
      })
      .catch(() => {
        if (cancelled) return
        setRuntimeMapError('Unable to load Mapbox map')
      })

    return () => {
      cancelled = true
      if (onResize) {
        window.removeEventListener('resize', onResize)
      }
      markersRef.current.forEach(({ marker, element, onClick }) => {
        element.removeEventListener('click', onClick)
        marker.remove()
      })
      markersRef.current = []
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [interactive, mapCenter, tokenMissing, zoom])

  useEffect(() => {
    if (!mapRef.current || !mapboxRef.current) return

    markersRef.current.forEach(({ marker, element, onClick }) => {
      element.removeEventListener('click', onClick)
      marker.remove()
    })
    markersRef.current = []

    const validStations = stations.filter(
      (station) => Number.isFinite(Number(station?.lng)) && Number.isFinite(Number(station?.lat))
    )

    markersRef.current = validStations.map((station) => {
      const selected = station.id === selectedStationId
      const element = buildMarkerElement({ selected })
      const onClick = () => onSelectStation?.(station.id)
      element.addEventListener('click', onClick)

      const marker = new mapboxRef.current.Marker({ element, anchor: 'center' })
        .setLngLat([Number(station.lng), Number(station.lat)])
        .addTo(mapRef.current)

      return { marker, element, onClick }
    })

    const selectedStation = validStations.find((station) => station.id === selectedStationId)
    if (selectedStation) {
      mapRef.current.easeTo({
        center: [Number(selectedStation.lng), Number(selectedStation.lat)],
        duration: 320,
      })
    }
  }, [onSelectStation, selectedStationId, stations])

  return (
    <div className={`landing-mapbox-wrap ${className}`.trim()}>
      <div ref={mapContainerRef} className='landing-mapbox-surface' />
      {tokenMissing || runtimeMapError ? (
        <div className='landing-mapbox-status'>
          {tokenMissing ? 'Missing VITE_MAPBOX_TOKEN' : runtimeMapError}
        </div>
      ) : null}
    </div>
  )
}
