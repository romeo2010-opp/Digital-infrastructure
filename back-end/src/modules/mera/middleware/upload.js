import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import multer from "multer"
import { badRequest } from "../../../utils/http.js"

const uploadRoot = path.resolve(process.env.MERA_UPLOAD_DIR || "tmp/mera-uploads")

fs.mkdirSync(uploadRoot, { recursive: true })

function sanitizeFilename(filename) {
  const originalName = String(filename || "")
  const originalExt = path.extname(originalName)
  const ext = path
    .extname(originalName)
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "")
    .slice(0, 32)
  const base = path
    .basename(originalName, originalExt)
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .slice(0, 48)
  return `${base || "file"}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext || ""}`
}

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, uploadRoot)
  },
  filename(_req, file, callback) {
    callback(null, sanitizeFilename(file.originalname))
  },
})

const baseUpload = multer({
  storage,
  limits: {
    fileSize: 8 * 1024 * 1024,
  },
})

function multerErrorAdapter(error, _req, _res, next) {
  if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
    next(badRequest("Upload exceeds 8MB limit"))
    return
  }
  next(error)
}

export const complaintMediaUpload = [baseUpload.single("media"), multerErrorAdapter]
export const inspectionEvidenceUpload = [baseUpload.single("evidence"), multerErrorAdapter]

function resolveUploadBaseUrl(req) {
  const configured = String(process.env.MERA_PUBLIC_UPLOAD_BASE_URL || "").trim()
  if (configured) return configured.replace(/\/+$/, "")
  return ""
}

export function buildUploadedFileUrl(file, req = null) {
  if (!file?.filename) return null
  const path = `/uploads/mera/${file.filename}`
  const baseUrl = resolveUploadBaseUrl(req)
  return baseUrl ? `${baseUrl}${path}` : path
}

export function inferUploadedFileType(file) {
  const mime = String(file?.mimetype || "").toLowerCase()
  if (mime.startsWith("image/")) return "PHOTO"
  if (mime.startsWith("video/")) return "VIDEO"
  if (mime.includes("pdf") || mime.includes("word")) return "DOCUMENT"
  return "OTHER"
}
