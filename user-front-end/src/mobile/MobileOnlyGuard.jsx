import { DesktopFallback } from './DesktopFallback'
import { useMobileViewport } from './useMobileViewport'

export function MobileOnlyGuard({ children, maxWidth = 768 }) {
  const isMobile = useMobileViewport(maxWidth)

  if (!isMobile) {
    return <DesktopFallback />
  }

  return children
}
