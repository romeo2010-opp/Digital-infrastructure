import { useEffect, useState } from 'react'

export function useMobileViewport(maxWidth = 768) {
  const mediaQuery = `(max-width: ${maxWidth}px)`
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(mediaQuery).matches)

  useEffect(() => {
    const media = window.matchMedia(mediaQuery)

    const onChange = (event) => {
      setIsMobile(event.matches)
    }

    media.addEventListener('change', onChange)
    return () => {
      media.removeEventListener('change', onChange)
    }
  }, [mediaQuery])

  return isMobile
}
