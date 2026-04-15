import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const sharedNodeModules = path.resolve(__dirname, "../front-end/node_modules")
const sharedReactRouterDist = path.resolve(sharedNodeModules, "react-router/dist/development")
const sharedReactRouterDomDist = path.resolve(sharedNodeModules, "react-router-dom/dist")

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const devApiTarget = env.VITE_DEV_API_TARGET || "http://127.0.0.1:4000"

  return {
    plugins: [react()],
    resolve: {
      alias: {
        react: path.resolve(sharedNodeModules, "react"),
        "react-dom": path.resolve(sharedNodeModules, "react-dom"),
        "react-router/dom": path.resolve(sharedReactRouterDist, "dom-export.mjs"),
        "react-router-dom": path.resolve(sharedReactRouterDomDist, "index.mjs"),
        "react-router": path.resolve(sharedReactRouterDist, "index.mjs"),
      },
      dedupe: ["react", "react-dom", "react-router", "react-router-dom"],
    },
    server: {
      host: "0.0.0.0",
      port: Number(env.VITE_DEV_PORT || 5174),
      strictPort: true,
      allowedHosts: true,
      proxy: {
        "/api": { target: devApiTarget, changeOrigin: true },
        "/auth": { target: devApiTarget, changeOrigin: true },
        "/health": { target: devApiTarget, changeOrigin: true },
        "/ws": { target: devApiTarget, changeOrigin: true, ws: true },
      },
    },
    preview: {
      host: "0.0.0.0",
      port: Number(env.VITE_PREVIEW_PORT || 4174),
      strictPort: true,
    },
  }
})
