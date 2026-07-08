import { createReadStream, existsSync, statSync } from "fs"
import { createServer } from "http"
import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "../dist")
const port = Number(process.env.PORT || 4173)

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
}

function filePathForRequest(url = "/") {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname)
  const requested = path.normalize(path.join(root, pathname))
  if (!requested.startsWith(root)) return path.join(root, "index.html")
  if (existsSync(requested) && statSync(requested).isFile()) return requested
  return path.join(root, "index.html")
}

const server = createServer((req, res) => {
  if (String(req.url || "").startsWith("/api/")) {
    res.statusCode = 502
    res.setHeader("Content-Type", "application/json; charset=utf-8")
    res.end(JSON.stringify({ message: "API requests must be sent to the SmartLink Schools API service. Check VITE_SCHOOLS_API_BASE_URL and redeploy the web service." }))
    return
  }
  const filePath = filePathForRequest(req.url)
  const type = mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream"
  res.setHeader("Content-Type", type)
  res.setHeader("Cache-Control", path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable")
  createReadStream(filePath)
    .on("error", () => {
      res.statusCode = 404
      res.end("Not found")
    })
    .pipe(res)
})

server.listen(port, "0.0.0.0", () => {
  console.log(`SmartLink Schools web listening on http://0.0.0.0:${port}`)
})
