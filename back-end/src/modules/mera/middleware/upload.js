import fs from "node:fs"
import path from "node:path"
import multer from "multer"
import { badRequest } from "../../../utils/http.js"

const uploadRoot = path.resolve(process.env.MERA_UPLOAD_DIR || "tmp/mera-uploads")

fs.mkdirSync(uploadRoot, { recursive: true })

function sanitizeFilename(filename) {
  const ext = path.extname(String(filename || "")).slice(0, 16)
  const base = path
    .basename(String(filename || ""), ext)
    .replace(/[^a-zA-Z0-9-_]+/g, "-")
    .slice(0, 48)
  return `${base || "file"}-${Date.now()}${ext || ""}`
}

const storage = multer.diskStorage({
  destination(_req, _file, callback) {
    callback(null, uploadRoot)
  },
  filename(_req, file, callback) {
    callback(null, sanitizeFilename(file.originalname))
  },
})

function fileFilter(_req, file, callback) {
  const mime = String(file.mimetype || "").toLowerCase()
  const allowed =
    mime.startsWith("image/") ||
    mime.startsWith("video/") ||
    mime === "application/pdf" ||
    mime === "application/msword" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"

  if (!allowed) {
    callback(badRequest("Unsupported MERA upload format"))
    return
  }
  callback(null, true)
}

const baseUpload = multer({
  storage,
  fileFilter,
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

export function buildUploadedFileUrl(file) {
  if (!file?.filename) return null
  return `/uploads/mera/${file.filename}`
}

export function inferUploadedFileType(file) {
  const mime = String(file?.mimetype || "").toLowerCase()
  if (mime.startsWith("image/")) return "PHOTO"
  if (mime.startsWith("video/")) return "VIDEO"
  if (mime.includes("pdf") || mime.includes("word")) return "DOCUMENT"
  return "OTHER"
}
