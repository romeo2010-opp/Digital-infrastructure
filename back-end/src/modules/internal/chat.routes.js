import { Router } from "express"
import multer from "multer"
import { z } from "zod"
import { asyncHandler } from "../../utils/asyncHandler.js"
import { badRequest, ok } from "../../utils/http.js"
import { requireInternalPermission } from "./middleware.js"
import { INTERNAL_PERMISSIONS } from "./permissions.js"
import {
  createChatMessage,
  deleteChatMessage,
  getChatMessageDocument,
  getDirectRoom,
  getInternalChatBootstrap,
  getRoomMessages,
  setChatMessagePinnedState,
  updateChatMessage,
} from "./chat.service.js"

const router = Router()
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const uploadAttachment = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: 1,
    fileSize: MAX_ATTACHMENT_BYTES,
  },
})

const attachmentSchema = z.object({
  name: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(128).optional().or(z.literal("")),
  size: z.coerce.number().int().min(1).max(MAX_ATTACHMENT_BYTES).optional(),
  contentBase64: z.string().trim().min(16).max(4_500_000),
})

const messageSchema = z
  .object({
    body: z.string().max(4000).optional().or(z.literal("")),
    attachment: attachmentSchema.optional(),
    replyToMessagePublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
  })
  .refine((value) => String(value.body || "").trim() || value.attachment, {
    message: "Message body or document is required",
  })

const messageEditSchema = z.object({
  body: z.string().max(4000),
})

const directRoomSchema = z.object({
  peerUserPublicId: z.string().trim().min(8).max(64),
})

const limitSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
})

function parseMultipartMessagePayload(req) {
  return z
    .object({
      body: z.string().max(4000).optional().or(z.literal("")),
      replyToMessagePublicId: z.string().trim().min(8).max(64).optional().or(z.literal("")),
    })
    .refine((value) => String(value.body || "").trim() || req.file, {
      message: "Message body or document is required",
    })
    .parse(req.body || {})
}

function uploadAttachmentMiddleware(req, res, next) {
  uploadAttachment.single("attachmentFile")(req, res, (error) => {
    if (!error) return next()
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return next(badRequest(`Document exceeds ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB upload limit`))
    }
    return next(error)
  })
}

router.get(
  "/bootstrap",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_VIEW),
  asyncHandler(async (req, res) => ok(res, await getInternalChatBootstrap(req.internalAuth)))
)

router.post(
  "/direct-rooms",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_SEND),
  asyncHandler(async (req, res) => {
    const payload = directRoomSchema.parse(req.body || {})
    return ok(res, await getDirectRoom(req.internalAuth, payload.peerUserPublicId))
  })
)

router.get(
  "/rooms/:roomPublicId/messages",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_VIEW),
  asyncHandler(async (req, res) => {
    const query = limitSchema.parse(req.query || {})
    return ok(
      res,
      await getRoomMessages({
        actor: req.internalAuth,
        roomPublicId: String(req.params.roomPublicId || "").trim(),
        limit: query.limit,
      })
    )
  })
)

router.post(
  "/rooms/:roomPublicId/messages",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_SEND),
  uploadAttachmentMiddleware,
  asyncHandler(async (req, res) => {
    const payload = req.file ? parseMultipartMessagePayload(req) : messageSchema.parse(req.body || {})
    return ok(
      res,
      await createChatMessage({
        actor: req.internalAuth,
        roomPublicId: String(req.params.roomPublicId || "").trim(),
        body: payload.body || "",
        attachment: req.file
          ? {
              name: req.file.originalname,
              mimeType: req.file.mimetype || "application/octet-stream",
              size: req.file.size,
              buffer: req.file.buffer,
            }
          : payload.attachment,
        replyToMessagePublicId: payload.replyToMessagePublicId || null,
      }),
      201
    )
  })
)

router.patch(
  "/rooms/:roomPublicId/messages/:messagePublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_SEND),
  asyncHandler(async (req, res) => {
    const payload = messageEditSchema.parse(req.body || {})
    return ok(
      res,
      await updateChatMessage({
        actor: req.internalAuth,
        roomPublicId: String(req.params.roomPublicId || "").trim(),
        messagePublicId: String(req.params.messagePublicId || "").trim(),
        body: payload.body,
      })
    )
  })
)

router.delete(
  "/rooms/:roomPublicId/messages/:messagePublicId",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_SEND),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await deleteChatMessage({
        actor: req.internalAuth,
        roomPublicId: String(req.params.roomPublicId || "").trim(),
        messagePublicId: String(req.params.messagePublicId || "").trim(),
      })
    )
  )
)

router.post(
  "/rooms/:roomPublicId/messages/:messagePublicId/pin",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_PIN),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await setChatMessagePinnedState({
        actor: req.internalAuth,
        roomPublicId: String(req.params.roomPublicId || "").trim(),
        messagePublicId: String(req.params.messagePublicId || "").trim(),
        pinned: true,
      })
    )
  )
)

router.post(
  "/rooms/:roomPublicId/messages/:messagePublicId/unpin",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_PIN),
  asyncHandler(async (req, res) =>
    ok(
      res,
      await setChatMessagePinnedState({
        actor: req.internalAuth,
        roomPublicId: String(req.params.roomPublicId || "").trim(),
        messagePublicId: String(req.params.messagePublicId || "").trim(),
        pinned: false,
      })
    )
  )
)

router.get(
  "/messages/:messagePublicId/document",
  requireInternalPermission(INTERNAL_PERMISSIONS.CHAT_VIEW),
  asyncHandler(async (req, res) => {
    const document = await getChatMessageDocument({
      actor: req.internalAuth,
      messagePublicId: String(req.params.messagePublicId || "").trim(),
    })

    res.setHeader("Content-Type", document.mimeType)
    res.setHeader("Content-Length", String(document.buffer.length))
    res.setHeader("Content-Disposition", `attachment; filename="${document.fileName}"`)
    return res.status(200).send(document.buffer)
  })
)

export default router
