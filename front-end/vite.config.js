import { defineConfig, loadEnv } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const devApiTarget = env.VITE_DEV_API_TARGET || 'http://127.0.0.1:4000'
  return {
    plugins: [react(),visualizer({ open: true, gzip: true })],
    server: {
      host: '0.0.0.0',
      port: Number(env.VITE_DEV_PORT || 5000),
      strictPort: true,
      allowedHosts: true,
      proxy: {
        '/api': { target: devApiTarget, changeOrigin: true },
        '/auth': { target: devApiTarget, changeOrigin: true },
        '/health': { target: devApiTarget, changeOrigin: true },
        '/ws': { target: devApiTarget, changeOrigin: true, ws: true },
      },
    },
    preview: {
      host: '0.0.0.0',
      port: Number(env.VITE_PREVIEW_PORT || 4173),
      strictPort: true,
    },
  }
})
