import { defineConfig, loadEnv } from "vite"
import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const devApiTarget = env.VITE_DEV_API_TARGET || "http://127.0.0.1:4000"
  const allowedHosts = String(env.VITE_ALLOWED_HOSTS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
  const useWideAllowedHosts = String(env.VITE_ALLOW_ALL_HOSTS || "true").toLowerCase() === "true"

  return {
    plugins: [react({ jsxRuntime: "automatic" }), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      host: true,
      port: 5177,
      strictPort: true,
      allowedHosts: useWideAllowedHosts
        ? true
        : [
            ".trycloudflare.com",
            ".ngrok-free.app",
            ".ngrok.app",
            ".loca.lt",
            ".localtunnel.me",
            ...allowedHosts,
          ],
      proxy: {
        "/auth": {
          target: devApiTarget,
          changeOrigin: true,
          secure: false,
        },
        "/api": {
          target: devApiTarget,
          changeOrigin: true,
          secure: false,
        },
        "/ws": {
          target: devApiTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
        },
      },
    },
    assetsInclude: ["**/*.svg", "**/*.csv"],
  }
})
