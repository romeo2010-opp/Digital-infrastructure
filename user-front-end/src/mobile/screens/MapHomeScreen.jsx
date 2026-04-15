import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FilterIcon, SearchIcon } from '../icons'
import { loadMapboxGl } from '../loadMapboxGl'
import { StationBottomSheet } from '../components/StationBottomSheet'

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
const MAPBOX_LIGHT_STYLE = import.meta.env.VITE_MAPBOX_STYLE_URL || 'mapbox://styles/mapbox/light-v11'
const MAPBOX_DARK_STYLE = import.meta.env.VITE_MAPBOX_DARK_STYLE_URL || 'mapbox://styles/mapbox/dark-v11'
const DEFAULT_CENTER = [35.0058, -15.7861]
const CAMERA_PADDING = { top: 120, right: 20, bottom: 290, left: 20 }
const ROUTE_SOURCE_ID = 'smartlink-route-source'
const ROUTE_CASING_LAYER_ID = 'smartlink-route-casing'
const ROUTE_LAYER_ID = 'smartlink-route-line'
const FUEL_MARKER_SVG =
  "<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.9' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M6.5 4h8v13h-8z'/><path d='M6.5 8h8'/><path d='M14.5 6.5h1.8l1.8 1.8v5.2a2.2 2.2 0 0 0 4.4 0v-2.9'/><path d='m18.1 8.3-1.4-1.4'/></svg>"
const STATION_FILTERS = [
  { id: 'all', label: 'All Stations' },
  { id: 'available', label: 'Available' },
  { id: 'in-use', label: 'In Use' },
  { id: 'low-fuel', label: 'Low Fuel' },
  { id: 'medium-fuel', label: 'Medium Fuel' },
  { id: 'open-24h', label: 'Open 24h' },
]

function stationToneClass(station) {
  if (station?.status === 'In Use') return 'tone-in-use'
  if (station?.fuelLevel === 'low') return 'tone-low'
  if (station?.fuelLevel === 'medium') return 'tone-medium'
  return 'tone-high'
}

function routeTone(station) {
  if (station?.status === 'In Use') {
    return {
      line: '#f2b01e',
      casing: 'rgba(120, 76, 0, 0.28)',
    }
  }

  if (station?.fuelLevel === 'low') {
    return {
      line: '#e74f5f',
      casing: 'rgba(112, 20, 32, 0.28)',
    }
  }

  if (station?.fuelLevel === 'medium') {
    return {
      line: '#f3cf3a',
      casing: 'rgba(120, 97, 0, 0.26)',
    }
  }

  return {
    line: '#20b062',
    casing: 'rgba(11, 64, 35, 0.2)',
  }
}

function buildMarkerElement(isSelected, station) {
  const el = document.createElement('button')
  el.type = 'button'
  el.className = `mapbox-station-marker ${stationToneClass(station)} ${isSelected ? 'is-selected' : ''}`
  el.innerHTML = `<span class='mapbox-station-glyph'>${FUEL_MARKER_SVG}</span>`
  return el
}

function buildCurrentLocationElement() {
  const el = document.createElement('div')
  el.className = 'current-location-marker'
  el.innerHTML = '<span></span>'
  return el
}

function emptyRouteData() {
  return {
    type: 'FeatureCollection',
    features: [],
  }
}

function routeDataFromCoordinates(coordinates) {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates,
        },
        properties: {},
      },
    ],
  }
}

function matchesStationFilter(station, filterId) {
  if (filterId === 'available') return station?.status === 'Available'
  if (filterId === 'in-use') return station?.status === 'In Use'
  if (filterId === 'low-fuel') return station?.fuelLevel === 'low'
  if (filterId === 'medium-fuel') return station?.fuelLevel === 'medium'
  if (filterId === 'open-24h') return (station?.hoursLabel || '').toLowerCase().includes('24h')
  return true
}

export function MapHomeScreen({ stations, onViewStation, theme = 'light' }) {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const mapboxRef = useRef(null)
  const markersRef = useRef([])
  const currentLocationMarkerRef = useRef(null)
  const loadTimeoutRef = useRef(null)
  const watchIdRef = useRef(null)
  const routeAbortControllerRef = useRef(null)
  const filterMenuRef = useRef(null)
  const routeLockRef = useRef({
    stationId: null,
    origin: null,
  })

  const [mapReady, setMapReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [searchText, setSearchText] = useState('')
  const [activeFilterId, setActiveFilterId] = useState('all')
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false)
  const [selectedStationId, setSelectedStationId] = useState(stations[0]?.id || null)
  const [chipPosition, setChipPosition] = useState(null)
  const [currentLocation, setCurrentLocation] = useState(null)
  const [routeMetricsByStationId, setRouteMetricsByStationId] = useState({})
  const mapStyle = theme === 'dark' ? MAPBOX_DARK_STYLE : MAPBOX_LIGHT_STYLE

  const filteredStations = useMemo(() => {
    const query = searchText.trim().toLowerCase()
    return stations.filter((station) => {
      const inName = station.name.toLowerCase().includes(query)
      const inAddress = station.address.toLowerCase().includes(query)
      const inChipLabel = (station.chipLabel || '').toLowerCase().includes(query)
      const inHoursLabel = (station.hoursLabel || '').toLowerCase().includes(query)
      const matchesQuery = !query || inName || inAddress || inChipLabel || inHoursLabel
      return matchesQuery && matchesStationFilter(station, activeFilterId)
    })
  }, [activeFilterId, searchText, stations])

  const selectedStation = useMemo(() => {
    if (!filteredStations.length) return null
    return filteredStations.find((station) => station.id === selectedStationId) || filteredStations[0]
  }, [filteredStations, selectedStationId])

  useEffect(() => {
    if (!isFilterMenuOpen) return undefined

    const onPointerDown = (event) => {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) {
        setIsFilterMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
    }
  }, [isFilterMenuOpen])

  const clearMarkers = useCallback(() => {
    markersRef.current.forEach(({ marker, element, onClick }) => {
      element.removeEventListener('click', onClick)
      marker.remove()
    })
    markersRef.current = []
  }, [])

  useEffect(() => {
    setMapReady(false)
    setLoadError('')

    if (!mapContainerRef.current || mapRef.current) return undefined

    if (!MAPBOX_TOKEN) {
      return undefined
    }

    let cancelled = false
    let onWindowResize = null

    loadMapboxGl()
      .then((mapboxgl) => {
        if (cancelled || !mapContainerRef.current) return

        mapboxgl.accessToken = MAPBOX_TOKEN
        mapboxRef.current = mapboxgl

        const map = new mapboxgl.Map({
          container: mapContainerRef.current,
          style: mapStyle,
          center: DEFAULT_CENTER,
          zoom: 12.9,
          bearing: 0,
          pitch: 0,
          attributionControl: false,
        })

        map.dragRotate.disable()
        map.touchZoomRotate.disableRotation()

        map.on('error', (event) => {
          if (cancelled) return
          const message = event?.error?.message || 'Mapbox map error'
          setLoadError(message)
        })

        map.once('load', () => {
          if (cancelled) return

          map.addSource(ROUTE_SOURCE_ID, {
            type: 'geojson',
            data: emptyRouteData(),
          })

          map.addLayer({
            id: ROUTE_CASING_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            paint: {
              'line-color': 'rgba(11, 64, 35, 0.2)',
              'line-width': 9,
              'line-opacity': 0.95,
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
          })

          map.addLayer({
            id: ROUTE_LAYER_ID,
            type: 'line',
            source: ROUTE_SOURCE_ID,
            paint: {
              'line-color': '#20b062',
              'line-width': 6,
              'line-opacity': 0.95,
            },
            layout: {
              'line-cap': 'round',
              'line-join': 'round',
            },
          })

          setMapReady(true)
          setLoadError('')
          map.resize()
          window.setTimeout(() => {
            if (cancelled) return
            map.resize()
          }, 120)
        })

        onWindowResize = () => {
          map.resize()
        }
        window.addEventListener('resize', onWindowResize)

        mapRef.current = map

        loadTimeoutRef.current = window.setTimeout(() => {
          if (cancelled || map.isStyleLoaded()) return
          setLoadError('Map did not finish loading. Check token scope and allowed URLs in Mapbox.')
        }, 8000)
      })
      .catch(() => {
        if (cancelled) return
        setLoadError('Unable to load Mapbox GL resources.')
      })

    return () => {
      cancelled = true
      if (loadTimeoutRef.current) {
        window.clearTimeout(loadTimeoutRef.current)
      }
      if (onWindowResize) {
        window.removeEventListener('resize', onWindowResize)
      }
      if (routeAbortControllerRef.current) {
        routeAbortControllerRef.current.abort()
      }
      clearMarkers()
      if (currentLocationMarkerRef.current) {
        currentLocationMarkerRef.current.remove()
        currentLocationMarkerRef.current = null
      }
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [clearMarkers, mapStyle])

  useEffect(() => {
    if (!navigator.geolocation) return undefined

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        setCurrentLocation({
          lng: position.coords.longitude,
          lat: position.coords.latitude,
        })
      },
      () => {
        // keep map functional even if location permission is denied
      },
      {
        enableHighAccuracy: true,
        maximumAge: 15000,
        timeout: 10000,
      }
    )

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !mapboxRef.current) return

    clearMarkers()

    markersRef.current = filteredStations.map((station) => {
      const isSelected = station.id === selectedStation?.id
      const element = buildMarkerElement(isSelected, station)
      const onClick = () => {
        setSelectedStationId(station.id)
      }
      element.addEventListener('click', onClick)

      const marker = new mapboxRef.current.Marker({ element, anchor: 'center' })
        .setLngLat([station.lng, station.lat])
        .addTo(mapRef.current)

      return { marker, element, onClick }
    })
  }, [clearMarkers, filteredStations, mapReady, selectedStation?.id])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedStation) return

    mapRef.current.easeTo({
      center: [selectedStation.lng, selectedStation.lat],
      padding: CAMERA_PADDING,
      duration: 600,
      bearing: 0,
      pitch: 0,
    })
  }, [mapReady, selectedStation])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedStation) return

    const map = mapRef.current
    const tone = routeTone(selectedStation)

    if (map.getLayer(ROUTE_LAYER_ID)) {
      map.setPaintProperty(ROUTE_LAYER_ID, 'line-color', tone.line)
    }

    if (map.getLayer(ROUTE_CASING_LAYER_ID)) {
      map.setPaintProperty(ROUTE_CASING_LAYER_ID, 'line-color', tone.casing)
    }
  }, [mapReady, selectedStation])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !mapboxRef.current || !currentLocation) return

    if (!currentLocationMarkerRef.current) {
      const element = buildCurrentLocationElement()
      currentLocationMarkerRef.current = new mapboxRef.current.Marker({ element, anchor: 'center' })
        .setLngLat([currentLocation.lng, currentLocation.lat])
        .addTo(mapRef.current)
      return
    }

    currentLocationMarkerRef.current.setLngLat([currentLocation.lng, currentLocation.lat])
  }, [currentLocation, mapReady])

  useEffect(() => {
    if (!mapReady || !mapRef.current) return

    const routeSource = mapRef.current.getSource(ROUTE_SOURCE_ID)
    if (!routeSource) return

    if (!selectedStation) {
      routeLockRef.current = { stationId: null, origin: null }
      routeSource.setData(emptyRouteData())
      return
    }

    if (!currentLocation) {
      if (!routeLockRef.current.origin || routeLockRef.current.stationId !== selectedStation.id) {
        routeSource.setData(emptyRouteData())
      }
      return
    }

    const isSameLockedStation = routeLockRef.current.stationId === selectedStation.id && routeLockRef.current.origin
    if (isSameLockedStation) return

    const lockedOrigin = {
      lng: currentLocation.lng,
      lat: currentLocation.lat,
    }
    routeLockRef.current = {
      stationId: selectedStation.id,
      origin: lockedOrigin,
    }

    if (routeAbortControllerRef.current) {
      routeAbortControllerRef.current.abort()
    }
    routeAbortControllerRef.current = new AbortController()

    const origin = `${lockedOrigin.lng},${lockedOrigin.lat}`
    const destination = `${selectedStation.lng},${selectedStation.lat}`
    const directionsUrl =
      `https://api.mapbox.com/directions/v5/mapbox/driving/${origin};${destination}` +
      `?alternatives=true&geometries=geojson&overview=full&steps=false&access_token=${MAPBOX_TOKEN}`

    fetch(directionsUrl, { signal: routeAbortControllerRef.current.signal })
      .then((response) => {
        if (!response.ok) throw new Error('Directions request failed')
        return response.json()
      })
      .then((payload) => {
        const routes = payload?.routes || []
        if (!routes.length) throw new Error('Missing route options')

        const shortestRoute = routes.reduce((best, route) => {
          if (!best) return route
          const bestDistance = Number(best.distance || Number.POSITIVE_INFINITY)
          const routeDistance = Number(route.distance || Number.POSITIVE_INFINITY)
          return routeDistance < bestDistance ? route : best
        }, null)

        const routeCoordinates = shortestRoute?.geometry?.coordinates
        if (!routeCoordinates?.length) throw new Error('Missing route coordinates')
        routeSource.setData(routeDataFromCoordinates(routeCoordinates))

        const distanceKm = Number(shortestRoute.distance || 0) / 1000
        const etaMin = Math.max(1, Math.round(Number(shortestRoute.duration || 0) / 60))
        setRouteMetricsByStationId((prev) => ({
          ...prev,
          [selectedStation.id]: {
            distanceKm,
            etaMin,
          },
        }))
      })
      .catch(() => {
        routeSource.setData(
          routeDataFromCoordinates([
            [lockedOrigin.lng, lockedOrigin.lat],
            [selectedStation.lng, selectedStation.lat],
          ])
        )
      })
  }, [currentLocation, mapReady, selectedStation])

  useEffect(() => {
    if (!mapReady || !mapRef.current || !selectedStation) return undefined

    const syncChip = () => {
      if (!mapRef.current) return
      const point = mapRef.current.project([selectedStation.lng, selectedStation.lat])
      setChipPosition({
        x: point.x,
        y: point.y,
      })
    }

    syncChip()
    mapRef.current.on('move', syncChip)
    mapRef.current.on('resize', syncChip)

    return () => {
      if (!mapRef.current) return
      mapRef.current.off('move', syncChip)
      mapRef.current.off('resize', syncChip)
    }
  }, [mapReady, selectedStation])

  const mapError = !MAPBOX_TOKEN ? 'Missing VITE_MAPBOX_TOKEN in .env' : loadError
  const activeFilter = STATION_FILTERS.find((filter) => filter.id === activeFilterId) || STATION_FILTERS[0]
  const noResultMessage = !mapError && mapReady && !filteredStations.length ? 'No stations match your search/filter.' : ''

  return (
    <div className='map-home-screen'>
      <section className='map-home-canvas'>
        <div className='map-visible-slot'>
          <div ref={mapContainerRef} className='map-home-surface' />
        </div>

        <div ref={filterMenuRef} className='map-search-controls'>
          <div className='map-search-pill'>
            <SearchIcon size={16} />
            <input
              type='search'
              value={searchText}
              placeholder='Search Station'
              onChange={(event) => setSearchText(event.target.value)}
              aria-label='Search station'
            />
            <button
              type='button'
              className={`map-filter-button ${activeFilterId !== 'all' ? 'is-active' : ''}`}
              aria-label='Filter stations'
              aria-haspopup='menu'
              aria-expanded={isFilterMenuOpen}
              onClick={() => setIsFilterMenuOpen((prev) => !prev)}
            >
              <FilterIcon size={14} />
            </button>
          </div>

          {isFilterMenuOpen ? (
            <div className='map-filter-popover' role='menu' aria-label='Station filters'>
              {STATION_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type='button'
                  role='menuitemradio'
                  aria-checked={activeFilterId === filter.id}
                  className={`map-filter-option ${activeFilterId === filter.id ? 'is-active' : ''}`}
                  onClick={() => {
                    setActiveFilterId(filter.id)
                    setIsFilterMenuOpen(false)
                  }}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          ) : null}

          {activeFilterId !== 'all' ? <span className='map-active-filter-chip'>{activeFilter.label}</span> : null}
        </div>

        {mapReady && selectedStation && chipPosition ? (
          <div
            className={`map-selected-chip ${stationToneClass(selectedStation)}`}
            style={{
              left: chipPosition.x,
              top: chipPosition.y - 16,
            }}
          >
            {selectedStation.chipLabel || selectedStation.name}
          </div>
        ) : null}

        {mapError ? <div className='mapbox-status error'>{mapError}</div> : null}
        {noResultMessage ? <div className='mapbox-status'>{noResultMessage}</div> : null}
      </section>

      <StationBottomSheet
        station={selectedStation}
        stations={filteredStations}
        selectedStationId={selectedStation?.id || null}
        onSelectStation={setSelectedStationId}
        onView={onViewStation}
        routeMetricsByStationId={routeMetricsByStationId}
      />
    </div>
  )
}
