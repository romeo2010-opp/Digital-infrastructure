import { useEffect, useMemo, useRef, useState } from "react"
import InternalShell from "../components/InternalShell"
import { internalApi } from "../api/internalApi"
import { useInternalAuth } from "../auth/AuthContext"
import { useAppShell } from "../layout/AppShellContext"
import { formatRelative, formatTime } from "../utils/display"

const ATTACHMENT_ACCEPT =
  "image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.ppt,.pptx,.zip,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/csv"
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const MESSAGE_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, { month: "numeric", day: "numeric", year: "numeric" })
const TEAM_CHAT_THEME_STORAGE_KEY = "smartlink.internal.teamChatTheme"

function resolveWsUrl(accessToken) {
  const base = import.meta.env.VITE_API_BASE_URL || window.location.origin
  const url = new URL(base, window.location.origin)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/ws/internal-chat"
  url.searchParams.set("accessToken", accessToken)
  return url.toString()
}

function roomSortValue(room) {
  return new Date(room?.lastMessage?.createdAt || room?.updatedAt || 0).getTime()
}

function summarizeRoomPreview(room) {
  if (room?.lastMessage?.body) return room.lastMessage.body
  if (room?.lastMessage?.document?.mimeType) {
    return `${attachmentLabelForMimeType(room.lastMessage.document.mimeType)} shared`
  }
  if (room?.lastMessage?.messageType === "DOCUMENT" || room?.lastMessage?.messageType === "TEXT_DOCUMENT") {
    return "File shared"
  }
  if (room?.roomType === "GROUP") return room?.description || "Shared workspace updates and pinned notices."
  return room?.otherUser?.email || "Direct thread ready"
}

function sortRooms(nextRooms) {
  return [...(nextRooms || [])].sort((left, right) => {
    const leftGroup = left?.systemKey === "ALL_INTERNALS" ? 1 : 0
    const rightGroup = right?.systemKey === "ALL_INTERNALS" ? 1 : 0
    if (leftGroup !== rightGroup) return rightGroup - leftGroup
    return roomSortValue(right) - roomSortValue(left)
  })
}

function mergeRoomSummary(currentRooms, nextRoom) {
  if (!nextRoom?.publicId) return sortRooms(currentRooms)
  const index = (currentRooms || []).findIndex((room) => room.publicId === nextRoom.publicId)
  if (index === -1) return sortRooms([...(currentRooms || []), nextRoom])
  const merged = [...currentRooms]
  merged[index] = {
    ...merged[index],
    ...nextRoom,
    otherUser: nextRoom.otherUser || merged[index].otherUser,
    lastMessage: nextRoom.lastMessage || merged[index].lastMessage,
  }
  return sortRooms(merged)
}

function mergeMessageList(existingMessages, incomingMessage) {
  if (!incomingMessage?.publicId) return existingMessages || []
  const current = Array.isArray(existingMessages) ? [...existingMessages] : []
  const index = current.findIndex((message) => message.publicId === incomingMessage.publicId)
  if (index === -1) current.push(incomingMessage)
  else current[index] = { ...current[index], ...incomingMessage }
  return current.sort((left, right) => new Date(left.createdAt || 0).getTime() - new Date(right.createdAt || 0).getTime())
}

function initialsForUser(user) {
  return String(user?.fullName || "")
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((chunk) => chunk[0]?.toUpperCase() || "")
    .join("") || "SL"
}

function normalizeRoleLabel(user) {
  return user?.primaryRoleLabel || user?.roleLabels?.[0] || "Internal team"
}

function matchesSearch(value, searchTerm) {
  if (!searchTerm) return true
  return String(value || "").toLowerCase().includes(searchTerm.toLowerCase())
}

function summarizePinnedMessage(message) {
  if (message?.body) return message.body
  if (message?.document?.fileName) return message.document.fileName
  return "Pinned update"
}

function describeSocketState(socketState) {
  if (socketState === "LIVE") return "Realtime relay active"
  if (socketState === "RECONNECTING") return "Restoring live sync"
  return "Opening live relay"
}

function trimPreview(value, maxLength = 84) {
  const normalized = String(value || "").trim()
  if (!normalized) return ""
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

function resolveAttachmentKind(value) {
  const mimeType = String(value?.mimeType || "").trim().toLowerCase()
  if (mimeType.startsWith("image/")) return "image"
  if (mimeType.startsWith("video/")) return "video"
  if (mimeType.startsWith("audio/")) return "audio"
  return "document"
}

function attachmentLabelForMimeType(mimeType) {
  const kind = resolveAttachmentKind({ mimeType })
  if (kind === "image") return "Photo"
  if (kind === "video") return "Video"
  if (kind === "audio") return "Voice note"
  return "File"
}

function formatAttachmentSize(value) {
  const size = Number(value || 0)
  if (!Number.isFinite(size) || size <= 0) return "Unknown size"
  if (size >= 1024 * 1024) {
    const mb = size / (1024 * 1024)
    return `${mb >= 10 ? mb.toFixed(0) : mb.toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(size / 1024))} KB`
}

function formatMessageDay(value) {
  const date = new Date(value || 0)
  if (Number.isNaN(date.getTime())) return ""
  return MESSAGE_DAY_FORMATTER.format(date)
}

function messageDayKey(value) {
  const date = new Date(value || 0)
  if (Number.isNaN(date.getTime())) return "unknown-day"
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
}

function buildMessageTimeline(messages) {
  const timeline = []
  let currentDayKey = ""
  ;(messages || []).forEach((message, index) => {
    const nextDayKey = messageDayKey(message.createdAt)
    if (nextDayKey !== currentDayKey) {
      currentDayKey = nextDayKey
      timeline.push({
        type: "day",
        key: `day-${nextDayKey}-${index}`,
        label: formatMessageDay(message.createdAt),
      })
    }
    timeline.push({
      type: "message",
      key: message.publicId || `message-${index}`,
      message,
    })
  })
  return timeline
}

function RoomCard({ room, active, onSelect, accent = "direct" }) {
  return (
    <button
      type="button"
      className={`team-chat-room-card team-chat-room-card--${accent} ${room.unreadCount ? "team-chat-room-card--unread" : "team-chat-room-card--read"} ${active ? "active" : ""}`}
      onClick={onSelect}
    >
      <div className={`team-chat-room-avatar ${accent === "group" ? "team-chat-room-avatar--group" : ""}`}>
        {accent === "group" ? "HQ" : initialsForUser(room.otherUser || room)}
      </div>
      <div className="team-chat-room-copy">
        <div className="team-chat-room-heading">
          <strong>{room.name}</strong>
          <span>{room.lastMessage?.createdAt ? formatRelative(room.lastMessage.createdAt) : "New room"}</span>
        </div>
        <p>{summarizeRoomPreview(room)}</p>
      </div>
      {room.unreadCount ? <span className="team-chat-unread">{room.unreadCount}</span> : null}
    </button>
  )
}

function MessageDayDivider({ label }) {
  return (
    <div className="team-chat-day-divider" role="separator" aria-label={label}>
      <span>{label}</span>
    </div>
  )
}

function isMessageReadByPeers(message, room) {
  if (!message?.createdAt || !room?.peerLastReadAt) return false
  const messageTime = new Date(message.createdAt).getTime()
  const peerReadTime = new Date(room.peerLastReadAt).getTime()
  if (!Number.isFinite(messageTime) || !Number.isFinite(peerReadTime)) return false
  return messageTime <= peerReadTime
}

function summarizeReplyPreview(message) {
  if (!message) return "Original message"
  if (message.deletedAt) return "Message deleted"
  if (message.document?.fileName) return `${attachmentLabelForMimeType(message.document.mimeType)} · ${message.document.fileName}`
  return trimPreview(message.body || "Original message", 72)
}

function InlineAttachment({
  message,
  attachment,
  onDownloadDocument,
  downloading,
}) {
  const attachmentKind = resolveAttachmentKind(attachment)
  const [objectUrl, setObjectUrl] = useState("")
  const [loading, setLoading] = useState(attachmentKind !== "document")
  const [error, setError] = useState("")

  useEffect(() => {
    if (!message?.publicId || !attachment || attachmentKind === "document") {
      setObjectUrl("")
      setLoading(false)
      setError("")
      return undefined
    }

    let cancelled = false
    let nextObjectUrl = ""

    setLoading(true)
    setError("")

    internalApi
      .downloadChatDocument(message.publicId)
      .then((blob) => {
        if (cancelled) return
        nextObjectUrl = window.URL.createObjectURL(blob)
        setObjectUrl(nextObjectUrl)
      })
      .catch((err) => {
        if (cancelled) return
        setError(err?.message || `Failed to load ${attachmentLabelForMimeType(attachment.mimeType).toLowerCase()}`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
      if (nextObjectUrl) window.URL.revokeObjectURL(nextObjectUrl)
    }
  }, [attachment?.fileName, attachment?.mimeType, attachment?.size, attachmentKind, message?.publicId])

  if (attachmentKind === "document") {
    return (
      <button
        type="button"
        className="team-chat-document"
        onClick={() => onDownloadDocument(message)}
        disabled={Boolean(downloading)}
      >
        <span>{attachment.fileName}</span>
        <small>
          {formatAttachmentSize(attachment.size)}
          {downloading ? " · Downloading..." : " · Open download"}
        </small>
      </button>
    )
  }

  return (
    <div className={`team-chat-attachment team-chat-attachment--${attachmentKind}`}>
      <div className="team-chat-attachment-frame">
        {loading ? (
          <div className="team-chat-attachment-loading">
            <strong>Loading {attachmentLabelForMimeType(attachment.mimeType).toLowerCase()}</strong>
            <span>{attachment.fileName}</span>
          </div>
        ) : null}

        {!loading && error ? (
          <button type="button" className="team-chat-document" onClick={() => onDownloadDocument(message)}>
            <span>{attachment.fileName}</span>
            <small>Open {attachmentLabelForMimeType(attachment.mimeType).toLowerCase()}</small>
          </button>
        ) : null}

        {!loading && !error && objectUrl ? (
          <>
            {attachmentKind === "image" ? (
              <img className="team-chat-attachment-image" src={objectUrl} alt={attachment.fileName || "Shared image"} />
            ) : null}
            {attachmentKind === "video" ? (
              <video className="team-chat-attachment-video" src={objectUrl} controls preload="metadata" playsInline />
            ) : null}
            {attachmentKind === "audio" ? (
              <div className="team-chat-attachment-audio">
                <div className="team-chat-attachment-audio-copy">
                  <strong>Voice note</strong>
                  <span>{attachment.fileName}</span>
                </div>
                <audio className="team-chat-attachment-audio-player" src={objectUrl} controls preload="metadata" />
              </div>
            ) : null}
          </>
        ) : null}
      </div>

      <div className="team-chat-attachment-footer">
        <div>
          <strong>{attachment.fileName}</strong>
          <span>
            {attachmentLabelForMimeType(attachment.mimeType)} · {formatAttachmentSize(attachment.size)}
          </span>
        </div>
        <button type="button" className="team-chat-inline-action" onClick={() => onDownloadDocument(message)}>
          Download
        </button>
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  isOwnMessage,
  isReadByPeers,
  senderMeta,
  onDownloadDocument,
  onContextMenu,
  downloading,
}) {
  return (
    <article
      className={`team-chat-bubble ${isOwnMessage ? "team-chat-bubble--self" : ""} ${
        isOwnMessage && isReadByPeers ? "team-chat-bubble--self-read" : ""
      }`}
      onContextMenu={onContextMenu}
    >
      {message.replyTo ? (
        <div className="team-chat-reply-preview">
          <strong>{message.replyTo.sender?.fullName || "Internal User"}</strong>
          <span>{summarizeReplyPreview(message.replyTo)}</span>
        </div>
      ) : null}

      <div className="team-chat-bubble-author">
        <div className="team-chat-bubble-avatar">{isOwnMessage ? "YO" : initialsForUser(message.sender || {})}</div>
        <div>
          <strong>{isOwnMessage ? "You" : message.sender?.fullName || "Internal User"}</strong>
          <span>{senderMeta}</span>
        </div>
      </div>

      {message.isDeleted ? <p className="team-chat-deleted-copy">This message was deleted.</p> : null}
      {!message.isDeleted && message.body ? <p>{message.body}</p> : null}

      {!message.isDeleted && message.document ? (
        <InlineAttachment
          message={message}
          attachment={message.document}
          onDownloadDocument={onDownloadDocument}
          downloading={downloading}
        />
      ) : null}

      <div className="team-chat-bubble-meta">
        <div className="team-chat-bubble-flags">
          {message.isPinned ? <span className="team-chat-pin-indicator">Pinned</span> : null}
        </div>
        <span className="team-chat-bubble-time">
          {formatTime(message.createdAt)}
          {isOwnMessage ? <span className="team-chat-bubble-checks">✓✓</span> : null}
        </span>
      </div>
    </article>
  )
}

export default function TeamChatPage() {
  const { session, hasPermission } = useInternalAuth()
  const { isMobile, isSidebarCollapsed, collapseSidebar, expandSidebar } = useAppShell()
  const [rooms, setRooms] = useState([])
  const [users, setUsers] = useState([])
  const [messagesByRoom, setMessagesByRoom] = useState({})
  const [selectedRoomPublicId, setSelectedRoomPublicId] = useState("")
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [composerBody, setComposerBody] = useState("")
  const [selectedFile, setSelectedFile] = useState(null)
  const [activeRoomLoads, setActiveRoomLoads] = useState({})
  const [downloadingMessageId, setDownloadingMessageId] = useState("")
  const [searchTerm, setSearchTerm] = useState("")
  const [socketState, setSocketState] = useState("CONNECTING")
  const [sidebarTab, setSidebarTab] = useState("conversations")
  const [notificationsEnabled, setNotificationsEnabled] = useState(true)
  const [chatTheme, setChatTheme] = useState(() => {
    const storedValue = window.localStorage.getItem(TEAM_CHAT_THEME_STORAGE_KEY)
    return storedValue === "light" ? "light" : "dark"
  })
  const [replyTarget, setReplyTarget] = useState(null)
  const [editingMessage, setEditingMessage] = useState(null)
  const [contextMenu, setContextMenu] = useState(null)
  const [messageMutationId, setMessageMutationId] = useState("")
  const fileInputRef = useRef(null)
  const messageListRef = useRef(null)
  const messageItemRefs = useRef({})
  const contextMenuRef = useRef(null)
  const initialSidebarCollapsedRef = useRef(null)
  const isPlatformOwner = String(session?.profile?.primaryRole || "").trim().toUpperCase() === "PLATFORM_OWNER"

  const groupRoom = useMemo(
    () => rooms.find((room) => room.systemKey === "ALL_INTERNALS") || rooms.find((room) => room.roomType === "GROUP") || null,
    [rooms]
  )
  const selectedRoom = useMemo(
    () => rooms.find((room) => room.publicId === selectedRoomPublicId) || groupRoom || rooms[0] || null,
    [groupRoom, rooms, selectedRoomPublicId]
  )
  const directRooms = useMemo(() => rooms.filter((room) => room.roomType === "DIRECT"), [rooms])
  const roster = useMemo(() => users.filter((user) => !user.isSelf), [users])
  const filteredDirectRooms = useMemo(
    () =>
      directRooms.filter(
        (room) =>
          matchesSearch(room.name, searchTerm) ||
          matchesSearch(room.otherUser?.email, searchTerm) ||
          matchesSearch(summarizeRoomPreview(room), searchTerm)
      ),
    [directRooms, searchTerm]
  )
  const filteredRoster = useMemo(
    () =>
      roster.filter(
        (user) =>
          matchesSearch(user.fullName, searchTerm) ||
          matchesSearch(user.email, searchTerm) ||
          matchesSearch(normalizeRoleLabel(user), searchTerm)
      ),
    [roster, searchTerm]
  )
  const conversationRooms = useMemo(() => {
    const nextRooms = []
    if (groupRoom) nextRooms.push(groupRoom)
    nextRooms.push(...filteredDirectRooms)
    return nextRooms
  }, [filteredDirectRooms, groupRoom])
  const selectedMessages = useMemo(
    () => (selectedRoom ? messagesByRoom[selectedRoom.publicId] || [] : []),
    [messagesByRoom, selectedRoom]
  )
  const selectedTimeline = useMemo(() => buildMessageTimeline(selectedMessages), [selectedMessages])
  const pinnedMessages = useMemo(
    () =>
      selectedRoom?.roomType === "GROUP"
        ? [...selectedMessages]
            .filter((message) => message.isPinned)
            .sort((left, right) => new Date(right.pinnedAt || 0).getTime() - new Date(left.pinnedAt || 0).getTime())
        : [],
    [selectedMessages, selectedRoom]
  )
  const canPin = Boolean(hasPermission("chat:pin") && selectedRoom?.roomType === "GROUP")
  const canUnpin = Boolean(isPlatformOwner && selectedRoom?.roomType === "GROUP")
  const canSubmit = Boolean(
    selectedRoom
      && !sending
      && (editingMessage ? composerBody.trim() : (composerBody.trim() || selectedFile))
  )
  const selectedFileSummary = selectedFile
    ? `${attachmentLabelForMimeType(selectedFile.type)} · ${formatAttachmentSize(selectedFile.size)}`
    : ""
  const activeRoomLoading = Boolean(activeRoomLoads[selectedRoom?.publicId])
  const totalUnreadCount = useMemo(
    () => rooms.reduce((count, room) => count + Number(room?.unreadCount || 0), 0),
    [rooms]
  )
  const selectedRoomDocumentCount = useMemo(
    () => selectedMessages.reduce((count, message) => count + (message?.document ? 1 : 0), 0),
    [selectedMessages]
  )
  const selectedRoomParticipantCount = selectedRoom
    ? selectedRoom.roomType === "GROUP"
      ? roster.length + 1
      : 2
    : 0
  const selectedRoomLastActivity = selectedRoom?.lastMessage?.createdAt
    ? formatRelative(selectedRoom.lastMessage.createdAt)
    : "Awaiting first update"
  const selectedRoomSummary = useMemo(() => {
    if (!selectedRoom) {
      return "Select a conversation to review team updates and messages."
    }
    if (selectedRoom.roomType === "GROUP") {
      return "Company channel"
    }
    const role = normalizeRoleLabel(selectedRoom.otherUser)
    const email = selectedRoom.otherUser?.email
    return [role, email].filter(Boolean).join(" · ") || "Direct internal conversation"
  }, [selectedRoom])
  const selectedProfile = useMemo(() => {
    if (!selectedRoom) {
      return {
        avatarLabel: "SL",
        name: "No conversation selected",
        subtitle: "Choose a room from the left rail to inspect its details.",
        status: describeSocketState(socketState),
        facts: [],
      }
    }

    if (selectedRoom.roomType === "GROUP") {
      return {
        avatarLabel: "HQ",
        name: selectedRoom.name || "Company channel",
        subtitle: "Broadcast workspace",
        status: `${selectedRoomParticipantCount} members active in the workspace`,
        facts: [
          { label: "Workspace", value: "Company-wide communication" },
          { label: "Participants", value: String(selectedRoomParticipantCount) },
          { label: "Pinned", value: String(pinnedMessages.length) },
          { label: "Last activity", value: selectedRoomLastActivity },
        ],
      }
    }

    return {
      avatarLabel: initialsForUser(selectedRoom.otherUser || selectedRoom),
      name: selectedRoom.name || selectedRoom.otherUser?.fullName || "Direct message",
      subtitle: normalizeRoleLabel(selectedRoom.otherUser),
      status: selectedRoom.otherUser?.email || "Internal team member",
      facts: [
        { label: "Email", value: selectedRoom.otherUser?.email || "Not available" },
        { label: "Role", value: normalizeRoleLabel(selectedRoom.otherUser) },
        { label: "Attachments", value: String(selectedRoomDocumentCount) },
        { label: "Last activity", value: selectedRoomLastActivity },
      ],
    }
  }, [
    pinnedMessages.length,
    selectedRoom,
    selectedRoomDocumentCount,
    selectedRoomLastActivity,
    selectedRoomParticipantCount,
    socketState,
  ])
  const sharedDocuments = useMemo(() => {
    const palette = ["mint", "sky", "amber"]
    return [...selectedMessages]
      .filter((message) => message?.document)
      .slice(-3)
      .reverse()
      .map((message, index) => ({
        id: message.publicId,
        accent: palette[index % palette.length],
        title: trimPreview(message.document.fileName || "Shared document", 38),
        meta: `${attachmentLabelForMimeType(message.document.mimeType)} · ${formatAttachmentSize(message.document.size)}`,
        caption: message.sender?.fullName || "Internal user",
      }))
  }, [selectedMessages])

  function registerMessageNode(messagePublicId, node) {
    if (!messagePublicId) return
    if (node) messageItemRefs.current[messagePublicId] = node
    else delete messageItemRefs.current[messagePublicId]
  }

  function focusMessage(messagePublicId) {
    const target = messageItemRefs.current[messagePublicId]
    if (!target) return
    target.scrollIntoView({ behavior: "smooth", block: "center" })
  }

  function closeContextMenu() {
    setContextMenu(null)
  }

  async function loadBootstrap() {
    setLoading(true)
    setError("")
    try {
      const payload = await internalApi.getChatBootstrap()
      const nextRooms = sortRooms(payload.rooms || [])
      setRooms(nextRooms)
      setUsers(payload.users || [])
      setSelectedRoomPublicId((current) => {
        if (current && nextRooms.some((room) => room.publicId === current)) return current
        return payload.groupRoomPublicId || nextRooms[0]?.publicId || ""
      })
    } catch (err) {
      setError(err?.message || "Failed to load team chat")
    } finally {
      setLoading(false)
    }
  }

  async function loadRoomMessages(roomPublicId) {
    if (!roomPublicId) return
    setActiveRoomLoads((current) => ({ ...current, [roomPublicId]: true }))
    try {
      const payload = await internalApi.getChatRoomMessages(roomPublicId)
      setRooms((current) => mergeRoomSummary(current, payload.room))
      setMessagesByRoom((current) => ({
        ...current,
        [roomPublicId]: payload.messages || [],
      }))
    } catch (err) {
      setError(err?.message || "Failed to load messages")
    } finally {
      setActiveRoomLoads((current) => ({ ...current, [roomPublicId]: false }))
    }
  }

  async function openDirectChat(user) {
    if (!user?.publicId) return
    setError("")
    const existingRoom = directRooms.find((room) => room.otherUser?.publicId === user.publicId)
    if (existingRoom) {
      setSelectedRoomPublicId(existingRoom.publicId)
      return
    }

    try {
      const room = await internalApi.ensureDirectChatRoom(user.publicId)
      setRooms((current) => mergeRoomSummary(current, room))
      setSelectedRoomPublicId(room.publicId)
      await loadRoomMessages(room.publicId)
    } catch (err) {
      setError(err?.message || "Failed to open direct chat")
    }
  }

  async function handleSend(event) {
    event.preventDefault()
    if (!selectedRoom?.publicId || sending) return

    setSending(true)
    setError("")
    try {
      let payload = null

      if (editingMessage?.publicId) {
        payload = await internalApi.editChatMessage(selectedRoom.publicId, editingMessage.publicId, composerBody)
      } else {
        payload = await internalApi.sendChatMessage(selectedRoom.publicId, {
          body: composerBody,
          attachmentFile: selectedFile || undefined,
          replyToMessagePublicId: replyTarget?.publicId || "",
        })
      }

      setRooms((current) => mergeRoomSummary(current, payload.room))
      setMessagesByRoom((current) => ({
        ...current,
        [selectedRoom.publicId]: mergeMessageList(current[selectedRoom.publicId], payload.message),
      }))
      setComposerBody("")
      setSelectedFile(null)
      setReplyTarget(null)
      setEditingMessage(null)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } catch (err) {
      setError(err?.message || (editingMessage ? "Failed to update message" : "Failed to send message"))
    } finally {
      setSending(false)
    }
  }

  async function handleTogglePin(message) {
    if (!selectedRoom?.publicId || !message?.publicId) return
    setError("")
    try {
      setMessageMutationId(message.publicId)
      const payload = message.isPinned
        ? await internalApi.unpinChatMessage(selectedRoom.publicId, message.publicId)
        : await internalApi.pinChatMessage(selectedRoom.publicId, message.publicId)
      setRooms((current) => mergeRoomSummary(current, payload.room))
      setMessagesByRoom((current) => ({
        ...current,
        [selectedRoom.publicId]: mergeMessageList(current[selectedRoom.publicId], payload.message),
      }))
    } catch (err) {
      setError(err?.message || "Failed to update pinned state")
    } finally {
      setMessageMutationId("")
    }
  }

  async function handleDeleteMessage(message) {
    if (!selectedRoom?.publicId || !message?.publicId) return
    setError("")
    try {
      setMessageMutationId(message.publicId)
      const payload = await internalApi.deleteChatMessage(selectedRoom.publicId, message.publicId)
      setRooms((current) => mergeRoomSummary(current, payload.room))
      setMessagesByRoom((current) => ({
        ...current,
        [selectedRoom.publicId]: mergeMessageList(current[selectedRoom.publicId], payload.message),
      }))
      if (editingMessage?.publicId === message.publicId) {
        setEditingMessage(null)
        setComposerBody("")
      }
      if (replyTarget?.publicId === message.publicId) {
        setReplyTarget(null)
      }
    } catch (err) {
      setError(err?.message || "Failed to delete message")
    } finally {
      setMessageMutationId("")
    }
  }

  function handleReplyToMessage(message) {
    setReplyTarget(message)
    setEditingMessage(null)
    setComposerBody("")
    closeContextMenu()
    window.requestAnimationFrame(() => {
      const textarea = document.querySelector(".team-chat-composer textarea")
      textarea?.focus?.()
    })
  }

  function handleEditMessage(message) {
    setEditingMessage(message)
    setReplyTarget(null)
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
    setComposerBody(message.body || "")
    closeContextMenu()
    window.requestAnimationFrame(() => {
      const textarea = document.querySelector(".team-chat-composer textarea")
      textarea?.focus?.()
    })
  }

  function openContextMenu(event, message) {
    event.preventDefault()
    event.stopPropagation()
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      message,
    })
  }

  function availableMessageActions(message) {
    const isOwnMessage = message?.sender?.publicId === session?.profile?.user?.publicId
    const canEditMessage = isOwnMessage && !message?.isDeleted && (message?.body || "").trim()
    const canDeleteMessage = isOwnMessage && !message?.isDeleted
    const canPinMessage = canPin && !message?.isDeleted && !message?.isPinned
    const canUnpinMessage = canUnpin && !message?.isDeleted && message?.isPinned

    return {
      canEditMessage,
      canDeleteMessage,
      canPinMessage,
      canUnpinMessage,
    }
  }

  async function handleDownloadDocument(message) {
    if (!message?.publicId || !message.document) return
    setDownloadingMessageId(message.publicId)
    setError("")
    try {
      const blob = await internalApi.downloadChatDocument(message.publicId)
      const objectUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = objectUrl
      link.download = message.document.fileName || "document"
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(objectUrl)
    } catch (err) {
      setError(err?.message || "Failed to download attachment")
    } finally {
      setDownloadingMessageId("")
    }
  }

  function handleFileSelection(event) {
    const file = event.target.files?.[0]
    if (!file) {
      setSelectedFile(null)
      return
    }

    if (file.size > MAX_ATTACHMENT_BYTES) {
      setSelectedFile(null)
      event.target.value = ""
      setError("Attachment must be 50MB or smaller")
      return
    }

    setError("")
    setSelectedFile(file)
    window.requestAnimationFrame(() => {
      const textarea = document.querySelector(".team-chat-composer textarea")
      textarea?.focus?.()
    })
  }

  function handleComposerKeyDown(event) {
    if (event.key !== "Enter" || event.shiftKey) return
    if (sending || !selectedRoom || (!composerBody.trim() && !selectedFile)) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  useEffect(() => {
    loadBootstrap()
  }, [])

  useEffect(() => {
    window.localStorage.setItem(TEAM_CHAT_THEME_STORAGE_KEY, chatTheme)
  }, [chatTheme])

  useEffect(() => {
    if (isMobile) return undefined
    initialSidebarCollapsedRef.current = isSidebarCollapsed
    collapseSidebar()
    return () => {
      if (!initialSidebarCollapsedRef.current) expandSidebar()
    }
  }, [collapseSidebar, expandSidebar, isMobile])

  useEffect(() => {
    if (!selectedRoom?.publicId) return
    if (messagesByRoom[selectedRoom.publicId]) return
    loadRoomMessages(selectedRoom.publicId)
  }, [messagesByRoom, selectedRoom])

  useEffect(() => {
    if (!selectedMessages.length || !messageListRef.current) return
    messageListRef.current.scrollTop = messageListRef.current.scrollHeight
  }, [selectedMessages])

  useEffect(() => {
    if (!contextMenu) return undefined

    function handlePointerDown(event) {
      if (contextMenuRef.current?.contains(event.target)) return
      closeContextMenu()
    }

    function handleEscape(event) {
      if (event.key === "Escape") closeContextMenu()
    }

    window.addEventListener("pointerdown", handlePointerDown)
    window.addEventListener("keydown", handleEscape)
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown)
      window.removeEventListener("keydown", handleEscape)
    }
  }, [contextMenu])

  useEffect(() => {
    const accessToken = session?.accessToken
    if (!accessToken) return undefined

    let socket = null
    let reconnectTimer = null
    let disposed = false

    function connect() {
      if (disposed) return
      setSocketState("CONNECTING")
      socket = new WebSocket(resolveWsUrl(accessToken))

      socket.onopen = () => {
        setSocketState("LIVE")
      }

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload?.type === "internal_chat:ready") {
            setSocketState("LIVE")
            return
          }
          if (payload?.type === "internal_chat:message_created" || payload?.type === "internal_chat:message_updated") {
            const room = payload?.data?.room
            const message = payload?.data?.message
            if (room?.publicId) {
              setRooms((current) => mergeRoomSummary(current, room))
            }
            if (room?.publicId && message?.publicId) {
              setMessagesByRoom((current) => ({
                ...current,
                [room.publicId]: mergeMessageList(current[room.publicId], message),
              }))
            }
          }
        } catch {
          // Ignore malformed websocket payloads.
        }
      }

      socket.onclose = () => {
        if (disposed) return
        setSocketState("RECONNECTING")
        reconnectTimer = window.setTimeout(connect, 3000)
      }

      socket.onerror = () => {
        setSocketState("RECONNECTING")
      }
    }

    connect()

    return () => {
      disposed = true
      if (reconnectTimer) window.clearTimeout(reconnectTimer)
      if (socket) socket.close()
    }
  }, [session?.accessToken])

  return (
    <InternalShell
      title="Team Chat"
      alerts={error ? [{ id: "team-chat-error", type: "ERROR", title: "Chat Error", body: error }] : []}
      contentClassName={`internal-page-inner--chat internal-page-inner--chat--${chatTheme}`}
    >
      <div className={`team-chat-page team-chat-page--pro team-chat-page--theme-${chatTheme}`}>
        <div className="team-chat-pro-shell">
          <aside className="team-chat-pro-sidebar">
            <div className="team-chat-pro-sidebar-header">
              <div className="team-chat-pro-user">
                <div className="team-chat-room-avatar">{initialsForUser(session?.profile?.user || {})}</div>
                <div>
                  <strong>{session?.profile?.user?.fullName || "Internal User"}</strong>
                  <span>{session?.profile?.user?.email || describeSocketState(socketState)}</span>
                </div>
              </div>

              <div className="team-chat-pro-sidebar-meta">
                <span>{rooms.length} rooms</span>
                <span>{totalUnreadCount} unread</span>
              </div>
            </div>

            <label className="team-chat-search team-chat-pro-search">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="11" cy="11" r="6" />
                <path d="m16 16 4 4" />
              </svg>
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search conversations"
              />
            </label>

            <div className="team-chat-pro-sidebar-tabs" role="tablist" aria-label="Chat sidebar views">
              <button
                type="button"
                className={`team-chat-pro-tab ${sidebarTab === "conversations" ? "active" : ""}`}
                onClick={() => setSidebarTab("conversations")}
              >
                Conversations
                <span>{conversationRooms.length}</span>
              </button>
              <button
                type="button"
                className={`team-chat-pro-tab ${sidebarTab === "company" ? "active" : ""}`}
                onClick={() => setSidebarTab("company")}
              >
                Company
                <span>{filteredRoster.length}</span>
              </button>
            </div>

            <div className="team-chat-pro-sidebar-scroll">
              {sidebarTab === "conversations" ? (
                <>
                  <div className="team-chat-section-header team-chat-section-header--compact">
                    <div>
                      <strong>Recent conversations</strong>
                      <small>Broadcast and direct threads</small>
                    </div>
                  </div>

                  <div className="team-chat-room-list">
                    {conversationRooms.length ? (
                      conversationRooms.map((room) => (
                        <RoomCard
                          key={room.publicId}
                          room={room}
                          active={selectedRoom?.publicId === room.publicId}
                          onSelect={() => setSelectedRoomPublicId(room.publicId)}
                          accent={room.roomType === "GROUP" ? "group" : "direct"}
                        />
                      ))
                    ) : (
                      <p className="team-chat-empty">No conversations match this search.</p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <div className="team-chat-section-header team-chat-section-header--compact">
                    <div>
                      <strong>Company directory</strong>
                      <small>Start a new direct thread</small>
                    </div>
                  </div>

                  <div className="team-chat-people-list team-chat-people-list--scrollable">
                    {filteredRoster.length ? (
                      filteredRoster.map((user) => (
                        <button key={user.publicId} type="button" className="team-chat-person-card" onClick={() => openDirectChat(user)}>
                          <div className="team-chat-room-avatar">{initialsForUser(user)}</div>
                          <div className="team-chat-room-copy">
                            <div className="team-chat-room-heading">
                              <strong>{user.fullName}</strong>
                              <span>{normalizeRoleLabel(user)}</span>
                            </div>
                            <p>{user.email || "Internal user"}</p>
                          </div>
                        </button>
                      ))
                    ) : (
                      <p className="team-chat-empty">No team members match this search.</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </aside>

          <section
            className={`team-chat-pro-thread ${
              selectedRoom?.roomType === "GROUP" && pinnedMessages.length
                ? "team-chat-pro-thread--with-pinned"
                : ""
            }`}
          >
            <header className="team-chat-pro-thread-header">
              <div className="team-chat-pro-thread-main">
                <div className={`team-chat-room-avatar team-chat-thread-avatar ${selectedRoom?.roomType === "GROUP" ? "team-chat-room-avatar--group" : ""}`}>
                  {selectedRoom?.roomType === "GROUP" ? "HQ" : initialsForUser(selectedRoom?.otherUser || selectedRoom || {})}
                </div>
                <div className="team-chat-pro-thread-copy">
                  <div className="team-chat-pro-thread-title-row">
                    <strong>{selectedRoom?.name || "Select a chat"}</strong>
                    <span className={`team-chat-live-state team-chat-live-state--${socketState.toLowerCase()}`}>{socketState}</span>
                  </div>
                  <p>{selectedRoomSummary}</p>
                </div>
              </div>

              <div className="team-chat-pro-thread-stats">
                <span>{selectedRoomParticipantCount} participants</span>
                <span>{selectedRoomDocumentCount} attachments</span>
                <span>{pinnedMessages.length} pinned</span>
                <span>{selectedRoomLastActivity}</span>
              </div>
            </header>

            {selectedRoom?.roomType === "GROUP" && pinnedMessages.length ? (
              <div className="team-chat-pro-pinned-bar">
                <strong>Pinned</strong>
                <div className="team-chat-pro-pinned-list">
                  {pinnedMessages.map((message) => (
                    <button
                      key={message.publicId}
                      type="button"
                      className="team-chat-pro-pinned-chip"
                      onClick={() => focusMessage(message.publicId)}
                    >
                      <span>{message.sender?.fullName || "Internal User"}</span>
                      <small>{summarizePinnedMessage(message)}</small>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="team-chat-message-list team-chat-message-list--pro" ref={messageListRef}>
              {loading || activeRoomLoading ? (
                <p className="team-chat-empty">Loading conversation...</p>
              ) : selectedTimeline.length ? (
                selectedTimeline.map((item) =>
                  item.type === "day" ? (
                    <MessageDayDivider key={item.key} label={item.label} />
                  ) : (
                    <div
                      key={item.key}
                      ref={(node) => registerMessageNode(item.message.publicId, node)}
                      className={`team-chat-message-row ${
                        item.message.sender?.publicId === session?.profile?.user?.publicId
                          ? "team-chat-message-row--self"
                          : "team-chat-message-row--other"
                      }`}
                    >
                      <MessageBubble
                        message={item.message}
                        isOwnMessage={item.message.sender?.publicId === session?.profile?.user?.publicId}
                        isReadByPeers={
                          item.message.sender?.publicId === session?.profile?.user?.publicId
                            ? isMessageReadByPeers(item.message, selectedRoom)
                            : false
                        }
                        senderMeta={
                          item.message.sender?.publicId === session?.profile?.user?.publicId
                            ? session?.profile?.user?.email || "Internal operator"
                            : selectedRoom?.roomType === "GROUP"
                              ? normalizeRoleLabel(item.message.sender)
                              : item.message.sender?.email || normalizeRoleLabel(item.message.sender)
                        }
                        onDownloadDocument={handleDownloadDocument}
                        onContextMenu={(event) => openContextMenu(event, item.message)}
                        downloading={downloadingMessageId === item.message.publicId}
                      />
                    </div>
                  )
                )
              ) : (
                <div className="team-chat-empty team-chat-empty--panel">
                  <strong>No messages yet</strong>
                  <p>Send a text or attach a photo, video, voice note, or file to begin this thread.</p>
                </div>
              )}
            </div>

            <form className="team-chat-composer team-chat-composer--pro" onSubmit={handleSend}>
              <input ref={fileInputRef} type="file" accept={ATTACHMENT_ACCEPT} hidden onChange={handleFileSelection} />

              {replyTarget ? (
                <div className="team-chat-composer-state">
                  <div>
                    <strong>Replying to {replyTarget.sender?.fullName || "Internal User"}</strong>
                    <span>{summarizeReplyPreview(replyTarget)}</span>
                  </div>
                  <button type="button" className="team-chat-inline-action" onClick={() => setReplyTarget(null)}>
                    Cancel
                  </button>
                </div>
              ) : null}

              {editingMessage ? (
                <div className="team-chat-composer-state">
                  <div>
                    <strong>Editing message</strong>
                    <span>{trimPreview(editingMessage.body || "Update your message", 72)}</span>
                  </div>
                  <button
                    type="button"
                    className="team-chat-inline-action"
                    onClick={() => {
                      setEditingMessage(null)
                      setComposerBody("")
                    }}
                  >
                    Cancel
                  </button>
                </div>
              ) : null}

              {selectedFile ? (
                <div className="team-chat-file-pill">
                  <strong>{selectedFile.name}</strong>
                  <span>{selectedFileSummary}</span>
                  <button
                    type="button"
                    className="team-chat-inline-action"
                    onClick={() => {
                      setSelectedFile(null)
                      if (fileInputRef.current) fileInputRef.current.value = ""
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}

              <div className="team-chat-composer-shell team-chat-composer-shell--pro">
                <button
                  type="button"
                  className="team-chat-action-button team-chat-action-button--icon"
                  disabled={!selectedRoom || sending || Boolean(editingMessage)}
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach file"
                >
                  +
                </button>

                <textarea
                  value={composerBody}
                  onChange={(event) => setComposerBody(event.target.value)}
                  onKeyDown={handleComposerKeyDown}
                  placeholder={selectedRoom ? "Write a message" : "Select a room to start chatting"}
                  rows={1}
                  disabled={!selectedRoom || sending}
                />

                <div className="team-chat-composer-toolbar">
                  <div className="team-chat-composer-status">
                    <span>
                      {selectedRoom
                        ? editingMessage
                          ? `Editing a message in ${selectedRoom.name}`
                          : `Posting to ${selectedRoom.name}${selectedFile ? ` with ${selectedFile.name}` : ""}`
                        : "Choose a room before composing a message"}
                    </span>
                  </div>

                  <div className="team-chat-composer-actions">
                    <button type="submit" className="team-chat-action-button team-chat-action-button--primary" disabled={!canSubmit}>
                      {sending ? (editingMessage ? "Saving..." : "Sending...") : editingMessage ? "Save" : "Send"}
                    </button>
                  </div>
                </div>
              </div>
            </form>
          </section>

          <aside className="team-chat-pro-inspector">
            <div className="team-chat-pro-inspector-section">
              <span className="team-chat-pro-inspector-label">Options</span>
              <label className="team-chat-pro-toggle">
                <span>Notifications</span>
                <input
                  type="checkbox"
                  checked={notificationsEnabled}
                  onChange={(event) => setNotificationsEnabled(event.target.checked)}
                />
              </label>

              <div className="team-chat-theme-picker" role="group" aria-label="Team chat theme">
                <span className="team-chat-theme-label">Theme</span>
                <div className="team-chat-theme-switch">
                  <button
                    type="button"
                    className={`team-chat-theme-option ${chatTheme === "dark" ? "active" : ""}`}
                    onClick={() => setChatTheme("dark")}
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    className={`team-chat-theme-option ${chatTheme === "light" ? "active" : ""}`}
                    onClick={() => setChatTheme("light")}
                  >
                    White
                  </button>
                </div>
              </div>
            </div>

            <div className="team-chat-pro-inspector-section">
              <span className="team-chat-pro-inspector-label">Profile</span>
              <div className="team-chat-pro-profile-card">
                <div className={`team-chat-room-avatar team-chat-pro-profile-avatar ${selectedRoom?.roomType === "GROUP" ? "team-chat-room-avatar--group" : ""}`}>
                  {selectedProfile.avatarLabel}
                </div>
                <strong>{selectedProfile.name}</strong>
                <span>{selectedProfile.subtitle}</span>
                <small>{selectedProfile.status}</small>
              </div>

              {selectedProfile.facts.length ? (
                <div className="team-chat-pro-facts">
                  {selectedProfile.facts.map((fact) => (
                    <div key={`${fact.label}-${fact.value}`} className="team-chat-pro-fact">
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="team-chat-pro-inspector-section">
              <span className="team-chat-pro-inspector-label">Shared files</span>
              {sharedDocuments.length ? (
                <div className="team-chat-pro-media-grid">
                  {sharedDocuments.map((item) => (
                    <div key={item.id} className={`team-chat-pro-media-card team-chat-pro-media-card--${item.accent}`}>
                      <strong>{item.title}</strong>
                      <span>{item.caption}</span>
                      <small>{item.meta}</small>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="team-chat-empty">Shared documents will appear here.</p>
              )}
            </div>

            {selectedRoom?.roomType === "GROUP" && pinnedMessages.length ? (
              <div className="team-chat-pro-inspector-section">
                <span className="team-chat-pro-inspector-label">Pinned notes</span>
                <div className="team-chat-pro-note-list">
                  {pinnedMessages.slice(0, 4).map((message) => (
                    <button
                      key={message.publicId}
                      type="button"
                      className="team-chat-pro-note"
                      onClick={() => focusMessage(message.publicId)}
                    >
                      <strong>{message.sender?.fullName || "Internal User"}</strong>
                      <span>{trimPreview(summarizePinnedMessage(message), 68)}</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>
        {contextMenu ? (() => {
          const actions = availableMessageActions(contextMenu.message)
          return (
            <div
              ref={contextMenuRef}
              className="team-chat-context-menu"
              style={{ top: contextMenu.y, left: contextMenu.x }}
              onClick={(event) => event.stopPropagation()}
            >
              <button type="button" onClick={() => handleReplyToMessage(contextMenu.message)}>
                Reply
              </button>
              {actions.canEditMessage ? (
                <button type="button" onClick={() => handleEditMessage(contextMenu.message)}>
                  Edit
                </button>
              ) : null}
              {actions.canDeleteMessage ? (
                <button
                  type="button"
                  disabled={messageMutationId === contextMenu.message.publicId}
                  onClick={() => {
                    closeContextMenu()
                    handleDeleteMessage(contextMenu.message)
                  }}
                >
                  Delete
                </button>
              ) : null}
              {actions.canPinMessage ? (
                <button
                  type="button"
                  disabled={messageMutationId === contextMenu.message.publicId}
                  onClick={() => {
                    closeContextMenu()
                    handleTogglePin(contextMenu.message)
                  }}
                >
                  Pin
                </button>
              ) : null}
              {actions.canUnpinMessage ? (
                <button
                  type="button"
                  disabled={messageMutationId === contextMenu.message.publicId}
                  onClick={() => {
                    closeContextMenu()
                    handleTogglePin(contextMenu.message)
                  }}
                >
                  Unpin
                </button>
              ) : null}
            </div>
          )
        })() : null}
      </div>
    </InternalShell>
  )
}
