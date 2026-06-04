import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ArrowRight, Bell, CheckCircle2 } from "lucide-react"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "./ui/drawer"

export default function InternalNotificationDrawer({ open, onOpenChange, items = [] }) {
  const [selected, setSelected] = useState(null)
  const normalizedItems = useMemo(
    () =>
      (Array.isArray(items) ? items : []).filter(Boolean).map((item, index) => ({
        id: item.id || `internal-notification-${index}`,
        type: String(item.type || "INFO").toUpperCase(),
        title: item.title || "System message",
        body: item.body || item.message || "",
        meta: item.meta || "",
        isActionable: Boolean(item.isActionable),
        onOpen: typeof item.onOpen === "function" ? item.onOpen : null,
      })),
    [items],
  )
  const actionableCount = normalizedItems.filter((item) => item.isActionable).length

  useEffect(() => {
    if (open) setSelected(null)
  }, [open])

  function openAction(item) {
    if (!item?.onOpen) return
    onOpenChange(false)
    setSelected(null)
    item.onOpen()
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="internal-notification-drawer">
        <DrawerHeader>
          <DrawerTitle className="internal-notification-title">
            <Bell aria-hidden="true" />
            Notifications
          </DrawerTitle>
          <DrawerDescription>
            {actionableCount ? `${actionableCount} actionable item${actionableCount === 1 ? "" : "s"}` : "All internal notifications are informational."}
          </DrawerDescription>
        </DrawerHeader>
        <div className="internal-notification-body">
          {!selected ? (
            <div className="internal-notification-list">
              {normalizedItems.length ? normalizedItems.map((item, index) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelected(item)}
                  style={{ animationDelay: `${Math.min(index * 22, 180)}ms` }}
                  className="internal-notification-list-item"
                >
                  <span className={`internal-notification-dot ${item.isActionable ? "is-actionable" : ""}`} />
                  <span className="internal-notification-list-copy">
                    <strong>{item.title}</strong>
                    <span>{item.body || "-"}</span>
                  </span>
                  <span className="internal-notification-list-meta">
                    <span>{item.type}</span>
                    {item.meta ? <span>{item.meta}</span> : null}
                    <ArrowRight aria-hidden="true" />
                  </span>
                </button>
              )) : (
                <div className="internal-notification-empty">No notifications yet.</div>
              )}
            </div>
          ) : (
            <div className="internal-notification-detail">
              <button type="button" onClick={() => setSelected(null)} className="internal-secondary-button internal-back-button">
                <ArrowLeft aria-hidden="true" />
                Back to notifications
              </button>
              <div>
                <div className="internal-notification-kicker">
                  {selected.isActionable ? <span className="internal-notification-dot is-actionable" /> : <CheckCircle2 aria-hidden="true" />}
                  {selected.type}
                </div>
                <h3>{selected.title}</h3>
                {selected.meta ? <p>{selected.meta}</p> : null}
              </div>
              <div className="internal-notification-message">{selected.body || "No message body."}</div>
              {selected.isActionable && selected.onOpen ? (
                <button type="button" onClick={() => openAction(selected)} className="internal-primary-button">
                  Open request
                  <ArrowRight aria-hidden="true" />
                </button>
              ) : null}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
