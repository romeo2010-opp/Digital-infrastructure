import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:4000'
  const devPort = Number(env.VITE_DEV_PORT || 5173)
  const allowedHosts = String(env.VITE_ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
  const useWideAllowedHosts =
    String(env.VITE_ALLOW_ALL_HOSTS || 'true').toLowerCase() === 'true'
  const hmrProtocol = String(env.VITE_HMR_PROTOCOL || '').trim() || undefined
  const hmrHost = String(env.VITE_HMR_HOST || '').trim() || undefined
  const hmrPortValue = Number(env.VITE_HMR_PORT)
  const hmrClientPortValue = Number(env.VITE_HMR_CLIENT_PORT)
  const hmrTimeoutValue = Number(env.VITE_HMR_TIMEOUT)
  const hmrPath = String(env.VITE_HMR_PATH || '').trim() || undefined
  const useWatchPolling =
    String(env.VITE_WATCH_USE_POLLING || 'false').toLowerCase() === 'true'
  const watchPollingIntervalValue = Number(env.VITE_WATCH_POLLING_INTERVAL)
  const hmrConfig =
    hmrProtocol || hmrHost || Number.isFinite(hmrPortValue) || Number.isFinite(hmrClientPortValue) || hmrPath
      ? {
          protocol: hmrProtocol,
          host: hmrHost,
          port: Number.isFinite(hmrPortValue) ? hmrPortValue : undefined,
          clientPort: Number.isFinite(hmrClientPortValue) ? hmrClientPortValue : undefined,
          path: hmrPath,
          timeout: Number.isFinite(hmrTimeoutValue) ? hmrTimeoutValue : undefined,
        }
      : undefined
  const watchConfig = useWatchPolling
    ? {
        usePolling: true,
        interval: Number.isFinite(watchPollingIntervalValue) ? watchPollingIntervalValue : 500,
      }
    : undefined

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: devPort,
      strictPort: true,
      allowedHosts: useWideAllowedHosts
        ? true
        : [
            '.trycloudflare.com',
            '.ngrok-free.app',
            '.ngrok.app',
            '.loca.lt',
            '.localtunnel.me',
            ...allowedHosts,
          ],
      hmr: hmrConfig,
      watch: watchConfig,
      proxy: {
        '/auth': {
          target: devApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/api': {
          target: devApiTarget,
          changeOrigin: true,
          secure: false,
        },
        '/ws': {
          target: devApiTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(env.VITE_PREVIEW_PORT || 4173),
      strictPort: true,
    },
  }
})
