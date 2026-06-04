import fs from "node:fs"
import path from "node:path"
import express from "express"

const DEFAULT_CACHE_MAX_AGE = "1h"

function hasUnsafeSegment(segment) {
  return !segment || segment === "." || segment === ".." || segment.includes("\0")
}

export function resolveSafeUploadPath(rootDir, requestPath) {
  const root = path.resolve(rootDir)
  const rawPath = String(requestPath || "").replace(/\\/g, "/")
  const trimmedPath = rawPath.replace(/^\/+/, "")
  const segments = trimmedPath.split("/").filter(Boolean)

  if (segments.length === 0 || segments.some(hasUnsafeSegment)) {
    return null
  }

  const filePath = path.resolve(root, ...segments)
  const relativePath = path.relative(root, filePath)

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null
  }

  return filePath
}

export function buildInlineContentDisposition(filename) {
  const sourceName = String(filename || "download")
  const fallbackName = sourceName
    .replace(/[^\x20-\x7E]+/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, 160) || "download"
  const encodedName = encodeURIComponent(sourceName).replace(/['()]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)

  return `inline; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`
}

export function createUploadFileServer({ rootDir, cacheMaxAge = DEFAULT_CACHE_MAX_AGE } = {}) {
  if (!rootDir) {
    throw new Error("Upload file server requires a rootDir")
  }

  const uploadRoot = path.resolve(rootDir)
  fs.mkdirSync(uploadRoot, { recursive: true })

  const router = express.Router()

  function serveUploadFile(req, res, next) {
    const filePath = resolveSafeUploadPath(uploadRoot, req.params[0])

    if (!filePath) {
      res.status(400).json({ ok: false, error: "Invalid file path" })
      return
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError) {
        if (statError.code === "ENOENT" || statError.code === "ENOTDIR") return next()
        return next(statError)
      }

      if (!stat.isFile()) return next()

      res.removeHeader("X-Frame-Options")
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin")
      res.setHeader("Content-Security-Policy", "sandbox allow-downloads")
      res.setHeader("X-Content-Type-Options", "nosniff")
      res.setHeader("Content-Disposition", buildInlineContentDisposition(path.basename(filePath)))

      return res.sendFile(
        filePath,
        {
          acceptRanges: true,
          cacheControl: true,
          dotfiles: "deny",
          lastModified: true,
          maxAge: cacheMaxAge,
        },
        (sendError) => {
          if (!sendError) return
          if (res.headersSent) return next(sendError)
          if (sendError.status === 404 || sendError.statusCode === 404) return next()
          return next(sendError)
        }
      )
    })
  }

  router.get("/*", serveUploadFile)
  router.head("/*", serveUploadFile)

  return router
}
