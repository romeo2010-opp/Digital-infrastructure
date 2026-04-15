import { useCallback, useEffect, useState } from 'react'

function normalizePath(path) {
  if (!path) return '/'
  const withoutQuery = String(path).split('?')[0].split('#')[0]
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1)
  }
  return withoutQuery || '/'
}

export function useMiniRouter() {
  const [pathname, setPathname] = useState(() => normalizePath(window.location.pathname))

  useEffect(() => {
    const onPopState = () => {
      setPathname(normalizePath(window.location.pathname))
    }

    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
    }
  }, [])

  const navigate = useCallback(
    (targetPath, options = {}) => {
      const nextPath = normalizePath(targetPath)
      if (!nextPath || nextPath === pathname) return

      if (options.replace) {
        window.history.replaceState({}, '', nextPath)
      } else {
        window.history.pushState({}, '', nextPath)
      }
      window.scrollTo({ top: 0, behavior: 'auto' })
      setPathname(nextPath)
    },
    [pathname]
  )

  return {
    pathname,
    navigate,
  }
}
