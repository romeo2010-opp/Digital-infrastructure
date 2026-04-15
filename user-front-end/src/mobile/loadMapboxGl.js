const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.css'
const MAPBOX_JS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.js'

let mapboxPromise

function ensureMapboxCss() {
  if (document.querySelector('link[data-mapbox-gl]')) return
  const link = document.createElement('link')
  link.rel = 'stylesheet'
  link.href = MAPBOX_CSS_URL
  link.setAttribute('data-mapbox-gl', 'true')
  document.head.appendChild(link)
}

export function loadMapboxGl() {
  if (window.mapboxgl) return Promise.resolve(window.mapboxgl)
  if (mapboxPromise) return mapboxPromise

  mapboxPromise = new Promise((resolve, reject) => {
    ensureMapboxCss()

    const script = document.createElement('script')
    script.src = MAPBOX_JS_URL
    script.async = true
    script.defer = true
    script.onload = () => {
      if (window.mapboxgl) {
        resolve(window.mapboxgl)
        return
      }
      reject(new Error('Mapbox GL script loaded without window.mapboxgl'))
    }
    script.onerror = () => reject(new Error('Failed to load Mapbox GL script'))
    document.head.appendChild(script)
  })

  return mapboxPromise
}
