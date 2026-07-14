import crypto from "crypto"
import { URL } from "url"
import { verifySessionToken } from "../middleware/auth.js"
import { getPortalPacket, normalizePortalPacketKeys } from "./portalPackets.js"

const WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
const PUSH_INTERVAL_MS = 30000
const schoolDashboardRoles = new Set(["school_owner", "headteacher", "teacher", "bursar", "librarian", "super_admin"])
const schoolResourceRoles = new Set(["school_owner", "headteacher", "teacher", "bursar", "librarian", "parent", "student", "super_admin"])
const portalResources = new Set(["preferences", "schoolData", "studentPortal", "timetables", "examLab"])
const portalClients = new Map()

function acceptKey(key) {
  return crypto.createHash("sha1").update(`${key}${WS_MAGIC}`).digest("base64")
}

function sendFrame(socket, payload) {
  if (!socket.writable) return
  const body = Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
  const header = []
  header.push(0x81)
  if (body.length < 126) {
    header.push(body.length)
  } else if (body.length < 65536) {
    header.push(126, (body.length >> 8) & 0xff, body.length & 0xff)
  } else {
    header.push(127, 0, 0, 0, 0, (body.length >> 24) & 0xff, (body.length >> 16) & 0xff, (body.length >> 8) & 0xff, body.length & 0xff)
  }
  socket.write(Buffer.concat([Buffer.from(header), body]))
}

function normalizeId(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

function userRole(user) {
  return String(user?.role || "").toLowerCase()
}

function packetKeysForUser(user, keys = []) {
  const requestedKeys = normalizePortalPacketKeys(keys)
  const role = userRole(user)
  return requestedKeys.filter((key) => {
    if (key === "studentPortal") return role === "student"
    if (key === "schoolDashboard") return schoolDashboardRoles.has(role)
    return false
  })
}

function normalizePortalResources(resources = []) {
  const raw = Array.isArray(resources) ? resources : String(resources || "").split(",")
  return [...new Set(raw.map((resource) => String(resource || "").trim()).filter((resource) => portalResources.has(resource)))]
}

function resourcesForUser(user, resources = []) {
  const role = userRole(user)
  return normalizePortalResources(resources).filter((resource) => {
    if (resource === "preferences") return true
    if (resource === "examLab") return role === "super_admin"
    if (resource === "studentPortal") return role === "student"
    if (resource === "schoolData" || resource === "timetables") return schoolResourceRoles.has(role)
    return false
  })
}

function matchesScope(user, { schoolId = null, userId = null } = {}) {
  const scopedUserId = normalizeId(userId)
  const scopedSchoolId = normalizeId(schoolId)
  const currentRole = userRole(user)
  if (scopedUserId && normalizeId(user?.id) !== scopedUserId) return false
  if (!scopedSchoolId || currentRole === "super_admin") return true
  return normalizeId(user?.schoolId) === scopedSchoolId
}

export function broadcastPortalInvalidation({
  schoolId = null,
  userId = null,
  keys = [],
  resources = [],
  reason = "mutation",
  actorUserId = null,
} = {}) {
  const requestedKeys = normalizePortalPacketKeys(keys)
  const requestedResources = normalizePortalResources(resources)
  const at = new Date().toISOString()
  let sent = 0

  portalClients.forEach((client, socket) => {
    if (!socket.writable || socket.destroyed) {
      portalClients.delete(socket)
      return
    }
    if (!matchesScope(client.user, { schoolId, userId })) return

    const permittedKeys = packetKeysForUser(client.user, requestedKeys)
    const permittedResources = resourcesForUser(client.user, requestedResources)
    if (!permittedKeys.length && !permittedResources.length) return

    try {
      sendFrame(socket, {
        type: "mera_portal_invalidate",
        keys: permittedKeys,
        resources: permittedResources,
        reason,
        actorUserId: normalizeId(actorUserId),
        at,
      })
      sent += 1
    } catch {
      portalClients.delete(socket)
      try {
        socket.destroy()
      } catch {
        // noop
      }
    }
  })

  return { sent }
}

export function broadcastUserEvent({ schoolId, userId, type, data }) {
  let sent = 0
  portalClients.forEach((client, socket) => {
    if (!socket.writable || socket.destroyed || !matchesScope(client.user, { schoolId, userId })) return
    try { sendFrame(socket, { type, data, at: new Date().toISOString() }); sent += 1 } catch { portalClients.delete(socket) }
  })
  return { sent }
}

function sendClose(socket, code = 1000, reason = "") {
  if (!socket.writable) return
  const reasonBuffer = Buffer.from(reason)
  const body = Buffer.alloc(2 + reasonBuffer.length)
  body.writeUInt16BE(code, 0)
  reasonBuffer.copy(body, 2)
  const header = body.length < 126 ? Buffer.from([0x88, body.length]) : Buffer.from([0x88, 0])
  socket.write(Buffer.concat([header, body]))
}

function decodeFrame(buffer) {
  if (buffer.length < 2) return null
  const opcode = buffer[0] & 0x0f
  const masked = Boolean(buffer[1] & 0x80)
  let length = buffer[1] & 0x7f
  let offset = 2
  if (length === 126) {
    if (buffer.length < 4) return null
    length = buffer.readUInt16BE(2)
    offset = 4
  } else if (length === 127) {
    if (buffer.length < 10) return null
    const high = buffer.readUInt32BE(2)
    const low = buffer.readUInt32BE(6)
    length = high * 2 ** 32 + low
    offset = 10
  }
  const mask = masked ? buffer.subarray(offset, offset + 4) : null
  if (masked) offset += 4
  if (buffer.length < offset + length) return null
  const payload = Buffer.from(buffer.subarray(offset, offset + length))
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % 4]
    }
  }
  return { opcode, text: payload.toString("utf8"), consumed: offset + length }
}

function writeHttpResponse(socket, status, message) {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`)
  socket.destroy()
}

async function sendPackets(socket, user, message = {}) {
  const keys = normalizePortalPacketKeys(message.keys)
  const paramsByKey = message.paramsByKey && typeof message.paramsByKey === "object" ? message.paramsByKey : {}
  const requestId = String(message.requestId || "")
  const forbidden = []
  const errors = []

  sendFrame(socket, { type: "mera_portal_packets_ready", requestId, keys })

  await Promise.all(keys.map(async (key) => {
    try {
      const data = await getPortalPacket(user, key, paramsByKey[key] || {})
      sendFrame(socket, { type: "mera_portal_packet", requestId, key, status: "ready", data })
    } catch (error) {
      const status = Number(error?.status || 500)
      if (status === 403) forbidden.push(key)
      errors.push({ key, error: error?.message || "Unable to load realtime packet." })
      sendFrame(socket, { type: "mera_portal_packet", requestId, key, status: status === 403 ? "forbidden" : "error", error: error?.message || "Unable to load realtime packet." })
    }
  }))

  sendFrame(socket, { type: "mera_portal_packets_complete", requestId, keys, forbidden, errors })
}

export function attachPortalWebSocketServer(server) {
  server.on("upgrade", (req, socket) => {
    let url
    try {
      url = new URL(req.url || "", "http://localhost")
    } catch {
      writeHttpResponse(socket, 400, "Bad Request")
      return
    }

    if (url.pathname !== "/ws/mera-dashboard") {
      writeHttpResponse(socket, 404, "Not Found")
      return
    }

    const key = req.headers["sec-websocket-key"]
    if (!key) {
      writeHttpResponse(socket, 400, "Bad Request")
      return
    }

    let user
    try {
      const token = url.searchParams.get("accessToken") || ""
      user = verifySessionToken(token)
      if (user.mustChangePassword) throw new Error("Password change required")
    } catch {
      socket.write(
        [
          "HTTP/1.1 401 Unauthorized",
          "Connection: close",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n"),
      )
      socket.destroy()
      return
    }

    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptKey(String(key))}`,
        "",
        "",
      ].join("\r\n"),
    )

    let buffered = Buffer.alloc(0)
    const client = { user, connectedAt: Date.now() }
    portalClients.set(socket, client)
    const pushTimer = setInterval(() => {
      const role = String(user.role || "").toLowerCase()
      const keys = role === "student" ? ["studentPortal"] : schoolDashboardRoles.has(role) ? ["schoolDashboard"] : []
      if (!keys.length) return
      sendFrame(socket, { type: "mera_portal_invalidate", keys, reason: "server-push" })
    }, PUSH_INTERVAL_MS)

    socket.on("data", (chunk) => {
      buffered = Buffer.concat([buffered, chunk])
      let frame = decodeFrame(buffered)
      while (frame) {
        buffered = buffered.subarray(frame.consumed)
        if (frame.opcode === 0x8) {
          sendClose(socket)
          socket.end()
          return
        }
        if (frame.opcode === 0x9) {
          sendFrame(socket, { type: "pong", at: new Date().toISOString() })
        } else if (frame.opcode === 0x1) {
          try {
            const message = JSON.parse(frame.text || "{}")
            if (message.type === "ping") {
              sendFrame(socket, { type: "pong", at: new Date().toISOString() })
            } else if (message.type === "mera_portal_packets_request") {
              sendPackets(socket, user, message).catch((error) => {
                sendFrame(socket, { type: "mera_portal_packets_complete", requestId: message.requestId, errors: [{ message: error?.message || "Realtime packet request failed." }] })
              })
            }
          } catch {
            sendFrame(socket, { type: "error", error: "Malformed realtime message." })
          }
        }
        frame = decodeFrame(buffered)
      }
    })

    function cleanup() {
      clearInterval(pushTimer)
      portalClients.delete(socket)
    }

    socket.on("close", cleanup)
    socket.on("error", cleanup)
  })
}
