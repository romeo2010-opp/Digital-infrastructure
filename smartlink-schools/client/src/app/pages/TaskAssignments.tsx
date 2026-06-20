import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { AlertTriangle, CheckCircle2, Clock3, FileText, Plus, RefreshCw, ShieldAlert } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { ModalShell } from '../components/ModalShell'
import { PageBackButton } from '../components/PageBackButton'
import { FieldShell, ToolbarField } from '../components/FieldLabel'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { Toolbar } from '../components/Toolbar'
import { KpiDrilldownCard, KpiDrilldownDrawer, type DrilldownConfig } from '../components/KpiDrilldown'
import { MERA_PERMISSIONS } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { matchesSearch, normalizeDate, normalizeRows, renderPill } from '../lib/portalUtils'

const fieldClass = 'h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-slate-400'
const taskTypes = [
  'CASE_REVIEW',
  'COMPLAINT_REVIEW',
  'STATION_INSPECTION',
  'HOARDING_INVESTIGATION',
  'PRICE_VIOLATION_REVIEW',
  'QUEUE_DISORDER_REVIEW',
  'TELEMETRY_MISMATCH_REVIEW',
  'FIELD_VISIT',
  'MANUAL_TASK',
]
const priorities = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']
const statuses = ['ASSIGNED', 'ACKNOWLEDGED', 'IN_PROGRESS', 'NEEDS_MORE_INFO', 'ESCALATED', 'COMPLETED', 'REJECTED', 'CANCELLED']

function isOverdue(task: any) {
  if (!task?.dueAt || ['COMPLETED', 'CANCELLED', 'REJECTED'].includes(String(task.status || '').toUpperCase())) return false
  return new Date(task.dueAt).getTime() < Date.now()
}

function taskPriorityPill(value: any) {
  const priority = String(value || '').toUpperCase()
  const classes =
    priority === 'CRITICAL'
      ? 'border-red-200 bg-red-50 text-red-700'
      : priority === 'HIGH'
        ? 'border-orange-200 bg-orange-50 text-orange-700'
        : priority === 'MEDIUM'
          ? 'border-blue-200 bg-blue-50 text-blue-700'
          : 'border-slate-200 bg-slate-50 text-slate-700'
  return <span className={`inline-flex rounded border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] ${classes}`}>{priority || '-'}</span>
}

function KpiStrip({ stats, myTasks, rows: sourceRows }: { stats: any; myTasks?: any; rows?: any[] }) {
  const [drilldown, setDrilldown] = useState<DrilldownConfig | null>(null)
  const source = normalizeRows(sourceRows || myTasks?.items)
  const byStatus = myTasks?.counts?.byStatus || stats?.byStatus || {}
  const columns = [
    { key: 'taskNumber', label: 'Task', render: (row: any) => row.taskNumber || '-' },
    { key: 'title', label: 'Title', render: (row: any) => row.title || '-' },
    { key: 'priority', label: 'Priority', render: (row: any) => row.priority || '-' },
    { key: 'status', label: 'Status', render: (row: any) => row.status || '-' },
    { key: 'dueAt', label: 'Due', render: (row: any) => normalizeDate(row.dueAt) },
  ]
  const cards = [
    { label: 'Assigned', value: stats?.myAssigned ?? byStatus.ASSIGNED ?? 0, rows: source.filter((task: any) => task.status === 'ASSIGNED'), tone: 'neutral' as const, accent: '#2563eb' },
    { label: 'In Progress', value: stats?.inProgress ?? byStatus.IN_PROGRESS ?? 0, rows: source.filter((task: any) => task.status === 'IN_PROGRESS'), tone: 'neutral' as const, accent: '#64748b' },
    { label: 'Overdue', value: stats?.overdue ?? source.filter(isOverdue).length, rows: source.filter(isOverdue), tone: 'bad' as const, accent: '#dc2626' },
    { label: 'Critical', value: stats?.critical ?? source.filter((task: any) => task.priority === 'CRITICAL').length, rows: source.filter((task: any) => task.priority === 'CRITICAL'), tone: 'bad' as const, accent: '#111827' },
    { label: 'Completed This Week', value: stats?.completedThisWeek ?? byStatus.COMPLETED ?? 0, rows: source.filter((task: any) => task.status === 'COMPLETED'), tone: 'good' as const, accent: '#10b981' },
  ]
  return (
    <>
      <div className="grid gap-3 md:grid-cols-5">
        {cards.map((card) => (
          <KpiDrilldownCard
            key={card.label}
            label={card.label}
            value={Number(card.value || 0)}
            delta={`${card.rows.length} rows`}
            helper="task records"
            tone={card.tone}
            accent={card.accent}
            onClick={() => setDrilldown({ title: card.label, value: Number(card.value || 0), subtitle: 'Task records represented by this KPI.', rows: card.rows, columns })}
          />
        ))}
      </div>
      <KpiDrilldownDrawer open={Boolean(drilldown)} onOpenChange={(open) => !open && setDrilldown(null)} drilldown={drilldown} />
    </>
  )
}

function TaskTable({
  rows,
  onOpen,
  onAcknowledge,
  onStart,
  onComplete,
  onManage,
  actionLoading = false,
}: {
  rows: any[]
  onOpen: (task: any) => void
  onAcknowledge?: (task: any) => void
  onStart?: (task: any) => void
  onComplete?: (task: any) => void
  onManage?: (task: any) => void
  actionLoading?: boolean
}) {
  return (
    <PortalTable
      rows={rows}
      onRowClick={onOpen}
      emptyMessage="No task assignments match this view."
      columns={[
        { key: 'taskNumber', label: 'Task No.' },
        { key: 'title', label: 'Title', render: (row) => <span className="font-medium text-slate-900">{row.title}</span> },
        { key: 'type', label: 'Type', render: (row) => renderPill(row.type) },
        { key: 'priority', label: 'Priority', render: (row) => taskPriorityPill(row.priority) },
        { key: 'status', label: 'Status', render: (row) => renderPill(row.status) },
        { key: 'stationName', label: 'Station', render: (row) => row.stationName || '-' },
        { key: 'district', label: 'District', render: (row) => row.district || '-' },
        {
          key: 'dueAt',
          label: 'Due Date',
          render: (row) => <span className={isOverdue(row) ? 'font-semibold text-red-700' : ''}>{normalizeDate(row.dueAt)}</span>,
        },
        { key: 'assignedBy', label: 'Assigned By', render: (row) => row.assignedBy?.fullName || '-' },
        {
          key: 'actions',
          label: 'Actions',
          render: (row) => (
            <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
              {row.status === 'ASSIGNED' && onAcknowledge ? <button disabled={actionLoading} className="text-[11px] font-semibold text-blue-700 disabled:opacity-50" onClick={() => onAcknowledge(row)}>Acknowledge</button> : null}
              {['ASSIGNED', 'ACKNOWLEDGED', 'NEEDS_MORE_INFO', 'ESCALATED'].includes(row.status) && onStart ? <button disabled={actionLoading} className="text-[11px] font-semibold text-blue-700 disabled:opacity-50" onClick={() => onStart(row)}>Start</button> : null}
              {['IN_PROGRESS', 'ESCALATED', 'NEEDS_MORE_INFO'].includes(row.status) && onComplete ? <button disabled={actionLoading} className="text-[11px] font-semibold text-emerald-700 disabled:opacity-50" onClick={() => onComplete(row)}>Complete</button> : null}
              {onManage ? <button disabled={actionLoading} className="text-[11px] font-semibold text-slate-700 disabled:opacity-50" onClick={() => onManage(row)}>Manage</button> : null}
              <button disabled={actionLoading} className="text-[11px] font-semibold text-slate-700 disabled:opacity-50" onClick={() => onOpen(row)}>Open</button>
            </div>
          ),
        },
      ]}
    />
  )
}

function filterTasks(rows: any[], filters: any) {
  return normalizeRows(rows).filter((row: any) => {
    if (filters.status && row.status !== filters.status) return false
    if (filters.priority && row.priority !== filters.priority) return false
    if (filters.type && row.type !== filters.type) return false
    if (filters.district && String(row.district || '').toLowerCase() !== filters.district.toLowerCase()) return false
    if (filters.overdue && !isOverdue(row)) return false
    if (filters.search && !matchesSearch(row, filters.search)) return false
    return true
  })
}

function TaskFilters({ filters, setFilters, includeAssignee = false, users = [] }: any) {
  return (
    <Toolbar>
      <ToolbarField label="Search tasks" hint="Filter tasks by title, number, station, district, linked entity, or evidence text. Example: TASK-2026 or overpricing.">
        <Input className="h-9 w-64" value={filters.search} onChange={(event) => setFilters({ ...filters, search: event.target.value })} placeholder="Search tasks..." />
      </ToolbarField>
      {includeAssignee ? (
        <ToolbarField label="Assignee" hint="Filter tasks by assigned MERA officer. Example: view work owned by one field officer.">
        <select className={fieldClass} value={filters.assignedTo} onChange={(event) => setFilters({ ...filters, assignedTo: event.target.value })}>
          <option value="">All assignees</option>
          {normalizeRows(users).map((user: any) => (
            <option key={user.publicId} value={user.publicId}>{user.fullName || user.name}</option>
          ))}
        </select>
        </ToolbarField>
      ) : null}
      <ToolbarField label="Status" hint="Filter by current task workflow state. Example: Escalated, In Progress, or Needs More Info.">
      <select className={fieldClass} value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}>
        <option value="">All statuses</option>
        {statuses.map((status) => <option key={status} value={status}>{status}</option>)}
      </select>
      </ToolbarField>
      <ToolbarField label="Priority" hint="Filter tasks by urgency. Example: Critical for safety or high-risk enforcement work.">
      <select className={fieldClass} value={filters.priority} onChange={(event) => setFilters({ ...filters, priority: event.target.value })}>
        <option value="">All priorities</option>
        {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
      </select>
      </ToolbarField>
      <ToolbarField label="Task type" hint="Filter by assignment category. Example: Station Inspection or Complaint Review.">
      <select className={fieldClass} value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value })}>
        <option value="">All types</option>
        {taskTypes.map((type) => <option key={type} value={type}>{type}</option>)}
      </select>
      </ToolbarField>
      <ToolbarField label="Overdue only" hint="Show only tasks past their due date and not yet closed. Example: overdue inspection assignments.">
        <label className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700">
          <input type="checkbox" checked={filters.overdue} onChange={(event) => setFilters({ ...filters, overdue: event.target.checked })} />
          Overdue
        </label>
      </ToolbarField>
    </Toolbar>
  )
}

export function MyTasks() {
  const navigate = useNavigate()
  const { data, runAction, api, token, actionLoading } = usePortal()
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', type: '', district: '', overdue: false })
  const rows = useMemo(() => filterTasks(data.myTasks?.items, filters), [data.myTasks, filters])

  const complete = async (task: any) => {
    const notes = window.prompt('Completion notes are required.')
    if (!notes?.trim()) return
    await runAction(() => api.completeTask(token, task.taskNumber, notes.trim()), 'Completing task...')
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <KpiStrip stats={data.taskStats} myTasks={data.myTasks} rows={normalizeRows(data.myTasks?.items)} />
      <TaskFilters filters={filters} setFilters={setFilters} />
      <SectionCard title="My Assigned Tasks" subtitle="Officer work queue and regulatory actions assigned to this account">
        <TaskTable
          rows={rows}
          onOpen={(task) => navigate(`/tasks/${task.taskNumber}`)}
          onAcknowledge={(task) => runAction(() => api.changeTaskStatus(token, task.taskNumber, 'ACKNOWLEDGED'), 'Acknowledging task...')}
          onStart={(task) => runAction(() => api.changeTaskStatus(token, task.taskNumber, 'IN_PROGRESS'), 'Starting task...')}
          onComplete={complete}
          actionLoading={actionLoading}
        />
      </SectionCard>
    </div>
  )
}

export function TaskOperations() {
  const navigate = useNavigate()
  const { data, runAction, api, token, hasAnyPermission, actionLoading } = usePortal()
  const canManage = hasAnyPermission([MERA_PERMISSIONS.TASKS_CREATE, MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_MANAGE])
  const [filters, setFilters] = useState({ search: '', status: '', priority: '', type: '', district: '', assignedTo: '', overdue: false })
  const [selectedTask, setSelectedTask] = useState<any>(null)
  const [manageForm, setManageForm] = useState({ assignedToUserPublicId: '', priority: 'MEDIUM', dueAt: '' })
  const rows = useMemo(() => {
    return filterTasks(data.tasks?.items, filters).filter((task: any) => !filters.assignedTo || task.assignedTo?.publicId === filters.assignedTo)
  }, [data.tasks, filters])

  const openManage = (task: any) => {
    setSelectedTask(task)
    setManageForm({
      assignedToUserPublicId: task.assignedTo?.publicId || '',
      priority: task.priority || 'MEDIUM',
      dueAt: task.dueAt ? String(task.dueAt).slice(0, 16) : '',
    })
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <KpiStrip stats={data.taskStats} rows={normalizeRows(data.tasks?.items)} />
      <Toolbar>
        {canManage ? (
          <Button type="button" size="sm" className="bg-blue-700 hover:bg-blue-800" onClick={() => navigate('/tasks/new')} disabled={actionLoading}>
            <Plus className="size-4" />
            Create Task
          </Button>
        ) : null}
        <Button type="button" variant="outline" size="sm" onClick={() => navigate('/tasks/my')} disabled={actionLoading}>My Tasks</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => runAction(() => api.listTasks(token), 'Refreshing tasks...')} disabled={actionLoading}>
          <RefreshCw className="size-4" />
          Refresh
        </Button>
      </Toolbar>
      <TaskFilters filters={filters} setFilters={setFilters} includeAssignee users={data.assignableUsers} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard title="Task Operations" subtitle="Supervisor assignment queue, escalation posture, and overdue regulatory actions">
          <TaskTable rows={rows} onOpen={(task) => navigate(`/tasks/${task.taskNumber}`)} onManage={canManage ? openManage : undefined} actionLoading={actionLoading} />
        </SectionCard>
        <SectionCard title="Officer Workload" subtitle="Open workload and overdue assignments by officer">
          <PortalTable
            rows={normalizeRows(data.taskStats?.workloadByOfficer)}
            emptyMessage="No workload records available."
            columns={[
              { key: 'fullName', label: 'Officer' },
              { key: 'openTasks', label: 'Open' },
              { key: 'pendingAcknowledgement', label: 'Pending Ack' },
              { key: 'escalatedTasks', label: 'Escalated' },
              { key: 'overdueTasks', label: 'Overdue', render: (row) => <span className={row.overdueTasks ? 'font-semibold text-red-700' : ''}>{row.overdueTasks}</span> },
            ]}
          />
        </SectionCard>
      </div>

      <ModalShell
        open={Boolean(selectedTask)}
        onOpenChange={(open) => !open && setSelectedTask(null)}
        title={selectedTask ? `Manage ${selectedTask.taskNumber}` : 'Manage Task'}
        description="Update assignment controls for the selected regulatory task."
        footer={
          <>
            <Button type="button" variant="outline" onClick={() => setSelectedTask(null)} disabled={actionLoading}>Close</Button>
            {selectedTask && !['COMPLETED', 'CANCELLED', 'REJECTED'].includes(selectedTask.status) ? (
              <Button
                type="button"
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                disabled={actionLoading}
                onClick={async () => {
                  const reason = window.prompt('Cancellation reason')
                  if (!reason?.trim()) return
                  await runAction(() => api.changeTaskStatus(token, selectedTask.taskNumber, 'CANCELLED', reason.trim()), 'Cancelling task...')
                  setSelectedTask(null)
                }}
              >
                Cancel Task
              </Button>
            ) : null}
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              onClick={async () => {
                await runAction(() =>
                  api.updateTask(token, selectedTask.taskNumber, {
                    assignedToUserPublicId: manageForm.assignedToUserPublicId,
                    priority: manageForm.priority,
                    dueAt: manageForm.dueAt || null,
                  }),
                  'Saving task changes...',
                )
                setSelectedTask(null)
              }}
              disabled={!selectedTask || actionLoading}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <div className="grid gap-3">
          <FieldShell label="Assignee" hint="Choose the MERA officer who owns the task. Example: assign a field inspection follow-up to the district compliance officer.">
            <select className={`${fieldClass} w-full`} value={manageForm.assignedToUserPublicId} onChange={(event) => setManageForm({ ...manageForm, assignedToUserPublicId: event.target.value })}>
              <option value="">Select assignee</option>
              {normalizeRows(data.assignableUsers).map((user: any) => (
                <option key={user.publicId} value={user.publicId}>{user.fullName || user.name} - {user.roleDisplayName || user.role}</option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Priority" hint="Use priority to signal urgency. Example: CRITICAL for safety risks or verified illegal vending; HIGH for urgent station follow-up.">
            <select className={`${fieldClass} w-full`} value={manageForm.priority} onChange={(event) => setManageForm({ ...manageForm, priority: event.target.value })}>
              {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Due date" hint="Set the expected completion deadline. Example: same day for an active shortage response, next week for a routine licence review.">
            <Input type="datetime-local" value={manageForm.dueAt} onChange={(event) => setManageForm({ ...manageForm, dueAt: event.target.value })} />
          </FieldShell>
          {selectedTask ? (
            <Button
              type="button"
              variant="outline"
              disabled={actionLoading}
              onClick={async () => {
                const reason = window.prompt('Escalation reason')
                if (!reason?.trim()) return
                await runAction(() => api.escalateTask(token, selectedTask.taskNumber, { reason: reason.trim() }), 'Escalating task...')
                setSelectedTask(null)
              }}
            >
              Escalate
            </Button>
          ) : null}
        </div>
      </ModalShell>
    </div>
  )
}

export function CreateTask() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { data, runAction, api, token, actionLoading } = usePortal()
  const [form, setForm] = useState(() => ({
    title: searchParams.get('title') || '',
    description: searchParams.get('description') || '',
    type: searchParams.get('type') || 'MANUAL_TASK',
    category: searchParams.get('category') || '',
    priority: searchParams.get('priority') || 'MEDIUM',
    assignedToUserPublicId: '',
    dueAt: '',
    district: searchParams.get('district') || '',
    stationPublicId: searchParams.get('stationPublicId') || '',
    stationName: searchParams.get('stationName') || '',
    linkedEntityType: searchParams.get('linkedEntityType') || '',
    linkedEntityId: searchParams.get('linkedEntityId') || '',
    evidenceSummary: '',
  }))
  const [message, setMessage] = useState('')

  return (
    <div className="h-full overflow-y-auto p-4">
      <SectionCard title="Create Assignment" subtitle="Supervisor assignment form for regulatory casework and field action">
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <FieldShell label="Task title" hint="Use a short action-oriented title. Example: Investigate pump price mismatch at Area 18 Total.">
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="Task title" />
          </FieldShell>
          <FieldShell label="Task type" hint="Classify the work so it routes into the right operational bucket. Example: PRICE_VIOLATION_REVIEW for overpricing evidence.">
            <select className={`${fieldClass} w-full`} value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
              {taskTypes.map((type) => <option key={type} value={type}>{type}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Category" hint="Add a human-readable grouping for reporting. Example: Pricing, Hoarding, Queue Control, or Licensing.">
            <Input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Category" />
          </FieldShell>
          <FieldShell label="Priority" hint="Set urgency based on public impact and risk. Example: CRITICAL for public safety, HIGH for active fuel manipulation.">
            <select className={`${fieldClass} w-full`} value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}>
              {priorities.map((priority) => <option key={priority} value={priority}>{priority}</option>)}
            </select>
          </FieldShell>
          <FieldShell label="Assigned officer" hint="Select the MERA officer responsible for the next action. Example: the district inspector covering the station.">
            <select className={`${fieldClass} w-full`} value={form.assignedToUserPublicId} onChange={(event) => setForm({ ...form, assignedToUserPublicId: event.target.value })}>
              <option value="">Assign to officer</option>
              {normalizeRows(data.assignableUsers).map((user: any) => (
                <option key={user.publicId} value={user.publicId}>{user.fullName || user.name} - {user.roleDisplayName || user.role}</option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Due date" hint="Choose when the task should be completed. Example: today 17:00 for a shortage response, Friday 12:00 for documentation review.">
            <Input type="datetime-local" value={form.dueAt} onChange={(event) => setForm({ ...form, dueAt: event.target.value })} />
          </FieldShell>
          <FieldShell label="District" hint="Limits the operational scope and reporting district. Example: Lilongwe, Blantyre, Mzuzu.">
            <Input value={form.district} onChange={(event) => setForm({ ...form, district: event.target.value })} placeholder="District" />
          </FieldShell>
          <FieldShell label="Station" hint="Link a station when the task concerns a specific site. Example: selecting a station fills the station and district context.">
            <select
              className={`${fieldClass} w-full`}
              value={form.stationPublicId}
              onChange={(event) => {
                const station = normalizeRows(data.profiles).find((item: any) => item.public_id === event.target.value)
                setForm({ ...form, stationPublicId: event.target.value, stationName: station?.name || form.stationName, district: station?.city || form.district })
              }}
            >
              <option value="">No station selected</option>
              {normalizeRows(data.profiles).map((station: any) => (
                <option key={station.public_id} value={station.public_id}>{station.name} - {station.city || 'No district'}</option>
              ))}
            </select>
          </FieldShell>
          <FieldShell label="Linked entity type" hint="Connect the source record type. Example: COMPLAINT, INSPECTION, COMPLIANCE_FLAG, STATION, or ENFORCEMENT_ACTION.">
            <Input value={form.linkedEntityType} onChange={(event) => setForm({ ...form, linkedEntityType: event.target.value })} placeholder="Linked entity type" />
          </FieldShell>
          <FieldShell label="Linked entity ID" hint="Paste the public ID for the source record. Example: a complaint ID, inspection reference, or station public ID.">
            <Input value={form.linkedEntityId} onChange={(event) => setForm({ ...form, linkedEntityId: event.target.value })} placeholder="Linked entity ID" />
          </FieldShell>
          <FieldShell className="lg:col-span-2" label="Description" hint="Explain what the officer should verify and what outcome is expected. Example: Confirm displayed petrol price and collect pump photo evidence.">
            <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Description" />
          </FieldShell>
          <FieldShell className="lg:col-span-2" label="Evidence summary" hint="Summarize the evidence that caused this task. Example: Three complaints and a station price report show MWK 150/litre above official price.">
            <Textarea value={form.evidenceSummary} onChange={(event) => setForm({ ...form, evidenceSummary: event.target.value })} placeholder="Evidence summary" />
          </FieldShell>
        </div>
        <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
          <div className="text-xs font-medium text-slate-500">{message}</div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/tasks')} disabled={actionLoading}>Cancel</Button>
            <Button
              type="button"
              className="bg-blue-700 hover:bg-blue-800"
              disabled={actionLoading}
              onClick={async () => {
                setMessage('')
                const task = await runAction(() => api.createTask(token, { ...form, dueAt: form.dueAt || null }), 'Creating task assignment...')
                setMessage('Task assignment created.')
                if (task?.taskNumber) navigate(`/tasks/${task.taskNumber}`)
              }}
            >
              Create Task
            </Button>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

export function TaskDetails() {
  const { taskNumber = '' } = useParams()
  const navigate = useNavigate()
  const { api, token, runAction, hasAnyPermission, data, actionLoading } = usePortal()
  const [task, setTask] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [completionNotes, setCompletionNotes] = useState('')
  const [evidence, setEvidence] = useState<any>({ evidenceType: 'DOCUMENT', title: '', description: '', file: null })
  const canManage = hasAnyPermission([MERA_PERMISSIONS.TASKS_MANAGE, MERA_PERMISSIONS.TASKS_ASSIGN, MERA_PERMISSIONS.TASKS_VIEW_ALL])

  const loadTask = async () => {
    setLoading(true)
    setError('')
    try {
      setTask(await api.getTask(token, taskNumber))
    } catch (err: any) {
      setError(err?.message || 'Unable to load task.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (token && taskNumber) loadTask()
  }, [token, taskNumber])

  const refreshAfter = async (runner: () => Promise<any>, label = 'Updating task...') => {
    const result = await runAction(runner, label)
    setTask(result || (await api.getTask(token, taskNumber)))
    return result
  }

  if (loading) return <div className="p-4"><PageBackButton fallback="/tasks" /><div className="mt-4 text-sm text-slate-500">Loading task...</div></div>
  if (error) return <div className="p-4"><PageBackButton fallback="/tasks" /><div className="mt-4 text-sm text-red-700">{error}</div></div>
  if (!task) return <div className="p-4"><PageBackButton fallback="/tasks" /><div className="mt-4 text-sm text-slate-500">Task not found.</div></div>

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto bg-white p-5 text-[#111827] lg:p-6">
      <PageBackButton fallback="/tasks" />
      <div className="overflow-hidden rounded-[8px] border border-[#e5e7eb] bg-white shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
        <div className="border-b border-[#f3f4f6] px-5 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[12px] font-semibold uppercase tracking-[0.1em] text-[#6b7280]">{task.taskNumber}</div>
            <h2 className="mt-2 max-w-4xl break-words text-[26px] font-semibold tracking-[-0.05em] text-[#111827]">{task.title}</h2>
            <div className="mt-2 flex flex-wrap gap-2">{renderPill(task.status)}{taskPriorityPill(task.priority)}{renderPill(task.type)}{isOverdue(task) ? renderPill('OVERDUE') : null}</div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => navigate('/tasks/my')} disabled={actionLoading}>My Tasks</Button>
            {canManage ? <Button type="button" className="bg-[#111111] hover:bg-[#2a2a2a]" onClick={() => navigate('/tasks')} disabled={actionLoading}>Task Operations</Button> : null}
          </div>
        </div>
        </div>
        <div className="grid gap-3 bg-[#fafafa] px-5 py-4 md:grid-cols-4">
          {[
            ['Due', normalizeDate(task.dueAt), isOverdue(task) ? 'text-red-700' : 'text-[#111827]'],
            ['Assigned officer', task.assignedTo?.fullName || '-', 'text-[#111827]'],
            ['Assigned by', task.assignedBy?.fullName || '-', 'text-[#111827]'],
            ['District', task.district || '-', 'text-[#111827]'],
          ].map(([label, value, color]) => (
            <div key={label} className="min-w-0 rounded-[8px] border border-[#e5e7eb] bg-white px-4 py-3">
              <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">{label}</div>
              <div className={`mt-2 break-words text-[16px] font-semibold tracking-[-0.03em] ${color}`}>{value}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid gap-4">
          <SectionCard title="Task Summary">
            <div className="space-y-4 p-5 text-[13px] font-medium text-[#4b5563]">
              <p className="break-words leading-6">{task.description}</p>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ['Station', task.stationName || '-'],
                  ['Linked Entity', `${task.linkedEntityType || '-'} ${task.linkedEntityId || ''}`.trim()],
                  ['Category', task.category || '-'],
                ].map(([label, value]) => (
                  <div key={label} className="min-w-0 rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#6b7280]">{label}</div>
                    <div className="mt-2 break-words text-[13px] font-semibold text-[#111827]">{value}</div>
                  </div>
                ))}
              </div>
              {task.evidenceSummary ? <div className="rounded-[8px] border border-[#e5e7eb] bg-[#fafafa] p-3 text-[12px] leading-5 text-[#4b5563]">{task.evidenceSummary}</div> : null}
            </div>
          </SectionCard>

          <SectionCard title="Linked Record">
            <div className="p-5 text-[13px] font-medium text-[#4b5563]">
              {task.linkedEntitySummary ? (
                <div className="grid gap-2">
                  <div className="break-words text-[15px] font-semibold text-[#111827]">{task.linkedEntitySummary.title || task.linkedEntitySummary.id}</div>
                  <div className="break-words leading-6">{task.linkedEntitySummary.description || 'No linked summary available.'}</div>
                  <div className="flex gap-2">{task.linkedEntitySummary.status ? renderPill(task.linkedEntitySummary.status) : null}{task.linkedEntitySummary.priority ? taskPriorityPill(task.linkedEntitySummary.priority) : null}</div>
                </div>
              ) : (
                <span className="text-[#6b7280]">No linked record.</span>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Notes">
            <div className="divide-y divide-slate-200">
              {normalizeRows(task.notes).length ? normalizeRows(task.notes).map((item: any) => (
                <div key={item.id} className="px-4 py-3 text-sm">
                  <div className="flex justify-between gap-3 text-xs text-slate-500"><span>{item.author?.fullName || 'MERA user'} - {item.visibility}</span><span>{normalizeDate(item.createdAt)}</span></div>
                  <p className="mt-2 text-slate-700">{item.note}</p>
                </div>
              )) : <div className="p-4 text-sm text-slate-500">No notes recorded.</div>}
            </div>
            <div className="border-t border-slate-200 p-4">
              <FieldShell label="Task note" hint="Add operational context or a handover update. Example: Called station manager; requested updated pump photo before 14:00.">
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add note" disabled={actionLoading} />
              </FieldShell>
              <div className="mt-2 flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  className="bg-blue-700 hover:bg-blue-800"
                  disabled={actionLoading || !note.trim()}
                  onClick={async () => {
                    if (!note.trim()) return
                    await refreshAfter(() => api.addTaskNote(token, task.taskNumber, { note: note.trim(), visibility: 'INTERNAL' }), 'Adding task note...')
                    setNote('')
                  }}
                >
                  Add Note
                </Button>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="grid gap-4 content-start">
          <SectionCard title="Workflow Actions">
            <div className="grid gap-2 p-4">
              {task.status === 'ASSIGNED' ? <Button type="button" variant="outline" disabled={actionLoading} onClick={() => refreshAfter(() => api.changeTaskStatus(token, task.taskNumber, 'ACKNOWLEDGED'), 'Acknowledging task...')}>Acknowledge</Button> : null}
              {['ASSIGNED', 'ACKNOWLEDGED', 'NEEDS_MORE_INFO', 'ESCALATED'].includes(task.status) ? <Button type="button" variant="outline" disabled={actionLoading} onClick={() => refreshAfter(() => api.changeTaskStatus(token, task.taskNumber, 'IN_PROGRESS'), 'Starting task...')}>Start Work</Button> : null}
              {['ACKNOWLEDGED', 'IN_PROGRESS'].includes(task.status) ? <Button type="button" variant="outline" disabled={actionLoading} onClick={() => refreshAfter(() => api.changeTaskStatus(token, task.taskNumber, 'NEEDS_MORE_INFO'), 'Requesting more information...')}>Request More Info</Button> : null}
              {!['COMPLETED', 'CANCELLED', 'REJECTED'].includes(task.status) ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-red-200 text-red-700 hover:bg-red-50"
                  disabled={actionLoading}
                  onClick={() => {
                    const reason = window.prompt('Escalation reason')
                    if (!reason?.trim()) return
                    refreshAfter(() => api.escalateTask(token, task.taskNumber, { reason: reason.trim() }), 'Escalating task...')
                  }}
                >
                  Escalate
                </Button>
              ) : null}
              {canManage && task.status === 'COMPLETED' ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={actionLoading}
                  onClick={() => {
                    const reason = window.prompt('Reopen reason')
                    if (!reason?.trim()) return
                    refreshAfter(() => api.changeTaskStatus(token, task.taskNumber, 'IN_PROGRESS', reason.trim()), 'Reopening task...')
                  }}
                >
                  Reopen
                </Button>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard title="Completion Panel">
            <div className="grid gap-3 p-4">
              <FieldShell label="Completion notes" hint="Record what was completed and the final finding. Example: Price corrected to official MERA rate; evidence attached.">
                <Textarea value={completionNotes} onChange={(event) => setCompletionNotes(event.target.value)} placeholder="Completion notes" disabled={actionLoading} />
              </FieldShell>
              <Button
                type="button"
                className="bg-emerald-700 hover:bg-emerald-800"
                disabled={actionLoading || !['IN_PROGRESS', 'ESCALATED', 'NEEDS_MORE_INFO'].includes(task.status)}
                onClick={async () => {
                  if (!completionNotes.trim()) return
                  await refreshAfter(() => api.completeTask(token, task.taskNumber, completionNotes.trim()), 'Completing task...')
                  setCompletionNotes('')
                }}
              >
                Complete Task
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Evidence">
            <div className="divide-y divide-slate-200">
              {normalizeRows(task.evidence).map((item: any) => (
                <button key={item.id} type="button" className="block w-full px-4 py-3 text-left text-xs transition hover:bg-slate-50" onClick={() => navigate(`/documents/task-evidence/${item.id}`)}>
                  <div className="font-semibold text-slate-900">{item.title}</div>
                  <div className="mt-1 text-slate-500">{item.evidenceType} - {normalizeDate(item.createdAt)}</div>
                  <span className="mt-1 block text-blue-700">{item.fileUrl ? 'Open evidence detail / file' : 'Open evidence detail'}</span>
                </button>
              ))}
              {!normalizeRows(task.evidence).length ? <div className="p-4 text-sm text-slate-500">No evidence attached.</div> : null}
            </div>
            <div className="grid gap-2 border-t border-slate-200 p-4">
              <FieldShell label="Evidence title" hint="Name the file so reviewers know what it proves. Example: Pump price board photo, signed inspection sheet, or station manager statement.">
                <Input value={evidence.title} onChange={(event) => setEvidence({ ...evidence, title: event.target.value })} placeholder="Evidence title" disabled={actionLoading} />
              </FieldShell>
              <FieldShell label="Evidence file" hint="Attach the document, image, or video supporting this task update. Example: JPG pump photo, PDF notice, or MP4 queue footage.">
                <Input type="file" onChange={(event) => setEvidence({ ...evidence, file: event.target.files?.[0] || null })} disabled={actionLoading} />
              </FieldShell>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={actionLoading}
                onClick={async () => {
                  if (!evidence.file && !evidence.title) return
                  await refreshAfter(() => api.addTaskEvidence(token, task.taskNumber, evidence), 'Attaching evidence...')
                  setEvidence({ evidenceType: 'DOCUMENT', title: '', description: '', file: null })
                }}
              >
                Attach Evidence
              </Button>
            </div>
          </SectionCard>
        </div>
      </div>

      <SectionCard title="Activity Timeline">
        <div className="divide-y divide-slate-200">
          {normalizeRows(task.activityLogs).map((item: any) => (
            <div key={item.id} className="grid gap-2 px-4 py-3 text-xs md:grid-cols-[160px_1fr_180px]">
              <span className="text-slate-500">{normalizeDate(item.createdAt)}</span>
              <span className="font-medium text-slate-800">{item.action} {item.oldValue ? `${item.oldValue} -> ${item.newValue || '-'}` : item.newValue || ''}</span>
              <span className="text-slate-500">{item.actor?.fullName || 'System'}</span>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}
