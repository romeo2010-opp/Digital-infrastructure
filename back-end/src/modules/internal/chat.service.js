import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { prisma } from "../../db/prisma.js"
import { badRequest, notFound } from "../../utils/http.js"
import { createPublicId } from "../common/db.js"
import { publishInternalChatEvent } from "../../realtime/internalChatHub.js"

const CHAT_ROOM_TYPE_GROUP = "GROUP"
const CHAT_ROOM_TYPE_DIRECT = "DIRECT"
const DEFAULT_GROUP_ROOM_KEY = "ALL_INTERNALS"
const DEFAULT_GROUP_ROOM_NAME = "All Internals"
const DEFAULT_GROUP_ROOM_DESCRIPTION = "Shared internal chat for company-wide coordination."
const MAX_MESSAGE_BODY_LENGTH = 4000
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ATTACHMENTS_DIR = path.resolve(__dirname, "../../../tmp/internal-chat-attachments")

let ensureTablesPromise = null

function toIsoOrNull(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
}

function resolveMessageType({ hasBody, hasAttachment }) {
  if (hasBody && hasAttachment) return "TEXT_DOCUMENT"
  if (hasAttachment) return "DOCUMENT"
  return "TEXT"
}

function normalizeMessageBody(body) {
  return String(body || "").trim().slice(0, MAX_MESSAGE_BODY_LENGTH)
}

function sanitizeFileName(value) {
  return String(value || "")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .slice(0, 255)
}

function sanitizeExtension(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "")
    .slice(0, 16)
}

function stripDataUrlPrefix(value) {
  const normalized = String(value || "").trim()
  const marker = normalized.indexOf("base64,")
  if (marker === -1) return normalized
  return normalized.slice(marker + "base64,".length)
}

function buildDirectRoomKey(userIdA, userIdB) {
  const a = Number(userIdA || 0)
  const b = Number(userIdB || 0)
  if (!Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) {
    throw badRequest("Direct room requires two valid users")
  }
  return [a, b].sort((left, right) => left - right).join(":")
}

function normalizeAttachmentPayload(attachment) {
  if (!attachment) return null

  const name = sanitizeFileName(attachment.name)
  const mimeType = String(attachment.mimeType || "application/octet-stream").trim().slice(0, 128)
  const buffer = Buffer.isBuffer(attachment.buffer)
    ? attachment.buffer
    : Buffer.from(stripDataUrlPrefix(attachment.contentBase64), "base64")

  if (!name) throw badRequest("Document name is required")
  if (!buffer.length) throw badRequest("Document content is invalid")
  if (buffer.length > MAX_ATTACHMENT_BYTES) {
    throw badRequest(`Document exceeds ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)}MB upload limit`)
  }

  const declaredSize = Number(attachment.size || 0)
  if (declaredSize > 0 && Math.abs(buffer.length - declaredSize) > 8) {
    throw badRequest("Document size metadata does not match the uploaded file")
  }

  return {
    name,
    mimeType,
    size: buffer.length,
    buffer,
  }
}

function mapChatUserRow(row, currentUserId = null) {
  const roleNames = splitCsv(row?.role_names)

  return {
    publicId: String(row?.public_id || "").trim(),
    fullName: String(row?.full_name || "").trim() || "Internal User",
    email: String(row?.email || "").trim() || null,
    roleLabels: roleNames,
    primaryRoleLabel: roleNames[0] || null,
    isSelf: Number(row?.id || 0) === Number(currentUserId || 0),
  }
}

function mapChatRoomRow(row) {
  const otherUser =
    String(row?.room_type || "").trim().toUpperCase() === CHAT_ROOM_TYPE_DIRECT && row?.other_user_public_id
      ? {
          publicId: String(row.other_user_public_id || "").trim(),
          fullName: String(row.other_user_full_name || "").trim() || "Internal User",
          email: String(row.other_user_email || "").trim() || null,
          roleLabels: splitCsv(row.other_user_role_names),
        }
      : null

  return {
    publicId: String(row?.public_id || "").trim(),
    roomType: String(row?.room_type || "").trim().toUpperCase() || CHAT_ROOM_TYPE_GROUP,
    name:
      String(row?.room_type || "").trim().toUpperCase() === CHAT_ROOM_TYPE_DIRECT
        ? otherUser?.fullName || "Direct Chat"
        : String(row?.name || "").trim() || DEFAULT_GROUP_ROOM_NAME,
    description: String(row?.description || "").trim() || null,
    unreadCount: Number(row?.unread_count || 0),
    pinnedCount: Number(row?.pinned_count || 0),
    updatedAt: toIsoOrNull(row?.updated_at || row?.last_message_created_at),
    lastReadAt: toIsoOrNull(row?.last_read_at),
    peerLastReadAt: toIsoOrNull(row?.peer_last_read_at),
    systemKey: String(row?.system_key || "").trim() || null,
    otherUser,
    lastMessage: row?.last_message_public_id
      ? {
          publicId: String(row.last_message_public_id || "").trim(),
          body: String(row.last_message_body || "").trim() || "",
          messageType: String(row.last_message_type || "TEXT").trim().toUpperCase(),
          createdAt: toIsoOrNull(row.last_message_created_at),
          senderName: String(row.last_message_sender_name || "").trim() || null,
          document: row?.last_message_attachment_name
            ? {
                fileName: String(row.last_message_attachment_name || "").trim(),
                mimeType: String(row.last_message_attachment_mime_type || "application/octet-stream").trim(),
              }
            : null,
        }
      : null,
  }
}

function mapChatMessageRow(row) {
  const hasDocument = Boolean(row?.attachment_name)
  const isDeleted = Boolean(row?.deleted_at)
  const replyHasDocument = Boolean(row?.reply_attachment_name)

  return {
    publicId: String(row?.public_id || "").trim(),
    roomPublicId: String(row?.room_public_id || "").trim(),
    messageType: String(row?.message_type || "TEXT").trim().toUpperCase(),
    body: isDeleted ? "" : String(row?.body || "").trim() || "",
    createdAt: toIsoOrNull(row?.created_at),
    updatedAt: toIsoOrNull(row?.updated_at),
    editedAt: toIsoOrNull(row?.edited_at),
    deletedAt: toIsoOrNull(row?.deleted_at),
    isDeleted,
    isPinned: Boolean(Number(row?.is_pinned || 0)),
    pinnedAt: toIsoOrNull(row?.pinned_at),
    sender: {
      publicId: String(row?.sender_public_id || "").trim(),
      fullName: String(row?.sender_full_name || "").trim() || "Internal User",
      email: String(row?.sender_email || "").trim() || null,
    },
    pinnedBy: row?.pinned_by_public_id
      ? {
          publicId: String(row.pinned_by_public_id || "").trim(),
          fullName: String(row.pinned_by_full_name || "").trim() || "Admin",
        }
      : null,
    document: hasDocument
      ? {
          fileName: String(row.attachment_name || "").trim(),
        mimeType: String(row.attachment_mime_type || "application/octet-stream").trim(),
        size: Number(row?.attachment_size || 0),
        downloadPath: `/api/internal/chat/messages/${String(row?.public_id || "").trim()}/document`,
      }
      : null,
    replyTo: row?.reply_public_id
      ? {
          publicId: String(row.reply_public_id || "").trim(),
          body: Boolean(row?.reply_deleted_at) ? "" : String(row.reply_body || "").trim() || "",
          messageType: String(row.reply_message_type || "TEXT").trim().toUpperCase(),
          deletedAt: toIsoOrNull(row?.reply_deleted_at),
          sender: {
            publicId: String(row?.reply_sender_public_id || "").trim() || null,
            fullName: String(row?.reply_sender_full_name || "").trim() || "Internal User",
          },
          document: replyHasDocument
            ? {
                fileName: String(row.reply_attachment_name || "").trim(),
              }
            : null,
        }
      : null,
  }
}

async function ensureInternalChatTables() {
  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true })

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS internal_chat_rooms (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(26) NOT NULL,
      room_type VARCHAR(16) NOT NULL,
      name VARCHAR(160) NULL,
      description VARCHAR(255) NULL,
      system_key VARCHAR(64) NULL,
      direct_key VARCHAR(64) NULL,
      created_by_user_id BIGINT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_internal_chat_rooms_public_id (public_id),
      UNIQUE KEY uq_internal_chat_rooms_system_key (system_key),
      UNIQUE KEY uq_internal_chat_rooms_direct_key (direct_key),
      KEY idx_internal_chat_rooms_type_updated (room_type, updated_at),
      CONSTRAINT fk_internal_chat_rooms_created_by
        FOREIGN KEY (created_by_user_id) REFERENCES users (id)
        ON DELETE SET NULL
        ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS internal_chat_room_members (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      room_id BIGINT UNSIGNED NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      member_role VARCHAR(16) NOT NULL DEFAULT 'MEMBER',
      joined_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      last_read_at DATETIME(3) NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_internal_chat_room_member (room_id, user_id),
      KEY idx_internal_chat_room_members_user (user_id),
      CONSTRAINT fk_internal_chat_room_members_room
        FOREIGN KEY (room_id) REFERENCES internal_chat_rooms (id)
        ON DELETE CASCADE
        ON UPDATE RESTRICT,
      CONSTRAINT fk_internal_chat_room_members_user
        FOREIGN KEY (user_id) REFERENCES users (id)
        ON DELETE CASCADE
        ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS internal_chat_messages (
      id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      public_id CHAR(26) NOT NULL,
      room_id BIGINT UNSIGNED NOT NULL,
      sender_user_id BIGINT UNSIGNED NOT NULL,
      message_type VARCHAR(24) NOT NULL,
      body TEXT NULL,
      attachment_name VARCHAR(255) NULL,
      attachment_mime_type VARCHAR(128) NULL,
      attachment_size BIGINT UNSIGNED NULL,
      attachment_storage_path VARCHAR(512) NULL,
      attachment_base64 LONGTEXT NULL,
      reply_to_message_public_id CHAR(26) NULL,
      edited_at DATETIME(3) NULL,
      deleted_at DATETIME(3) NULL,
      is_pinned TINYINT(1) NOT NULL DEFAULT 0,
      pinned_at DATETIME(3) NULL,
      pinned_by_user_id BIGINT UNSIGNED NULL,
      created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
      PRIMARY KEY (id),
      UNIQUE KEY uq_internal_chat_messages_public_id (public_id),
      KEY idx_internal_chat_messages_room_created (room_id, created_at, id),
      KEY idx_internal_chat_messages_room_pinned (room_id, is_pinned, pinned_at),
      CONSTRAINT fk_internal_chat_messages_room
        FOREIGN KEY (room_id) REFERENCES internal_chat_rooms (id)
        ON DELETE CASCADE
        ON UPDATE RESTRICT,
      CONSTRAINT fk_internal_chat_messages_sender
        FOREIGN KEY (sender_user_id) REFERENCES users (id)
        ON DELETE RESTRICT
        ON UPDATE RESTRICT,
      CONSTRAINT fk_internal_chat_messages_pinned_by
        FOREIGN KEY (pinned_by_user_id) REFERENCES users (id)
        ON DELETE SET NULL
        ON UPDATE RESTRICT
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `)

  try {
    await prisma.$executeRawUnsafe(`
      ALTER TABLE internal_chat_messages
      ADD COLUMN attachment_storage_path VARCHAR(512) NULL AFTER attachment_size
    `)
  } catch (error) {
    const message = String(error?.message || "").toLowerCase()
    if (!message.includes("duplicate column")) throw error
  }

  for (const statement of [
    "ALTER TABLE internal_chat_messages ADD COLUMN reply_to_message_public_id CHAR(26) NULL AFTER attachment_base64",
    "ALTER TABLE internal_chat_messages ADD COLUMN edited_at DATETIME(3) NULL AFTER reply_to_message_public_id",
    "ALTER TABLE internal_chat_messages ADD COLUMN deleted_at DATETIME(3) NULL AFTER edited_at",
  ]) {
    try {
      await prisma.$executeRawUnsafe(statement)
    } catch (error) {
      const message = String(error?.message || "").toLowerCase()
      if (!message.includes("duplicate column")) throw error
    }
  }
}

export async function ensureInternalChatTablesReady() {
  if (!ensureTablesPromise) {
    ensureTablesPromise = ensureInternalChatTables().catch((error) => {
      ensureTablesPromise = null
      throw error
    })
  }
  await ensureTablesPromise
}

async function getGroupRoomRow() {
  const rows = await prisma.$queryRaw`
    SELECT id, public_id, room_type, name, description, system_key, updated_at
    FROM internal_chat_rooms
    WHERE system_key = ${DEFAULT_GROUP_ROOM_KEY}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function ensureDefaultGroupRoom() {
  await ensureInternalChatTablesReady()

  let room = await getGroupRoomRow()
  if (!room?.id) {
    const publicId = createPublicId()
    await prisma.$executeRaw`
      INSERT INTO internal_chat_rooms (
        public_id,
        room_type,
        name,
        description,
        system_key
      )
      VALUES (
        ${publicId},
        ${CHAT_ROOM_TYPE_GROUP},
        ${DEFAULT_GROUP_ROOM_NAME},
        ${DEFAULT_GROUP_ROOM_DESCRIPTION},
        ${DEFAULT_GROUP_ROOM_KEY}
      )
    `
    room = await getGroupRoomRow()
  }

  if (!room?.id) throw new Error("Failed to initialize the internal group chat room")

  await prisma.$executeRaw`
    INSERT IGNORE INTO internal_chat_room_members (
      room_id,
      user_id,
      member_role
    )
    SELECT
      ${room.id},
      u.id,
      'MEMBER'
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id AND iur.is_active = 1
    INNER JOIN internal_roles ir ON ir.id = iur.role_id AND ir.is_active = 1
    WHERE u.is_active = 1
  `

  return room
}

async function listActiveInternalUsers() {
  const rows = await prisma.$queryRaw`
    SELECT
      u.id,
      u.public_id,
      u.full_name,
      u.email,
      GROUP_CONCAT(DISTINCT ir.name ORDER BY ir.rank_order ASC SEPARATOR ', ') AS role_names
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id
    INNER JOIN internal_roles ir ON ir.id = iur.role_id
    WHERE u.is_active = 1
      AND iur.is_active = 1
      AND ir.is_active = 1
    GROUP BY u.id, u.public_id, u.full_name, u.email
    ORDER BY u.full_name ASC, u.id ASC
  `

  return rows || []
}

async function getActiveInternalUserByPublicId(userPublicId) {
  const scopedPublicId = String(userPublicId || "").trim()
  if (!scopedPublicId) return null

  const rows = await prisma.$queryRaw`
    SELECT
      u.id,
      u.public_id,
      u.full_name,
      u.email,
      GROUP_CONCAT(DISTINCT ir.name ORDER BY ir.rank_order ASC SEPARATOR ', ') AS role_names
    FROM users u
    INNER JOIN internal_user_roles iur ON iur.user_id = u.id
    INNER JOIN internal_roles ir ON ir.id = iur.role_id
    WHERE u.public_id = ${scopedPublicId}
      AND u.is_active = 1
      AND iur.is_active = 1
      AND ir.is_active = 1
    GROUP BY u.id, u.public_id, u.full_name, u.email
    LIMIT 1
  `
  return rows?.[0] || null
}

async function listRoomRowsForUser(userId) {
  return prisma.$queryRaw`
    SELECT
      rooms.id,
      rooms.public_id,
      rooms.room_type,
      rooms.name,
      rooms.description,
      rooms.system_key,
      rooms.updated_at,
      memberships.last_read_at,
      (
        SELECT MIN(other_membership.last_read_at)
        FROM internal_chat_room_members other_membership
        WHERE other_membership.room_id = rooms.id
          AND other_membership.user_id <> ${userId}
      ) AS peer_last_read_at,
      other_user.public_id AS other_user_public_id,
      other_user.full_name AS other_user_full_name,
      other_user.email AS other_user_email,
      (
        SELECT GROUP_CONCAT(DISTINCT ir.name ORDER BY ir.rank_order ASC SEPARATOR ', ')
        FROM internal_user_roles iur
        INNER JOIN internal_roles ir ON ir.id = iur.role_id
        WHERE iur.user_id = other_user.id
          AND iur.is_active = 1
          AND ir.is_active = 1
      ) AS other_user_role_names,
      (
        SELECT message.public_id
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_public_id,
      (
        SELECT message.body
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_body,
      (
        SELECT message.message_type
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_type,
      (
        SELECT message.created_at
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_created_at,
      (
        SELECT message.attachment_name
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_attachment_name,
      (
        SELECT message.attachment_mime_type
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_attachment_mime_type,
      (
        SELECT sender.full_name
        FROM internal_chat_messages message
        INNER JOIN users sender ON sender.id = message.sender_user_id
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ) AS last_message_sender_name,
      (
        SELECT COUNT(*)
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
          AND message.sender_user_id <> ${userId}
          AND message.created_at > COALESCE(memberships.last_read_at, TIMESTAMP('1970-01-01 00:00:00'))
      ) AS unread_count,
      (
        SELECT COUNT(*)
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
          AND message.is_pinned = 1
      ) AS pinned_count
    FROM internal_chat_rooms rooms
    INNER JOIN internal_chat_room_members memberships
      ON memberships.room_id = rooms.id
      AND memberships.user_id = ${userId}
    LEFT JOIN internal_chat_room_members other_member
      ON rooms.room_type = ${CHAT_ROOM_TYPE_DIRECT}
      AND other_member.room_id = rooms.id
      AND other_member.user_id <> ${userId}
    LEFT JOIN users other_user ON other_user.id = other_member.user_id
    ORDER BY COALESCE(
      (
        SELECT message.created_at
        FROM internal_chat_messages message
        WHERE message.room_id = rooms.id
        ORDER BY message.created_at DESC, message.id DESC
        LIMIT 1
      ),
      rooms.updated_at
    ) DESC,
    rooms.id DESC
  `
}

async function resolveRoomMembership({ roomPublicId, userId }) {
  const scopedRoomPublicId = String(roomPublicId || "").trim()
  if (!scopedRoomPublicId) throw notFound("Chat room was not found")

  const rows = await prisma.$queryRaw`
    SELECT
      rooms.id,
      rooms.public_id,
      rooms.room_type,
      rooms.name,
      rooms.description,
      rooms.system_key,
      memberships.last_read_at,
      (
        SELECT MIN(other_membership.last_read_at)
        FROM internal_chat_room_members other_membership
        WHERE other_membership.room_id = rooms.id
          AND other_membership.user_id <> ${userId}
      ) AS peer_last_read_at
    FROM internal_chat_rooms rooms
    INNER JOIN internal_chat_room_members memberships
      ON memberships.room_id = rooms.id
      AND memberships.user_id = ${userId}
    WHERE rooms.public_id = ${scopedRoomPublicId}
    LIMIT 1
  `

  const room = rows?.[0]
  if (!room?.id) throw notFound("Chat room was not found")
  return room
}

async function listRoomMessagesRows({ roomPublicId, userId, limit = 50 }) {
  const safeLimit = Math.max(1, Math.min(100, Number(limit || 50)))
  return prisma.$queryRaw`
    SELECT
      message.public_id,
      room.public_id AS room_public_id,
      message.message_type,
      message.body,
      message.attachment_name,
      message.attachment_mime_type,
      message.attachment_size,
      message.attachment_storage_path,
      message.reply_to_message_public_id,
      message.edited_at,
      message.deleted_at,
      message.is_pinned,
      message.pinned_at,
      message.updated_at,
      message.created_at,
      sender.public_id AS sender_public_id,
      sender.full_name AS sender_full_name,
      sender.email AS sender_email,
      pinned_by.public_id AS pinned_by_public_id,
      pinned_by.full_name AS pinned_by_full_name,
      reply.public_id AS reply_public_id,
      reply.body AS reply_body,
      reply.message_type AS reply_message_type,
      reply.deleted_at AS reply_deleted_at,
      reply.attachment_name AS reply_attachment_name,
      reply_sender.public_id AS reply_sender_public_id,
      reply_sender.full_name AS reply_sender_full_name
    FROM internal_chat_messages message
    INNER JOIN internal_chat_rooms room ON room.id = message.room_id
    INNER JOIN internal_chat_room_members membership
      ON membership.room_id = room.id
      AND membership.user_id = ${userId}
    INNER JOIN users sender ON sender.id = message.sender_user_id
    LEFT JOIN users pinned_by ON pinned_by.id = message.pinned_by_user_id
    LEFT JOIN internal_chat_messages reply ON reply.public_id = message.reply_to_message_public_id
    LEFT JOIN users reply_sender ON reply_sender.id = reply.sender_user_id
    WHERE room.public_id = ${String(roomPublicId || "").trim()}
    ORDER BY message.created_at DESC, message.id DESC
    LIMIT ${safeLimit}
  `
}

async function getMessageRowForUser({ messagePublicId, userId }) {
  const rows = await prisma.$queryRaw`
    SELECT
      message.public_id,
      room.public_id AS room_public_id,
      message.message_type,
      message.body,
      message.attachment_name,
      message.attachment_mime_type,
      message.attachment_size,
      message.attachment_storage_path,
      message.reply_to_message_public_id,
      message.edited_at,
      message.deleted_at,
      message.is_pinned,
      message.pinned_at,
      message.updated_at,
      message.created_at,
      sender.public_id AS sender_public_id,
      sender.full_name AS sender_full_name,
      sender.email AS sender_email,
      pinned_by.public_id AS pinned_by_public_id,
      pinned_by.full_name AS pinned_by_full_name,
      reply.public_id AS reply_public_id,
      reply.body AS reply_body,
      reply.message_type AS reply_message_type,
      reply.deleted_at AS reply_deleted_at,
      reply.attachment_name AS reply_attachment_name,
      reply_sender.public_id AS reply_sender_public_id,
      reply_sender.full_name AS reply_sender_full_name
    FROM internal_chat_messages message
    INNER JOIN internal_chat_rooms room ON room.id = message.room_id
    INNER JOIN internal_chat_room_members membership
      ON membership.room_id = room.id
      AND membership.user_id = ${userId}
    INNER JOIN users sender ON sender.id = message.sender_user_id
    LEFT JOIN users pinned_by ON pinned_by.id = message.pinned_by_user_id
    LEFT JOIN internal_chat_messages reply ON reply.public_id = message.reply_to_message_public_id
    LEFT JOIN users reply_sender ON reply_sender.id = reply.sender_user_id
    WHERE message.public_id = ${String(messagePublicId || "").trim()}
    LIMIT 1
  `
  return rows?.[0] || null
}

async function touchRoomReadState({ roomId, userId }) {
  await prisma.$executeRaw`
    UPDATE internal_chat_room_members
    SET last_read_at = CURRENT_TIMESTAMP(3)
    WHERE room_id = ${roomId}
      AND user_id = ${userId}
  `
}

async function listRoomMemberUserIds(roomId) {
  const rows = await prisma.$queryRaw`
    SELECT user_id
    FROM internal_chat_room_members
    WHERE room_id = ${roomId}
  `
  return (rows || [])
    .map((row) => Number(row.user_id || 0))
    .filter((value) => Number.isFinite(value) && value > 0)
}

async function getRoomSummaryForUser({ roomPublicId, userId }) {
  const roomRows = await listRoomRowsForUser(userId)
  const room = (roomRows || []).find((row) => String(row.public_id || "").trim() === String(roomPublicId || "").trim())
  return room ? mapChatRoomRow(room) : null
}

async function getRoomSummaryByIdForUser({ roomId, userId }) {
  const rows = await listRoomRowsForUser(userId)
  const room = (rows || []).find((row) => Number(row.id || 0) === Number(roomId || 0))
  return room ? mapChatRoomRow(room) : null
}

async function getMessageMutationRowForUser({ roomPublicId, messagePublicId, userId }) {
  const rows = await prisma.$queryRaw`
    SELECT
      message.id,
      message.public_id,
      message.room_id,
      room.public_id AS room_public_id,
      message.sender_user_id,
      message.message_type,
      message.body,
      message.attachment_name,
      message.attachment_mime_type,
      message.attachment_size,
      message.attachment_storage_path,
      message.reply_to_message_public_id,
      message.deleted_at,
      message.is_pinned
    FROM internal_chat_messages message
    INNER JOIN internal_chat_rooms room ON room.id = message.room_id
    INNER JOIN internal_chat_room_members membership
      ON membership.room_id = room.id
      AND membership.user_id = ${userId}
    WHERE room.public_id = ${String(roomPublicId || "").trim()}
      AND message.public_id = ${String(messagePublicId || "").trim()}
    LIMIT 1
  `

  return rows?.[0] || null
}

async function resolveReplyTargetMessage({ roomId, replyToMessagePublicId }) {
  const scopedReplyPublicId = String(replyToMessagePublicId || "").trim()
  if (!scopedReplyPublicId) return null

  const rows = await prisma.$queryRaw`
    SELECT public_id
    FROM internal_chat_messages
    WHERE room_id = ${roomId}
      AND public_id = ${scopedReplyPublicId}
    LIMIT 1
  `

  const row = rows?.[0] || null
  if (!row?.public_id) throw notFound("Reply target message was not found")
  return String(row.public_id || "").trim()
}

async function ensureDirectRoom({ userId, peerUserId }) {
  const directKey = buildDirectRoomKey(userId, peerUserId)
  let rows = await prisma.$queryRaw`
    SELECT id, public_id
    FROM internal_chat_rooms
    WHERE direct_key = ${directKey}
    LIMIT 1
  `

  let room = rows?.[0] || null
  if (!room?.id) {
    const publicId = createPublicId()
    await prisma.$executeRaw`
      INSERT INTO internal_chat_rooms (
        public_id,
        room_type,
        direct_key,
        created_by_user_id
      )
      VALUES (
        ${publicId},
        ${CHAT_ROOM_TYPE_DIRECT},
        ${directKey},
        ${userId}
      )
    `

    rows = await prisma.$queryRaw`
      SELECT id, public_id
      FROM internal_chat_rooms
      WHERE direct_key = ${directKey}
      LIMIT 1
    `
    room = rows?.[0] || null
  }

  if (!room?.id) throw new Error("Failed to create a direct chat room")

  await prisma.$executeRaw`
    INSERT IGNORE INTO internal_chat_room_members (
      room_id,
      user_id,
      member_role
    )
    VALUES
      (${room.id}, ${userId}, 'MEMBER'),
      (${room.id}, ${peerUserId}, 'MEMBER')
  `

  return room
}

async function publishRoomEventToMembers({ roomId, roomPublicId, eventType, message }) {
  const memberIds = await listRoomMemberUserIds(roomId)
  await Promise.all(
    memberIds.map(async (memberUserId) => {
      const room = await getRoomSummaryForUser({ roomPublicId, userId: memberUserId })
      if (!room) return
      publishInternalChatEvent({
        userId: memberUserId,
        eventType,
        data: {
          room,
          message,
        },
      })
    })
  )
}

async function writeAttachmentToDisk({ messagePublicId, attachment }) {
  if (!attachment) return null

  await fs.mkdir(ATTACHMENTS_DIR, { recursive: true })
  const originalExtension = sanitizeExtension(path.extname(attachment.name))
  const fileName = `${messagePublicId}${originalExtension || ".bin"}`
  const relativePath = path.posix.join("internal-chat-attachments", fileName)
  const absolutePath = path.join(ATTACHMENTS_DIR, fileName)
  await fs.writeFile(absolutePath, attachment.buffer)

  return {
    relativePath,
    absolutePath,
  }
}

function resolveAttachmentAbsolutePath(relativePath) {
  const scopedRelativePath = String(relativePath || "").trim()
  if (!scopedRelativePath) return null
  return path.resolve(path.dirname(ATTACHMENTS_DIR), scopedRelativePath)
}

export async function getInternalChatBootstrap(actor) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  if (!Number.isFinite(userId) || userId <= 0) throw badRequest("Missing internal user")

  const [users, rooms] = await Promise.all([listActiveInternalUsers(), listRoomRowsForUser(userId)])
  const groupRoom = (rooms || []).find((room) => String(room.system_key || "").trim() === DEFAULT_GROUP_ROOM_KEY)

  return {
    rooms: (rooms || []).map(mapChatRoomRow),
    users: users.map((row) => mapChatUserRow(row, userId)),
    groupRoomPublicId: groupRoom?.public_id || null,
  }
}

export async function getDirectRoom(actor, peerUserPublicId) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const peer = await getActiveInternalUserByPublicId(peerUserPublicId)
  if (!peer?.id) throw notFound("The selected internal user was not found")
  if (Number(peer.id) === userId) throw badRequest("You cannot start a direct chat with yourself")

  const room = await ensureDirectRoom({ userId, peerUserId: Number(peer.id) })
  const roomSummary = await getRoomSummaryByIdForUser({ roomId: room.id, userId })
  if (!roomSummary) throw new Error("Failed to load the direct chat room")
  return roomSummary
}

export async function getRoomMessages({ actor, roomPublicId, limit = 50 }) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const room = await resolveRoomMembership({ roomPublicId, userId })
  const rows = await listRoomMessagesRows({ roomPublicId, userId, limit })
  await touchRoomReadState({ roomId: room.id, userId })

  const roomSummary = await getRoomSummaryForUser({ roomPublicId, userId })

  return {
    room: roomSummary,
    messages: [...(rows || [])].reverse().map(mapChatMessageRow),
  }
}

export async function createChatMessage({ actor, roomPublicId, body, attachment = null, replyToMessagePublicId = null }) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const messageBody = normalizeMessageBody(body)
  const normalizedAttachment = normalizeAttachmentPayload(attachment)

  if (!messageBody && !normalizedAttachment) {
    throw badRequest("Message body or document is required")
  }

  const room = await resolveRoomMembership({ roomPublicId, userId })
  if (String(room.system_key || "").trim() === DEFAULT_GROUP_ROOM_KEY) {
    await ensureDefaultGroupRoom()
  }

  const replyTargetPublicId = await resolveReplyTargetMessage({
    roomId: room.id,
    replyToMessagePublicId,
  })

  const messagePublicId = createPublicId()
  const messageType = resolveMessageType({
    hasBody: Boolean(messageBody),
    hasAttachment: Boolean(normalizedAttachment),
  })
  let storedAttachment = null

  if (normalizedAttachment) {
    storedAttachment = await writeAttachmentToDisk({
      messagePublicId,
      attachment: normalizedAttachment,
    })
  }

  try {
    await prisma.$executeRaw`
      INSERT INTO internal_chat_messages (
        public_id,
        room_id,
        sender_user_id,
        message_type,
        body,
        attachment_name,
        attachment_mime_type,
        attachment_size,
        attachment_storage_path,
        attachment_base64,
        reply_to_message_public_id
      )
      VALUES (
        ${messagePublicId},
        ${room.id},
        ${userId},
        ${messageType},
        ${messageBody || null},
        ${normalizedAttachment?.name || null},
        ${normalizedAttachment?.mimeType || null},
        ${normalizedAttachment?.size || null},
        ${storedAttachment?.relativePath || null},
        ${null},
        ${replyTargetPublicId || null}
      )
    `
  } catch (error) {
    if (storedAttachment?.absolutePath) {
      await fs.unlink(storedAttachment.absolutePath).catch(() => {})
    }
    throw error
  }

  await prisma.$executeRaw`
    UPDATE internal_chat_rooms
    SET updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${room.id}
  `
  await touchRoomReadState({ roomId: room.id, userId })

  const createdMessageRow = await getMessageRowForUser({ messagePublicId, userId })
  if (!createdMessageRow?.public_id) throw new Error("Failed to load the new chat message")

  const roomSummary = await getRoomSummaryForUser({ roomPublicId, userId })
  const message = mapChatMessageRow(createdMessageRow)

  await publishRoomEventToMembers({
    roomId: room.id,
    roomPublicId,
    eventType: "internal_chat:message_created",
    message,
  })

  return {
    room: roomSummary,
    message,
  }
}

export async function setChatMessagePinnedState({ actor, roomPublicId, messagePublicId, pinned }) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const room = await resolveRoomMembership({ roomPublicId, userId })
  if (String(room.room_type || "").trim().toUpperCase() !== CHAT_ROOM_TYPE_GROUP) {
    throw badRequest("Pinned messages are only supported in the group chat")
  }
  if (!pinned && String(actor?.primaryRole || "").trim().toUpperCase() !== "PLATFORM_OWNER") {
    throw badRequest("Only the CEO can unpin pinned messages.")
  }

  const messageTarget = await getMessageMutationRowForUser({ roomPublicId, messagePublicId, userId })
  if (!messageTarget?.public_id) throw notFound("Chat message was not found")
  if (messageTarget.deleted_at) {
    throw badRequest("Deleted messages cannot be pinned or unpinned.")
  }

  if (pinned) {
    await prisma.$executeRaw`
      UPDATE internal_chat_messages
      SET
        is_pinned = 1,
        pinned_at = CURRENT_TIMESTAMP(3),
        pinned_by_user_id = ${userId},
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${String(messagePublicId || "").trim()}
        AND room_id = ${room.id}
    `
  } else {
    await prisma.$executeRaw`
      UPDATE internal_chat_messages
      SET
        is_pinned = 0,
        pinned_at = NULL,
        pinned_by_user_id = NULL,
        updated_at = CURRENT_TIMESTAMP(3)
      WHERE public_id = ${String(messagePublicId || "").trim()}
        AND room_id = ${room.id}
    `
  }

  const messageRow = await getMessageRowForUser({ messagePublicId, userId })
  if (!messageRow?.public_id) throw notFound("Chat message was not found")

  const message = mapChatMessageRow(messageRow)
  const roomSummary = await getRoomSummaryForUser({ roomPublicId, userId })

  await publishRoomEventToMembers({
    roomId: room.id,
    roomPublicId,
    eventType: "internal_chat:message_updated",
    message,
  })

  return {
    room: roomSummary,
    message,
  }
}

export async function updateChatMessage({ actor, roomPublicId, messagePublicId, body }) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const room = await resolveRoomMembership({ roomPublicId, userId })
  const messageTarget = await getMessageMutationRowForUser({ roomPublicId, messagePublicId, userId })
  if (!messageTarget?.public_id) throw notFound("Chat message was not found")
  if (Number(messageTarget.sender_user_id || 0) !== userId) {
    throw badRequest("Only the sender can edit this message.")
  }
  if (messageTarget.deleted_at) {
    throw badRequest("Deleted messages cannot be edited.")
  }

  const nextBody = normalizeMessageBody(body)
  if (!nextBody && !messageTarget.attachment_name) {
    throw badRequest("Message body cannot be empty.")
  }

  const nextMessageType = resolveMessageType({
    hasBody: Boolean(nextBody),
    hasAttachment: Boolean(messageTarget.attachment_name),
  })

  await prisma.$executeRaw`
    UPDATE internal_chat_messages
    SET
      body = ${nextBody || null},
      message_type = ${nextMessageType},
      edited_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${String(messagePublicId || "").trim()}
      AND room_id = ${room.id}
  `

  await prisma.$executeRaw`
    UPDATE internal_chat_rooms
    SET updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${room.id}
  `

  const messageRow = await getMessageRowForUser({ messagePublicId, userId })
  if (!messageRow?.public_id) throw notFound("Chat message was not found")
  const message = mapChatMessageRow(messageRow)
  const roomSummary = await getRoomSummaryForUser({ roomPublicId, userId })

  await publishRoomEventToMembers({
    roomId: room.id,
    roomPublicId,
    eventType: "internal_chat:message_updated",
    message,
  })

  return {
    room: roomSummary,
    message,
  }
}

export async function deleteChatMessage({ actor, roomPublicId, messagePublicId }) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const room = await resolveRoomMembership({ roomPublicId, userId })
  const messageTarget = await getMessageMutationRowForUser({ roomPublicId, messagePublicId, userId })
  if (!messageTarget?.public_id) throw notFound("Chat message was not found")
  if (Number(messageTarget.sender_user_id || 0) !== userId) {
    throw badRequest("Only the sender can delete this message.")
  }
  if (messageTarget.deleted_at) {
    throw badRequest("Message is already deleted.")
  }

  const storagePath = resolveAttachmentAbsolutePath(messageTarget.attachment_storage_path)

  await prisma.$executeRaw`
    UPDATE internal_chat_messages
    SET
      message_type = 'TEXT',
      body = NULL,
      attachment_name = NULL,
      attachment_mime_type = NULL,
      attachment_size = NULL,
      attachment_storage_path = NULL,
      attachment_base64 = NULL,
      is_pinned = 0,
      pinned_at = NULL,
      pinned_by_user_id = NULL,
      deleted_at = CURRENT_TIMESTAMP(3),
      updated_at = CURRENT_TIMESTAMP(3)
    WHERE public_id = ${String(messagePublicId || "").trim()}
      AND room_id = ${room.id}
  `

  if (storagePath) {
    await fs.unlink(storagePath).catch(() => {})
  }

  await prisma.$executeRaw`
    UPDATE internal_chat_rooms
    SET updated_at = CURRENT_TIMESTAMP(3)
    WHERE id = ${room.id}
  `

  const messageRow = await getMessageRowForUser({ messagePublicId, userId })
  if (!messageRow?.public_id) throw notFound("Chat message was not found")
  const message = mapChatMessageRow(messageRow)
  const roomSummary = await getRoomSummaryForUser({ roomPublicId, userId })

  await publishRoomEventToMembers({
    roomId: room.id,
    roomPublicId,
    eventType: "internal_chat:message_updated",
    message,
  })

  return {
    room: roomSummary,
    message,
  }
}

export async function getChatMessageDocument({ actor, messagePublicId }) {
  await ensureDefaultGroupRoom()

  const userId = Number(actor?.userId || 0)
  const rows = await prisma.$queryRaw`
    SELECT
      message.attachment_name,
      message.attachment_mime_type,
      message.attachment_storage_path,
      message.attachment_base64,
      message.deleted_at
    FROM internal_chat_messages message
    INNER JOIN internal_chat_rooms room ON room.id = message.room_id
    INNER JOIN internal_chat_room_members membership
      ON membership.room_id = room.id
      AND membership.user_id = ${userId}
    WHERE message.public_id = ${String(messagePublicId || "").trim()}
    LIMIT 1
  `

  const row = rows?.[0]
  if (row?.deleted_at) throw notFound("Chat document was not found")
  const storagePath = resolveAttachmentAbsolutePath(row?.attachment_storage_path)
  if (storagePath) {
    try {
      return {
        fileName: sanitizeFileName(row.attachment_name) || "document",
        mimeType: String(row.attachment_mime_type || "application/octet-stream").trim() || "application/octet-stream",
        buffer: await fs.readFile(storagePath),
      }
    } catch {
      // Fall through to legacy DB-backed attachment lookup.
    }
  }

  if (!row?.attachment_name || !row?.attachment_base64) {
    throw notFound("Document was not found")
  }

  return {
    fileName: sanitizeFileName(row.attachment_name) || "document",
    mimeType: String(row.attachment_mime_type || "application/octet-stream").trim() || "application/octet-stream",
    buffer: Buffer.from(String(row.attachment_base64 || ""), "base64"),
  }
}
