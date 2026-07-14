import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import {
  AlertTriangle,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  DoorOpen,
  Eye,
  Plus,
  RefreshCcw,
  Send,
  Sparkles,
  UploadCloud,
  Users,
} from 'lucide-react'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { Toolbar } from '../components/Toolbar'
import { PageBackButton } from '../components/PageBackButton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { usePortal } from '../lib/portalContext'

function pretty(value: any) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function dateText(value: any) {
  if (!value) return '-'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value).slice(0, 10) : date.toLocaleDateString()
}

function dateInputValue(value: any) {
  if (!value) return ''
  return String(value).slice(0, 10)
}

function selectClassName() {
  return 'h-9 w-full rounded-[5px] border border-[#d9dce3] bg-white px-3 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35 disabled:bg-[#f3f4f6] disabled:text-[#9ca3af]'
}

function statusTone(status: any) {
  const value = String(status || '').toUpperCase()
  if (['PUBLISHED', 'APPROVED', 'READY'].includes(value)) return 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
  if (['UNDER_REVIEW', 'GENERATING', 'DRAFT'].includes(value)) return 'border-[#bfdbfe] bg-[#eff6ff] text-[#1d4ed8]'
  if (['CHANGES_REQUESTED', 'VALIDATION_REQUIRED', 'SETUP'].includes(value)) return 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
  if (['ARCHIVED', 'SUPERSEDED'].includes(value)) return 'border-[#e5e7eb] bg-[#f8fafc] text-[#4b5563]'
  return 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
}

function StatusPill({ value }: { value: any }) {
  return <span className={`inline-flex rounded-[4px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${statusTone(value)}`}>{pretty(value)}</span>
}

function solverJobMessage(job: any, fallback: string) {
  return String(job?.user_message || job?.message || fallback)
}

function sameId(left: any, right: any) {
  if (left === null || left === undefined || right === null || right === undefined) return false
  return String(left) === String(right)
}

function shortTime(value: any) {
  if (!value) return ''
  const text = String(value)
  const match = text.match(/(\d{1,2}):(\d{2})/)
  if (!match) return text
  return `${match[1].padStart(2, '0')}.${match[2]}`
}

function slotTimeLabel(slot: any) {
  return shortTime(slot?.start_time) || slot?.display_name || slot?.code || '-'
}

function slotTimeRangeLabel(slot: any) {
  const start = shortTime(slot?.start_time)
  const end = shortTime(slot?.end_time)
  return [start, end].filter(Boolean).join(' - ') || slot?.display_name || slot?.code || '-'
}

function slotSortValue(slot: any, index: number) {
  return Number(slot?.sort_order || slot?.slot_number || index)
}

function slotRowKey(slot: any) {
  return [
    slot?.sort_order || slot?.slot_number || '',
    shortTime(slot?.start_time),
    shortTime(slot?.end_time),
    slot?.display_name || slot?.code || '',
    slot?.slot_type || '',
  ].join('|')
}

function entryTitle(entry: any) {
  return entry.subject_name || entry.title || entry.weekly_activity_name || pretty(entry.entry_type)
}

function entryMeta(entry: any) {
  return [entry.teacher_name, entry.facility_name || entry.room_name].filter(Boolean).join(' / ')
}

function entryCoversSlot(entry: any, slot: any, slotIndex: Map<string, number>) {
  if (sameId(entry.slot_start_id, slot.id)) return true
  const current = slotIndex.get(String(slot.id))
  const start = slotIndex.get(String(entry.slot_start_id))
  const end = slotIndex.get(String(entry.slot_end_id || entry.slot_start_id))
  if (current === undefined || start === undefined || end === undefined) return false
  return current >= start && current <= end
}

function cycleWeekCount(timetable: any) {
  const value = Number(timetable?.timetable_cycle_weeks || timetable?.timetableCycleWeeks || 1)
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 1
}

function entryBelongsToClass(entry: any, classId: any) {
  if (!classId) return false
  if (sameId(entry.class_id, classId)) return true
  if (entry.class_id) return false
  const type = String(entry.entry_type || '').toUpperCase()
  return Boolean(entry.weekly_activity_name) || ['WEEKLY_ACTIVITY', 'ASSEMBLY', 'CHAPEL', 'RELIGIOUS_PROGRAMME', 'CLUB', 'SPORTS', 'STUDY', 'STAFF_MEETING', 'CUSTOM'].includes(type)
}

function ClassTimetableGrid({
  classes,
  selectedClassId,
  onSelectClass,
  cycleDays,
  bellSlots,
  dayTemplates,
  entries,
  timetableCycleWeeks = 1,
}: {
  classes: any[]
  selectedClassId: string
  onSelectClass: (value: string) => void
  cycleDays: any[]
  bellSlots: any[]
  dayTemplates: any[]
  entries: any[]
  timetableCycleWeeks?: number
}) {
  const weeks = Array.from({ length: Math.max(1, Number(timetableCycleWeeks || 1)) }, (_, index) => index + 1)
  const [selectedWeek, setSelectedWeek] = useState(1)
  const selectedClass = classes.find((row) => sameId(row.id, selectedClassId))
  const slots = [...(bellSlots || [])].sort((a, b) => slotSortValue(a, 0) - slotSortValue(b, 0))
  const days = [...(cycleDays || [])].filter((day) => Number(day.active ?? 1) === 1)
  const slotsByTemplate = new Map<string, any[]>()
  slots.forEach((slot) => {
    const key = String(slot.template_id || '')
    slotsByTemplate.set(key, [...(slotsByTemplate.get(key) || []), slot])
  })
  const templateByDay = new Map((dayTemplates || []).filter((row) => Number(row.active ?? 1) === 1).map((row) => [String(row.cycle_day_id), String(row.bell_template_id)]))
  const slotsForDay = (day: any) => {
    const templateId = templateByDay.get(String(day.id))
    const daySlots = templateId ? slotsByTemplate.get(templateId) : null
    return daySlots?.length ? daySlots : slots
  }
  const rowSlotMap = new Map<string, any>()
  days.forEach((day) => slotsForDay(day).forEach((slot) => {
    const key = slotRowKey(slot)
    if (!rowSlotMap.has(key)) rowSlotMap.set(key, slot)
  }))
  const rowSlots = Array.from(rowSlotMap.values()).sort((a, b) => slotSortValue(a, 0) - slotSortValue(b, 0) || String(a.start_time || '').localeCompare(String(b.start_time || '')))
  const slotIndex = new Map(slots.map((slot, index) => [String(slot.id), index]))
  useEffect(() => {
    if (!weeks.includes(selectedWeek)) setSelectedWeek(1)
  }, [selectedWeek, weeks.length])

  const selectedEntries = entries.filter((entry) => entryBelongsToClass(entry, selectedClassId) && Number(entry.cycle_week || entry.cycleWeek || 1) === selectedWeek)

  return (
    <SectionCard
      title="Class Timetable"
      subtitle={selectedClass ? `${selectedClass.name} weekly view in timetable-grid format.` : 'Choose a class to view the timetable grid.'}
      actions={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {weeks.length > 1 ? (
            <div className="flex rounded-[5px] border border-[#d9dce3] bg-white p-0.5">
              {weeks.map((week) => (
                <button key={week} type="button" onClick={() => setSelectedWeek(week)} className={`h-7 rounded-[4px] px-2 text-[11px] font-bold ${selectedWeek === week ? 'bg-[#111827] text-white' : 'text-[#64748b] hover:bg-[#f3f4f6]'}`}>Week {week}</button>
              ))}
            </div>
          ) : null}
          <select value={selectedClassId} onChange={(event) => onSelectClass(event.target.value)} className={`${selectClassName()} max-w-[220px]`}>
            <option value="">Select class</option>
            {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </div>
      }
    >
      {!selectedClassId ? (
        <div className="grid place-items-center gap-2 px-4 py-12 text-center">
          <Users className="size-8 text-[#9ca3af]" />
          <div className="text-[13px] font-semibold text-[#111827]">Select a class</div>
          <p className="max-w-md text-[12px] leading-5 text-[#6b7280]">The class timetable will open in a day-by-period grid.</p>
        </div>
      ) : !days.length || !slots.length ? (
        <div className="grid place-items-center px-4 py-12 text-center text-[12px] font-semibold text-[#64748b]">
          Add cycle days and bell slots before this timetable can render as a grid.
        </div>
      ) : (
        <div className="p-4">
          <div className="overflow-auto rounded-[8px] border border-[#d7dce5] bg-white">
            <table className="w-full min-w-[860px] table-fixed border-collapse text-center">
              <thead>
                <tr>
                  <th className="w-[132px] border-r border-[#d7dce5] bg-[#f8fafc] px-3 py-3 text-left text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">Time</th>
                  {days.map((day) => (
                    <th key={day.id} className="border-r border-[#d7dce5] bg-[#f8fafc] px-3 py-3 text-[12px] font-bold text-[#111827] last:border-r-0">
                      {day.display_name || day.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rowSlots.map((slot, slotPosition) => {
                  const teaching = Number(slot.teaching_allowed ?? 1) === 1
                  return (
                    <tr key={slotRowKey(slot)} className={teaching ? 'bg-white' : 'bg-[#fbfcfe]'}>
                      <th className="border-r border-t border-[#d7dce5] bg-[#fbfcfe] px-3 py-3 text-left align-top">
                        <span className="block text-[12px] font-bold text-[#111827]">{slotTimeLabel(slot)}</span>
                        <span className="mt-0.5 block text-[10px] font-semibold text-[#64748b]">{slotTimeRangeLabel(slot)}</span>
                      </th>
                      {days.map((day) => {
                        const daySlot = slotsForDay(day).find((candidate) => slotRowKey(candidate) === slotRowKey(slot))
                        const cellEntries = daySlot ? selectedEntries.filter((entry) => sameId(entry.cycle_day_id, day.id) && entryCoversSlot(entry, daySlot, slotIndex)) : []
                        const slotLabel = String(daySlot?.display_name || daySlot?.slot_type || slot.display_name || slot.slot_type || '').toUpperCase()
                        return (
                          <td key={`${day.id}-${slotRowKey(slot)}`} className="h-[62px] border-r border-t border-[#d7dce5] px-2 py-2 align-middle last:border-r-0">
                            {cellEntries.length ? (
                              <div className="grid gap-1">
                                {cellEntries.map((entry) => (
                                  <div key={`${entry.id}-${daySlot?.id || slot.id}`} className="rounded-[5px] border border-[#d8dee7] bg-white px-2 py-1.5 text-left shadow-[0_1px_4px_rgba(15,23,42,0.05)]">
                                    <div className="flex items-center gap-1.5">
                                      <span className="h-5 w-1 rounded-full bg-[#6bdd9e]" />
                                      <div className="min-w-0">
                                        <div className="truncate text-[11px] font-bold text-[#111827]">{entryTitle(entry)}</div>
                                        {entryMeta(entry) ? <div className="mt-0.5 truncate text-[10px] font-semibold text-[#64748b]">{entryMeta(entry)}</div> : null}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : !daySlot ? (
                              <span className="text-[11px] font-medium text-[#cbd5e1]">-</span>
                            ) : !Number(daySlot.teaching_allowed ?? teaching) ? (
                              <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#475569]">{slotLabel || 'Break'}</span>
                            ) : (
                              <span className="text-[11px] font-medium text-[#cbd5e1]">{slotPosition === 0 ? 'Open' : ''}</span>
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-[#64748b]">
            <span>{selectedEntries.length} scheduled entr{selectedEntries.length === 1 ? 'y' : 'ies'} for {selectedClass?.name || 'this class'} in Week {selectedWeek}.</span>
            <span>Cells repeat lessons that span more than one period.</span>
          </div>
        </div>
      )}
    </SectionCard>
  )
}

function activityEntryType(activityType: any) {
  const value = String(activityType || '').toUpperCase()
  if (['ASSEMBLY', 'CHAPEL', 'SPORTS', 'CLUB', 'STUDY', 'STAFF_MEETING', 'RELIGIOUS_PROGRAMME'].includes(value)) return value
  return 'WEEKLY_ACTIVITY'
}

function ReadinessPanel({ readiness, onOpenCurriculumSettings }: { readiness: any; onOpenCurriculumSettings?: () => void }) {
  const errors = readiness?.errors || []
  const warnings = readiness?.warnings || []
  const passed = readiness?.passed || []
  const rows = [...errors, ...warnings, ...passed].slice(0, 8)
  return (
    <SectionCard
      title="Readiness"
      subtitle={readiness?.ready ? 'Generation and review checks are passing.' : `${errors.length} blocking issue${errors.length === 1 ? '' : 's'} found.`}
      actions={<StatusPill value={readiness?.ready ? 'READY' : 'VALIDATION_REQUIRED'} />}
    >
      <div className="grid gap-2 p-4">
        {rows.length ? rows.map((item: any) => (
          <div key={`${item.code}-${item.level}`} className="grid grid-cols-[10px_minmax(0,1fr)] gap-2 rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2">
            <span className={`mt-1.5 size-2 rounded-full ${item.level === 'error' ? 'bg-[#ef4444]' : item.level === 'warning' ? 'bg-[#f59e0b]' : 'bg-[#22c55e]'}`} />
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-[#111827]">{pretty(item.code)}</div>
              <div className="mt-0.5 text-[11px] leading-5 text-[#6b7280]">{item.message}</div>
              {item.code === 'NO_CURRICULUM_REQUIREMENTS' && onOpenCurriculumSettings ? (
                <Button type="button" variant="outline" onClick={onOpenCurriculumSettings} className="mt-2 h-7 rounded-[5px] text-[11px]">
                  Open curriculum requirements
                </Button>
              ) : null}
            </div>
          </div>
        )) : (
          <div className="rounded-[5px] border border-dashed border-[#cbd5e1] px-3 py-6 text-center text-[12px] font-medium text-[#64748b]">
            Select a timetable version to run readiness checks.
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function ExamClassScheduleGrid({
  classes,
  selectedClassId,
  onSelectClass,
  entries,
  operatingMode,
}: {
  classes: any[]
  selectedClassId: string
  onSelectClass: (value: string) => void
  entries: any[]
  operatingMode: string
}) {
  const selectedClass = classes.find((row) => sameId(row.id, selectedClassId))
  const classEntries = entries
    .filter((entry) => sameId(entry.class_id, selectedClassId))
    .sort((a, b) => String(a.calendar_date || '').localeCompare(String(b.calendar_date || '')) || String(a.start_slot_name || '').localeCompare(String(b.start_slot_name || '')))
  const isFullSuspension = String(operatingMode || '').toUpperCase() === 'FULL_SCHOOL_SUSPENSION'

  return (
    <SectionCard
      title="Class Exam Schedule"
      subtitle={isFullSuspension ? 'Full suspension: lessons are paused while classes write scheduled papers.' : 'Choose a class to inspect its examination papers.'}
      actions={
        <select value={selectedClassId} onChange={(event) => onSelectClass(event.target.value)} className={`${selectClassName()} max-w-[220px]`}>
          <option value="">Select class</option>
          {classes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
      }
    >
      {!selectedClassId ? (
        <div className="grid place-items-center gap-2 px-4 py-12 text-center">
          <ClipboardList className="size-8 text-[#9ca3af]" />
          <div className="text-[12px] font-semibold text-[#475569]">Select a class to see what they are writing.</div>
        </div>
      ) : classEntries.length ? (
        <div className="grid gap-2 p-4">
          {isFullSuspension ? (
            <div className="rounded-[5px] border border-[#d8dee7] bg-[#f8fafc] px-3 py-2 text-[12px] font-semibold text-[#374151]">
              Lessons are suspended for {selectedClass?.name || 'this class'} during the exam timetable.
            </div>
          ) : null}
          <div className="overflow-x-auto rounded-[5px] border border-[#e5e7eb]">
            <table className="min-w-full border-separate border-spacing-0 bg-white text-left text-[12px]">
              <thead className="bg-[#f8fafc] text-[10px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                <tr>
                  <th className="border-b border-[#e5e7eb] px-3 py-2">Date</th>
                  <th className="border-b border-[#e5e7eb] px-3 py-2">Session</th>
                  <th className="border-b border-[#e5e7eb] px-3 py-2">Paper</th>
                  <th className="border-b border-[#e5e7eb] px-3 py-2">Room</th>
                </tr>
              </thead>
              <tbody>
                {classEntries.map((entry) => (
                  <tr key={entry.id} className="border-b border-[#eef2f7] last:border-b-0">
                    <td className="border-b border-[#eef2f7] px-3 py-2 font-semibold text-[#111827]">{dateText(entry.calendar_date)}</td>
                    <td className="border-b border-[#eef2f7] px-3 py-2 text-[#475569]">{[entry.start_slot_name, entry.end_slot_name && entry.end_slot_name !== entry.start_slot_name ? entry.end_slot_name : null].filter(Boolean).join(' - ') || '-'}</td>
                    <td className="border-b border-[#eef2f7] px-3 py-2 text-[#111827]">{entry.title || entry.subject_name || pretty(entry.entry_type)}</td>
                    <td className="border-b border-[#eef2f7] px-3 py-2 text-[#475569]">{entry.facility_name || entry.room_name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="grid place-items-center gap-2 px-4 py-12 text-center">
          <AlertTriangle className="size-8 text-[#9ca3af]" />
          <div className="text-[12px] font-semibold text-[#475569]">No exam papers have been scheduled for {selectedClass?.name || 'this class'} yet.</div>
        </div>
      )}
    </SectionCard>
  )
}

function CreateTimetableForm({ mode, options, onCreate, loading }: { mode: 'school' | 'exam'; options: any; onCreate: (payload: any) => void; loading: boolean }) {
  const activeYear = (options?.years || []).find((year: any) => year.is_active || year.status === 'active') || options?.years?.[0]
  const activeTerm = (options?.terms || []).find((term: any) => ['open', 'marking', 'active'].includes(String(term.status || '').toLowerCase())) || options?.terms?.[0]
  const [name, setName] = useState(mode === 'exam' ? 'Exam Timetable' : 'School Timetable')
  const [academicYearId, setAcademicYearId] = useState<any>(activeYear?.id || '')
  const [termId, setTermId] = useState<any>(activeTerm?.id || '')
  const [effectiveFrom, setEffectiveFrom] = useState(dateInputValue(activeTerm?.start_date || activeYear?.start_date))
  const [effectiveTo, setEffectiveTo] = useState(dateInputValue(activeTerm?.end_date || activeYear?.end_date))
  const maxCycleWeeks = Math.max(1, Number(options?.timetable_policy?.max_timetable_cycle_weeks || 4))
  const [cycleWeeks, setCycleWeeks] = useState(String(Math.max(1, Number(options?.timetable_policy?.timetable_cycle_weeks || 1))))

  useEffect(() => {
    if (!academicYearId && activeYear?.id) setAcademicYearId(activeYear.id)
    if (!termId && activeTerm?.id) setTermId(activeTerm.id)
    if (!effectiveFrom && (activeTerm?.start_date || activeYear?.start_date)) setEffectiveFrom(dateInputValue(activeTerm?.start_date || activeYear?.start_date))
    if (!effectiveTo && (activeTerm?.end_date || activeYear?.end_date)) setEffectiveTo(dateInputValue(activeTerm?.end_date || activeYear?.end_date))
  }, [academicYearId, activeYear, activeTerm, effectiveFrom, effectiveTo, termId])

  return (
    <SectionCard title={mode === 'exam' ? 'New Exam Timetable' : 'New School Timetable'} subtitle="Create a versioned timetable inside the active school scope.">
      <div className="grid gap-4 p-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_220px]">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Name
            <Input value={name} onChange={(event) => setName(event.target.value)} className="h-9 text-[13px]" />
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Academic Year
            <select value={academicYearId} onChange={(event) => setAcademicYearId(event.target.value)} className={selectClassName()}>
              <option value="">Select year</option>
              {(options?.years || []).map((year: any) => <option key={year.id} value={year.id}>{year.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Term
            <select value={termId} onChange={(event) => setTermId(event.target.value)} className={selectClassName()}>
              <option value="">No term</option>
              {(options?.terms || []).map((term: any) => <option key={term.id} value={term.id}>{term.name}</option>)}
            </select>
          </label>
        </div>
        <div className="grid gap-3 sm:grid-cols-[180px_180px_180px_auto] sm:items-end">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            From
            <Input type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} className="h-9 text-[13px]" />
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            To
            <Input type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} className="h-9 text-[13px]" />
          </label>
          {mode === 'school' ? (
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Cycle Weeks
              <select value={cycleWeeks} onChange={(event) => setCycleWeeks(event.target.value)} className={selectClassName()}>
                {Array.from({ length: maxCycleWeeks }, (_, index) => index + 1).map((week) => <option key={week} value={week}>{week} week{week === 1 ? '' : 's'}</option>)}
              </select>
            </label>
          ) : null}
          <Button
            type="button"
            disabled={loading || !name.trim() || !academicYearId || !effectiveFrom || !effectiveTo}
            onClick={() => onCreate({
              name,
              timetable_type: mode === 'exam' ? 'EXAM_TIMETABLE' : 'SCHOOL_TIMETABLE',
              academic_year_id: academicYearId,
              term_id: termId || null,
              cycle_type: mode === 'exam' ? 'DATED_EXAM_SESSIONS' : Number(cycleWeeks || 1) > 1 ? 'ROTATING_CYCLE' : 'NORMAL_WEEK',
              timetable_cycle_weeks: mode === 'school' ? Number(cycleWeeks || 1) : 1,
              effective_from: effectiveFrom,
              effective_to: effectiveTo,
            })}
            className="h-9 justify-self-start rounded-[5px] px-3 text-[12px]"
          >
            <Plus className="size-3.5" />
            Create timetable
          </Button>
        </div>
      </div>
    </SectionCard>
  )
}

function ManualEntryForm({ detail, version, options, mode, loading, canManage, onCreate }: { detail: any; version: any; options: any; mode: 'school' | 'exam'; loading: boolean; canManage: boolean; onCreate: (payload: any) => void }) {
  const teachingSlots = useMemo(() => (detail?.bell_slots || []).filter((slot: any) => Number(slot.teaching_allowed) === 1), [detail?.bell_slots])
  const cycleDays = useMemo(() => detail?.cycle_days || [], [detail?.cycle_days])
  const timetableWeeks = cycleWeekCount(detail?.timetable)
  const dayTemplates = useMemo(() => detail?.day_templates || [], [detail?.day_templates])
  const classes = options?.classes || []
  const subjects = options?.subjects || []
  const teachers = options?.teachers || []
  const rooms = options?.rooms || []
  const facilities = options?.facilities || []
  const weeklyActivities = options?.weekly_activities || []
  const assessments = options?.assessments || []
  const examSessions = options?.exam_sessions || []
  const entryTypes = mode === 'exam'
    ? ['EXAM_PAPER', 'PRACTICAL_EXAM', 'COMPUTER_BASED_EXAM', 'LISTENING_EXAM']
    : ['LESSON', 'SUBJECT_LESSON', 'LABORATORY_LESSON', 'COMPUTER_LESSON', 'WEEKLY_ACTIVITY', 'ASSEMBLY', 'CHAPEL', 'RELIGIOUS_PROGRAMME', 'CLUB', 'SPORTS', 'STUDY', 'STAFF_MEETING', 'CUSTOM']
  const [cycleDayId, setCycleDayId] = useState<any>('')
  const [cycleWeek, setCycleWeek] = useState<any>('1')
  const [slotStartId, setSlotStartId] = useState<any>('')
  const [slotEndId, setSlotEndId] = useState<any>('')
  const [classId, setClassId] = useState<any>('')
  const [subjectId, setSubjectId] = useState<any>('')
  const [teacherId, setTeacherId] = useState<any>('')
  const [roomId, setRoomId] = useState<any>('')
  const [facilityId, setFacilityId] = useState<any>('')
  const [entryType, setEntryType] = useState(mode === 'exam' ? 'EXAM_PAPER' : 'LESSON')
  const [sourceWeeklyActivityId, setSourceWeeklyActivityId] = useState<any>('')
  const [assessmentId, setAssessmentId] = useState<any>('')
  const [examSessionId, setExamSessionId] = useState<any>('')
  const [calendarDate, setCalendarDate] = useState('')
  const [title, setTitle] = useState('')
  const selectedWeeklyActivity = weeklyActivities.find((activity: any) => String(activity.id) === String(sourceWeeklyActivityId))
  const selectedDay = useMemo(() => cycleDays.find((day: any) => String(day.id) === String(cycleDayId)), [cycleDayId, cycleDays])
  const selectedDayTemplate = useMemo(() => {
    if (mode !== 'school' || !cycleDayId) return null
    return dayTemplates.find((row: any) => Number(row.active ?? 1) === 1 && String(row.cycle_day_id) === String(cycleDayId)) || null
  }, [cycleDayId, dayTemplates, mode])
  const slotOptions = useMemo(() => {
    if (mode === 'school' && selectedDayTemplate?.bell_template_id) {
      return teachingSlots.filter((slot: any) => String(slot.template_id) === String(selectedDayTemplate.bell_template_id))
    }
    return teachingSlots
  }, [mode, selectedDayTemplate?.bell_template_id, teachingSlots])

  useEffect(() => {
    if (!cycleDayId && cycleDays[0]?.id) setCycleDayId(cycleDays[0].id)
    if (mode === 'exam' && !calendarDate) setCalendarDate(dateInputValue(detail?.timetable?.effective_from))
  }, [calendarDate, cycleDayId, cycleDays, detail?.timetable?.effective_from, mode])

  useEffect(() => {
    const validSlotIds = new Set(slotOptions.map((slot: any) => String(slot.id)))
    const firstSlotId = slotOptions[0]?.id || ''
    if ((!slotStartId || !validSlotIds.has(String(slotStartId))) && String(slotStartId || '') !== String(firstSlotId || '')) setSlotStartId(firstSlotId)
    if ((!slotEndId || !validSlotIds.has(String(slotEndId))) && String(slotEndId || '') !== String(firstSlotId || '')) setSlotEndId(firstSlotId)
  }, [slotEndId, slotOptions, slotStartId])

  useEffect(() => {
    setEntryType(mode === 'exam' ? 'EXAM_PAPER' : 'LESSON')
    setSourceWeeklyActivityId('')
  }, [mode])

  useEffect(() => {
    if (!selectedWeeklyActivity) return
    setEntryType(activityEntryType(selectedWeeklyActivity.activity_type))
    setTitle((current) => current || selectedWeeklyActivity.name || '')
    if (selectedWeeklyActivity.facility_id) setFacilityId(selectedWeeklyActivity.facility_id)
    if (selectedWeeklyActivity.responsible_teacher_id) setTeacherId(selectedWeeklyActivity.responsible_teacher_id)
    if (selectedWeeklyActivity.start_slot_id) setSlotStartId(selectedWeeklyActivity.start_slot_id)
    if (selectedWeeklyActivity.end_slot_id || selectedWeeklyActivity.start_slot_id) setSlotEndId(selectedWeeklyActivity.end_slot_id || selectedWeeklyActivity.start_slot_id)
    if (selectedWeeklyActivity.cycle_day_id) {
      setCycleDayId(selectedWeeklyActivity.cycle_day_id)
    } else if (selectedWeeklyActivity.weekday !== null && selectedWeeklyActivity.weekday !== undefined) {
      const day = cycleDays.find((row: any) => Number(row.weekday) === Number(selectedWeeklyActivity.weekday))
      if (day?.id) setCycleDayId(day.id)
    }
  }, [cycleDays, selectedWeeklyActivity])

  const editable = ['SETUP', 'VALIDATION_REQUIRED', 'READY', 'DRAFT', 'CHANGES_REQUESTED'].includes(String(version?.status || '').toUpperCase())
  if (!editable || !canManage) return null

  const canSave = Boolean(slotOptions.length && slotStartId && slotEndId && (mode === 'exam' ? (calendarDate && (title.trim() || assessmentId)) : (title.trim() || classId || subjectId || sourceWeeklyActivityId)))
  const missingBaseSetup = !teachingSlots.length || (!cycleDays.length && mode === 'school')
  const selectedDayHasNoPeriods = mode === 'school' && !missingBaseSetup && cycleDayId && !slotOptions.length

  return (
    <SectionCard title="Manual Entry" subtitle="Add one validated timetable row to the selected draft version.">
      <div className="grid gap-3 p-4">
        {missingBaseSetup ? (
          <div className="rounded-[5px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#c2410c]">
            Add cycle days and teaching periods before entering timetable rows.
          </div>
        ) : null}
        {selectedDayHasNoPeriods ? (
          <div className="rounded-[5px] border border-[#e5e7eb] bg-[#f8fafc] px-3 py-2 text-[12px] font-semibold text-[#374151]">
            {selectedDay?.display_name || 'This day'} has no teaching periods in its assigned bell schedule.
          </div>
        ) : null}
        <div className="grid gap-3 lg:grid-cols-5">
          {mode === 'school' && timetableWeeks > 1 ? (
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Week
              <select value={cycleWeek} onChange={(event) => setCycleWeek(event.target.value)} className={selectClassName()}>
                {Array.from({ length: timetableWeeks }, (_, index) => index + 1).map((week) => <option key={week} value={week}>Week {week}</option>)}
              </select>
            </label>
          ) : null}
          {mode === 'school' ? (
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Day
              <select value={cycleDayId} onChange={(event) => setCycleDayId(event.target.value)} className={selectClassName()}>
                {cycleDays.map((day: any) => <option key={day.id} value={day.id}>{day.display_name}</option>)}
              </select>
            </label>
          ) : (
            <>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                Exam date
                <Input type="date" value={calendarDate} onChange={(event) => setCalendarDate(event.target.value)} className="h-9 text-[12px]" />
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                Exam session
                <select value={examSessionId} onChange={(event) => setExamSessionId(event.target.value)} className={selectClassName()}>
                  <option value="">No exam series</option>
                  {examSessions.map((session: any) => <option key={session.id} value={session.id}>{session.name}</option>)}
                </select>
              </label>
            </>
          )}
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Start period
            <select value={slotStartId} onChange={(event) => { setSlotStartId(event.target.value); if (!slotEndId) setSlotEndId(event.target.value) }} className={selectClassName()}>
              {slotOptions.map((slot: any) => <option key={slot.id} value={slot.id}>{slot.display_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            End period
            <select value={slotEndId} onChange={(event) => setSlotEndId(event.target.value)} className={selectClassName()}>
              {slotOptions.map((slot: any) => <option key={slot.id} value={slot.id}>{slot.display_name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Facility
            <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)} className={selectClassName()}>
              <option value="">No facility</option>
              {facilities.map((facility: any) => <option key={facility.id} value={facility.id}>{facility.name || facility.facility_code}</option>)}
            </select>
          </label>
        </div>

        <div className="grid gap-3 lg:grid-cols-[220px_minmax(0,1fr)]">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Entry type
            <select value={entryType} onChange={(event) => setEntryType(event.target.value)} className={selectClassName()}>
              {entryTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
            </select>
          </label>
          {mode === 'school' ? (
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Weekly activity
              <select value={sourceWeeklyActivityId} onChange={(event) => setSourceWeeklyActivityId(event.target.value)} className={selectClassName()}>
                <option value="">Manual row</option>
                {weeklyActivities.map((activity: any) => <option key={activity.id} value={activity.id}>{activity.name} ({pretty(activity.activity_type)})</option>)}
              </select>
            </label>
          ) : null}
        </div>

        {!facilities.length && rooms.length ? (
          <label className="grid max-w-sm gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Legacy room
            <select value={roomId} onChange={(event) => setRoomId(event.target.value)} className={selectClassName()}>
              <option value="">No room</option>
              {rooms.map((room: any) => <option key={room.id} value={room.id}>{room.name || room.code}</option>)}
            </select>
          </label>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-4">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Class
            <select value={classId} onChange={(event) => setClassId(event.target.value)} className={selectClassName()}>
              <option value="">No class</option>
              {classes.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Subject
            <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)} className={selectClassName()}>
              <option value="">No subject</option>
              {subjects.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
            Teacher
            <select value={teacherId} onChange={(event) => setTeacherId(event.target.value)} className={selectClassName()}>
              <option value="">No teacher</option>
              {teachers.map((row: any) => <option key={row.id} value={row.id}>{row.full_name}</option>)}
            </select>
          </label>
          {mode === 'exam' ? (
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Assessment
              <select value={assessmentId} onChange={(event) => setAssessmentId(event.target.value)} className={selectClassName()}>
                <option value="">No paper</option>
                {assessments.map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </label>
          ) : (
            <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
              Title
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional activity title" className="h-9 text-[12px]" />
            </label>
          )}
        </div>

        {mode === 'exam' ? (
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional paper title" className="h-9 text-[12px]" />
        ) : null}

        <Button
          type="button"
          disabled={loading || !canSave}
          onClick={() => onCreate({
            cycle_week: mode === 'school' ? Number(cycleWeek || 1) : 1,
            cycle_day_id: mode === 'school' ? cycleDayId || null : null,
            slot_start_id: slotStartId,
            slot_end_id: slotEndId,
            class_id: classId || null,
            subject_id: subjectId || null,
            teacher_id: teacherId || null,
            room_id: roomId || null,
            facility_id: facilityId || null,
            source_weekly_activity_id: sourceWeeklyActivityId || null,
            assessment_id: assessmentId || null,
            exam_session_id: examSessionId || null,
            entry_type: entryType,
            calendar_date: mode === 'exam' ? calendarDate : null,
            title: title.trim() || null,
          })}
          className="h-9 justify-self-start rounded-[5px] px-3 text-[12px]"
        >
          <Plus className="size-3.5" />
          Add entry
        </Button>
      </div>
    </SectionCard>
  )
}

export function TimetablingPage({ personal = false }: { personal?: boolean }) {
  const { api, token, user, portalSyncEvent } = usePortal()
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const mode = location.pathname.startsWith('/exam-timetables') || location.pathname === '/my-exams' || location.pathname === '/my-invigilation' ? 'exam' : 'school'
  const isNew = location.pathname.endsWith('/new')
  const basePath = mode === 'exam' ? '/exam-timetables' : '/timetables'
  const isDetailRoute = Boolean(params.id) && !isNew
  const userRole = String(user?.role || '').toLowerCase()
  const canManage = ['super_admin', 'school_owner', 'headteacher'].includes(userRole)
  const [loading, setLoading] = useState(false)
  const [pageError, setPageError] = useState('')
  const [options, setOptions] = useState<any>({})
  const [list, setList] = useState<any[]>([])
  const [detail, setDetail] = useState<any>(null)
  const [versionDetail, setVersionDetail] = useState<any>(null)
  const [readiness, setReadiness] = useState<any>(null)
  const [conflicts, setConflicts] = useState<any[]>([])
  const [generationJob, setGenerationJob] = useState<any>(null)
  const [examScopeType, setExamScopeType] = useState('WHOLE_SCHOOL')
  const [examOperatingMode, setExamOperatingMode] = useState('NORMAL_LESSONS_CONTINUE')
  const [examSeriesId, setExamSeriesId] = useState<any>('')
  const [selectedClassId, setSelectedClassId] = useState('')

  const timetableId = params.id
  const activeVersion = useMemo(() => {
    if (versionDetail?.version) return versionDetail.version
    if (!detail?.versions?.length) return detail?.version || null
    return detail.versions.find((version: any) => String(version.id) === String(params.versionId)) || detail.versions[0]
  }, [detail, params.versionId, versionDetail])

  const entries = useMemo(() => {
    if (versionDetail?.entries) return versionDetail.entries
    if (!activeVersion?.id) return detail?.entries || []
    return (detail?.entries || []).filter((entry: any) => String(entry.timetable_version_id) === String(activeVersion.id))
  }, [activeVersion?.id, detail?.entries, versionDetail?.entries])

  const detailCycleDays = versionDetail?.cycle_days || detail?.cycle_days || []
  const detailBellSlots = versionDetail?.bell_slots || detail?.bell_slots || []
  const detailDayTemplates = versionDetail?.day_templates || detail?.day_templates || []
  const schedulingDetail = useMemo(() => detail ? { ...detail, cycle_days: detailCycleDays, bell_slots: detailBellSlots, day_templates: detailDayTemplates, entries } : null, [detail, detailBellSlots, detailCycleDays, detailDayTemplates, entries])
  const classOptions = useMemo(() => {
    const rows = new Map<string, any>()
    ;(options?.classes || []).forEach((row: any) => rows.set(String(row.id), row))
    entries.forEach((entry: any) => {
      if (entry.class_id && !rows.has(String(entry.class_id))) rows.set(String(entry.class_id), { id: entry.class_id, name: entry.class_name || `Class ${entry.class_id}` })
    })
    return Array.from(rows.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
  }, [entries, options?.classes])

  const loadList = async () => {
    if (!token) return []
    const response = await api.listTimetables(token, { type: mode === 'exam' ? 'EXAM_TIMETABLE' : 'SCHOOL_TIMETABLE' })
    const rows = response?.timetables || []
    setList(rows)
    return rows
  }

  const loadDetail = async (id = timetableId) => {
    if (!token || !id) {
      setDetail(null)
      setVersionDetail(null)
      setReadiness(null)
      setConflicts([])
      return
    }
    const response = await api.getTimetable(token, id)
    setDetail(response)
    const selected = params.versionId || response?.versions?.[0]?.id
    if (!selected) {
      setVersionDetail(null)
      setReadiness(null)
      setConflicts([])
      return
    }
    const [versionResponse, readyResponse, conflictResponse] = await Promise.all([
      api.getTimetableVersion(token, id, selected).catch(() => null),
      api.getTimetableReadiness(token, id, selected).catch(() => null),
      api.listTimetableConflicts(token, id, selected).catch(() => ({ conflicts: [] })),
    ])
    setVersionDetail(versionResponse)
    setReadiness(readyResponse)
    setConflicts(conflictResponse?.conflicts || [])
  }

  const loadAll = async () => {
    if (!token) return
    setLoading(true)
    setPageError('')
    try {
      const [optionsResponse] = await Promise.all([
        api.getTimetableSetupOptions(token),
        loadList(),
      ])
      setOptions(optionsResponse || {})
      if (timetableId) await loadDetail(timetableId)
      else {
        setDetail(null)
        setVersionDetail(null)
        setReadiness(null)
        setConflicts([])
      }
    } catch (error: any) {
      setPageError(error?.message || 'Unable to load timetables.')
      setList([])
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (personal) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, mode, timetableId, params.versionId, personal])

  useEffect(() => {
    if (personal || !portalSyncEvent?.pulse) return
    if (!portalSyncEvent.resources?.includes('timetables')) return
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalSyncEvent?.pulse])

  useEffect(() => {
    if (!classOptions.length) {
      if (selectedClassId) setSelectedClassId('')
      return
    }
    if (!selectedClassId || !classOptions.some((row) => sameId(row.id, selectedClassId))) {
      const classWithEntries = classOptions.find((row) => entries.some((entry: any) => sameId(entry.class_id, row.id)))
      setSelectedClassId(String((classWithEntries || classOptions[0])?.id || ''))
    }
  }, [classOptions, entries, selectedClassId])

  useEffect(() => {
    if (mode !== 'exam') return
    const setupProgress = detail?.timetable?.setup_progress || {}
    const savedExamSeriesId = setupProgress.exam_session_id || setupProgress.examSessionId
    const savedOperatingMode = String(setupProgress.operating_mode || setupProgress.operatingMode || '').toUpperCase()
    if (!examSeriesId && savedExamSeriesId) setExamSeriesId(String(savedExamSeriesId))
    if (['NORMAL_LESSONS_CONTINUE', 'PARTIAL_SUSPENSION', 'FULL_SCHOOL_SUSPENSION', 'CUSTOM'].includes(savedOperatingMode) && savedOperatingMode !== examOperatingMode) {
      setExamOperatingMode(savedOperatingMode)
    }
  }, [detail?.timetable?.id, detail?.timetable?.setup_progress, mode])

  useEffect(() => {
    if (!token || !generationJob?.id) return
    const timer = window.setInterval(async () => {
      const response = await api.getTimetableGenerationJob(token, generationJob.id).catch(() => null)
      const nextJob = response?.job
      if (!nextJob) return
      setGenerationJob(nextJob)
      const status = String(nextJob.job_status || '').toUpperCase()
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(status)) {
        window.clearInterval(timer)
        if (status === 'COMPLETED') {
          toast.success(solverJobMessage(nextJob, 'Solver draft saved. Review the generated timetable before approval.'))
        } else if (status === 'FAILED') {
          toast.error(solverJobMessage(nextJob, 'The solver could not produce a publishable draft.'))
        } else {
          toast.message(solverJobMessage(nextJob, 'Solver generation was cancelled.'))
        }
        setGenerationJob(null)
        await loadDetail(detail?.timetable?.public_ref || timetableId)
      }
    }, 2500)
    return () => window.clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, generationJob?.id])

  const createTimetable = async (payload: any) => {
    if (!token) return
    setLoading(true)
    try {
      const response = await api.createTimetable(token, payload)
      const id = response?.timetable?.public_ref
      toast.success('Timetable created.')
      navigate(`${basePath}/${id || ''}/versions`)
    } catch (error: any) {
      toast.error(error?.message || 'Unable to create timetable.')
    } finally {
      setLoading(false)
    }
  }

  const runAction = async (label: string, fn: () => Promise<any>) => {
    setLoading(true)
    try {
      await fn()
      toast.success(label)
      await loadDetail(detail?.timetable?.id || timetableId)
    } catch (error: any) {
      toast.error(error?.message || 'Action failed.')
    } finally {
      setLoading(false)
    }
  }

  const createEntry = (payload: any) => {
    if (!detail?.timetable?.id || !activeVersion?.id) return
    return runAction('Entry saved.', () => api.createTimetableEntry(token, detail.timetable.id, activeVersion.id, payload))
  }

  const applyWeeklyActivities = () => {
    if (!detail?.timetable?.id || !activeVersion?.id) return
    return runAction('Weekly activities applied.', () => api.applyWeeklyActivitiesToTimetableVersion(token, detail.timetable.id, activeVersion.id, { preview: false }))
  }

  const startSolver = async (assisted = false) => {
    if (!detail?.timetable?.id || !activeVersion?.id) return
    setLoading(true)
    try {
      const payload = mode === 'exam'
        ? { strategy: 'CANDIDATE_FRIENDLY', examSeriesId: examSeriesId || options?.exam_sessions?.[0]?.id, scopeType: examScopeType, operatingMode: examOperatingMode }
        : { strategy: 'BALANCED' }
      const response = mode === 'exam'
        ? await api.startExamTimetableGeneration(token, detail.timetable.id, activeVersion.id, payload)
        : assisted
          ? await api.completeTimetableWithSolver(token, detail.timetable.id, activeVersion.id, payload)
          : await api.startTimetableGeneration(token, detail.timetable.id, activeVersion.id, payload)
      setGenerationJob(response?.job || null)
      toast.success(solverJobMessage(response?.job, 'Solver job queued.'))
      await loadDetail(detail.timetable.id)
    } catch (error: any) {
      toast.error(error?.message || 'Unable to start solver generation.')
    } finally {
      setLoading(false)
    }
  }

  const findAlternatives = async () => {
    if (!detail?.timetable?.id || !activeVersion?.id) return
    const entry = entries[0]
    try {
      const response = await api.findTimetableAlternatives(token, detail.timetable.id, activeVersion.id, {
        entryType: entry?.entry_type || 'LESSON',
        classId: entry?.class_id,
        teacherId: entry?.teacher_id,
        facilityId: entry?.facility_id,
        durationSlots: 1,
        maxAlternatives: 8,
      })
      toast.success(`${response?.alternatives?.length || 0} solver alternative${response?.alternatives?.length === 1 ? '' : 's'} found.`)
    } catch (error: any) {
      toast.error(error?.message || 'Unable to find alternatives.')
    }
  }

  const kpis = useMemo(() => {
    const published = list.filter((item) => String(item.status || '').toUpperCase() === 'PUBLISHED').length
    const activeDrafts = list.filter((item) => ['DRAFT', 'READY', 'UNDER_REVIEW', 'GENERATING'].includes(String(item.status || '').toUpperCase())).length
    const listItems = [
      { label: mode === 'exam' ? 'Exam Timetables' : 'School Timetables', value: list.length, helper: 'school scope', delta: loading ? 'refreshing' : 'loaded' },
      { label: 'Published', value: published, helper: 'live schedules', delta: 'current', tone: published ? 'good' as const : 'neutral' as const },
      { label: 'Active Drafts', value: activeDrafts, helper: 'in progress', delta: activeDrafts ? 'review' : 'none' },
    ]
    if (!isDetailRoute) return listItems
    return [
      { label: 'Versions', value: detail?.versions?.length || 0, helper: 'selected timetable', delta: activeVersion ? `v${activeVersion.version_number}` : 'none' },
      { label: 'Entries', value: entries.length, helper: 'selected version', delta: mode === 'school' ? `${classOptions.length} classes` : 'scheduled' },
      { label: 'Cycle', value: `${cycleWeekCount(detail?.timetable)}w`, helper: 'generated weeks', delta: cycleWeekCount(detail?.timetable) > 1 ? 'rotating' : 'weekly' },
      { label: 'Conflicts', value: conflicts.length, helper: 'selected version', delta: conflicts.length ? 'resolve' : 'clear', tone: conflicts.length ? 'warn' as const : 'good' as const },
      { label: 'Published', value: published, helper: 'live schedules', delta: 'current', tone: published ? 'good' as const : 'neutral' as const },
    ]
  }, [activeVersion, classOptions.length, conflicts.length, detail?.versions?.length, entries.length, isDetailRoute, list, loading, mode])

  if (personal) {
    return (
      <main className="grid gap-3 p-4">
        <SectionCard title={mode === 'exam' ? 'My Exams' : 'My Timetable'} subtitle="Published personal schedules from the school timetable module.">
          <div className="grid place-items-center gap-3 px-4 py-12 text-center">
            <CalendarDays className="size-8 text-[#9ca3af]" />
            <div>
              <div className="text-[14px] font-semibold text-[#111827]">No published personal schedule yet</div>
              <p className="mt-1 max-w-md text-[12px] leading-5 text-[#6b7280]">Once leadership publishes a timetable version for your class or duty scope, it will appear here.</p>
            </div>
          </div>
        </SectionCard>
      </main>
    )
  }

  const timetableRows = list.map((item) => ({
    ...item,
    context: [item.academic_year_name, item.term_name].filter(Boolean).join(' / ') || '-',
    dates: `${dateText(item.effective_from)} - ${dateText(item.effective_to)}`,
    cycleText: `${cycleWeekCount(item)} week${cycleWeekCount(item) === 1 ? '' : 's'}`,
  }))
  const versionRows = (detail?.versions || []).map((version: any) => ({
    ...version,
    label: `v${version.version_number}`,
    created: dateText(version.created_at),
  }))
  const entryRows = entries.map((entry: any) => ({
    ...entry,
    time: `${mode === 'school' ? `Week ${entry.cycle_week || 1} / ` : ''}${entry.cycle_day_name || dateText(entry.calendar_date)} / ${entry.start_slot_name || '-'}${entry.end_slot_name && entry.end_slot_name !== entry.start_slot_name ? ` - ${entry.end_slot_name}` : ''}`,
    titleText: entry.title || pretty(entry.entry_type),
    entryTypeText: pretty(entry.entry_type),
    resourceText: entry.facility_name || entry.room_name || '-',
    sourceText: entry.weekly_activity_name ? `Weekly: ${entry.weekly_activity_name}` : entry.assessment_id ? 'Assessment' : 'Manual',
  }))
  const initialLoading = loading && !pageError && (isDetailRoute ? !detail?.timetable : !list.length)

  return (
    <main className="grid gap-3 p-4">
      <Toolbar>
        {isDetailRoute ? (
          <PageBackButton fallback={basePath} label="Back to timetables" />
        ) : null}
        <div className="min-w-[240px] flex-1">
          <div className="text-[12px] font-semibold text-[#111827]">
            {isDetailRoute && detail?.timetable ? detail.timetable.name : mode === 'exam' ? 'Exam timetable list' : 'School timetable list'}
          </div>
          <div className="text-[11px] leading-5 text-[#6b7280]">
            {isDetailRoute ? 'Versions, grid view, solver actions, review and publication.' : 'Open a timetable to manage versions, entries and publication.'}
          </div>
        </div>
        <Button type="button" variant="outline" onClick={loadAll} disabled={loading} className="h-8 rounded-[5px] text-[12px]">
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
        {!isNew && canManage ? (
          <Button type="button" onClick={() => navigate(`${basePath}/new`)} disabled={loading} className="h-8 rounded-[5px] text-[12px]">
            <Plus className="size-3.5" />
            New
          </Button>
        ) : null}
      </Toolbar>

      {pageError ? (
        <div className="flex items-start gap-2 rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {pageError}
        </div>
      ) : null}

      {initialLoading ? (
        <SmartLinkLoadingState
          label={isDetailRoute ? 'Loading timetable' : 'Loading timetable list'}
          detail={isDetailRoute ? 'Opening versions, entries and scheduling checks.' : 'Preparing available timetable records.'}
        />
      ) : (
        <>
          <SectionKpiStrip items={kpis} />

          {isNew && canManage ? <CreateTimetableForm mode={mode} options={options} onCreate={createTimetable} loading={loading} /> : null}

          {!isDetailRoute ? (
            <SectionCard
              title={mode === 'exam' ? 'Exam Timetables' : 'School Timetables'}
              subtitle="Open a timetable to view versions, grid layout, entries, conflicts and publication actions."
            >
              <PortalTable
                columns={[
                  { key: 'name', label: 'Name', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
                  { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                  { key: 'context', label: 'Context' },
                  { key: 'dates', label: 'Dates' },
                  { key: 'cycleText', label: 'Cycle' },
                  { key: 'latest_version_number', label: 'Latest', render: (row) => row.latest_version_number ? `v${row.latest_version_number}` : '-' },
                  {
                    key: 'open',
                    label: 'View',
                    render: (row) => (
                      <button
                        type="button"
                        className="inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#d7dde5] bg-white px-2 text-[11px] font-semibold text-[#374151] hover:bg-[#f8fafc]"
                        onClick={(event) => { event.stopPropagation(); navigate(`${basePath}/${row.public_ref}/versions`) }}
                      >
                        <Eye className="size-3.5" />
                        Open
                      </button>
                    ),
                  },
                ]}
                rows={timetableRows}
                onRowClick={(row) => navigate(`${basePath}/${row.public_ref}/versions`)}
                emptyMessage={`No ${mode === 'exam' ? 'exam timetables' : 'school timetables'} have been created yet.`}
              />
            </SectionCard>
          ) : null}

          {isDetailRoute && detail?.timetable ? (
            <div className="grid gap-3">
              <SectionCard
                title={detail.timetable.name}
                subtitle={`${detail.timetable.academic_year_name || '-'}${detail.timetable.term_name ? ` / ${detail.timetable.term_name}` : ''} / ${dateText(detail.timetable.effective_from)} to ${dateText(detail.timetable.effective_to)} / ${cycleWeekCount(detail.timetable)} week${cycleWeekCount(detail.timetable) === 1 ? '' : 's'} generated cycle`}
                actions={<StatusPill value={detail.timetable.status} />}
              >
                <div className="flex flex-wrap items-center gap-2 p-4">
                  {mode === 'exam' && canManage ? (
                    <div className="grid w-full gap-2 rounded-[5px] border border-[#e5e7eb] bg-[#f8fafc] p-3 md:grid-cols-3">
                      <select value={examSeriesId} onChange={(event) => setExamSeriesId(event.target.value)} className={selectClassName()}>
                        <option value="">Exam series</option>
                        {(options?.exam_sessions || []).map((session: any) => <option key={session.id} value={session.id}>{session.name}</option>)}
                      </select>
                      <select value={examScopeType} onChange={(event) => setExamScopeType(event.target.value)} className={selectClassName()}>
                        {['WHOLE_SCHOOL', 'GRADE', 'CLASS', 'STREAM', 'STUDENT_GROUP', 'SUBJECT', 'CUSTOM'].map((item) => <option key={item} value={item}>{pretty(item)}</option>)}
                      </select>
                      <select value={examOperatingMode} onChange={(event) => setExamOperatingMode(event.target.value)} className={selectClassName()}>
                        {['NORMAL_LESSONS_CONTINUE', 'PARTIAL_SUSPENSION', 'FULL_SCHOOL_SUSPENSION', 'CUSTOM'].map((item) => <option key={item} value={item}>{pretty(item)}</option>)}
                      </select>
                    </div>
                  ) : null}
                  {activeVersion && canManage ? (
                    <>
                      <Button type="button" variant="outline" disabled={loading} onClick={() => runAction('Version cloned.', () => api.cloneTimetableVersion(token, detail.timetable.id, activeVersion.id))} className="h-8 rounded-[5px] text-[11px]">
                        <Copy className="size-3.5" />
                        Clone
                      </Button>
                      <Button type="button" variant="outline" disabled={loading} onClick={() => startSolver(false)} className="h-8 rounded-[5px] text-[11px]">
                        <Sparkles className="size-3.5" />
                        {mode === 'exam' ? 'Generate Exam Timetable' : 'Generate with Solver'}
                      </Button>
                      {mode === 'school' ? (
                        <>
                          <Button type="button" variant="outline" disabled={loading} onClick={() => startSolver(true)} className="h-8 rounded-[5px] text-[11px]">
                            <Sparkles className="size-3.5" />
                            Complete remaining
                          </Button>
                          <Button type="button" variant="outline" disabled={loading} onClick={findAlternatives} className="h-8 rounded-[5px] text-[11px]">
                            <RefreshCcw className="size-3.5" />
                            Find best alternatives
                          </Button>
                          <Button type="button" variant="outline" disabled={loading} onClick={applyWeeklyActivities} className="h-8 rounded-[5px] text-[11px]">
                            <CalendarDays className="size-3.5" />
                            Apply weekly activities
                          </Button>
                        </>
                      ) : null}
                      <Button type="button" variant="outline" disabled={loading} onClick={() => runAction('Submitted for review.', () => api.submitTimetableReview(token, detail.timetable.id, activeVersion.id))} className="h-8 rounded-[5px] text-[11px]">
                        <Send className="size-3.5" />
                        Review
                      </Button>
                      <Button type="button" variant="outline" disabled={loading} onClick={() => runAction('Approved.', () => api.approveTimetableVersion(token, detail.timetable.id, activeVersion.id))} className="h-8 rounded-[5px] text-[11px]">
                        <CheckCircle2 className="size-3.5" />
                        Approve
                      </Button>
                      <Button type="button" disabled={loading} onClick={() => runAction('Published.', () => api.publishTimetableVersion(token, detail.timetable.id, activeVersion.id))} className="h-8 rounded-[5px] text-[11px]">
                        <UploadCloud className="size-3.5" />
                        Publish
                      </Button>
                    </>
                  ) : !activeVersion && canManage ? (
                    <Button type="button" onClick={() => runAction('Version created.', () => api.createTimetableVersion(token, detail.timetable.id))} className="h-8 rounded-[5px] text-[11px]">
                      <Plus className="size-3.5" />
                      Create version
                    </Button>
                  ) : null}
                </div>
              </SectionCard>
              {mode === 'school' ? (
                <ClassTimetableGrid
                  classes={classOptions}
                  selectedClassId={selectedClassId}
                  onSelectClass={setSelectedClassId}
                  cycleDays={detailCycleDays}
                  bellSlots={detailBellSlots}
                  dayTemplates={detailDayTemplates}
                  entries={entries}
                  timetableCycleWeeks={cycleWeekCount(detail.timetable)}
                />
              ) : null}

              {mode === 'exam' ? (
                <ExamClassScheduleGrid
                  classes={classOptions}
                  selectedClassId={selectedClassId}
                  onSelectClass={setSelectedClassId}
                  entries={entries}
                  operatingMode={examOperatingMode}
                />
              ) : null}

              <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <SectionCard title="Versions" subtitle="Choose the draft, review or published version to inspect.">
                  <PortalTable
                    columns={[
                      { key: 'label', label: 'Version', render: (row) => <span className="font-semibold text-[#111827]">{row.label}</span> },
                      { key: 'status', label: 'Status', render: (row) => <StatusPill value={row.status} /> },
                      { key: 'creation_method', label: 'Method', render: (row) => pretty(row.creation_method) },
                      { key: 'solver_score', label: 'Score', render: (row) => row.solver_score ?? '-' },
                      { key: 'created', label: 'Created' },
                      {
                        key: 'open',
                        label: 'Action',
                        render: (row) => (
                          <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" onClick={(event) => { event.stopPropagation(); navigate(`${basePath}/${detail.timetable.public_ref}/versions/${row.public_ref}`) }} aria-label="Open version">
                            <Eye className="size-3.5" />
                          </button>
                        ),
                      },
                    ]}
                    rows={versionRows}
                    onRowClick={(row) => navigate(`${basePath}/${detail.timetable.public_ref}/versions/${row.public_ref}`)}
                    emptyMessage="No versions have been created for this timetable."
                  />
                </SectionCard>
                <ReadinessPanel readiness={readiness} onOpenCurriculumSettings={() => navigate('/settings/timetable-rules')} />
              </div>

              <div className="grid gap-3 2xl:grid-cols-[minmax(0,1fr)_360px]">
                <ManualEntryForm detail={schedulingDetail || detail} version={activeVersion} options={options} mode={mode} loading={loading} canManage={canManage} onCreate={createEntry} />
                <SectionCard title="Schedule Setup" subtitle="Data available for manual and assisted scheduling.">
                  <div className="grid gap-2 p-4">
                    {[
                      [CalendarDays, 'Cycle weeks', cycleWeekCount(detail?.timetable)],
                      [CalendarDays, 'Cycle days', detailCycleDays?.length || 0],
                      [Clock, 'Teaching periods', (detailBellSlots || []).filter((slot: any) => Number(slot.teaching_allowed) === 1).length],
                      [Users, 'Classes', options?.classes?.length || 0],
                      [BookOpen, 'Subjects', options?.subjects?.length || 0],
                      [DoorOpen, 'Facilities', options?.facilities?.length || options?.rooms?.length || 0],
                      [CalendarDays, 'Weekly activities', options?.weekly_activities?.length || 0],
                    ].map(([IconValue, label, value]) => {
                      const Icon = IconValue as any
                      return (
                        <div key={String(label)} className="flex items-center justify-between gap-3 rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2">
                          <span className="inline-flex items-center gap-2 text-[12px] font-semibold text-[#374151]"><Icon className="size-3.5" />{String(label)}</span>
                          <span className="text-[12px] font-bold text-[#111827]">{String(value)}</span>
                        </div>
                      )
                    })}
                  </div>
                </SectionCard>
              </div>

              <SectionCard title="Entries" subtitle={activeVersion ? `Rows in version v${activeVersion.version_number}.` : 'Select a version to view entries.'}>
                <PortalTable
                  columns={[
                    { key: 'time', label: 'Day / Period' },
                    { key: 'titleText', label: 'Title', render: (row) => <span className="font-semibold text-[#111827]">{row.titleText}</span> },
                    { key: 'entryTypeText', label: 'Type' },
                    { key: 'class_name', label: 'Class', render: (row) => row.class_name || '-' },
                    { key: 'subject_name', label: 'Subject', render: (row) => row.subject_name || '-' },
                    { key: 'teacher_name', label: 'Teacher', render: (row) => row.teacher_name || '-' },
                    { key: 'resourceText', label: 'Facility' },
                    { key: 'sourceText', label: 'Source' },
                  ]}
                  rows={entryRows}
                  emptyMessage="No timetable entries have been added to this version yet."
                />
              </SectionCard>

              {conflicts.length ? (
                <SectionCard title="Unresolved Conflicts" subtitle="Fix the first hard conflict shown below, then refresh validation.">
                  <PortalTable
                    columns={[
                      { key: 'severity', label: 'Severity', render: (row) => <StatusPill value={row.severity} /> },
                      { key: 'conflict_code', label: 'Conflict' },
                      { key: 'message', label: 'Main reason', render: (row) => row.message || row.human_message || '-' },
                    ]}
                    rows={conflicts}
                    emptyMessage="No conflicts found."
                  />
                </SectionCard>
              ) : null}
            </div>
          ) : null}

          {isDetailRoute && !detail?.timetable && !pageError ? (
            <SectionCard title="Timetable unavailable" subtitle="The selected timetable could not be opened.">
              <div className="grid place-items-center gap-3 px-4 py-14 text-center">
                <ClipboardList className="size-9 text-[#9ca3af]" />
                <div className="text-[13px] font-semibold text-[#111827]">Return to the timetable list and choose another record.</div>
              </div>
            </SectionCard>
          ) : null}
        </>
      )}
    </main>
  )
}
