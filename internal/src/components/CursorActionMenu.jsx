import { useEffect } from "react"

export default function CursorActionMenu({ menu, onClose }) {
  useEffect(() => {
    if (!menu) return undefined

    function handlePointerDown() {
      onClose()
    }

    function handleKeyDown(event) {
      if (event.key === "Escape") onClose()
    }

    document.addEventListener("mousedown", handlePointerDown)
    document.addEventListener("keydown", handleKeyDown)

    return () => {
      document.removeEventListener("mousedown", handlePointerDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [menu, onClose])

  if (!menu) return null

  const viewportWidth = typeof window !== "undefined" ? window.innerWidth : 1280
  const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 720
  const estimatedHeight = Math.max(160, (menu.items?.length || 1) * 44 + 24)
  const left = Math.max(12, Math.min(menu.x, viewportWidth - 236))
  const top = Math.max(12, Math.min(menu.y, viewportHeight - estimatedHeight))

  return (
    <div
      className="cursor-action-menu"
      style={{ left, top }}
      onMouseDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="menu"
    >
      {menu.title ? <p className="cursor-action-menu__title">{menu.title}</p> : null}
      {(menu.items || []).map((item) => (
        <button
          key={item.id || item.label}
          type="button"
          role="menuitem"
          className={`cursor-action-menu__item ${item.danger ? "is-danger" : ""}`}
          disabled={item.disabled}
          onClick={() => {
            onClose()
            item.onSelect?.()
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
