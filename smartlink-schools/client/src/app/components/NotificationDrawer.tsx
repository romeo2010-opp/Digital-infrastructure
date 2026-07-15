import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Bell, CheckCircle2 } from 'lucide-react'
import { useNavigate } from 'react-router'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from './ui/drawer'
import { usePortal } from '../lib/portalContext'
import { normalizeDate, normalizeRows } from '../lib/portalUtils'

function routeForNotification(item: any) {
  const type = String(item?.linkedEntityType || '').toUpperCase()
  const id = String(item?.linkedEntityId || '').trim()
  if (type === 'FINANCE_DISCOUNT') return '/finance/discounts-bursaries'
  if (type === 'TIMETABLE') return '/timetables'
  if (type === 'EXAM_SESSION') return '/exam-sessions'
  if (type === 'PAYROLL_RUN') return id && !/^\d+$/.test(id) ? `/finance/payroll/${encodeURIComponent(id)}` : '/finance/payroll'
  if (type === 'STAFF_LEAVE') return id && !/^\d+$/.test(id) ? `/staff/leave/${encodeURIComponent(id)}` : '/staff/leave'
  if (type === 'PARENT_ACADEMIC_INSIGHT') return '/student-portal'
  if (!id) return ''
  if (type === 'DIRECTOR_TASK') return `/tasks/${encodeURIComponent(id)}`
  if (type === 'STUDENT') return '/students'
  if (type === 'PARENT' || type === 'GUARDIAN') return '/parents'
  if (type === 'FEE' || type === 'PAYMENT' || type === 'RECEIPT') return '/fees'
  if (type === 'ATTENDANCE') return '/attendance'
  if (type === 'HOMEWORK') return '/homework'
  if (type === 'RESULT' || type === 'ASSESSMENT') return '/results'
  if (type === 'MESSAGE') return '/messages'
  if (type === 'REPORT') return '/reports'
  return ''
}

export function NotificationDrawer({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const navigate = useNavigate()
  const { data, api, token, runAction, actionLoading, updatePortalData } = usePortal()
  const items = normalizeRows(data.notifications?.items)
  const unreadCount = Number(data.notifications?.unreadCount || 0)
  const [selected, setSelected] = useState<any>(null)
  const selectedRoute = routeForNotification(selected)

  useEffect(() => {
    if (!open || !token) return
    setSelected(null)
    api.listNotifications(token).then((payload: any) => updatePortalData((current: any) => ({ ...current, notifications: payload?.notifications || { items: [], unreadCount: 0 } }))).catch(() => {})
  }, [open, token])

  useEffect(() => {
    if (!selected?.publicId || !items.length) return
    const nextSelected = items.find((item: any) => item.publicId === selected.publicId)
    if (nextSelected) setSelected(nextSelected)
  }, [open, items.map((item: any) => `${item.publicId}:${item.readAt || ''}`).join('|')])

  const selectNotification = async (item: any) => {
    setSelected(item)
    if (!item?.readAt && item?.publicId) {
      const readAt = new Date().toISOString()
      updatePortalData((current: any) => {
        const items = normalizeRows(current.notifications?.items).map((notification: any) =>
          notification.publicId === item.publicId ? { ...notification, readAt } : notification,
        )
        return {
          ...current,
          notifications: {
            ...(current.notifications || {}),
            items,
            unreadCount: Math.max(0, Number(current.notifications?.unreadCount || 0) - 1),
          },
        }
      })
      setSelected({ ...item, readAt })
      await runAction(() => api.markNotificationRead(token, item.publicId), 'Marking notification as read...', { refresh: false })
    }
  }

  const openLinkedRecord = () => {
    if (!selectedRoute) return
    onOpenChange(false)
    navigate(selectedRoute)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right">
      <DrawerContent className="mera-notification-drawer w-[900px] max-w-[98vw] border-[#e2e8f0] bg-white text-[#111827] shadow-[0_24px_60px_rgba(15,23,42,0.16)] sm:max-w-[900px]">
        <DrawerHeader className="mera-notification-header border-b border-[#f1f5f9] p-5">
          <DrawerTitle className="flex items-center gap-2 text-[17px] text-[#111827]">
            <Bell className="size-4 text-[#2563eb]" />
            Notifications
          </DrawerTitle>
          <DrawerDescription className="text-[#6b7280]">
            {unreadCount ? `${unreadCount} unread notification${unreadCount === 1 ? '' : 's'}` : 'All notifications are read.'}
          </DrawerDescription>
        </DrawerHeader>
        <div className="min-h-0 flex-1 overflow-y-auto bg-[#f8fafc]">
          {!selected ? (
            <div className="grid gap-2 p-3">
              {items.length ? items.map((item: any, index: number) => {
                const unread = !item.readAt
                return (
                  <button
                    key={item.publicId}
                    type="button"
                    disabled={actionLoading}
                    onClick={() => selectNotification(item)}
                    style={{ animationDelay: `${Math.min(index * 22, 180)}ms` }}
                    className="mera-notification-list-item block w-full rounded-[8px] border border-[#e2e8f0] bg-white px-4 py-3 text-left shadow-sm transition hover:border-[#cbd5e1] hover:bg-white focus-visible:bg-white focus-visible:outline-none disabled:opacity-60"
                  >
                    <div className="flex items-start gap-3">
                      <span className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? 'bg-[#2563eb]' : 'bg-[#d1d5db]'}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="min-w-0 truncate text-[13px] font-bold leading-5 text-[#111827]">{item.title}</span>
                          <span className="rounded-full border border-[#e2e8f0] bg-[#f8fafc] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-[#64748b]">{item.type || 'Notification'}</span>
                        </div>
                        <span className="mt-1 block line-clamp-2 text-[12px] leading-5 text-[#6b7280]">{item.message || 'No message body.'}</span>
                        <span className="mt-2 block text-[11px] font-semibold text-[#94a3b8]">{normalizeDate(item.createdAt)}</span>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-[#94a3b8]" />
                    </div>
                  </button>
                )
              }) : (
                <div className="p-4 text-[12px] font-semibold text-[#6b7280]">No notifications yet.</div>
              )}
            </div>
          ) : (
            <div className="mera-notification-detail grid gap-4 p-5">
              <button type="button" onClick={() => setSelected(null)} className="inline-flex h-9 w-fit items-center gap-2 rounded-[5px] border border-[#e2e8f0] px-3 text-[12px] font-semibold text-[#374151] hover:bg-[#f9fafb]">
                <ArrowLeft className="size-3.5" />
                Back to notifications
              </button>
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.09em] text-[#9ca3af]">
                  {selected.readAt ? <CheckCircle2 className="size-3.5 text-[#10b981]" /> : <span className="size-2 rounded-full bg-[#2563eb]" />}
                  {selected.type || 'Notification'}
                </div>
                <h3 className="mt-2 text-[18px] font-bold text-[#111827]">{selected.title}</h3>
                <div className="mt-1 text-[12px] font-medium text-[#9ca3af]">{normalizeDate(selected.createdAt)}</div>
              </div>
              <div className="rounded-[6px] border border-[#e2e8f0] bg-[#f9fafb] px-4 py-3 text-[13px] leading-6 text-[#374151]">
                {selected.message || 'No message body.'}
              </div>
              {selected.linkedEntityType && selected.linkedEntityType !== 'director_task' ? (
                <div className="rounded-[6px] border border-[#e2e8f0] bg-white px-4 py-3 text-[12px] text-[#6b7280]">
                  <div className="font-bold uppercase tracking-[0.08em] text-[#9ca3af]">Linked record</div>
                  <div className="mt-1 font-semibold text-[#111827]">{selected.linkedEntityType || 'Record'}</div>
                </div>
              ) : null}
              {selectedRoute ? (
                <button type="button" onClick={openLinkedRecord} className="inline-flex h-9 w-fit items-center gap-2 rounded-[5px] bg-[#111827] px-3 text-[12px] font-semibold text-white hover:bg-[#1f2937]">
                  Open linked record
                  <ArrowRight className="size-3.5" />
                </button>
              ) : null}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
