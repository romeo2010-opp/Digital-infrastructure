import { useEffect, useRef, useState } from "react"
import { useInternalAuth } from "../auth/AuthContext"

function resolveWsUrl(accessToken) {
  const base = import.meta.env.VITE_API_BASE_URL || window.location.origin
  const url = new URL(base, window.location.origin)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws/internal-chat"
  url.searchParams.set("accessToken", accessToken)
  return url.toString()
}

function trimPreview(value, maxLength = 120) {
  const normalized = String(value || "").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function resolveAttachmentKind(message) {
  const mimeType = String(message?.document?.mimeType || "").trim().toLowerCase()
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "document"
}

function summarizeToastMessage(message) {
  if (!message) return "New message received"
  if (message.isDeleted) return "Message deleted"
  if (message.body) return trimPreview(message.body, 120)
  if (message.document?.fileName) {
    const attachmentKind = resolveAttachmentKind(message)
    if (attachmentKind === "image") return `Photo shared: ${message.document.fileName}`
    if (attachmentKind === "video") return `Video shared: ${message.document.fileName}`
    if (attachmentKind === "audio") return `Voice note shared: ${message.document.fileName}`
    return `File shared: ${message.document.fileName}`
  }
  return "New message received"
}

function initialsForToast(value) {
  const parts = String(value || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)

  if (!parts.length) return "SL"
  return parts.map((part) => part.charAt(0).toUpperCase()).join("")
}

export default function InternalChatToasts() {
  const { isAuthenticated, session, hasPermission } = useInternalAuth()
  const [incomingToasts, setIncomingToasts] = useState([])
  const toastTimeoutsRef = useRef({})

  function dismissToast(toastId) {
    setIncomingToasts((current) => current.filter((toast) => toast.id !== toastId))
    if (toastTimeoutsRef.current[toastId]) {
      window.clearTimeout(toastTimeoutsRef.current[toastId])
      delete toastTimeoutsRef.current[toastId]
    }
  }

  function pushIncomingToast(room, message) {
    const toastId = `${room?.publicId || "room"}:${message?.publicId || Date.now()}`
    const nextToast = {
      id: toastId,
      title: room?.name || message?.sender?.fullName || "New message",
      sender: message?.sender?.fullName || "Internal User",
      body: summarizeToastMessage(message),
    }

    setIncomingToasts((current) => {
      const withoutDuplicate = current.filter((toast) => toast.id !== toastId)
      return [nextToast, ...withoutDuplicate].slice(0, 4)
    })

    if (toastTimeoutsRef.current[toastId]) {
      window.clearTimeout(toastTimeoutsRef.current[toastId])
    }
    toastTimeoutsRef.current[toastId] = window.setTimeout(() => {
      dismissToast(toastId)
    }, 4800)
  }

  useEffect(() => {
    return () => {
      Object.values(toastTimeoutsRef.current).forEach((timeoutId) => window.clearTimeout(timeoutId))
      toastTimeoutsRef.current = {}
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated || !hasPermission("chat:view") || !session?.accessToken) return undefined

    let socket = null
    let reconnectTimer = null
    let disposed = false

    function connect() {
      if (disposed) return
      socket = new WebSocket(resolveWsUrl(session.accessToken))

      socket.onclose = () => {
        if (disposed) return
        reconnectTimer = window.setTimeout(connect, 3000)
      }

      socket.onerror = () => {
        if (socket) socket.close()
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload?.type !== "internal_chat:message_created") return
          const room = payload?.data?.room
          const message = payload?.data?.message
          if (!room?.publicId || !message?.publicId) return
          if (message?.sender?.publicId === session?.profile?.user?.publicId) return
          pushIncomingToast(room, message)
        } catch {
          // Ignore malformed websocket payloads.
        }
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (socket) socket.close()
    }
  }, [hasPermission, isAuthenticated, session?.accessToken, session?.profile?.user?.publicId])

  if (!incomingToasts.length) return null

  return (
    <div className="team-chat-toast-stack" aria-live="polite" aria-atomic="true">
      {incomingToasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          className="team-chat-toast"
          onClick={() => dismissToast(toast.id)}
        >
          <i className="team-chat-toast-glow" aria-hidden="true" />
          <div className="team-chat-toast-head">
            <span className="team-chat-toast-avatar" aria-hidden="true">
              {initialsForToast(toast.sender || toast.title)}
            </span>
            <div className="team-chat-toast-copy">
              <strong>{toast.title}</strong>
              <span>{toast.sender}</span>
              <p>{toast.body}</p>
            </div>
          </div>
          <i className="team-chat-toast-progress" aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
