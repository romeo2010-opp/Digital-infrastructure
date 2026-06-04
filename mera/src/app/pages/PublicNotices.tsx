import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Plus, RefreshCcw, Search, Send, UploadCloud, XCircle } from 'lucide-react'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { FieldShell, ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-[#e2e8f0] bg-white px-3 text-[12px] font-medium text-[#6b7280]'
const channels = ['FACEBOOK_PAGE', 'INSTAGRAM_BUSINESS', 'X_TWITTER', 'LINKEDIN_PAGE', 'YOUTUBE_COMMUNITY', 'TIKTOK']
const categories = [
  'fuel availability update',
  'shortage advisory',
  'price announcement',
  'compliance warning',
  'panic buying warning',
  'station notice',
  'district advisory',
  'inspection announcement',
  'general public advisory',
]

export function PublicNotices() {
  const { token, api, runAction, data, requestPackets, packetStatus, packetErrors } = usePortal()
  const [search, setSearch] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [form, setForm] = useState({
    title: '',
    message: '',
    category: 'fuel availability update',
    targetRegion: '',
    targetDistrict: '',
    fuelType: '',
    severity: 'medium',
    status: 'draft',
    scheduledAt: '',
    selectedChannels: ['FACEBOOK_PAGE'],
  })

  const payload = data.publicNotices || { items: [] }
  const loading = packetStatus.publicNotices === 'loading' && data.publicNotices === undefined
  const refreshing = packetStatus.publicNotices === 'loading'
  const error = packetErrors.publicNotices || ''

  const load = () => {
    if (!token) return
    requestPackets(['publicNotices'], { reason: 'public-notices-refresh', force: true })
  }

  useEffect(() => {
    if (!token || data.publicNotices !== undefined) return
    load()
  }, [data.publicNotices, token])

  const rows = useMemo(() => normalizeRows(payload.items).filter((row: any) => matchesSearch(row, search)), [payload, search])
  const pendingRows = rows.filter((row: any) => row.status === 'pending_approval')
  const publishedRows = rows.filter((row: any) => row.status === 'published')
  const scheduledRows = rows.filter((row: any) => row.status === 'scheduled')
  const columns = [
    { key: 'title', label: 'Title' },
    { key: 'category', label: 'Category' },
    { key: 'targetDistrict', label: 'District', render: (row: any) => row.targetDistrict || '-' },
    { key: 'severity', label: 'Severity', render: (row: any) => renderPill(row.severity) },
    { key: 'status', label: 'Status', render: (row: any) => renderPill(row.status) },
    { key: 'updatedAt', label: 'Updated', render: (row: any) => normalizeDate(row.updatedAt) },
  ]

  const toggleChannel = (channel: string) => {
    setForm((current) => ({
      ...current,
      selectedChannels: current.selectedChannels.includes(channel)
        ? current.selectedChannels.filter((item) => item !== channel)
        : [...current.selectedChannels, channel],
    }))
  }

  const runNoticeAction = async (label: string, runner: () => Promise<any>) => {
    await runAction(runner, label, { refresh: false })
    load()
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto bg-[#f9fafb] p-4 text-[#111827]">
      <SectionKpiStrip
        columns={columns}
        items={[
          { label: 'Drafts / Queue', value: rows.length - publishedRows.length, rows: rows.filter((row: any) => row.status !== 'published'), accent: '#185FA5' },
          { label: 'Pending Approval', value: pendingRows.length, rows: pendingRows, tone: pendingRows.length ? 'warn' : 'good', accent: '#EF9F27' },
          { label: 'Scheduled', value: scheduledRows.length, rows: scheduledRows, accent: '#185FA5' },
          { label: 'Published', value: publishedRows.length, rows: publishedRows, tone: 'good', accent: '#1D9E75' },
        ]}
      />

      <Toolbar>
        <Button type="button" size="sm" className="bg-[#111827] hover:bg-[#111827]" onClick={() => setModalOpen(true)}>
          <Plus className="size-4" />
          Notice
        </Button>
        <ToolbarField label="Search notices" hint="Filter notices by title, category, status, region, district, or fuel type. Example: search shortage or Lilongwe." className="min-w-[260px] flex-1">
        <div className="flex items-center gap-2">
          <Search className="size-4 text-[#6b7280]" />
          <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Filter notices..." />
        </div>
        </ToolbarField>
        <Button type="button" variant="outline" size="sm" onClick={load} disabled={refreshing}>
          <RefreshCcw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </Toolbar>

      {error ? <div className="rounded-md border border-[#e2e8f0] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">{error}</div> : null}

      <div className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[1.35fr_0.85fr]">
        <SectionCard title="Public Notices" subtitle="Draft, approval, schedule, and internal publishing workflow">
          <PortalTable rows={rows} columns={columns} onRowClick={setSelected} emptyMessage={loading ? 'Loading notices...' : 'No public notices available.'} />
        </SectionCard>

        <SectionCard
          title="Notice Action Panel"
          subtitle="Supervisor approval and internal publishing controls"
          actions={selected ? renderPill(selected.status) : null}
        >
          <div className="space-y-3 px-4 py-4 text-sm">
            {selected ? (
              <>
                <div className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] p-3">
                  <div className="font-medium text-[#111827]">{selected.title}</div>
                  <div className="mt-1 text-xs text-[#6b7280]">{selected.category} • {selected.targetDistrict || 'National'}</div>
                  <p className="mt-3 text-xs leading-5 text-[#6b7280]">{selected.message}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => runNoticeAction('Submitting notice...', () => api.submitPublicNotice(token, selected.noticeId))}>
                    <Send className="size-4" />
                    Submit
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => runNoticeAction('Approving notice...', () => api.approvePublicNotice(token, selected.noticeId))}>
                    <CheckCircle2 className="size-4" />
                    Approve
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => runNoticeAction('Rejecting notice...', () => api.rejectPublicNotice(token, selected.noticeId, { reason: 'Rejected in command centre' }))}>
                    <XCircle className="size-4" />
                    Reject
                  </Button>
                  <Button type="button" size="sm" className="bg-[#111827] hover:bg-[#111827]" onClick={() => runNoticeAction('Publishing notice...', () => api.publishPublicNotice(token, selected.noticeId))}>
                    <UploadCloud className="size-4" />
                    Publish
                  </Button>
                </div>
                <div className="rounded-md border border-[#e2e8f0] bg-white p-3">
                  <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b7280]">External Channels</div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {normalizeRows(selected.selectedChannels).map((channel: any) => (
                      <span key={channel} className="rounded-md border border-[#e2e8f0] bg-[#f9fafb] px-2 py-1 text-[10px] font-medium text-[#6b7280]">{String(channel).replaceAll('_', ' ')}</span>
                    ))}
                  </div>
                  {normalizeRows(selected.externalPostStatus).length ? (
                    <div className="mt-3 space-y-1 text-[11px] text-[#6b7280]">
                      {normalizeRows(selected.externalPostStatus).map((item: any) => (
                        <div key={item.channel} className="flex justify-between gap-2">
                          <span>{String(item.channel).replaceAll('_', ' ')}</span>
                          <span>{item.status || 'not configured'}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="rounded-md border border-dashed border-[#e2e8f0] bg-[#f9fafb] p-4 text-[#6b7280]">
                Select a notice to review approval, scheduling, and publishing state.
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      <ModalShell
        open={modalOpen}
        onOpenChange={setModalOpen}
        title="Create Public Notice"
        description="Draft a MERA public communication for approval."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>Cancel</Button>
            <Button
              type="button"
              className="bg-[#111827] hover:bg-[#111827]"
              onClick={async () => {
                await runAction(() => api.createPublicNotice(token, form), 'Saving public notice...', { refresh: false })
                setModalOpen(false)
                load()
              }}
            >
              Save Draft
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <FieldShell label="Notice title" hint="Use a clear public-facing heading. Example: Fuel supply update for Lilongwe service stations.">
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Notice title" />
          </FieldShell>
          <FieldShell label="Public message" hint="Write the message exactly as the public should read it. Example: Diesel deliveries are scheduled for selected stations from 14:00.">
            <textarea className="min-h-28 w-full rounded-md border border-[#e2e8f0] px-3 py-2 text-sm text-[#6b7280]" value={form.message} onChange={(event) => setForm({ ...form, message: event.target.value })} placeholder="Public message" />
          </FieldShell>
          <div className="grid gap-3 sm:grid-cols-2">
            <FieldShell label="Category" hint="Classify the notice for publishing and filtering. Example: supply update, price notice, safety advisory.">
              <select className={`${fieldClass} w-full`} value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </FieldShell>
            <FieldShell label="Severity" hint="Set public urgency. Example: critical for safety or major disruption, low for routine updates.">
              <select className={`${fieldClass} w-full`} value={form.severity} onChange={(event) => setForm({ ...form, severity: event.target.value })}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </FieldShell>
            <FieldShell label="Target region" hint="Optional regional scope. Example: Central Region or Northern Region.">
              <Input value={form.targetRegion} onChange={(event) => setForm({ ...form, targetRegion: event.target.value })} placeholder="Target region" />
            </FieldShell>
            <FieldShell label="Target district" hint="Optional district scope. Example: Lilongwe, Blantyre, Mzimba.">
              <Input value={form.targetDistrict} onChange={(event) => setForm({ ...form, targetDistrict: event.target.value })} placeholder="Target district" />
            </FieldShell>
            <FieldShell label="Fuel type" hint="Optional product focus. Example: Petrol, Diesel, Paraffin, LPG.">
              <Input value={form.fuelType} onChange={(event) => setForm({ ...form, fuelType: event.target.value })} placeholder="Fuel type" />
            </FieldShell>
            <FieldShell label="Schedule time" hint="Optional scheduled publish time. Leave blank to keep as a draft until approved.">
              <input type="datetime-local" className={`${fieldClass} w-full`} value={form.scheduledAt} onChange={(event) => setForm({ ...form, scheduledAt: event.target.value })} />
            </FieldShell>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {channels.map((channel) => (
              <button
                key={channel}
                type="button"
                onClick={() => toggleChannel(channel)}
                className={`rounded-md border px-3 py-2 text-left text-[12px] font-medium ${
                  form.selectedChannels.includes(channel)
                    ? 'border-[#e2e8f0] bg-[#111827] text-white'
                    : 'border-[#e2e8f0] bg-white text-[#6b7280] hover:bg-[#f9fafb]'
                }`}
              >
                {channel.replaceAll('_', ' ')}
              </button>
            ))}
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
