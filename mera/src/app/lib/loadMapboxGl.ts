const MAPBOX_CSS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.css'
const MAPBOX_JS_URL = 'https://api.mapbox.com/mapbox-gl-js/v3.16.0/mapbox-gl.js'

let mapboxPromise: Promise<any> | null = null

function loadCss(url: string): Promise<void> {
  return new Promise((resolve) => {
    const link = document.createElement('link')
    link.rel = 'stylesheet'
    link.href = url
    link.setAttribute('data-mapbox-gl', 'true')
    
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }

    link.onload = finish
    link.onerror = finish
    
    // Timeout after 3 seconds to avoid hanging
    setTimeout(finish, 3000)
    
    document.head.appendChild(link)
  })
}

function loadScript(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Check if already loading/loaded
    const existing = document.querySelector(`script[data-mapbox-gl-src="${url}"]`)
    if (existing) {
      // If it's already loaded, check for mapboxgl
      if ((window as any).mapboxgl) {
        resolve()
        return
      }
      
      // Otherwise wait for it
      let loaded = false
      const checkMapbox = () => {
        if ((window as any).mapboxgl && !loaded) {
          loaded = true
          resolve()
        }
      }
      
      existing.addEventListener('load', checkMapbox, { once: true })
      setTimeout(checkMapbox, 100)
      setTimeout(checkMapbox, 500)
      setTimeout(checkMapbox, 1000)
      return
    }
    
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.defer = false
    script.setAttribute('data-mapbox-gl-src', url)
    script.setAttribute('data-mapbox-gl', 'true')
    
    let done = false
    const finish = (success: boolean) => {
      if (done) return
      done = true
      
      // Give it a moment to execute
      setTimeout(() => {
        const mapboxgl = (window as any).mapboxgl
        if (mapboxgl) {
          resolve()
        } else if (success) {
          console.warn(`[loadMapboxGl] Script loaded but mapboxgl not on window, resolving anyway`)
          resolve()
        } else {
          console.error(`[loadMapboxGl] Script failed to load`)
          reject(new Error(`Failed to load ${url}`))
        }
      }, 100)
    }
    
    script.onload = () => {
      finish(true)
    }
    
    script.onerror = () => {
      console.error(`[loadMapboxGl] Script onerror: ${url}`)
      finish(false)
    }
    
    document.head.appendChild(script)
  })
}

export function loadMapboxGl() {
  if (typeof window === 'undefined') {
    console.error('[loadMapboxGl] No window')
    return Promise.reject(new Error('Mapbox GL requires a browser.'))
  }

  // If already loaded, return immediately
  if ((window as any).mapboxgl) {
    return Promise.resolve((window as any).mapboxgl)
  }

  // If already loading, return existing promise
  if (mapboxPromise) {
    return mapboxPromise
  }

  mapboxPromise = (async () => {
    try {
      await loadCss(MAPBOX_CSS_URL)
      
      await loadScript(MAPBOX_JS_URL)
      
      const mapboxgl = (window as any).mapboxgl
      if (!mapboxgl) {
        throw new Error('Mapbox GL not available after script load')
      }
      
      return mapboxgl
    } catch (error) {
      console.error('[loadMapboxGl] Error:', error)
      mapboxPromise = null
      throw error
    }
  })()

  return mapboxPromise
}
