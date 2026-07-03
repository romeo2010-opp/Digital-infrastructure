import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import {
  Activity,
  Building2,
  CalendarClock,
  ClipboardList,
  FlaskConical,
  Pencil,
  Plus,
  RefreshCcw,
  Save,
  Settings2,
  Trash2,
} from 'lucide-react'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { SmartLinkLoadingState } from '../components/SmartLinkLoadingState'
import { ModalShell } from '../components/ModalShell'
import { Toolbar } from '../components/Toolbar'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Switch } from '../components/ui/switch'
import { usePortal } from '../lib/portalContext'

export type SchedulingSettingsSection = 'academic-configuration' | 'facilities' | 'laboratories' | 'weekly-activities' | 'timetable-rules'

const facilityTypes = [
  'CLASSROOM',
  'SCIENCE_LABORATORY',
  'BIOLOGY_LABORATORY',
  'CHEMISTRY_LABORATORY',
  'PHYSICS_LABORATORY',
  'GENERAL_LABORATORY',
  'COMPUTER_LABORATORY',
  'LANGUAGE_LABORATORY',
  'LIBRARY',
  'WORKSHOP',
  'ART_ROOM',
  'MUSIC_ROOM',
  'HOME_ECONOMICS_ROOM',
  'AGRICULTURE_FACILITY',
  'SPORTS_GROUND',
  'HALL',
  'MEETING_ROOM',
  'SPECIAL_NEEDS_ROOM',
  'EXAMINATION_ROOM',
  'CUSTOM',
]

const laboratoryTypes = [
  'GENERAL_LABORATORY',
  'SCIENCE_LABORATORY',
  'BIOLOGY_LABORATORY',
  'CHEMISTRY_LABORATORY',
  'PHYSICS_LABORATORY',
  'COMPUTER_LABORATORY',
  'LANGUAGE_LABORATORY',
  'WORKSHOP',
  'HOME_ECONOMICS_ROOM',
  'AGRICULTURE_FACILITY',
]

const activityTypes = [
  'ASSEMBLY',
  'CHAPEL',
  'RELIGIOUS_PROGRAMME',
  'CLUB',
  'SPORTS',
  'GUIDANCE_COUNSELLING',
  'LIBRARY_PROGRAMME',
  'WEEKLY_TEST',
  'REMEDIAL',
  'STAFF_MEETING',
  'DEPARTMENT_MEETING',
  'STUDY',
  'CLEANING',
  'BROADCAST',
  'STUDENT_LEADERSHIP',
  'CUSTOM',
]

const examPolicies = [
  'CONTINUE_DURING_EXAMS',
  'SUSPEND_DURING_EXAMS',
  'REQUIRE_MANUAL_DECISION',
  'MOVE_TO_ALTERNATIVE_TIME',
  'EXAMS_CANNOT_OVERRIDE',
]

const curriculumEntryTypes = [
  'LESSON',
  'SUBJECT_LESSON',
  'PRACTICAL_LESSON',
  'LABORATORY_LESSON',
  'COMPUTER_LESSON',
  'STUDY',
  'CUSTOM',
]

const bellSlotTypes = [
  'TEACHING_PERIOD',
  'BREAK',
  'LUNCH',
  'ASSEMBLY',
  'CHAPEL',
  'CLUB',
  'SPORTS',
  'STAFF_MEETING',
  'STUDY',
  'CUSTOM',
  'CLOSED',
]

const bellSlotTagOptions = [
  'MORNING_FOCUS',
  'EARLY_MORNING',
  'LATE_MORNING',
  'BEFORE_LUNCH',
  'AFTER_LUNCH',
  'AFTERNOON',
  'LAST_PERIOD',
  'DOUBLE_PERIOD_FRIENDLY',
  'PRACTICAL_FRIENDLY',
  'LOW_FOCUS',
  'CUSTOM',
]

const focusScopeTypes = ['WHOLE_SCHOOL', 'GRADE', 'CLASS', 'STREAM', 'SUBJECT', 'DEPARTMENT', 'CUSTOM']
const streamRuleScopeTypes = ['WHOLE_SCHOOL', 'GRADE', 'CLASS', 'STREAM', 'SUBJECT', 'CUSTOM']
const ruleSeverities = ['SOFT', 'HARD']
const streamPolicies = [
  'DISALLOW_PARALLEL_SAME_SUBJECT',
  'ALLOW_PARALLEL_SAME_SUBJECT',
  'ALLOW_ONLY_WITH_DIFFERENT_TEACHERS',
  'ALLOW_ONLY_WITH_DIFFERENT_ROOMS',
  'LIMIT_PARALLEL_SAME_SUBJECT',
]

const weekdays = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
]

const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]'
const selectClassName = 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35 disabled:bg-[#f3f4f6] disabled:text-[#9ca3af]'

function Field({ label, children }: { label: string; children: any }) {
  return <label className={labelClass}>{label}{children}</label>
}

function pretty(value: any) {
  return String(value || '-')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function boolLabel(value: any) {
  return Number(value) || value === true ? 'Yes' : 'No'
}

function dateText(value: any) {
  return value ? String(value).slice(0, 10) : '-'
}

function weekdayText(value: any) {
  return weekdays.find((day) => Number(day.value) === Number(value))?.label || '-'
}

function timeText(value: any) {
  return value ? String(value).slice(0, 5) : '-'
}

function timeMinutes(value: any) {
  const text = timeText(value)
  if (!text || text === '-') return null
  const [hours, minutes] = text.split(':').map((part) => Number(part || 0))
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

function rangesOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && endA > startB
}

function isLabFacility(row: any) {
  const type = String(row?.facility_type || '')
  return type.includes('LABORATORY') || ['WORKSHOP', 'HOME_ECONOMICS_ROOM', 'AGRICULTURE_FACILITY'].includes(type)
}

function Pill({ value }: { value: any }) {
  const text = pretty(value)
  const tone = /active|available|approved|yes|pass|published/i.test(text)
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
    : /inactive|closed|blocked|no|cannot|disabled/i.test(text)
      ? 'border-[#fecaca] bg-[#fef2f2] text-[#b91c1c]'
      : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
  return <span className={`inline-flex rounded-[4px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${tone}`}>{text}</span>
}

function sectionMeta(section: SchedulingSettingsSection) {
  if (section === 'academic-configuration') return { title: 'Academic Configuration', subtitle: 'Academic years, terms, teaching days, bell periods and closure context.', icon: CalendarClock }
  if (section === 'facilities') return { title: 'Facilities and Resources', subtitle: 'Classrooms, halls, libraries, sports areas and shared equipment.', icon: Building2 }
  if (section === 'laboratories') return { title: 'Laboratories', subtitle: 'Practical rooms, supported subjects, workstation capacity and exam readiness.', icon: FlaskConical }
  if (section === 'weekly-activities') return { title: 'Weekly Activities', subtitle: 'Assembly, chapel, clubs, sports, tests, study periods and staff meetings.', icon: Activity }
  return { title: 'Timetable Rules', subtitle: 'Occupancy, facility rules and exam scheduling controls from the shared foundation.', icon: Settings2 }
}

function initialFacilityForm(type = 'CLASSROOM') {
  const writtenExamReady = ['CLASSROOM', 'HALL', 'LIBRARY', 'MEETING_ROOM', 'EXAMINATION_ROOM', 'GENERAL_LABORATORY', 'SCIENCE_LABORATORY', 'BIOLOGY_LABORATORY', 'CHEMISTRY_LABORATORY', 'PHYSICS_LABORATORY', 'COMPUTER_LABORATORY', 'LANGUAGE_LABORATORY', 'WORKSHOP', 'HOME_ECONOMICS_ROOM', 'AGRICULTURE_FACILITY'].includes(type)
  return {
    facility_code: '',
    name: '',
    facility_type: type,
    facility_type_label: '',
    building: '',
    floor_label: '',
    normal_capacity: '',
    examination_capacity: '',
    accessible: true,
    can_host_normal_lessons: true,
    can_host_examinations: writtenExamReady,
    can_host_multiple_groups: false,
    booking_required: false,
    active: true,
  }
}

function initialLabForm() {
  return {
    ...initialFacilityForm('GENERAL_LABORATORY'),
    can_host_examinations: true,
    booking_required: true,
    requires_supervision: true,
    can_host_practical_examinations: true,
    can_host_computer_examinations: false,
    workstation_count: '',
    functional_computer_count: '',
    power_required: false,
    network_required: false,
    notes: '',
  }
}

function initialActivityForm() {
  return {
    academic_year_id: '',
    term_id: '',
    name: '',
    activity_type: 'ASSEMBLY',
    activity_type_label: '',
    weekday: '1',
    start_slot_id: '',
    end_slot_id: '',
    start_time: '',
    end_time: '',
    scope_type: 'WHOLE_SCHOOL',
    class_id: '',
    facility_id: '',
    responsible_teacher_id: '',
    exam_policy: 'REQUIRE_MANUAL_DECISION',
    attendance_required: false,
    blocks_normal_lessons: true,
    allows_exam_override: true,
    appears_on_student_timetables: true,
    appears_on_teacher_timetables: true,
    priority: '50',
  }
}

function initialCurriculumForm() {
  return {
    academic_year_id: '',
    term_id: '',
    class_id: '',
    stream_section: '',
    subject_id: '',
    teacher_id: '',
    entry_type: 'SUBJECT_LESSON',
    periods_per_cycle: '4',
    block_length: '1',
    required_facility_id: '',
    required_facility_type: '',
    required_capacity: '',
    priority: '50',
    active: true,
  }
}

function initialBellTemplateForm() {
  return {
    name: '',
    description: '',
    timetable_id: '',
    shift_id: '',
    is_default: false,
    active: true,
  }
}

function initialBellSlotForm() {
  return {
    template_id: '',
    slot_number: '1',
    code: 'P1',
    display_name: 'Period 1',
    start_time: '07:30',
    end_time: '08:10',
    slot_type: 'TEACHING_PERIOD',
    teaching_allowed: true,
    can_span: true,
    sort_order: '1',
    tag_codes: [] as string[],
  }
}

function initialFocusCategoryForm() {
  return {
    name: '',
    code: '',
    description: '',
    default_priority: '50',
    active: true,
  }
}

function initialFocusAssignmentForm() {
  return {
    subject_id: '',
    focus_category_id: '',
    academic_year_id: '',
    term_id: '',
    grade_level: '',
    class_id: '',
    stream_section: '',
    active: true,
  }
}

function initialFocusRuleForm() {
  return {
    name: '',
    focus_category_id: '',
    subject_id: '',
    academic_year_id: '',
    term_id: '',
    scope_type: 'WHOLE_SCHOOL',
    scope_value: '',
    grade_level: '',
    class_id: '',
    stream_section: '',
    preferred_slot_tags: ['MORNING_FOCUS', 'EARLY_MORNING'],
    avoided_slot_tags: ['AFTER_LUNCH', 'LAST_PERIOD'],
    severity: 'SOFT',
    penalty_weight: '50',
    max_after_lunch_per_cycle: '',
    max_last_period_per_cycle: '',
    minimum_preferred_per_cycle: '',
    allow_override: true,
    active: true,
  }
}

function initialStreamRuleForm() {
  return {
    name: '',
    academic_year_id: '',
    term_id: '',
    scope_type: 'WHOLE_SCHOOL',
    scope_value: '',
    grade_level: '',
    class_id: '',
    stream_section: '',
    subject_id: '',
    policy: 'DISALLOW_PARALLEL_SAME_SUBJECT',
    severity: 'HARD',
    penalty_weight: '80',
    max_parallel_count: '',
    require_different_teachers: false,
    require_different_rooms: false,
    allow_override: false,
    active: true,
  }
}

function toggleArrayValue(values: string[] = [], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

export function SchedulingSettingsPage({ section }: { section: SchedulingSettingsSection }) {
  const { api, token, user } = usePortal()
  const navigate = useNavigate()
  const meta = sectionMeta(section)
  const Icon = meta.icon
  const canManage = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState('')
  const [error, setError] = useState('')
  const [options, setOptions] = useState<any>({})
  const [facilities, setFacilities] = useState<any[]>([])
  const [equipment, setEquipment] = useState<any[]>([])
  const [activities, setActivities] = useState<any[]>([])
  const [occupancy, setOccupancy] = useState<any[]>([])
  const [requirements, setRequirements] = useState<any[]>([])
  const [bellSchedules, setBellSchedules] = useState<any[]>([])
  const [bellSlotTags, setBellSlotTags] = useState<any[]>([])
  const [availableBellTags, setAvailableBellTags] = useState<any[]>([])
  const [focusCategories, setFocusCategories] = useState<any[]>([])
  const [focusAssignments, setFocusAssignments] = useState<any[]>([])
  const [focusRules, setFocusRules] = useState<any[]>([])
  const [streamRules, setStreamRules] = useState<any[]>([])
  const [timetables, setTimetables] = useState<any[]>([])
  const [facilityForm, setFacilityForm] = useState<any>(() => initialFacilityForm())
  const [labForm, setLabForm] = useState<any>(() => initialLabForm())
  const [equipmentForm, setEquipmentForm] = useState({ name: '', category: 'general', total_quantity: '1', usable_quantity: '1' })
  const [assignmentForm, setAssignmentForm] = useState({ facility_id: '', equipment_id: '', quantity: '1' })
  const [subjectForm, setSubjectForm] = useState({ facility_id: '', subject_id: '', preferred: true })
  const [activityForm, setActivityForm] = useState<any>(() => initialActivityForm())
  const [curriculumForm, setCurriculumForm] = useState<any>(() => initialCurriculumForm())
  const [editingRequirementId, setEditingRequirementId] = useState<any>(null)
  const [bellTemplateForm, setBellTemplateForm] = useState<any>(() => initialBellTemplateForm())
  const [bellSlotForm, setBellSlotForm] = useState<any>(() => initialBellSlotForm())
  const [editingBellTemplateId, setEditingBellTemplateId] = useState<any>(null)
  const [editingBellSlotId, setEditingBellSlotId] = useState<any>(null)
  const [bellTemplateModalOpen, setBellTemplateModalOpen] = useState(false)
  const [bellSlotModalOpen, setBellSlotModalOpen] = useState(false)
  const [focusCategoryForm, setFocusCategoryForm] = useState<any>(() => initialFocusCategoryForm())
  const [focusAssignmentForm, setFocusAssignmentForm] = useState<any>(() => initialFocusAssignmentForm())
  const [focusRuleForm, setFocusRuleForm] = useState<any>(() => initialFocusRuleForm())
  const [streamRuleForm, setStreamRuleForm] = useState<any>(() => initialStreamRuleForm())
  const [editingFocusCategoryId, setEditingFocusCategoryId] = useState<any>(null)
  const [editingFocusAssignmentId, setEditingFocusAssignmentId] = useState<any>(null)
  const [editingFocusRuleId, setEditingFocusRuleId] = useState<any>(null)
  const [editingStreamRuleId, setEditingStreamRuleId] = useState<any>(null)
  const [dailyPeriodTimetableId, setDailyPeriodTimetableId] = useState('')
  const [dailyPeriodPlan, setDailyPeriodPlan] = useState<any>(null)
  const [dailyPeriodLoading, setDailyPeriodLoading] = useState(false)

  const schoolSlots = useMemo(() => {
    const slots = options?.bell_slots || []
    const schoolOnly = slots.filter((slot: any) => !slot.timetable_type || slot.timetable_type === 'SCHOOL_TIMETABLE')
    return schoolOnly.length ? schoolOnly : slots
  }, [options?.bell_slots])

  const teachingSlots = useMemo(() => schoolSlots.filter((slot: any) => Number(slot.teaching_allowed) === 1), [schoolSlots])
  const labFacilities = useMemo(() => facilities.filter(isLabFacility), [facilities])
  const activeYear = useMemo(() => (options?.years || []).find((year: any) => year.is_active || year.status === 'active') || options?.years?.[0], [options?.years])
  const activeTerm = useMemo(() => (options?.terms || []).find((term: any) => ['open', 'active', 'marking'].includes(String(term.status || '').toLowerCase())) || options?.terms?.[0], [options?.terms])
  const tagsBySlot = useMemo(() => {
    const map = new Map<string, any[]>()
    bellSlotTags.filter((tag) => Number(tag.active) === 1).forEach((tag) => {
      const key = String(tag.bell_schedule_slot_id)
      map.set(key, [...(map.get(key) || []), tag])
    })
    return map
  }, [bellSlotTags])
  const bellSlotTimeIssue = useMemo(() => {
    if (!bellSlotModalOpen) return null
    const start = timeMinutes(bellSlotForm.start_time)
    const end = timeMinutes(bellSlotForm.end_time)
    if (start === null || end === null) return null
    if (end <= start) return 'Period end time must be after start time.'
    const template = bellSchedules.find((row) => String(row.id) === String(bellSlotForm.template_id))
    const overlap = (template?.slots || []).find((slot: any) => {
      if (String(slot.id) === String(editingBellSlotId || '')) return false
      const slotStart = timeMinutes(slot.start_time)
      const slotEnd = timeMinutes(slot.end_time)
      return slotStart !== null && slotEnd !== null && rangesOverlap(start, end, slotStart, slotEnd)
    })
    if (!overlap) return null
    return `${bellSlotForm.display_name || 'This period'} (${timeText(bellSlotForm.start_time)} - ${timeText(bellSlotForm.end_time)}) overlaps ${overlap.display_name || overlap.code || 'another period'} (${timeText(overlap.start_time)} - ${timeText(overlap.end_time)}).`
  }, [bellSchedules, bellSlotForm.display_name, bellSlotForm.end_time, bellSlotForm.start_time, bellSlotForm.template_id, bellSlotModalOpen, editingBellSlotId])

  const refresh = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      const safe = async (loader: () => Promise<any>, fallback: any) => {
        try {
          return await loader()
        } catch {
          return fallback
        }
      }
      const [setupPayload, facilityPayload, equipmentPayload, activityPayload, occupancyPayload, requirementsPayload, bellPayload, timetablePayload, bellTagPayload, focusCategoryPayload, focusAssignmentPayload, focusRulePayload, streamRulePayload] = await Promise.all([
        safe(() => api.getTimetableSetupOptions(token), {}),
        safe(() => api.listSchedulingFacilities(token, { include_inactive: true }), { facilities: [] }),
        safe(() => api.listFacilityEquipment(token, { include_inactive: true }), { equipment: [] }),
        safe(() => api.listWeeklyActivities(token, { include_inactive: true }), { activities: [] }),
        safe(() => api.listSchedulingOccupancy(token, {}), { occupancy: [] }),
        safe(() => api.listCurriculumRequirements(token, { include_inactive: true }), { requirements: [] }),
        safe(() => api.listBellSchedules(token, { include_inactive: true }), { templates: [] }),
        safe(() => api.listTimetables(token, {}), { timetables: [] }),
        safe(() => api.listBellSlotTags(token, { include_inactive: true }), { tags: [], available_tags: [] }),
        safe(() => api.listSubjectFocusCategories(token, { include_inactive: true }), { categories: [] }),
        safe(() => api.listSubjectFocusAssignments(token, { include_inactive: true }), { assignments: [] }),
        safe(() => api.listSubjectFocusRules(token, { include_inactive: true }), { rules: [] }),
        safe(() => api.listStreamSchedulingRules(token, { include_inactive: true }), { rules: [] }),
      ])
      setOptions(setupPayload || {})
      setFacilities(facilityPayload?.facilities || [])
      setEquipment(equipmentPayload?.equipment || [])
      setActivities(activityPayload?.activities || [])
      setOccupancy(occupancyPayload?.occupancy || [])
      setRequirements(requirementsPayload?.requirements || [])
      setBellSchedules(bellPayload?.templates || [])
      setTimetables(timetablePayload?.timetables || [])
      setBellSlotTags(bellTagPayload?.tags || [])
      setAvailableBellTags(bellTagPayload?.available_tags?.length ? bellTagPayload.available_tags : bellSlotTagOptions.map((code) => ({ code, name: pretty(code) })))
      setFocusCategories(focusCategoryPayload?.categories || [])
      setFocusAssignments(focusAssignmentPayload?.assignments || [])
      setFocusRules(focusRulePayload?.rules || [])
      setStreamRules(streamRulePayload?.rules || [])
      setDailyPeriodTimetableId((current) => current || String((timetablePayload?.timetables || []).find((row: any) => row.timetable_type === 'SCHOOL_TIMETABLE')?.id || timetablePayload?.timetables?.[0]?.id || ''))
    } catch (err: any) {
      setError(err?.message || 'Unable to load scheduling settings.')
    } finally {
      setLoading(false)
    }
  }

  const loadDailyPeriodPlan = async (timetableId = dailyPeriodTimetableId) => {
    if (!token || !timetableId) {
      setDailyPeriodPlan(null)
      return
    }
    setDailyPeriodLoading(true)
    try {
      const payload = await api.listTimetableDayTemplates(token, timetableId)
      setDailyPeriodPlan(payload || null)
    } catch (err: any) {
      setDailyPeriodPlan(null)
      toast.error(err?.message || 'Unable to load daily period plan.')
    } finally {
      setDailyPeriodLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, section])

  useEffect(() => {
    if (!dailyPeriodTimetableId || section !== 'academic-configuration') return
    loadDailyPeriodPlan(dailyPeriodTimetableId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyPeriodTimetableId, section, token])

  useEffect(() => {
    setActivityForm((current: any) => ({
      ...current,
      academic_year_id: current.academic_year_id || String(activeYear?.id || ''),
      term_id: current.term_id || String(activeTerm?.id || ''),
      start_slot_id: current.start_slot_id || String(teachingSlots[0]?.id || ''),
      end_slot_id: current.end_slot_id || String(teachingSlots[0]?.id || ''),
    }))
  }, [activeTerm?.id, activeYear?.id, teachingSlots])

  useEffect(() => {
    setCurriculumForm((current: any) => ({
      ...current,
      academic_year_id: current.academic_year_id || String(activeYear?.id || ''),
      term_id: current.term_id || String(activeTerm?.id || ''),
    }))
  }, [activeTerm?.id, activeYear?.id])

  useEffect(() => {
    setFocusAssignmentForm((current: any) => ({
      ...current,
      academic_year_id: current.academic_year_id || String(activeYear?.id || ''),
      term_id: current.term_id || String(activeTerm?.id || ''),
    }))
    setFocusRuleForm((current: any) => ({
      ...current,
      academic_year_id: current.academic_year_id || String(activeYear?.id || ''),
      term_id: current.term_id || String(activeTerm?.id || ''),
    }))
    setStreamRuleForm((current: any) => ({
      ...current,
      academic_year_id: current.academic_year_id || String(activeYear?.id || ''),
      term_id: current.term_id || String(activeTerm?.id || ''),
    }))
  }, [activeTerm?.id, activeYear?.id])

  useEffect(() => {
    setBellSlotForm((current: any) => ({
      ...current,
      template_id: current.template_id || String(bellSchedules.find((row) => Number(row.active) === 1)?.id || bellSchedules[0]?.id || ''),
    }))
  }, [bellSchedules])

  const run = async (label: string, action: () => Promise<any>) => {
    if (!token || !canManage) return
    setSaving(label)
    setError('')
    try {
      await action()
      toast.success(label)
      await refresh()
    } catch (err: any) {
      const message = err?.message || 'Action failed.'
      setError(message)
      toast.error(message)
    } finally {
      setSaving('')
    }
  }

  const createFacility = (form: any, reset: () => void) => run('Facility saved.', async () => {
    await api.createSchedulingFacility(token, {
      ...form,
      normal_capacity: form.normal_capacity || null,
      examination_capacity: form.examination_capacity || null,
      workstation_count: form.workstation_count || null,
      functional_computer_count: form.functional_computer_count || null,
    })
    reset()
  })

  const createEquipment = () => run('Equipment saved.', async () => {
    await api.createFacilityEquipment(token, equipmentForm)
    setEquipmentForm({ name: '', category: 'general', total_quantity: '1', usable_quantity: '1' })
  })

  const assignEquipment = () => run('Equipment assigned.', async () => {
    await api.assignFacilityEquipment(token, assignmentForm.facility_id, {
      equipment_id: assignmentForm.equipment_id,
      quantity: assignmentForm.quantity,
      available_for_exams: true,
      available_for_lessons: true,
    })
    setAssignmentForm({ facility_id: '', equipment_id: '', quantity: '1' })
  })

  const assignSubject = () => run('Subject support saved.', async () => {
    await api.setFacilitySubjectEligibility(token, subjectForm.facility_id, {
      subject_id: subjectForm.subject_id,
      preferred: subjectForm.preferred,
      allowed_lesson_types: ['LESSON', 'LABORATORY_LESSON', 'PRACTICAL'],
      allowed_exam_types: ['WRITTEN', 'PRACTICAL'],
    })
    setSubjectForm({ facility_id: '', subject_id: '', preferred: true })
  })

  const createActivity = () => run('Weekly activity saved.', async () => {
    const classScope = activityForm.scope_type === 'SELECTED_CLASSES' && activityForm.class_id
      ? [{ scope_type: 'SELECTED_CLASSES', scope_reference_id: activityForm.class_id }]
      : []
    await api.createWeeklyActivity(token, {
      ...activityForm,
      term_id: activityForm.term_id || null,
      start_slot_id: activityForm.start_slot_id || null,
      end_slot_id: activityForm.end_slot_id || activityForm.start_slot_id || null,
      facility_id: activityForm.facility_id || null,
      responsible_teacher_id: activityForm.responsible_teacher_id || null,
      activity_type_label: activityForm.activity_type === 'CUSTOM' ? activityForm.activity_type_label : null,
      scope_assignments: classScope,
    })
    setActivityForm({
      ...initialActivityForm(),
      academic_year_id: String(activeYear?.id || ''),
      term_id: String(activeTerm?.id || ''),
      start_slot_id: String(teachingSlots[0]?.id || ''),
      end_slot_id: String(teachingSlots[0]?.id || ''),
    })
  })

  const saveBellTemplate = () => run(editingBellTemplateId ? 'Bell schedule updated.' : 'Bell schedule saved.', async () => {
    const payload = {
      ...bellTemplateForm,
      timetable_id: bellTemplateForm.timetable_id || null,
      shift_id: bellTemplateForm.shift_id || null,
      description: bellTemplateForm.description || null,
    }
    if (editingBellTemplateId) await api.updateBellSchedule(token, editingBellTemplateId, payload)
    else await api.createBellSchedule(token, payload)
    setEditingBellTemplateId(null)
    setBellTemplateForm(initialBellTemplateForm())
    setBellTemplateModalOpen(false)
  })

  const editBellTemplate = (row: any) => {
    setEditingBellTemplateId(row.id)
    setBellTemplateForm({
      name: row.name || '',
      description: row.description || '',
      timetable_id: String(row.timetable_id || ''),
      shift_id: row.shift_id || '',
      is_default: Number(row.is_default) === 1,
      active: Number(row.active) === 1,
    })
    setBellTemplateModalOpen(true)
  }

  const openBellTemplateModal = () => {
    setEditingBellTemplateId(null)
    setBellTemplateForm(initialBellTemplateForm())
    setBellTemplateModalOpen(true)
  }

  const closeBellTemplateModal = () => {
    setBellTemplateModalOpen(false)
    setEditingBellTemplateId(null)
    setBellTemplateForm(initialBellTemplateForm())
  }

  const archiveBellTemplate = (row: any) => {
    if (!window.confirm(`Archive ${row.name}?`)) return
    run('Bell schedule archived.', () => api.archiveBellSchedule(token, row.id))
  }

  const saveBellSlot = () => {
    if (bellSlotTimeIssue) {
      setError(bellSlotTimeIssue)
      toast.error(bellSlotTimeIssue)
      return
    }
    return run(editingBellSlotId ? 'Period updated.' : 'Period saved.', async () => {
    const payload = {
      ...bellSlotForm,
      start_time: bellSlotForm.start_time?.length === 5 ? `${bellSlotForm.start_time}:00` : bellSlotForm.start_time,
      end_time: bellSlotForm.end_time?.length === 5 ? `${bellSlotForm.end_time}:00` : bellSlotForm.end_time,
    }
    const result = editingBellSlotId
      ? await api.updateBellScheduleSlot(token, editingBellSlotId, payload)
      : await api.createBellScheduleSlot(token, bellSlotForm.template_id, payload)
    const savedSlotId = editingBellSlotId || result?.slot?.id
    if (savedSlotId) {
      await api.setBellScheduleSlotTags(token, bellSlotForm.template_id, {
        slot_id: savedSlotId,
        tag_codes: bellSlotForm.tag_codes || [],
      })
    }
    const templateId = bellSlotForm.template_id
    setEditingBellSlotId(null)
    setBellSlotForm({ ...initialBellSlotForm(), template_id: templateId })
    setBellSlotModalOpen(false)
    })
  }

  const editBellSlot = (row: any) => {
    setEditingBellSlotId(row.id)
    setBellSlotForm({
      template_id: String(row.template_id || ''),
      slot_number: String(row.slot_number || 1),
      code: row.code || '',
      display_name: row.display_name || '',
      start_time: timeText(row.start_time),
      end_time: timeText(row.end_time),
      slot_type: row.slot_type || 'TEACHING_PERIOD',
      teaching_allowed: Number(row.teaching_allowed) === 1,
      can_span: Number(row.can_span) === 1,
      sort_order: String(row.sort_order || row.slot_number || 1),
      tag_codes: (tagsBySlot.get(String(row.id)) || []).map((tag) => tag.tag_code),
    })
    setBellSlotModalOpen(true)
  }

  const openBellSlotModal = () => {
    setEditingBellSlotId(null)
    setBellSlotForm({
      ...initialBellSlotForm(),
      template_id: bellSlotForm.template_id || String(bellSchedules.find((row) => Number(row.active) === 1)?.id || bellSchedules[0]?.id || ''),
    })
    setBellSlotModalOpen(true)
  }

  const closeBellSlotModal = () => {
    const templateId = bellSlotForm.template_id
    setBellSlotModalOpen(false)
    setEditingBellSlotId(null)
    setBellSlotForm({ ...initialBellSlotForm(), template_id: templateId })
  }

  const deleteBellSlot = (row: any) => {
    if (!window.confirm(`Delete ${row.display_name}?`)) return
    run('Period deleted.', () => api.deleteBellScheduleSlot(token, row.id))
  }

  const saveDayTemplate = async (row: any, bellTemplateId: any) => {
    if (!token || !canManage || !dailyPeriodTimetableId || !bellTemplateId) return
    setSaving('Updating daily periods...')
    setError('')
    try {
      await api.setTimetableDayTemplate(token, dailyPeriodTimetableId, row.cycle_day_id, { bell_template_id: bellTemplateId, active: true })
      toast.success('Daily periods updated.')
      await loadDailyPeriodPlan(dailyPeriodTimetableId)
    } catch (err: any) {
      const message = err?.message || 'Unable to update daily periods.'
      setError(message)
      toast.error(message)
    } finally {
      setSaving('')
    }
  }

  const saveCurriculumRequirement = () => run(editingRequirementId ? 'Requirement updated.' : 'Requirement saved.', async () => {
    const payload = {
      ...curriculumForm,
      term_id: curriculumForm.term_id || null,
      class_id: curriculumForm.class_id || null,
      stream_section: curriculumForm.stream_section || null,
      subject_id: curriculumForm.subject_id || null,
      teacher_id: curriculumForm.teacher_id || null,
      required_facility_id: curriculumForm.required_facility_id || null,
      required_facility_type: curriculumForm.required_facility_type || null,
      required_capacity: curriculumForm.required_capacity || null,
      metadata: {
        source: 'scheduling_settings',
        notes: curriculumForm.entry_type === 'CUSTOM' ? 'Custom curriculum requirement' : undefined,
      },
    }
    if (editingRequirementId) await api.updateCurriculumRequirement(token, editingRequirementId, payload)
    else await api.createCurriculumRequirement(token, payload)
    setEditingRequirementId(null)
    setCurriculumForm({
      ...initialCurriculumForm(),
      academic_year_id: String(activeYear?.id || ''),
      term_id: String(activeTerm?.id || ''),
    })
  })

  const editRequirement = (row: any) => {
    setEditingRequirementId(row.id)
    setCurriculumForm({
      academic_year_id: String(row.academic_year_id || activeYear?.id || ''),
      term_id: String(row.term_id || activeTerm?.id || ''),
      class_id: String(row.class_id || ''),
      stream_section: row.stream_section || '',
      subject_id: String(row.subject_id || ''),
      teacher_id: String(row.teacher_id || ''),
      entry_type: row.entry_type || 'SUBJECT_LESSON',
      periods_per_cycle: String(row.periods_per_cycle || 1),
      block_length: String(row.block_length || 1),
      required_facility_id: String(row.required_facility_id || ''),
      required_facility_type: row.required_facility_type || '',
      required_capacity: row.required_capacity ? String(row.required_capacity) : '',
      priority: String(row.priority ?? 50),
      active: Number(row.active) === 1,
    })
  }

  const archiveRequirement = (row: any) => {
    if (!window.confirm(`Archive ${row.subject_name || row.entry_type} for ${row.class_name || row.stream_section || 'this scope'}?`)) return
    run('Requirement archived.', () => api.archiveCurriculumRequirement(token, row.id))
  }

  const saveFocusCategory = () => run(editingFocusCategoryId ? 'Focus category updated.' : 'Focus category saved.', async () => {
    const payload = {
      ...focusCategoryForm,
      code: focusCategoryForm.code || focusCategoryForm.name,
      description: focusCategoryForm.description || null,
    }
    if (editingFocusCategoryId) await api.updateSubjectFocusCategory(token, editingFocusCategoryId, payload)
    else await api.createSubjectFocusCategory(token, payload)
    setEditingFocusCategoryId(null)
    setFocusCategoryForm(initialFocusCategoryForm())
  })

  const editFocusCategory = (row: any) => {
    setEditingFocusCategoryId(row.id)
    setFocusCategoryForm({
      name: row.name || '',
      code: row.code || '',
      description: row.description || '',
      default_priority: String(row.default_priority ?? 50),
      active: Number(row.active) === 1,
    })
  }

  const archiveFocusCategory = (row: any) => {
    if (!window.confirm(`Archive ${row.name}?`)) return
    run('Focus category archived.', () => api.archiveSubjectFocusCategory(token, row.id))
  }

  const saveFocusAssignment = () => run(editingFocusAssignmentId ? 'Focus assignment updated.' : 'Focus assignment saved.', async () => {
    const payload = {
      ...focusAssignmentForm,
      academic_year_id: focusAssignmentForm.academic_year_id || null,
      term_id: focusAssignmentForm.term_id || null,
      grade_level: focusAssignmentForm.grade_level || null,
      class_id: focusAssignmentForm.class_id || null,
      stream_section: focusAssignmentForm.stream_section || null,
    }
    if (editingFocusAssignmentId) await api.updateSubjectFocusAssignment(token, editingFocusAssignmentId, payload)
    else await api.createSubjectFocusAssignment(token, payload)
    setEditingFocusAssignmentId(null)
    setFocusAssignmentForm({ ...initialFocusAssignmentForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') })
  })

  const editFocusAssignment = (row: any) => {
    setEditingFocusAssignmentId(row.id)
    setFocusAssignmentForm({
      subject_id: String(row.subject_id || ''),
      focus_category_id: String(row.focus_category_id || ''),
      academic_year_id: String(row.academic_year_id || ''),
      term_id: String(row.term_id || ''),
      grade_level: row.grade_level || '',
      class_id: String(row.class_id || ''),
      stream_section: row.stream_section || '',
      active: Number(row.active) === 1,
    })
  }

  const archiveFocusAssignment = (row: any) => {
    if (!window.confirm(`Archive focus assignment for ${row.subject_name || 'this subject'}?`)) return
    run('Focus assignment archived.', () => api.archiveSubjectFocusAssignment(token, row.id))
  }

  const saveFocusRule = () => run(editingFocusRuleId ? 'Subject focus rule updated.' : 'Subject focus rule saved.', async () => {
    const payload = {
      ...focusRuleForm,
      focus_category_id: focusRuleForm.focus_category_id || null,
      subject_id: focusRuleForm.subject_id || null,
      academic_year_id: focusRuleForm.academic_year_id || null,
      term_id: focusRuleForm.term_id || null,
      scope_value: focusRuleForm.scope_value || null,
      grade_level: focusRuleForm.grade_level || null,
      class_id: focusRuleForm.class_id || null,
      stream_section: focusRuleForm.stream_section || null,
      max_after_lunch_per_cycle: focusRuleForm.max_after_lunch_per_cycle === '' ? null : focusRuleForm.max_after_lunch_per_cycle,
      max_last_period_per_cycle: focusRuleForm.max_last_period_per_cycle === '' ? null : focusRuleForm.max_last_period_per_cycle,
      minimum_preferred_per_cycle: focusRuleForm.minimum_preferred_per_cycle === '' ? null : focusRuleForm.minimum_preferred_per_cycle,
    }
    if (editingFocusRuleId) await api.updateSubjectFocusRule(token, editingFocusRuleId, payload)
    else await api.createSubjectFocusRule(token, payload)
    setEditingFocusRuleId(null)
    setFocusRuleForm({ ...initialFocusRuleForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') })
  })

  const editFocusRule = (row: any) => {
    setEditingFocusRuleId(row.id)
    setFocusRuleForm({
      name: row.name || '',
      focus_category_id: String(row.focus_category_id || ''),
      subject_id: String(row.subject_id || ''),
      academic_year_id: String(row.academic_year_id || ''),
      term_id: String(row.term_id || ''),
      scope_type: row.scope_type || 'WHOLE_SCHOOL',
      scope_value: row.scope_value || '',
      grade_level: row.grade_level || '',
      class_id: String(row.class_id || ''),
      stream_section: row.stream_section || '',
      preferred_slot_tags: row.preferred_slot_tags || [],
      avoided_slot_tags: row.avoided_slot_tags || [],
      severity: row.severity || 'SOFT',
      penalty_weight: String(row.penalty_weight ?? 50),
      max_after_lunch_per_cycle: row.max_after_lunch_per_cycle ?? '',
      max_last_period_per_cycle: row.max_last_period_per_cycle ?? '',
      minimum_preferred_per_cycle: row.minimum_preferred_per_cycle ?? '',
      allow_override: Number(row.allow_override) === 1,
      active: Number(row.active) === 1,
    })
  }

  const archiveFocusRule = (row: any) => {
    if (!window.confirm(`Archive ${row.name}?`)) return
    run('Subject focus rule archived.', () => api.archiveSubjectFocusRule(token, row.id))
  }

  const saveStreamRule = () => run(editingStreamRuleId ? 'Stream rule updated.' : 'Stream rule saved.', async () => {
    const payload = {
      ...streamRuleForm,
      academic_year_id: streamRuleForm.academic_year_id || null,
      term_id: streamRuleForm.term_id || null,
      scope_value: streamRuleForm.scope_value || null,
      grade_level: streamRuleForm.grade_level || null,
      class_id: streamRuleForm.class_id || null,
      stream_section: streamRuleForm.stream_section || null,
      subject_id: streamRuleForm.subject_id || null,
      max_parallel_count: streamRuleForm.max_parallel_count === '' ? null : streamRuleForm.max_parallel_count,
    }
    if (editingStreamRuleId) await api.updateStreamSchedulingRule(token, editingStreamRuleId, payload)
    else await api.createStreamSchedulingRule(token, payload)
    setEditingStreamRuleId(null)
    setStreamRuleForm({ ...initialStreamRuleForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') })
  })

  const editStreamRule = (row: any) => {
    setEditingStreamRuleId(row.id)
    setStreamRuleForm({
      name: row.name || '',
      academic_year_id: String(row.academic_year_id || ''),
      term_id: String(row.term_id || ''),
      scope_type: row.scope_type || 'WHOLE_SCHOOL',
      scope_value: row.scope_value || '',
      grade_level: row.grade_level || '',
      class_id: String(row.class_id || ''),
      stream_section: row.stream_section || '',
      subject_id: String(row.subject_id || ''),
      policy: row.policy || 'DISALLOW_PARALLEL_SAME_SUBJECT',
      severity: row.severity || 'HARD',
      penalty_weight: String(row.penalty_weight ?? 80),
      max_parallel_count: row.max_parallel_count ?? '',
      require_different_teachers: Number(row.require_different_teachers) === 1,
      require_different_rooms: Number(row.require_different_rooms) === 1,
      allow_override: Number(row.allow_override) === 1,
      active: Number(row.active) === 1,
    })
  }

  const archiveStreamRule = (row: any) => {
    if (!window.confirm(`Archive ${row.name}?`)) return
    run('Stream scheduling rule archived.', () => api.archiveStreamSchedulingRule(token, row.id))
  }

  const archiveFacility = (row: any) => {
    if (!window.confirm(`Archive ${row.name}?`)) return
    run('Facility archived.', () => api.archiveSchedulingFacility(token, row.id))
  }

  const duplicateFacility = (row: any) => run('Facility duplicated.', () => api.duplicateSchedulingFacility(token, row.id, { name: `${row.name} copy` }))

  const archiveActivity = (row: any) => {
    if (!window.confirm(`Archive ${row.name}?`)) return
    run('Weekly activity archived.', () => api.archiveWeeklyActivity(token, row.id))
  }

  const duplicateActivity = (row: any) => run('Weekly activity duplicated.', () => api.duplicateWeeklyActivity(token, row.id, { name: `${row.name} copy` }))

  const facilityRows = facilities.map((row) => ({
    ...row,
    typeText: row.facility_type_label || pretty(row.facility_type),
    capacityText: `${row.normal_capacity || '-'} / ${row.examination_capacity || '-'}`,
    examText: boolLabel(row.can_host_examinations),
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const labRows = labFacilities.map((row) => ({
    ...row,
    typeText: row.facility_type_label || pretty(row.facility_type),
    capacityText: `${row.normal_capacity || '-'} / ${row.examination_capacity || '-'}`,
    computersText: `${row.functional_computer_count || 0} usable / ${row.workstation_count || 0} stations`,
    examText: [
      Number(row.can_host_practical_examinations) ? 'Practical' : '',
      Number(row.can_host_computer_examinations) ? 'Computer' : '',
      Number(row.can_host_examinations) ? 'Written' : '',
    ].filter(Boolean).join(', ') || '-',
  }))

  const activityRows = activities.map((row) => ({
    ...row,
    typeText: row.activity_type_label || pretty(row.activity_type),
    dayText: row.cycle_day_name || weekdayText(row.weekday),
    timeText: `${row.start_slot_name || timeText(row.start_time)} - ${row.end_slot_name || timeText(row.end_time)}`,
    ownerText: row.responsible_teacher_name || '-',
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const occupancyRows = occupancy.slice(0, 120).map((row) => ({
    ...row,
    resourceText: pretty(row.resourceType),
    whenText: [row.date || weekdayText(row.weekday), `${timeText(row.startTime)} - ${timeText(row.endTime)}`].filter(Boolean).join(' / '),
    sourceText: pretty(row.sourceEntityType),
    blockingText: row.blocking ? 'Blocking' : 'Flexible',
  }))

  const requirementRows = requirements.map((row) => ({
    ...row,
    scopeText: row.class_name || row.stream_section || (row.student_group_id ? `Group ${row.student_group_id}` : '-'),
    subjectText: row.subject_name || pretty(row.entry_type),
    teacherText: row.teacher_name || 'Any eligible teacher',
    loadText: `${row.periods_per_cycle || 0} period${Number(row.periods_per_cycle) === 1 ? '' : 's'} / block ${row.block_length || 1}`,
    facilityText: row.required_facility_name || (row.required_facility_type ? pretty(row.required_facility_type) : 'Any suitable room'),
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const focusCategoryRows = focusCategories.map((row) => ({
    ...row,
    priorityText: row.default_priority ?? 50,
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const focusAssignmentRows = focusAssignments.map((row) => ({
    ...row,
    subjectText: row.subject_name || `Subject ${row.subject_id}`,
    categoryText: row.focus_category_name || `Category ${row.focus_category_id}`,
    scopeText: [row.grade_level, row.class_name, row.stream_section].filter(Boolean).join(' / ') || 'Whole school',
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const focusRuleRows = focusRules.map((row) => ({
    ...row,
    targetText: row.focus_category_name || row.subject_name || '-',
    scopeText: [pretty(row.scope_type), row.grade_level, row.class_name, row.stream_section, row.scope_value].filter(Boolean).join(' / '),
    timingText: [
      (row.preferred_slot_tags || []).length ? `Prefer ${(row.preferred_slot_tags || []).map(pretty).join(', ')}` : '',
      (row.avoided_slot_tags || []).length ? `Avoid ${(row.avoided_slot_tags || []).map(pretty).join(', ')}` : '',
    ].filter(Boolean).join(' | ') || '-',
    severityText: row.severity || 'SOFT',
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const streamRuleRows = streamRules.map((row) => ({
    ...row,
    targetText: row.subject_name || 'All subjects',
    scopeText: [pretty(row.scope_type), row.grade_level, row.class_name, row.stream_section, row.scope_value].filter(Boolean).join(' / '),
    policyText: pretty(row.policy),
    severityText: row.severity || 'HARD',
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const bellScheduleRows = bellSchedules.map((row) => ({
    ...row,
    timetableText: row.timetable_name || 'Whole school / reusable',
    typeText: row.timetable_type ? pretty(row.timetable_type) : 'Shared',
    defaultText: Number(row.is_default) ? 'Default' : 'Optional',
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))

  const bellSlotRows = bellSchedules.flatMap((template) => (template.slots || []).map((slot: any) => ({
    ...slot,
    templateName: template.name,
    timeText: `${timeText(slot.start_time)} - ${timeText(slot.end_time)}`,
    typeText: pretty(slot.slot_type),
    tagText: (tagsBySlot.get(String(slot.id)) || []).map((tag) => pretty(tag.tag_code)).join(', '),
    teachingText: Number(slot.teaching_allowed) ? 'Teaching' : 'Blocked',
    spanText: Number(slot.can_span) ? 'Can span' : 'No span',
  })))
  const dailyTemplateRows = (dailyPeriodPlan?.day_templates || []).map((row: any) => ({
    ...row,
    scheduleText: row.bell_template_name || 'Unassigned',
    timeText: row.day_start_time && row.day_end_time ? `${timeText(row.day_start_time)} - ${timeText(row.day_end_time)}` : '-',
    statusText: Number(row.active) ? 'Active' : 'Inactive',
  }))
  const dailyAvailableTemplates = dailyPeriodPlan?.templates || []
  const dailyAssignedRows = dailyTemplateRows.filter((row: any) => row.bell_template_id && Number(row.active))
  const dailyStart = dailyAssignedRows
    .map((row: any) => timeText(row.day_start_time))
    .filter((value: string) => value && value !== '-')
    .sort()[0] || '-'
  const dailyEnd = dailyAssignedRows
    .map((row: any) => timeText(row.day_end_time))
    .filter((value: string) => value && value !== '-')
    .sort()
  const dailyEndText = dailyEnd[dailyEnd.length - 1] || '-'

  const kpis = [
    { label: 'Facilities', value: facilities.length, helper: 'shared school resources', delta: `${labFacilities.length} labs` },
    { label: 'Exam-ready Rooms', value: facilities.filter((row) => Number(row.can_host_examinations)).length, helper: 'written or practical exams', delta: 'facility rules' },
    { label: 'Weekly Activities', value: activities.filter((row) => Number(row.active)).length, helper: 'active recurring events', delta: `${activities.filter((row) => Number(row.blocks_normal_lessons)).length} blocking` },
    { label: 'Requirements', value: requirements.filter((row) => Number(row.active)).length, helper: 'solver period rules', delta: `${requirements.reduce((sum, row) => sum + Number(row.periods_per_cycle || 0), 0)} periods` },
    { label: 'Bell Schedules', value: bellSchedules.filter((row) => Number(row.active)).length, helper: 'period templates', delta: `${bellSlotRows.length} slots` },
    { label: 'Bell Periods', value: teachingSlots.length, helper: 'available setup periods', delta: schoolSlots[0]?.timetable_name || 'shared setup' },
  ]

  const renderAcademicConfiguration = () => (
    <div className="grid gap-3">
      <SectionKpiStrip items={kpis} />
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <SectionCard title="Academic Context" subtitle="The timetable engine reads active academic years and terms from the school session module.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Name', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'start_date', label: 'Start', render: (row) => dateText(row.start_date) },
              { key: 'end_date', label: 'End', render: (row) => dateText(row.end_date) },
              { key: 'status', label: 'Status', render: (row) => <Pill value={row.status || (row.is_active ? 'active' : 'inactive')} /> },
            ]}
            rows={options?.years || []}
            emptyMessage="No academic years are available."
          />
        </SectionCard>
        <SectionCard title="Scheduling Sources" subtitle="Open the existing managers for detailed academic setup.">
          <div className="grid gap-2 p-4">
            {[
              ['Academic Years', `${(options?.years || []).length} configured`, '/academic-sessions'],
              ['Terms', `${(options?.terms || []).length} configured`, '/academic-sessions'],
              ['Teaching Days', 'Created inside each timetable', '/timetables'],
              ['Bell Schedules', `${(options?.bell_templates || []).length} templates`, '/timetables'],
              ['School Closures', 'Managed from calendar and academic sessions', '/calendar'],
            ].map(([label, detail, path]) => (
              <button key={label} type="button" onClick={() => navigate(path)} className="flex items-center justify-between gap-3 rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2 text-left hover:bg-[#f8fafc]">
                <span>
                  <span className="block text-[12px] font-semibold text-[#111827]">{label}</span>
                  <span className="text-[11px] text-[#6b7280]">{detail}</span>
                </span>
                <Pill value="Open" />
              </button>
            ))}
          </div>
        </SectionCard>
      </div>
      <SectionCard
        title="Daily Period Plan"
        subtitle="Assign the period template each timetable day should use. Edit the actual period times in Bell Periods below."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden text-[11px] font-semibold text-[#64748b] sm:inline">Day runs {dailyStart} - {dailyEndText}</span>
            <select
              value={dailyPeriodTimetableId}
              onChange={(event) => setDailyPeriodTimetableId(event.target.value)}
              className={`${selectClassName} min-w-[220px]`}
            >
              <option value="">Select timetable</option>
              {timetables.filter((row) => row.timetable_type === 'SCHOOL_TIMETABLE').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </div>
        }
      >
        {dailyPeriodLoading ? (
          <SmartLinkLoadingState label="Loading daily periods" detail="Preparing day-by-day bell schedules." />
        ) : (
          <PortalTable
            columns={[
              { key: 'cycle_day_name', label: 'Day', render: (row) => <span className="font-semibold text-[#111827]">{row.cycle_day_name || row.cycle_day_code}</span> },
              {
                key: 'bell_template_id',
                label: 'Period schedule',
                render: (row) => (
                  <select
                    value={row.bell_template_id || ''}
                    disabled={!canManage || saving !== ''}
                    onChange={(event) => saveDayTemplate(row, event.target.value)}
                    className={`${selectClassName} min-w-[220px]`}
                  >
                    <option value="">Choose schedule</option>
                    {dailyAvailableTemplates.map((template: any) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({timeText(template.day_start_time)} - {timeText(template.day_end_time)})
                      </option>
                    ))}
                  </select>
                ),
              },
              { key: 'timeText', label: 'School day' },
              { key: 'slot_count', label: 'Periods', render: (row) => row.slot_count || '-' },
              { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
            ]}
            rows={dailyTemplateRows}
            emptyMessage={dailyPeriodTimetableId ? 'No cycle days are configured for this timetable.' : 'Select a timetable to edit daily periods.'}
          />
        )}
      </SectionCard>
      <SectionCard
        title="Bell Periods"
        subtitle="Current period choices available to weekly activities and timetable entry."
        actions={canManage ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button type="button" variant="outline" onClick={openBellTemplateModal} className="h-8 rounded-[5px] text-[12px]">
              <Plus className="size-3.5" />
              Create bell schedule
            </Button>
            <Button type="button" onClick={openBellSlotModal} disabled={!bellSchedules.length} className="h-8 rounded-[5px] text-[12px]">
              <Plus className="size-3.5" />
              Add period
            </Button>
          </div>
        ) : null}
      >
        <div className="grid gap-3 border-b border-[#e5e7eb] p-4">
          <div className="grid gap-3">
            <PortalTable
              columns={[
                { key: 'name', label: 'Schedule', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
                { key: 'timetableText', label: 'Scope' },
                { key: 'slot_count', label: 'Periods' },
                { key: 'defaultText', label: 'Default', render: (row) => <Pill value={row.defaultText} /> },
                { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
                {
                  key: 'actions',
                  label: 'Action',
                  render: (row) => canManage ? (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={(event) => { event.stopPropagation(); editBellTemplate(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit bell schedule"><Pencil className="size-3.5" /></button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); archiveBellTemplate(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive bell schedule"><Trash2 className="size-3.5" /></button>
                    </div>
                  ) : '-',
                },
              ]}
              rows={bellScheduleRows}
              emptyMessage="No bell schedules have been configured."
            />
            <PortalTable
              columns={[
                { key: 'display_name', label: 'Period', render: (row) => <span className="font-semibold text-[#111827]">{row.display_name}</span> },
                { key: 'templateName', label: 'Schedule' },
                { key: 'code', label: 'Code' },
                { key: 'timeText', label: 'Time' },
                { key: 'typeText', label: 'Type' },
                { key: 'tagText', label: 'Tags', render: (row) => row.tagText || '-' },
                { key: 'teachingText', label: 'Teaching', render: (row) => <Pill value={row.teachingText} /> },
                {
                  key: 'actions',
                  label: 'Action',
                  render: (row) => canManage ? (
                    <div className="flex items-center gap-1">
                      <button type="button" onClick={(event) => { event.stopPropagation(); editBellSlot(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit period"><Pencil className="size-3.5" /></button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); deleteBellSlot(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Delete period"><Trash2 className="size-3.5" /></button>
                    </div>
                  ) : '-',
                },
              ]}
              rows={bellSlotRows}
              emptyMessage="No periods have been configured for these schedules."
            />
          </div>
        </div>
        <PortalTable
          columns={[
            { key: 'display_name', label: 'Period', render: (row) => <span className="font-semibold text-[#111827]">{row.display_name}</span> },
            { key: 'template_name', label: 'Template' },
            { key: 'timetable_name', label: 'Timetable', render: (row) => row.timetable_name || '-' },
            { key: 'time', label: 'Time', render: (row) => `${timeText(row.start_time)} - ${timeText(row.end_time)}` },
            { key: 'slot_type', label: 'Type', render: (row) => pretty(row.slot_type) },
            { key: 'teaching_allowed', label: 'Teaching', render: (row) => <Pill value={boolLabel(row.teaching_allowed)} /> },
          ]}
          rows={schoolSlots}
          emptyMessage="No bell periods are available yet. Create a school timetable to seed default periods."
        />
      </SectionCard>

      <ModalShell
        open={bellTemplateModalOpen}
        onOpenChange={(open) => open ? setBellTemplateModalOpen(true) : closeBellTemplateModal()}
        title={editingBellTemplateId ? 'Edit Bell Schedule' : 'Create Bell Schedule'}
        description="Create the day template that holds lesson periods, breaks and lunch."
        className="max-w-2xl"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeBellTemplateModal} disabled={saving !== ''} className="h-8 rounded-[5px] text-[12px]">Cancel</Button>
            <Button type="button" disabled={!canManage || saving !== '' || !bellTemplateForm.name} onClick={saveBellTemplate} className="h-8 rounded-[5px] text-[12px]">
              <Save className="size-3.5" />
              {editingBellTemplateId ? 'Update schedule' : 'Save schedule'}
            </Button>
          </>
        )}
      >
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          <Field label="Name"><Input value={bellTemplateForm.name} onChange={(event) => setBellTemplateForm({ ...bellTemplateForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="Standard School Day" /></Field>
          <Field label="Timetable">
            <select value={bellTemplateForm.timetable_id} onChange={(event) => setBellTemplateForm({ ...bellTemplateForm, timetable_id: event.target.value })} className={selectClassName}>
              <option value="">Reusable across school</option>
              {timetables.map((row) => <option key={row.id} value={row.id}>{row.name} ({pretty(row.timetable_type)})</option>)}
            </select>
          </Field>
          <Field label="Description"><Input value={bellTemplateForm.description} onChange={(event) => setBellTemplateForm({ ...bellTemplateForm, description: event.target.value })} className="h-8 text-[12px]" /></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2">
              <span className="text-[12px] font-semibold text-[#374151]">Default</span>
              <Switch checked={Boolean(bellTemplateForm.is_default)} onCheckedChange={(value) => setBellTemplateForm({ ...bellTemplateForm, is_default: value })} />
            </div>
            <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2">
              <span className="text-[12px] font-semibold text-[#374151]">Active</span>
              <Switch checked={Boolean(bellTemplateForm.active)} onCheckedChange={(value) => setBellTemplateForm({ ...bellTemplateForm, active: value })} />
            </div>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={bellSlotModalOpen}
        onOpenChange={(open) => open ? setBellSlotModalOpen(true) : closeBellSlotModal()}
        title={editingBellSlotId ? 'Edit Period' : 'Add Period'}
        description="Breaks, lunch and closed blocks are saved as non-teaching periods."
        className="max-w-3xl"
        footer={(
          <>
            <Button type="button" variant="outline" onClick={closeBellSlotModal} disabled={saving !== ''} className="h-8 rounded-[5px] text-[12px]">Cancel</Button>
            <Button type="button" disabled={!canManage || saving !== '' || Boolean(bellSlotTimeIssue) || !bellSlotForm.template_id || !bellSlotForm.code || !bellSlotForm.display_name || !bellSlotForm.start_time || !bellSlotForm.end_time} onClick={saveBellSlot} className="h-8 rounded-[5px] text-[12px]">
              <Save className="size-3.5" />
              {editingBellSlotId ? 'Update period' : 'Save period'}
            </Button>
          </>
        )}
      >
        <div className="grid max-h-[70vh] gap-3 overflow-y-auto pr-1">
          <Field label="Bell schedule">
            <select value={bellSlotForm.template_id} disabled={Boolean(editingBellSlotId)} onChange={(event) => setBellSlotForm({ ...bellSlotForm, template_id: event.target.value })} className={selectClassName}>
              <option value="">Select schedule</option>
              {bellSchedules.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="No."><Input type="number" min="1" value={bellSlotForm.slot_number} onChange={(event) => setBellSlotForm({ ...bellSlotForm, slot_number: event.target.value, sort_order: event.target.value })} className="h-8 text-[12px]" /></Field>
            <Field label="Code"><Input value={bellSlotForm.code} onChange={(event) => setBellSlotForm({ ...bellSlotForm, code: event.target.value })} className="h-8 text-[12px]" placeholder="P1" /></Field>
            <Field label="Sort"><Input type="number" min="0" value={bellSlotForm.sort_order} onChange={(event) => setBellSlotForm({ ...bellSlotForm, sort_order: event.target.value })} className="h-8 text-[12px]" /></Field>
          </div>
          <Field label="Display name"><Input value={bellSlotForm.display_name} onChange={(event) => setBellSlotForm({ ...bellSlotForm, display_name: event.target.value })} className="h-8 text-[12px]" placeholder="Period 1" /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Start"><Input type="time" value={bellSlotForm.start_time} onChange={(event) => setBellSlotForm({ ...bellSlotForm, start_time: event.target.value })} className="h-8 text-[12px]" /></Field>
            <Field label="End"><Input type="time" value={bellSlotForm.end_time} onChange={(event) => setBellSlotForm({ ...bellSlotForm, end_time: event.target.value })} className="h-8 text-[12px]" /></Field>
          </div>
          {bellSlotTimeIssue ? (
            <div className="rounded-[6px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-medium text-[#9a3412]">
              {bellSlotTimeIssue}
            </div>
          ) : null}
          <Field label="Type">
            <select
              value={bellSlotForm.slot_type}
              onChange={(event) => {
                const value = event.target.value
                const blocked = ['BREAK', 'LUNCH', 'CLOSED'].includes(value)
                setBellSlotForm({ ...bellSlotForm, slot_type: value, teaching_allowed: blocked ? false : bellSlotForm.teaching_allowed, can_span: blocked ? false : bellSlotForm.can_span })
              }}
              className={selectClassName}
            >
              {bellSlotTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
            </select>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
              <span className="text-[12px] font-semibold text-[#374151]">Teaching allowed</span>
              <Switch checked={Boolean(bellSlotForm.teaching_allowed)} onCheckedChange={(value) => setBellSlotForm({ ...bellSlotForm, teaching_allowed: value })} />
            </div>
            <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
              <span className="text-[12px] font-semibold text-[#374151]">Can span</span>
              <Switch checked={Boolean(bellSlotForm.can_span)} onCheckedChange={(value) => setBellSlotForm({ ...bellSlotForm, can_span: value })} />
            </div>
          </div>
          <div className="grid gap-2">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Slot tags</div>
            <div className="flex flex-wrap gap-1.5">
              {(availableBellTags.length ? availableBellTags : bellSlotTagOptions.map((code) => ({ code, name: pretty(code) }))).map((tag) => {
                const code = tag.code || tag.tag_code
                const active = (bellSlotForm.tag_codes || []).includes(code)
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setBellSlotForm({ ...bellSlotForm, tag_codes: toggleArrayValue(bellSlotForm.tag_codes || [], code) })}
                    className={`rounded-[4px] border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${active ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#d9dce3] bg-white text-[#475569]'}`}
                  >
                    {tag.name || pretty(code)}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </ModalShell>
    </div>
  )

  const renderFacilities = () => (
    <div className="grid gap-3">
      <SectionKpiStrip items={kpis} />
      <div className="grid gap-3 2xl:grid-cols-[380px_minmax(0,1fr)]">
        <SectionCard title="Create Facility" subtitle="Facilities are shared by normal timetables, weekly activities and exams.">
          <div className="grid gap-3 p-4">
            <Field label="Code"><Input value={facilityForm.facility_code} onChange={(event) => setFacilityForm({ ...facilityForm, facility_code: event.target.value })} className="h-8 text-[12px]" placeholder="ROOM-01" /></Field>
            <Field label="Name"><Input value={facilityForm.name} onChange={(event) => setFacilityForm({ ...facilityForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="Year 3A Classroom" /></Field>
            <Field label="Type">
              <select value={facilityForm.facility_type} onChange={(event) => setFacilityForm({ ...facilityForm, facility_type: event.target.value })} className={selectClassName}>
                {facilityTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
              </select>
            </Field>
            {facilityForm.facility_type === 'CUSTOM' ? <Field label="Custom label"><Input value={facilityForm.facility_type_label} onChange={(event) => setFacilityForm({ ...facilityForm, facility_type_label: event.target.value })} className="h-8 text-[12px]" /></Field> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Building"><Input value={facilityForm.building} onChange={(event) => setFacilityForm({ ...facilityForm, building: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Floor"><Input value={facilityForm.floor_label} onChange={(event) => setFacilityForm({ ...facilityForm, floor_label: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Normal capacity"><Input type="number" min="0" value={facilityForm.normal_capacity} onChange={(event) => setFacilityForm({ ...facilityForm, normal_capacity: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Exam capacity"><Input type="number" min="0" value={facilityForm.examination_capacity} onChange={(event) => setFacilityForm({ ...facilityForm, examination_capacity: event.target.value })} className="h-8 text-[12px]" /></Field>
            </div>
            {[
              ['Accessible', 'accessible'],
              ['Normal lessons', 'can_host_normal_lessons'],
              ['Examinations', 'can_host_examinations'],
              ['Multiple groups', 'can_host_multiple_groups'],
              ['Booking required', 'booking_required'],
            ].map(([label, key]) => (
              <div key={key} className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                <span className="text-[12px] font-semibold text-[#374151]">{label}</span>
                <Switch checked={Boolean(facilityForm[key])} onCheckedChange={(value) => setFacilityForm({ ...facilityForm, [key]: value })} />
              </div>
            ))}
            <Button type="button" disabled={!canManage || loading || saving !== '' || !facilityForm.facility_code || !facilityForm.name} onClick={() => createFacility(facilityForm, () => setFacilityForm(initialFacilityForm()))} className="h-8 justify-self-start rounded-[5px] text-[12px]">
              <Save className="size-3.5" />
              Save facility
            </Button>
          </div>
        </SectionCard>
        <SectionCard title="Facilities" subtitle="All school-owned spaces that can be reserved or validated.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Name', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'facility_code', label: 'Code' },
              { key: 'typeText', label: 'Type' },
              { key: 'capacityText', label: 'Normal / Exam' },
              { key: 'examText', label: 'Exam', render: (row) => <Pill value={row.examText} /> },
              { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); duplicateFacility(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Duplicate facility"><Plus className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveFacility(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive facility"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={facilityRows}
            emptyMessage="No facilities have been configured."
          />
        </SectionCard>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <SectionCard title="Shared Equipment" subtitle="Reusable resources that can be assigned to rooms and laboratories.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Name' },
              { key: 'category', label: 'Category', render: (row) => pretty(row.category) },
              { key: 'total_quantity', label: 'Total' },
              { key: 'usable_quantity', label: 'Usable' },
              { key: 'active', label: 'Status', render: (row) => <Pill value={Number(row.active) ? 'Active' : 'Inactive'} /> },
            ]}
            rows={equipment}
            emptyMessage="No shared equipment is configured."
          />
        </SectionCard>
        <SectionCard title="Add Equipment" subtitle="Create resources, then assign them to a facility.">
          <div className="grid gap-3 p-4">
            <Field label="Name"><Input value={equipmentForm.name} onChange={(event) => setEquipmentForm({ ...equipmentForm, name: event.target.value })} className="h-8 text-[12px]" /></Field>
            <Field label="Category"><Input value={equipmentForm.category} onChange={(event) => setEquipmentForm({ ...equipmentForm, category: event.target.value })} className="h-8 text-[12px]" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Total"><Input type="number" min="0" value={equipmentForm.total_quantity} onChange={(event) => setEquipmentForm({ ...equipmentForm, total_quantity: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Usable"><Input type="number" min="0" value={equipmentForm.usable_quantity} onChange={(event) => setEquipmentForm({ ...equipmentForm, usable_quantity: event.target.value })} className="h-8 text-[12px]" /></Field>
            </div>
            <Button type="button" disabled={!canManage || !equipmentForm.name || saving !== ''} onClick={createEquipment} className="h-8 justify-self-start rounded-[5px] text-[12px]">
              <Plus className="size-3.5" />
              Add equipment
            </Button>
            <div className="h-px bg-[#e5e7eb]" />
            <Field label="Facility">
              <select value={assignmentForm.facility_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, facility_id: event.target.value })} className={selectClassName}>
                <option value="">Select facility</option>
                {facilities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Equipment">
              <select value={assignmentForm.equipment_id} onChange={(event) => setAssignmentForm({ ...assignmentForm, equipment_id: event.target.value })} className={selectClassName}>
                <option value="">Select equipment</option>
                {equipment.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
              </select>
            </Field>
            <Field label="Quantity"><Input type="number" min="1" value={assignmentForm.quantity} onChange={(event) => setAssignmentForm({ ...assignmentForm, quantity: event.target.value })} className="h-8 text-[12px]" /></Field>
            <Button type="button" variant="outline" disabled={!canManage || !assignmentForm.facility_id || !assignmentForm.equipment_id || saving !== ''} onClick={assignEquipment} className="h-8 justify-self-start rounded-[5px] text-[12px]">
              Assign to facility
            </Button>
          </div>
        </SectionCard>
      </div>
    </div>
  )

  const renderLaboratories = () => (
    <div className="grid gap-3">
      <SectionKpiStrip items={kpis} />
      <div className="grid gap-3 2xl:grid-cols-[400px_minmax(0,1fr)]">
        <SectionCard title="Create Laboratory" subtitle="Laboratories inherit the shared facility model and add practical/exam readiness fields.">
          <div className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Code"><Input value={labForm.facility_code} onChange={(event) => setLabForm({ ...labForm, facility_code: event.target.value })} className="h-8 text-[12px]" placeholder="LAB-BIO" /></Field>
              <Field label="Name"><Input value={labForm.name} onChange={(event) => setLabForm({ ...labForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="Biology Laboratory" /></Field>
            </div>
            <Field label="Laboratory type">
              <select value={labForm.facility_type} onChange={(event) => setLabForm({ ...labForm, facility_type: event.target.value })} className={selectClassName}>
                {laboratoryTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Teaching capacity"><Input type="number" min="0" value={labForm.normal_capacity} onChange={(event) => setLabForm({ ...labForm, normal_capacity: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Exam capacity"><Input type="number" min="0" value={labForm.examination_capacity} onChange={(event) => setLabForm({ ...labForm, examination_capacity: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Workstations"><Input type="number" min="0" value={labForm.workstation_count} onChange={(event) => setLabForm({ ...labForm, workstation_count: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Usable computers"><Input type="number" min="0" value={labForm.functional_computer_count} onChange={(event) => setLabForm({ ...labForm, functional_computer_count: event.target.value })} className="h-8 text-[12px]" /></Field>
            </div>
            <div className="grid gap-2">
              {[
                ['Practical exams', 'can_host_practical_examinations'],
                ['Computer exams', 'can_host_computer_examinations'],
                ['Written exams', 'can_host_examinations'],
                ['Requires supervision', 'requires_supervision'],
                ['Power required', 'power_required'],
                ['Network required', 'network_required'],
              ].map(([label, key]) => (
                <div key={key} className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                  <span className="text-[12px] font-semibold text-[#374151]">{label}</span>
                  <Switch checked={Boolean(labForm[key])} onCheckedChange={(value) => setLabForm({ ...labForm, [key]: value })} />
                </div>
              ))}
            </div>
            <Button type="button" disabled={!canManage || saving !== '' || !labForm.facility_code || !labForm.name} onClick={() => createFacility(labForm, () => setLabForm(initialLabForm()))} className="h-8 justify-self-start rounded-[5px] text-[12px]">
              <Save className="size-3.5" />
              Save laboratory
            </Button>
          </div>
        </SectionCard>
        <SectionCard title="Laboratories" subtitle="Specialist rooms available for practical lessons and examinations.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Name', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'facility_code', label: 'Code' },
              { key: 'typeText', label: 'Type' },
              { key: 'capacityText', label: 'Teaching / Exam' },
              { key: 'computersText', label: 'Computers' },
              { key: 'examText', label: 'Exam modes' },
              { key: 'subject_count', label: 'Subjects' },
            ]}
            rows={labRows}
            emptyMessage="No laboratories have been configured."
          />
        </SectionCard>
      </div>
      <SectionCard title="Supported Subjects" subtitle="Subject support is used by timetable conflict checks and practical exam scheduling.">
        <div className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_auto] md:items-end">
          <Field label="Laboratory">
            <select value={subjectForm.facility_id} onChange={(event) => setSubjectForm({ ...subjectForm, facility_id: event.target.value })} className={selectClassName}>
              <option value="">Select laboratory</option>
              {labFacilities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Subject">
            <select value={subjectForm.subject_id} onChange={(event) => setSubjectForm({ ...subjectForm, subject_id: event.target.value })} className={selectClassName}>
              <option value="">Select subject</option>
              {(options?.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
            <span className="text-[12px] font-semibold text-[#374151]">Preferred</span>
            <Switch checked={subjectForm.preferred} onCheckedChange={(value) => setSubjectForm({ ...subjectForm, preferred: value })} />
          </div>
          <Button type="button" disabled={!canManage || !subjectForm.facility_id || !subjectForm.subject_id || saving !== ''} onClick={assignSubject} className="h-8 rounded-[5px] text-[12px]">
            <Save className="size-3.5" />
            Save support
          </Button>
        </div>
      </SectionCard>
    </div>
  )

  const renderWeeklyActivities = () => (
    <div className="grid gap-3">
      <SectionKpiStrip items={kpis} />
      <div className="grid gap-3 2xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard title="Create Weekly Activity" subtitle="Recurring school events can reserve periods, teachers, classes and facilities.">
          <div className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Academic year">
                <select value={activityForm.academic_year_id} onChange={(event) => setActivityForm({ ...activityForm, academic_year_id: event.target.value })} className={selectClassName}>
                  <option value="">Select year</option>
                  {(options?.years || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select value={activityForm.term_id} onChange={(event) => setActivityForm({ ...activityForm, term_id: event.target.value })} className={selectClassName}>
                  <option value="">All terms</option>
                  {(options?.terms || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Name"><Input value={activityForm.name} onChange={(event) => setActivityForm({ ...activityForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="Friday assembly" /></Field>
              <Field label="Type">
                <select value={activityForm.activity_type} onChange={(event) => setActivityForm({ ...activityForm, activity_type: event.target.value })} className={selectClassName}>
                  {activityTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
                </select>
              </Field>
            </div>
            {activityForm.activity_type === 'CUSTOM' ? <Field label="Custom label"><Input value={activityForm.activity_type_label} onChange={(event) => setActivityForm({ ...activityForm, activity_type_label: event.target.value })} className="h-8 text-[12px]" /></Field> : null}
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Day">
                <select value={activityForm.weekday} onChange={(event) => setActivityForm({ ...activityForm, weekday: event.target.value })} className={selectClassName}>
                  {weekdays.map((day) => <option key={day.value} value={day.value}>{day.label}</option>)}
                </select>
              </Field>
              <Field label="Start period">
                <select value={activityForm.start_slot_id} onChange={(event) => setActivityForm({ ...activityForm, start_slot_id: event.target.value, end_slot_id: activityForm.end_slot_id || event.target.value })} className={selectClassName}>
                  <option value="">Use time</option>
                  {teachingSlots.map((slot: any) => <option key={slot.id} value={slot.id}>{slot.display_name} ({timeText(slot.start_time)})</option>)}
                </select>
              </Field>
              <Field label="End period">
                <select value={activityForm.end_slot_id} onChange={(event) => setActivityForm({ ...activityForm, end_slot_id: event.target.value })} className={selectClassName}>
                  <option value="">Use time</option>
                  {teachingSlots.map((slot: any) => <option key={slot.id} value={slot.id}>{slot.display_name} ({timeText(slot.end_time)})</option>)}
                </select>
              </Field>
            </div>
            {!teachingSlots.length ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Start time"><Input type="time" value={activityForm.start_time} onChange={(event) => setActivityForm({ ...activityForm, start_time: event.target.value })} className="h-8 text-[12px]" /></Field>
                <Field label="End time"><Input type="time" value={activityForm.end_time} onChange={(event) => setActivityForm({ ...activityForm, end_time: event.target.value })} className="h-8 text-[12px]" /></Field>
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Scope">
                <select value={activityForm.scope_type} onChange={(event) => setActivityForm({ ...activityForm, scope_type: event.target.value })} className={selectClassName}>
                  <option value="WHOLE_SCHOOL">Whole school</option>
                  <option value="SELECTED_CLASSES">Selected class</option>
                  <option value="STAFF_ONLY">Staff only</option>
                </select>
              </Field>
              <Field label="Facility">
                <select value={activityForm.facility_id} onChange={(event) => setActivityForm({ ...activityForm, facility_id: event.target.value })} className={selectClassName}>
                  <option value="">No facility</option>
                  {facilities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            </div>
            {activityForm.scope_type === 'SELECTED_CLASSES' ? (
              <Field label="Class">
                <select value={activityForm.class_id} onChange={(event) => setActivityForm({ ...activityForm, class_id: event.target.value })} className={selectClassName}>
                  <option value="">Select class</option>
                  {(options?.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Responsible teacher">
                <select value={activityForm.responsible_teacher_id} onChange={(event) => setActivityForm({ ...activityForm, responsible_teacher_id: event.target.value })} className={selectClassName}>
                  <option value="">Unassigned</option>
                  {(options?.teachers || []).map((row: any) => <option key={row.id} value={row.id}>{row.full_name}</option>)}
                </select>
              </Field>
              <Field label="Exam policy">
                <select value={activityForm.exam_policy} onChange={(event) => setActivityForm({ ...activityForm, exam_policy: event.target.value })} className={selectClassName}>
                  {examPolicies.map((policy) => <option key={policy} value={policy}>{pretty(policy)}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-2">
              {[
                ['Blocks lessons', 'blocks_normal_lessons'],
                ['Exam override allowed', 'allows_exam_override'],
                ['Student timetable', 'appears_on_student_timetables'],
                ['Teacher timetable', 'appears_on_teacher_timetables'],
                ['Attendance required', 'attendance_required'],
              ].map(([label, key]) => (
                <div key={key} className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                  <span className="text-[12px] font-semibold text-[#374151]">{label}</span>
                  <Switch checked={Boolean(activityForm[key])} onCheckedChange={(value) => setActivityForm({ ...activityForm, [key]: value })} />
                </div>
              ))}
            </div>
            <Button type="button" disabled={!canManage || saving !== '' || !activityForm.academic_year_id || !activityForm.name || (!activityForm.start_slot_id && !activityForm.start_time)} onClick={createActivity} className="h-8 justify-self-start rounded-[5px] text-[12px]">
              <Save className="size-3.5" />
              Save activity
            </Button>
          </div>
        </SectionCard>
        <SectionCard title="Weekly Activities" subtitle="Active activities are available to apply into manual timetable versions.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Name', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'typeText', label: 'Type' },
              { key: 'dayText', label: 'Day' },
              { key: 'timeText', label: 'Time' },
              { key: 'facility_name', label: 'Facility', render: (row) => row.facility_name || '-' },
              { key: 'ownerText', label: 'Owner' },
              { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); duplicateActivity(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Duplicate weekly activity"><Plus className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveActivity(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive weekly activity"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={activityRows}
            emptyMessage="No weekly activities have been configured."
          />
        </SectionCard>
      </div>
    </div>
  )

  const renderRules = () => (
    <div className="grid gap-3">
      <SectionKpiStrip items={kpis} />
      <div className="grid gap-3 2xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard title={editingRequirementId ? 'Edit Curriculum Requirement' : 'Add Curriculum Requirement'} subtitle="Define the class-subject periods the solver must place before automatic generation can run.">
          <div className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Academic year">
                <select value={curriculumForm.academic_year_id} onChange={(event) => setCurriculumForm({ ...curriculumForm, academic_year_id: event.target.value })} className={selectClassName}>
                  <option value="">Select year</option>
                  {(options?.years || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Term">
                <select value={curriculumForm.term_id} onChange={(event) => setCurriculumForm({ ...curriculumForm, term_id: event.target.value })} className={selectClassName}>
                  <option value="">All terms</option>
                  {(options?.terms || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Class">
                <select value={curriculumForm.class_id} onChange={(event) => setCurriculumForm({ ...curriculumForm, class_id: event.target.value })} className={selectClassName}>
                  <option value="">Select class</option>
                  {(options?.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Stream">
                <Input value={curriculumForm.stream_section} onChange={(event) => setCurriculumForm({ ...curriculumForm, stream_section: event.target.value })} className="h-8 text-[12px]" placeholder="Optional" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Subject">
                <select value={curriculumForm.subject_id} onChange={(event) => setCurriculumForm({ ...curriculumForm, subject_id: event.target.value })} className={selectClassName}>
                  <option value="">Select subject</option>
                  {(options?.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Teacher">
                <select value={curriculumForm.teacher_id} onChange={(event) => setCurriculumForm({ ...curriculumForm, teacher_id: event.target.value })} className={selectClassName}>
                  <option value="">Any eligible teacher</option>
                  {(options?.teachers || []).map((row: any) => <option key={row.id} value={row.id}>{row.full_name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Entry type">
              <select value={curriculumForm.entry_type} onChange={(event) => setCurriculumForm({ ...curriculumForm, entry_type: event.target.value })} className={selectClassName}>
                {curriculumEntryTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
              </select>
            </Field>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Periods / cycle"><Input type="number" min="1" value={curriculumForm.periods_per_cycle} onChange={(event) => setCurriculumForm({ ...curriculumForm, periods_per_cycle: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Block length"><Input type="number" min="1" value={curriculumForm.block_length} onChange={(event) => setCurriculumForm({ ...curriculumForm, block_length: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Priority"><Input type="number" min="0" value={curriculumForm.priority} onChange={(event) => setCurriculumForm({ ...curriculumForm, priority: event.target.value })} className="h-8 text-[12px]" /></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Required room">
                <select value={curriculumForm.required_facility_id} onChange={(event) => setCurriculumForm({ ...curriculumForm, required_facility_id: event.target.value })} className={selectClassName}>
                  <option value="">Any suitable room</option>
                  {facilities.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Room type">
                <select value={curriculumForm.required_facility_type} onChange={(event) => setCurriculumForm({ ...curriculumForm, required_facility_type: event.target.value })} className={selectClassName}>
                  <option value="">No type rule</option>
                  {facilityTypes.map((type) => <option key={type} value={type}>{pretty(type)}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Capacity override">
              <Input type="number" min="0" value={curriculumForm.required_capacity} onChange={(event) => setCurriculumForm({ ...curriculumForm, required_capacity: event.target.value })} className="h-8 text-[12px]" placeholder="Uses class size by default" />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                disabled={!canManage || saving !== '' || !curriculumForm.academic_year_id || !curriculumForm.class_id || (!curriculumForm.subject_id && !['STUDY', 'CUSTOM'].includes(curriculumForm.entry_type))}
                onClick={saveCurriculumRequirement}
                className="h-8 rounded-[5px] text-[12px]"
              >
                <Save className="size-3.5" />
                {editingRequirementId ? 'Update requirement' : 'Save requirement'}
              </Button>
              {editingRequirementId ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setEditingRequirementId(null)
                    setCurriculumForm({ ...initialCurriculumForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') })
                  }}
                  className="h-8 rounded-[5px] text-[12px]"
                >
                  Cancel
                </Button>
              ) : null}
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Curriculum Period Requirements" subtitle="These records are the required weekly or cycle load used by solver generation.">
          <PortalTable
            columns={[
              { key: 'scopeText', label: 'Class / Scope', render: (row) => <span className="font-semibold text-[#111827]">{row.scopeText}</span> },
              { key: 'subjectText', label: 'Subject' },
              { key: 'teacherText', label: 'Teacher' },
              { key: 'loadText', label: 'Load' },
              { key: 'facilityText', label: 'Room rule' },
              { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); editRequirement(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit requirement"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveRequirement(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive requirement"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={requirementRows}
            emptyMessage="No curriculum period requirements have been configured. Add them before using solver generation."
          />
        </SectionCard>
      </div>
      <div className="grid gap-3 2xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard title={editingFocusCategoryId ? 'Edit Focus Category' : 'Subject Focus Categories'} subtitle="Categories let each school decide which subjects need stronger attention windows.">
          <div className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><Input value={focusCategoryForm.name} onChange={(event) => setFocusCategoryForm({ ...focusCategoryForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="High Focus" /></Field>
              <Field label="Code"><Input value={focusCategoryForm.code} onChange={(event) => setFocusCategoryForm({ ...focusCategoryForm, code: event.target.value })} className="h-8 text-[12px]" placeholder="HIGH_FOCUS" /></Field>
            </div>
            <Field label="Description"><Input value={focusCategoryForm.description} onChange={(event) => setFocusCategoryForm({ ...focusCategoryForm, description: event.target.value })} className="h-8 text-[12px]" /></Field>
            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <Field label="Priority"><Input type="number" min="0" value={focusCategoryForm.default_priority} onChange={(event) => setFocusCategoryForm({ ...focusCategoryForm, default_priority: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Button type="button" disabled={!canManage || saving !== '' || !focusCategoryForm.name} onClick={saveFocusCategory} className="h-8 rounded-[5px] text-[12px]">
                <Save className="size-3.5" />
                {editingFocusCategoryId ? 'Update category' : 'Save category'}
              </Button>
            </div>
            {editingFocusCategoryId ? (
              <Button type="button" variant="outline" onClick={() => { setEditingFocusCategoryId(null); setFocusCategoryForm(initialFocusCategoryForm()) }} className="h-8 justify-self-start rounded-[5px] text-[12px]">Cancel edit</Button>
            ) : null}
          </div>
        </SectionCard>
        <SectionCard title="Focus Categories" subtitle="Default categories are seeded, but schools can keep, rename or archive them.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Category', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'code', label: 'Code' },
              { key: 'priorityText', label: 'Priority' },
              { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); editFocusCategory(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit focus category"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveFocusCategory(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive focus category"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={focusCategoryRows}
            emptyMessage="No focus categories have been configured."
          />
        </SectionCard>
      </div>
      <div className="grid gap-3 2xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard title={editingFocusAssignmentId ? 'Edit Subject Focus Assignment' : 'Assign Subjects To Focus'} subtitle="This is where a school chooses which subjects belong to high-focus, practical, flexible or custom groups.">
          <div className="grid gap-3 p-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Subject">
                <select value={focusAssignmentForm.subject_id} onChange={(event) => setFocusAssignmentForm({ ...focusAssignmentForm, subject_id: event.target.value })} className={selectClassName}>
                  <option value="">Select subject</option>
                  {(options?.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Category">
                <select value={focusAssignmentForm.focus_category_id} onChange={(event) => setFocusAssignmentForm({ ...focusAssignmentForm, focus_category_id: event.target.value })} className={selectClassName}>
                  <option value="">Select category</option>
                  {focusCategories.filter((row) => Number(row.active) === 1).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Class">
                <select value={focusAssignmentForm.class_id} onChange={(event) => setFocusAssignmentForm({ ...focusAssignmentForm, class_id: event.target.value })} className={selectClassName}>
                  <option value="">All classes</option>
                  {(options?.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Grade"><Input value={focusAssignmentForm.grade_level} onChange={(event) => setFocusAssignmentForm({ ...focusAssignmentForm, grade_level: event.target.value })} className="h-8 text-[12px]" placeholder="Optional" /></Field>
              <Field label="Stream"><Input value={focusAssignmentForm.stream_section} onChange={(event) => setFocusAssignmentForm({ ...focusAssignmentForm, stream_section: event.target.value })} className="h-8 text-[12px]" placeholder="Optional" /></Field>
              <Field label="Term">
                <select value={focusAssignmentForm.term_id} onChange={(event) => setFocusAssignmentForm({ ...focusAssignmentForm, term_id: event.target.value })} className={selectClassName}>
                  <option value="">All terms</option>
                  {(options?.terms || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!canManage || saving !== '' || !focusAssignmentForm.subject_id || !focusAssignmentForm.focus_category_id} onClick={saveFocusAssignment} className="h-8 rounded-[5px] text-[12px]">
                <Save className="size-3.5" />
                {editingFocusAssignmentId ? 'Update assignment' : 'Save assignment'}
              </Button>
              {editingFocusAssignmentId ? (
                <Button type="button" variant="outline" onClick={() => { setEditingFocusAssignmentId(null); setFocusAssignmentForm({ ...initialFocusAssignmentForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') }) }} className="h-8 rounded-[5px] text-[12px]">Cancel</Button>
              ) : null}
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Subject Focus Assignments" subtitle="Assignments can apply to the whole school, a grade, a class or a stream.">
          <PortalTable
            columns={[
              { key: 'subjectText', label: 'Subject', render: (row) => <span className="font-semibold text-[#111827]">{row.subjectText}</span> },
              { key: 'categoryText', label: 'Category' },
              { key: 'scopeText', label: 'Scope' },
              { key: 'statusText', label: 'Status', render: (row) => <Pill value={row.statusText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); editFocusAssignment(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit focus assignment"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveFocusAssignment(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive focus assignment"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={focusAssignmentRows}
            emptyMessage="No subject focus assignments have been configured."
          />
        </SectionCard>
      </div>
      <div className="grid gap-3 2xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard title={editingFocusRuleId ? 'Edit Subject Focus Rule' : 'Subject Focus Timing Rule'} subtitle="Soft by default: the solver prefers these periods, but can move lessons when the timetable needs it.">
          <div className="grid gap-3 p-4">
            <Field label="Rule name"><Input value={focusRuleForm.name} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="High focus before lunch" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Category">
                <select value={focusRuleForm.focus_category_id} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, focus_category_id: event.target.value })} className={selectClassName}>
                  <option value="">No category</option>
                  {focusCategories.filter((row) => Number(row.active) === 1).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Subject">
                <select value={focusRuleForm.subject_id} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, subject_id: event.target.value })} className={selectClassName}>
                  <option value="">All subjects in category</option>
                  {(options?.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Scope">
                <select value={focusRuleForm.scope_type} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, scope_type: event.target.value })} className={selectClassName}>
                  {focusScopeTypes.map((scope) => <option key={scope} value={scope}>{pretty(scope)}</option>)}
                </select>
              </Field>
              <Field label="Class">
                <select value={focusRuleForm.class_id} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, class_id: event.target.value })} className={selectClassName}>
                  <option value="">Any class</option>
                  {(options?.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Grade"><Input value={focusRuleForm.grade_level} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, grade_level: event.target.value })} className="h-8 text-[12px]" /></Field>
            </div>
            <Field label="Stream"><Input value={focusRuleForm.stream_section} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, stream_section: event.target.value })} className="h-8 text-[12px]" /></Field>
            <div className="grid gap-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Preferred tags</div>
              <div className="flex flex-wrap gap-1.5">
                {(availableBellTags.length ? availableBellTags : bellSlotTagOptions.map((code) => ({ code, name: pretty(code) }))).map((tag) => {
                  const code = tag.code || tag.tag_code
                  const active = (focusRuleForm.preferred_slot_tags || []).includes(code)
                  return <button key={code} type="button" onClick={() => setFocusRuleForm({ ...focusRuleForm, preferred_slot_tags: toggleArrayValue(focusRuleForm.preferred_slot_tags || [], code) })} className={`rounded-[4px] border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${active ? 'border-[#111827] bg-[#111827] text-white' : 'border-[#d9dce3] bg-white text-[#475569]'}`}>{tag.name || pretty(code)}</button>
                })}
              </div>
            </div>
            <div className="grid gap-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Avoided tags</div>
              <div className="flex flex-wrap gap-1.5">
                {(availableBellTags.length ? availableBellTags : bellSlotTagOptions.map((code) => ({ code, name: pretty(code) }))).map((tag) => {
                  const code = tag.code || tag.tag_code
                  const active = (focusRuleForm.avoided_slot_tags || []).includes(code)
                  return <button key={code} type="button" onClick={() => setFocusRuleForm({ ...focusRuleForm, avoided_slot_tags: toggleArrayValue(focusRuleForm.avoided_slot_tags || [], code) })} className={`rounded-[4px] border px-2 py-1 text-[10px] font-bold uppercase tracking-[0.04em] ${active ? 'border-[#991b1b] bg-[#991b1b] text-white' : 'border-[#d9dce3] bg-white text-[#475569]'}`}>{tag.name || pretty(code)}</button>
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Severity"><select value={focusRuleForm.severity} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, severity: event.target.value })} className={selectClassName}>{ruleSeverities.map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></Field>
              <Field label="Weight"><Input type="number" min="1" value={focusRuleForm.penalty_weight} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, penalty_weight: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Min preferred"><Input type="number" min="0" value={focusRuleForm.minimum_preferred_per_cycle} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, minimum_preferred_per_cycle: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Max after lunch"><Input type="number" min="0" value={focusRuleForm.max_after_lunch_per_cycle} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, max_after_lunch_per_cycle: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Max last period"><Input type="number" min="0" value={focusRuleForm.max_last_period_per_cycle} onChange={(event) => setFocusRuleForm({ ...focusRuleForm, max_last_period_per_cycle: event.target.value })} className="h-8 text-[12px]" /></Field>
              <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                <span className="text-[12px] font-semibold text-[#374151]">Override</span>
                <Switch checked={Boolean(focusRuleForm.allow_override)} onCheckedChange={(value) => setFocusRuleForm({ ...focusRuleForm, allow_override: value })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!canManage || saving !== '' || !focusRuleForm.name || (!focusRuleForm.focus_category_id && !focusRuleForm.subject_id)} onClick={saveFocusRule} className="h-8 rounded-[5px] text-[12px]">
                <Save className="size-3.5" />
                {editingFocusRuleId ? 'Update rule' : 'Save rule'}
              </Button>
              {editingFocusRuleId ? <Button type="button" variant="outline" onClick={() => { setEditingFocusRuleId(null); setFocusRuleForm({ ...initialFocusRuleForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') }) }} className="h-8 rounded-[5px] text-[12px]">Cancel</Button> : null}
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Subject Focus Rules" subtitle="Soft rules guide the solver; hard rules also block manual placement.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Rule', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'targetText', label: 'Target' },
              { key: 'scopeText', label: 'Scope' },
              { key: 'timingText', label: 'Timing' },
              { key: 'severityText', label: 'Severity', render: (row) => <Pill value={row.severityText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); editFocusRule(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit focus rule"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveFocusRule(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive focus rule"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={focusRuleRows}
            emptyMessage="No subject focus rules have been configured."
          />
        </SectionCard>
      </div>
      <div className="grid gap-3 2xl:grid-cols-[430px_minmax(0,1fr)]">
        <SectionCard title={editingStreamRuleId ? 'Edit Stream Scheduling Rule' : 'Stream Scheduling Rule'} subtitle="Control whether streams may take the same subject at the same time.">
          <div className="grid gap-3 p-4">
            <Field label="Rule name"><Input value={streamRuleForm.name} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, name: event.target.value })} className="h-8 text-[12px]" placeholder="No parallel same subject" /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Policy"><select value={streamRuleForm.policy} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, policy: event.target.value })} className={selectClassName}>{streamPolicies.map((policy) => <option key={policy} value={policy}>{pretty(policy)}</option>)}</select></Field>
              <Field label="Severity"><select value={streamRuleForm.severity} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, severity: event.target.value })} className={selectClassName}>{['HARD', 'SOFT'].map((value) => <option key={value} value={value}>{pretty(value)}</option>)}</select></Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Scope"><select value={streamRuleForm.scope_type} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, scope_type: event.target.value })} className={selectClassName}>{streamRuleScopeTypes.map((scope) => <option key={scope} value={scope}>{pretty(scope)}</option>)}</select></Field>
              <Field label="Subject">
                <select value={streamRuleForm.subject_id} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, subject_id: event.target.value })} className={selectClassName}>
                  <option value="">All subjects</option>
                  {(options?.subjects || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Class">
                <select value={streamRuleForm.class_id} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, class_id: event.target.value })} className={selectClassName}>
                  <option value="">Any class</option>
                  {(options?.classes || []).map((row: any) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              <Field label="Grade"><Input value={streamRuleForm.grade_level} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, grade_level: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Stream"><Input value={streamRuleForm.stream_section} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, stream_section: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Max parallel"><Input type="number" min="1" value={streamRuleForm.max_parallel_count} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, max_parallel_count: event.target.value })} className="h-8 text-[12px]" /></Field>
              <Field label="Weight"><Input type="number" min="1" value={streamRuleForm.penalty_weight} onChange={(event) => setStreamRuleForm({ ...streamRuleForm, penalty_weight: event.target.value })} className="h-8 text-[12px]" /></Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                <span className="text-[12px] font-semibold text-[#374151]">Different teachers</span>
                <Switch checked={Boolean(streamRuleForm.require_different_teachers)} onCheckedChange={(value) => setStreamRuleForm({ ...streamRuleForm, require_different_teachers: value })} />
              </div>
              <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                <span className="text-[12px] font-semibold text-[#374151]">Different rooms</span>
                <Switch checked={Boolean(streamRuleForm.require_different_rooms)} onCheckedChange={(value) => setStreamRuleForm({ ...streamRuleForm, require_different_rooms: value })} />
              </div>
              <div className="flex items-center justify-between rounded-[5px] border border-[#e5e7eb] px-3 py-2">
                <span className="text-[12px] font-semibold text-[#374151]">Override</span>
                <Switch checked={Boolean(streamRuleForm.allow_override)} onCheckedChange={(value) => setStreamRuleForm({ ...streamRuleForm, allow_override: value })} />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" disabled={!canManage || saving !== '' || !streamRuleForm.name} onClick={saveStreamRule} className="h-8 rounded-[5px] text-[12px]">
                <Save className="size-3.5" />
                {editingStreamRuleId ? 'Update stream rule' : 'Save stream rule'}
              </Button>
              {editingStreamRuleId ? <Button type="button" variant="outline" onClick={() => { setEditingStreamRuleId(null); setStreamRuleForm({ ...initialStreamRuleForm(), academic_year_id: String(activeYear?.id || ''), term_id: String(activeTerm?.id || '') }) }} className="h-8 rounded-[5px] text-[12px]">Cancel</Button> : null}
            </div>
          </div>
        </SectionCard>
        <SectionCard title="Stream Scheduling Rules" subtitle="Hard rules block generation and manual placement; soft rules add penalties and warnings.">
          <PortalTable
            columns={[
              { key: 'name', label: 'Rule', render: (row) => <span className="font-semibold text-[#111827]">{row.name}</span> },
              { key: 'targetText', label: 'Subject' },
              { key: 'scopeText', label: 'Scope' },
              { key: 'policyText', label: 'Policy' },
              { key: 'severityText', label: 'Severity', render: (row) => <Pill value={row.severityText} /> },
              {
                key: 'actions',
                label: 'Action',
                render: (row) => canManage ? (
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={(event) => { event.stopPropagation(); editStreamRule(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" aria-label="Edit stream rule"><Pencil className="size-3.5" /></button>
                    <button type="button" onClick={(event) => { event.stopPropagation(); archiveStreamRule(row) }} className="grid size-7 place-items-center rounded-[4px] border border-[#fecaca] text-[#b91c1c]" aria-label="Archive stream rule"><Trash2 className="size-3.5" /></button>
                  </div>
                ) : '-',
              },
            ]}
            rows={streamRuleRows}
            emptyMessage="No stream scheduling rules have been configured."
          />
        </SectionCard>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <SectionCard title="Shared Occupancy" subtitle="Lessons, weekly activities and dated exam entries resolve against the same resources.">
          <PortalTable
            columns={[
              { key: 'title', label: 'Title', render: (row) => <span className="font-semibold text-[#111827]">{row.title}</span> },
              { key: 'resourceText', label: 'Resource' },
              { key: 'whenText', label: 'When' },
              { key: 'occupancyType', label: 'Type', render: (row) => pretty(row.occupancyType) },
              { key: 'sourceText', label: 'Source' },
              { key: 'blockingText', label: 'Rule', render: (row) => <Pill value={row.blockingText} /> },
            ]}
            rows={occupancyRows}
            emptyMessage="No shared occupancy has been recorded yet."
          />
        </SectionCard>
        <SectionCard title="Rule Coverage" subtitle="Quick links for timetable and examination scheduling controls.">
          <div className="grid gap-2 p-4">
            {[
              [ClipboardList, 'Manual school timetable', 'Create entries directly against facilities and teachers.', '/timetables'],
              [CalendarClock, 'Exam timetable', 'Generate or enter exam sessions using shared facilities.', '/exam-timetables'],
              [Building2, 'Facility rules', 'Manage capacities, availability and room capabilities.', '/settings/facilities'],
              [FlaskConical, 'Laboratory rules', 'Manage practical support and computer exam readiness.', '/settings/laboratories'],
              [Activity, 'Weekly activities', 'Reserve assembly, chapel, clubs, tests and meetings.', '/settings/weekly-activities'],
            ].map(([IconValue, label, detail, path]) => {
              const RowIcon = IconValue as any
              return (
                <button key={String(label)} type="button" onClick={() => navigate(String(path))} className="grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-2 rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2 text-left hover:bg-[#f8fafc]">
                  <RowIcon className="size-4 text-[#374151]" />
                  <span className="min-w-0">
                    <span className="block text-[12px] font-semibold text-[#111827]">{String(label)}</span>
                    <span className="block truncate text-[11px] text-[#6b7280]">{String(detail)}</span>
                  </span>
                  <Pill value="Open" />
                </button>
              )
            })}
          </div>
        </SectionCard>
      </div>
    </div>
  )

  const renderBody = () => {
    if (section === 'academic-configuration') return renderAcademicConfiguration()
    if (section === 'facilities') return renderFacilities()
    if (section === 'laboratories') return renderLaboratories()
    if (section === 'weekly-activities') return renderWeeklyActivities()
    return renderRules()
  }

  return (
    <main className="grid gap-3 p-4">
      <Toolbar>
        <div className="flex min-w-[240px] flex-1 items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[6px] border border-[#e5e7eb] bg-white text-[#111827]">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-[#111827]">{meta.title}</span>
            <span className="block text-[11px] leading-5 text-[#6b7280]">{meta.subtitle}</span>
          </span>
        </div>
        {saving ? <Pill value={saving} /> : null}
        <Button type="button" variant="outline" disabled={loading} onClick={refresh} className="h-8 rounded-[5px] text-[12px]">
          <RefreshCcw className="size-3.5" />
          Refresh
        </Button>
      </Toolbar>

      {!canManage ? (
        <div className="rounded-[6px] border border-[#fed7aa] bg-[#fff7ed] px-3 py-2 text-[12px] font-semibold text-[#c2410c]">
          Your account can view scheduling settings, but only school owners and headteachers can change them.
        </div>
      ) : null}
      {error ? <div className="rounded-[6px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{error}</div> : null}
      {loading ? <SmartLinkLoadingState label="Loading scheduling settings" detail="Fetching facilities, activities and occupancy rules." /> : renderBody()}
    </main>
  )
}
