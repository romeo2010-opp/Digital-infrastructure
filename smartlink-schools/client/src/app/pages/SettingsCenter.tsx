import { type CSSProperties, type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import {
  Bell,
  CalendarRange,
  CheckCircle2,
  Database,
  Download,
  Edit3,
  FileText,
  Globe2,
  GraduationCap,
  KeyRound,
  Lock,
  Palette,
  PlugZap,
  Plus,
  ReceiptText,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UserCircle2,
  Users,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ModalShell } from '../components/ModalShell'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { Switch } from '../components/ui/switch'
import { Toolbar } from '../components/Toolbar'
import { DEFAULT_SCHOOL_FEATURES, schoolFeatureDefinitions, type SchoolFeatureKey } from '../lib/access'
import { usePortal } from '../lib/portalContext'
import { formatRoleLabel, roleLabelFor } from '../lib/roleLabels'

export type SettingsSection = 'preferences' | 'personalized' | 'notifications' | 'security' | 'profile' | 'users' | 'audit' | 'organization' | 'features' | 'integrations' | 'data'

const sectionMeta: Record<SettingsSection, { title: string; subtitle: string; icon: any }> = {
  preferences: { title: 'Preferences', subtitle: 'Set your school workspace density, theme and landing page.', icon: Palette },
  personalized: { title: 'Personalized', subtitle: 'Customize the dashboard canvas, panels and workspace feel.', icon: Palette },
  notifications: { title: 'Notifications', subtitle: 'Choose which school events should alert staff.', icon: Bell },
  security: { title: 'Security', subtitle: 'Protect school records and account sessions.', icon: Lock },
  profile: { title: 'Profile', subtitle: 'Personal account details for this school workspace.', icon: UserCircle2 },
  users: { title: 'Users & Roles', subtitle: 'School staff access, duties and role scope.', icon: Users },
  audit: { title: 'Audit Logs', subtitle: 'Recent changes to school records and settings.', icon: ShieldCheck },
  organization: { title: 'School Profile', subtitle: 'School identity, classes, subjects and academic setup.', icon: GraduationCap },
  features: { title: 'Feature Assignment', subtitle: 'Enable the timetable modules this school is using.', icon: CalendarRange },
  integrations: { title: 'Integrations', subtitle: 'School communication, payment and reporting connectors.', icon: PlugZap },
  data: { title: 'Data Controls', subtitle: 'Exports, retention and backups for school-only records.', icon: Database },
}

const integrationRows = [
  { id: 'INT-001', name: 'Parent SMS', category: 'Messaging', status: 'Ready', owner: 'Administrator' },
  { id: 'INT-002', name: 'WhatsApp Notices', category: 'Messaging', status: 'Draft', owner: 'Headteacher' },
  { id: 'INT-003', name: 'Fee Payment Import', category: 'Finance', status: 'Ready', owner: 'Bursar' },
  { id: 'INT-004', name: 'Report Card Export', category: 'Academics', status: 'Ready', owner: 'Academic office' },
]

const dataRows = [
  { id: 'DATA-001', dataset: 'Student records', retention: 'Until transfer or graduation', export: 'CSV/PDF', owner: 'School Administrator' },
  { id: 'DATA-002', dataset: 'Fee records', retention: '7 academic years', export: 'CSV/PDF', owner: 'Bursar' },
  { id: 'DATA-003', dataset: 'Attendance registers', retention: '5 academic years', export: 'CSV', owner: 'Headteacher' },
  { id: 'DATA-004', dataset: 'Assessment results', retention: '7 academic years', export: 'PDF/CSV', owner: 'Academic office' },
]

const fallbackReportTemplates = [
  { id: 'smartlink_word', name: 'Word-style crest', description: 'A close Word-export style with a generated school crest and assessment tables.' },
  { id: 'modern_academic', name: 'Modern academic', description: 'A cleaner leadership report with a restrained school heading.' },
  { id: 'compact_formal', name: 'Compact formal', description: 'A simpler formal report intended for dense printing and school files.' },
]

function Pill({ value }: { value: string }) {
  const tone =
    /active|ready|complete|verified/i.test(value)
      ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#15803d]'
      : /draft|limited|pending/i.test(value)
      ? 'border-[#fed7aa] bg-[#fff7ed] text-[#c2410c]'
      : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'
  return <span className={`inline-flex rounded-[4px] border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${tone}`}>{value}</span>
}

function SettingRow({
  label,
  detail,
  children,
}: {
  label: string
  detail: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 border-b border-[var(--mera-panel-border-soft)] px-4 py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="text-[12px] font-semibold text-[var(--mera-panel-text)]">{label}</div>
        <p className="mt-1 text-[11px] leading-5 text-[var(--mera-panel-text-muted)]">{detail}</p>
      </div>
      <div className="min-w-0 sm:min-w-[180px]">{children}</div>
    </div>
  )
}

function selectClassName() {
  return 'h-8 w-full rounded-[5px] border border-[#d9dce3] bg-white px-2 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
}

function money(value: any) {
  return `MWK ${Number(value || 0).toLocaleString()}`
}

function rangeClassName() {
  return 'smartlink-personalized-range'
}

function rangeStyle(value: any, min: number, max: number): CSSProperties {
  const number = Number(value)
  const safeValue = Number.isFinite(number) ? number : min
  const percent = max > min ? ((Math.max(min, Math.min(max, safeValue)) - min) / (max - min)) * 100 : 0
  return { '--range-progress': `${percent}%` } as CSSProperties
}

const personalizedImageMaxInputBytes = 8 * 1024 * 1024
const personalizedImageTargetBytes = 620 * 1024
const personalizedImageMaxEdge = 1600

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Unable to prepare the selected image.'))
    }, type, quality)
  })
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read the selected image.'))
    reader.readAsDataURL(blob)
  })
}

function loadImageElement(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Unable to load the selected image.'))
    }
    image.src = url
  })
}

async function readPersonalizedImage(file: File) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Use a PNG, JPEG, or WebP image.')
  }
  if (file.size > personalizedImageMaxInputBytes) {
    throw new Error('Use an image smaller than 8MB so it can be optimized for your SmartLink profile.')
  }

  const image = await loadImageElement(file)
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) throw new Error('Unable to read the selected image dimensions.')

  let scale = Math.min(1, personalizedImageMaxEdge / Math.max(sourceWidth, sourceHeight))
  let outputType = 'image/webp'
  let outputBlob: Blob | null = null

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Unable to optimize the selected image.')
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(image, 0, 0, width, height)

    try {
      outputBlob = await canvasToBlob(canvas, outputType, Math.max(0.58, 0.78 - attempt * 0.05))
    } catch {
      outputType = 'image/jpeg'
      outputBlob = await canvasToBlob(canvas, outputType, Math.max(0.62, 0.78 - attempt * 0.05))
    }

    if (outputBlob.size <= personalizedImageTargetBytes) break
    scale *= 0.82
  }

  if (!outputBlob || outputBlob.size > personalizedImageTargetBytes) {
    throw new Error('Use a simpler image or crop it smaller before uploading.')
  }

  return blobToDataUrl(outputBlob)
}

function readLegacyPersonalizedImage(file: File) {
  return new Promise<string>((resolve, reject) => {
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      reject(new Error('Use a PNG, JPEG, or WebP image.'))
      return
    }
    if (file.size > 2.5 * 1024 * 1024) {
      reject(new Error('Use an image smaller than 2.5MB so it can be saved to your SmartLink profile.'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('Unable to read the selected image.'))
    reader.readAsDataURL(file)
  })
}

export function SettingsCenter({ section }: { section: SettingsSection }) {
  const { user, token, api, preferences, updatePreferences, previewPreferences, refreshSession } = usePortal()
  const meta = sectionMeta[section] || sectionMeta.preferences
  const Icon = meta.icon
  const [savedMessage, setSavedMessage] = useState('')
  const [settingsModal, setSettingsModal] = useState<'invite' | 'password' | 'export' | null>(null)
  const [setupEditModal, setSetupEditModal] = useState<'subject' | 'progression' | null>(null)
  const [inviteForm, setInviteForm] = useState({ full_name: '', email: '', phone: '', role: 'teacher', student_ref: '', guardian_number: '1' })
  const [inviteResult, setInviteResult] = useState<any>(null)
  const [inviteError, setInviteError] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [dbUsers, setDbUsers] = useState<any[]>([])
  const [permissionEditor, setPermissionEditor] = useState<any>(null)
  const [permissionLoading, setPermissionLoading] = useState(false)
  const [permissionError, setPermissionError] = useState('')
  const [dbClasses, setDbClasses] = useState<any[]>([])
  const [dbSubjects, setDbSubjects] = useState<any[]>([])
  const [dbProgressionRules, setDbProgressionRules] = useState<any[]>([])
  const [subjectForm, setSubjectForm] = useState({ name: '', code: '' })
  const [editingSubjectId, setEditingSubjectId] = useState<any>(null)
  const [subjectError, setSubjectError] = useState('')
  const [subjectLoading, setSubjectLoading] = useState(false)
  const [classForm, setClassForm] = useState({ name: '', grade_level: '', teacher_user_id: '', to_class_id: '', is_terminal_class: false })
  const [progressionRuleForm, setProgressionRuleForm] = useState({ from_class_id: '', to_class_id: '', is_terminal_class: false })
  const [progressionPolicy, setProgressionPolicy] = useState({ minimum_average: '50', enforce_threshold: true })
  const [classError, setClassError] = useState('')
  const [policyError, setPolicyError] = useState('')
  const [classLoading, setClassLoading] = useState(false)
  const [policyLoading, setPolicyLoading] = useState(false)
  const [schoolFeatures, setSchoolFeatures] = useState<Record<SchoolFeatureKey, boolean>>({ ...DEFAULT_SCHOOL_FEATURES })
  const [featureLoading, setFeatureLoading] = useState(false)
  const [featureError, setFeatureError] = useState('')
  const [reportTemplate, setReportTemplate] = useState('smartlink_word')
  const [reportTemplates, setReportTemplates] = useState<any[]>(fallbackReportTemplates)
  const [reportTemplateLoading, setReportTemplateLoading] = useState(false)
  const [reportTemplateError, setReportTemplateError] = useState('')
  const [settings, setSettings] = useState({
    appearance: 'light',
    density: 'comfortable',
    landingPage: 'dashboard',
    compactTables: false,
    attendanceAlerts: true,
    feeReminders: true,
    homeworkReminders: true,
    reportDigest: true,
    browserNotifications: false,
    sessionTimeout: '30',
    requireStepUp: true,
    trustedDevice: false,
    dashboardBackgroundEnabled: false,
    dashboardBackgroundImage: '',
    dashboardBackgroundName: '',
    dashboardBackgroundMode: 'cover',
    dashboardBackgroundX: 50,
    dashboardBackgroundY: 50,
    dashboardBackgroundScale: 100,
    dashboardBackgroundDim: 74,
    transparentSectionsEnabled: true,
    sectionTransparency: 18,
    sectionBlur: 10,
    accentTone: 'smartlink',
    pageRhythm: 'balanced',
    numberEmphasis: 'standard',
    dashboardFocus: 'standard',
    motionStyle: 'calm',
  })

  useEffect(() => {
    if (!preferences) return
    setSettings((current) => ({
      ...current,
      appearance: ['dark', 'black-white'].includes(String(preferences.appearance)) ? 'dark' : 'light',
      density: preferences.density || 'comfortable',
      landingPage: preferences.landingPage || 'dashboard',
      compactTables: Boolean(preferences.compactTables),
      attendanceAlerts: preferences.attendanceAlerts ?? true,
      feeReminders: preferences.feeReminders ?? true,
      homeworkReminders: preferences.homeworkReminders ?? true,
      reportDigest: preferences.reportDigest ?? preferences.dailyDigest ?? true,
      browserNotifications: Boolean(preferences.browserNotifications),
      sessionTimeout: String(preferences.sessionTimeout || '30'),
      requireStepUp: preferences.requireStepUp ?? true,
      trustedDevice: Boolean(preferences.trustedDevice),
      dashboardBackgroundEnabled: Boolean(preferences.dashboardBackgroundEnabled),
      dashboardBackgroundImage: preferences.dashboardBackgroundImage || '',
      dashboardBackgroundName: preferences.dashboardBackgroundName || '',
      dashboardBackgroundMode: preferences.dashboardBackgroundMode || 'cover',
      dashboardBackgroundX: Number(preferences.dashboardBackgroundX ?? 50),
      dashboardBackgroundY: Number(preferences.dashboardBackgroundY ?? 50),
      dashboardBackgroundScale: Number(preferences.dashboardBackgroundScale ?? 100),
      dashboardBackgroundDim: Number(preferences.dashboardBackgroundDim ?? 74),
      transparentSectionsEnabled: Boolean(preferences.transparentSectionsEnabled),
      sectionTransparency: Number(preferences.sectionTransparency ?? 0),
      sectionBlur: Number(preferences.sectionBlur ?? 10),
      accentTone: preferences.accentTone || 'smartlink',
      pageRhythm: preferences.pageRhythm || 'balanced',
      numberEmphasis: preferences.numberEmphasis || 'standard',
      dashboardFocus: preferences.dashboardFocus || 'standard',
      motionStyle: preferences.motionStyle || 'calm',
    }))
  }, [preferences])

  useEffect(() => {
    if (!savedMessage) return
    const timeout = window.setTimeout(() => setSavedMessage(''), 2400)
    return () => window.clearTimeout(timeout)
  }, [savedMessage])

  const refreshSchoolSetup = async () => {
    if (!token) return
    const [userPayload, classPayload, subjectPayload, progressionPayload] = await Promise.all([
      api.listUsers?.(token).catch(() => ({ users: [] })),
      api.listClasses?.(token).catch(() => ({ classes: [] })),
      api.listSubjects?.(token).catch(() => ({ subjects: [] })),
      api.listClassProgressionRules?.(token).catch(() => ({ rules: [], policy: null })),
    ])
    setDbUsers(userPayload?.users || [])
    setDbClasses(classPayload?.classes || [])
    setDbSubjects(subjectPayload?.subjects || [])
    setDbProgressionRules(progressionPayload?.rules || [])
    if (progressionPayload?.policy) {
      setProgressionPolicy({
        minimum_average: String(progressionPayload.policy.minimum_average ?? '50'),
        enforce_threshold: progressionPayload.policy.enforce_threshold !== false,
      })
    }
  }

  useEffect(() => {
    if (!token) return
    let cancelled = false
    refreshSchoolSetup().catch(() => {
      if (!cancelled) setDbSubjects([])
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, token])

  const userRows = useMemo(() => {
    return dbUsers.map((row) => ({
      id: row.public_ref,
      public_ref: row.public_ref,
      name: row.full_name || row.name || '-',
      email: row.email || '-',
      role: formatRoleLabel(row.role, '-'),
      scope: row.role === 'teacher' ? 'Assigned classes' : row.role === 'bursar' ? 'Fees' : row.role === 'headteacher' ? 'Academics' : 'Whole school',
      status: row.is_active ? 'Active' : 'Disabled',
      permissions: row.permissions || [],
    }))
  }, [dbUsers])

  const roleRowsLive = useMemo(() => {
    const roleCounts = userRows.reduce((counts: Record<string, number>, row) => {
      counts[row.role] = (counts[row.role] || 0) + 1
      return counts
    }, {})
    const roles = Object.keys(roleCounts).sort()
    return roles.map((role) => ({
      id: role,
      role,
      users: String(roleCounts[role]),
      access: role === 'teacher' ? 'Assigned classes' : role === 'bursar' ? 'Fees and receipts' : 'School workspace',
    }))
  }, [userRows])

  const classRowsLive = useMemo(() => {
    const ruleByClass = new Map(dbProgressionRules.map((row) => [Number(row.from_class_id), row]))
    return dbClasses.map((row) => ({
      id: row.id,
      className: row.name,
      teacher: row.teacher_name || 'Unassigned',
      students: Number(row.student_count || 0).toLocaleString(),
      subjects: dbSubjects.length.toLocaleString(),
      progression: ruleByClass.get(Number(row.id))?.is_terminal_class
        ? 'Terminal'
        : ruleByClass.get(Number(row.id))?.to_class_name || 'Not set',
    }))
  }, [dbClasses, dbProgressionRules, dbSubjects.length])

  const subjectRowsLive = useMemo(() => {
    return dbSubjects.map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code || '-',
    }))
  }, [dbSubjects])

  const progressionRuleRows = useMemo(() => {
    return dbProgressionRules.map((row) => ({
      ...row,
      nextClass: row.is_terminal_class ? 'Terminal / Graduate' : row.to_class_name || 'Not set',
      status: row.is_active ? 'Active' : 'Inactive',
    }))
  }, [dbProgressionRules])

  const teacherOptions = useMemo(() => {
    return dbUsers.filter((row) => String(row.role || '').toLowerCase() === 'teacher' && row.is_active !== false)
  }, [dbUsers])

  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLowerCase()
    if (!query) return userRows
    return userRows.filter((row) => [row.name, row.email, row.role, row.scope, row.status].some((value) => value.toLowerCase().includes(query)))
  }, [userRows, userSearch])

  const canManageSchoolSetup = ['school_owner', 'headteacher'].includes(String(user?.role || '').toLowerCase())
  const canEditPermissions = ['school_owner', 'director', 'owner'].includes(String(user?.role || '').toLowerCase())
  const canInviteUsers = ['school_owner', 'director', 'owner', 'super_admin'].includes(String(user?.role || '').toLowerCase())

  const openPermissionEditor = async (row: any) => {
    if (!token || !canEditPermissions || !row?.public_ref) return
    setPermissionLoading(true)
    setPermissionError('')
    try {
      setPermissionEditor(await api.getUserPermissions(token, row.public_ref))
    } catch (err: any) {
      setPermissionError(err?.message || 'Unable to load user permissions.')
    } finally {
      setPermissionLoading(false)
    }
  }

  const togglePermission = (code: string, allowed: boolean) => {
    setPermissionEditor((current: any) => ({
      ...current,
      permissions: (current?.permissions || []).map((item: any) => item.code === code ? { ...item, allowed } : item),
    }))
  }

  const saveUserPermissions = async () => {
    if (!token || !permissionEditor?.user?.public_ref) return
    setPermissionLoading(true)
    setPermissionError('')
    try {
      const payload = await api.updateUserPermissions(token, permissionEditor.user.public_ref, permissionEditor.permissions.map((item: any) => ({ code: item.code, allowed: item.allowed })))
      setPermissionEditor(payload)
      await refreshSchoolSetup()
      setSavedMessage('Permissions saved')
    } catch (err: any) {
      setPermissionError(err?.message || 'Unable to save user permissions.')
    } finally {
      setPermissionLoading(false)
    }
  }

  useEffect(() => {
    if (!token || section !== 'features') return
    let cancelled = false
    setFeatureLoading(true)
    setFeatureError('')
    api.getSchoolFeatures(token)
      .then((payload: any) => {
        if (!cancelled) setSchoolFeatures({ ...DEFAULT_SCHOOL_FEATURES, ...(payload?.features || {}) })
      })
      .catch((err: any) => {
        if (!cancelled) setFeatureError(err?.message || 'Unable to load school features.')
      })
      .finally(() => {
        if (!cancelled) setFeatureLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, section, token])

  useEffect(() => {
    if (!token || section !== 'organization') return
    let cancelled = false
    setReportTemplateLoading(true)
    setReportTemplateError('')
    api.getReportSettings(token)
      .then((payload: any) => {
        if (cancelled) return
        setReportTemplate(payload?.selected_template || 'smartlink_word')
        setReportTemplates(Array.isArray(payload?.templates) && payload.templates.length ? payload.templates : fallbackReportTemplates)
      })
      .catch((err: any) => {
        if (!cancelled) setReportTemplateError(err?.message || 'Unable to load report PDF designs.')
      })
      .finally(() => {
        if (!cancelled) setReportTemplateLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [api, section, token])

  const updateSetting = (key: keyof typeof settings, value: any) => {
    setSettings((current) => {
      const patch: any = { [key]: value }
      if (key === 'transparentSectionsEnabled' && value && Number(current.sectionTransparency || 0) <= 0) {
        patch.sectionTransparency = 18
      }
      const next = { ...current, ...patch }
      if (section === 'personalized') previewPreferences?.(patch)
      return next
    })
  }

  const handlePersonalizedImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const dataUrl = await readPersonalizedImage(file)
      setSettings((current) => ({
        ...current,
        dashboardBackgroundEnabled: true,
        dashboardBackgroundImage: dataUrl,
        dashboardBackgroundName: file.name,
      }))
      previewPreferences?.({
        dashboardBackgroundEnabled: true,
        dashboardBackgroundImage: dataUrl,
        dashboardBackgroundName: file.name,
      })
      setSavedMessage('Image ready')
    } catch (err: any) {
      setSavedMessage(err?.message || 'Unable to use image')
      event.target.value = ''
    }
  }

  const clearPersonalizedImage = () => {
    setSettings((current) => ({
      ...current,
      dashboardBackgroundEnabled: false,
      dashboardBackgroundImage: '',
      dashboardBackgroundName: '',
    }))
    previewPreferences?.({
      dashboardBackgroundEnabled: false,
      dashboardBackgroundImage: '',
      dashboardBackgroundName: '',
    })
  }

  const resetPersonalizedLook = () => {
    const patch = {
      dashboardBackgroundEnabled: false,
      dashboardBackgroundImage: '',
      dashboardBackgroundName: '',
      dashboardBackgroundMode: 'cover',
      dashboardBackgroundX: 50,
      dashboardBackgroundY: 50,
      dashboardBackgroundScale: 100,
      dashboardBackgroundDim: 74,
      transparentSectionsEnabled: false,
      sectionTransparency: 0,
      sectionBlur: 10,
      accentTone: 'smartlink',
      pageRhythm: 'balanced',
      numberEmphasis: 'standard',
      dashboardFocus: 'standard',
      motionStyle: 'calm',
    }
    setSettings((current) => ({ ...current, ...patch }))
    previewPreferences?.(patch)
  }

  const savePreferences = async () => {
    try {
      await updatePreferences?.(settings)
      setSavedMessage('Saved')
    } catch {
      setSavedMessage('Save failed')
    }
  }

  const completeSettingsModal = async () => {
    if (settingsModal === 'invite') {
      if (inviteResult) {
        setSettingsModal(null)
        setInviteResult(null)
        setInviteForm({ full_name: '', email: '', phone: '', role: 'teacher', student_ref: '', guardian_number: '1' })
        return
      }
      if (!token || !inviteForm.full_name.trim() || !inviteForm.email.trim()) {
        setInviteError('Full name and email address are required.')
        return
      }
      setInviteLoading(true)
      setInviteError('')
      try {
        const payload = await api.createSchoolUser(token, inviteForm)
        setInviteResult(payload)
        await refreshSchoolSetup()
        setSavedMessage(`${payload.user?.full_name || 'School user'} added`)
      } catch (err: any) {
        setInviteError(err?.message || 'Unable to create the school user.')
      } finally {
        setInviteLoading(false)
      }
      return
    }
    setSavedMessage('Saved')
    setSettingsModal(null)
  }

  const resetSubjectForm = () => {
    setSubjectForm({ name: '', code: '' })
    setEditingSubjectId(null)
    setSubjectError('')
  }

  const editSubject = (row: any) => {
    setEditingSubjectId(row.id)
    setSubjectForm({ name: row.name || '', code: row.code === '-' ? '' : row.code || '' })
    setSubjectError('')
    setSetupEditModal('subject')
  }

  const saveSubject = async () => {
    if (!token || !canManageSchoolSetup) return
    setSubjectError('')
    setSubjectLoading(true)
    try {
      const wasEditing = Boolean(editingSubjectId)
      if (editingSubjectId) await api.updateSubject(token, editingSubjectId, subjectForm)
      else await api.createSubject(token, subjectForm)
      resetSubjectForm()
      setSetupEditModal(null)
      await refreshSchoolSetup()
      setSavedMessage(wasEditing ? 'Subject updated' : 'Subject added')
    } catch (err: any) {
      setSubjectError(err?.message || 'Unable to save subject.')
    } finally {
      setSubjectLoading(false)
    }
  }

  const removeSubject = async (row: any) => {
    if (!token || !canManageSchoolSetup) return
    const confirmed = window.confirm(`Remove ${row.name}?`)
    if (!confirmed) return
    setSubjectError('')
    setSubjectLoading(true)
    try {
      await api.deleteSubject(token, row.id)
      if (String(editingSubjectId || '') === String(row.id)) resetSubjectForm()
      await refreshSchoolSetup()
      setSavedMessage('Subject removed')
    } catch (err: any) {
      setSubjectError(err?.message || 'Unable to remove subject.')
    } finally {
      setSubjectLoading(false)
    }
  }

  const resetClassForm = () => {
    setClassForm({ name: '', grade_level: '', teacher_user_id: '', to_class_id: '', is_terminal_class: false })
    setClassError('')
  }

  const createSchoolClass = async () => {
    if (!token || !canManageSchoolSetup) return
    setClassError('')
    setClassLoading(true)
    try {
      const created = await api.createClass(token, {
        name: classForm.name,
        grade_level: classForm.grade_level,
        teacher_user_id: classForm.teacher_user_id || undefined,
      })
      const classId = created?.class?.public_ref || created?.public_ref
      if (classId && (classForm.is_terminal_class || classForm.to_class_id)) {
        await api.saveClassProgressionRule(token, {
          from_class_id: classId,
          to_class_id: classForm.is_terminal_class ? undefined : classForm.to_class_id || undefined,
          is_terminal_class: classForm.is_terminal_class,
          default_decision: classForm.is_terminal_class ? 'graduate' : 'promote',
          is_active: true,
        })
      }
      resetClassForm()
      await refreshSchoolSetup()
      setSavedMessage('Class added')
    } catch (err: any) {
      setClassError(err?.message || 'Unable to create class.')
    } finally {
      setClassLoading(false)
    }
  }

  const editProgressionRule = (row: any) => {
    setProgressionRuleForm({
      from_class_id: String(row.from_class_id || ''),
      to_class_id: row.is_terminal_class ? '' : String(row.to_class_id || ''),
      is_terminal_class: Boolean(row.is_terminal_class),
    })
    setClassError('')
    setSetupEditModal('progression')
  }

  const saveProgressionRule = async () => {
    if (!token || !canManageSchoolSetup) return
    setClassError('')
    if (!progressionRuleForm.from_class_id) {
      setClassError('Select a class before saving the progression rule.')
      return
    }
    if (!progressionRuleForm.is_terminal_class && !progressionRuleForm.to_class_id) {
      setClassError('Select a next class or mark this class as terminal.')
      return
    }
    setClassLoading(true)
    try {
      await api.saveClassProgressionRule(token, {
        from_class_id: progressionRuleForm.from_class_id,
        to_class_id: progressionRuleForm.is_terminal_class ? undefined : progressionRuleForm.to_class_id,
        is_terminal_class: progressionRuleForm.is_terminal_class,
        default_decision: progressionRuleForm.is_terminal_class ? 'graduate' : 'promote',
        is_active: true,
      })
      setProgressionRuleForm({ from_class_id: '', to_class_id: '', is_terminal_class: false })
      setSetupEditModal(null)
      await refreshSchoolSetup()
      setSavedMessage('Progression rule saved')
    } catch (err: any) {
      setClassError(err?.message || 'Unable to save progression rule.')
    } finally {
      setClassLoading(false)
    }
  }

  const saveProgressionPolicy = async () => {
    if (!token || !canManageSchoolSetup) return
    const minimumAverage = Number(progressionPolicy.minimum_average)
    setPolicyError('')
    if (!Number.isFinite(minimumAverage) || minimumAverage < 0 || minimumAverage > 100) {
      setPolicyError('Enter a minimum average between 0 and 100.')
      return
    }
    setPolicyLoading(true)
    try {
      const payload = await api.saveProgressionPolicy(token, {
        minimum_average: minimumAverage,
        enforce_threshold: progressionPolicy.enforce_threshold,
      })
      const nextPolicy = payload?.policy || progressionPolicy
      setProgressionPolicy({
        minimum_average: String(nextPolicy.minimum_average ?? minimumAverage),
        enforce_threshold: nextPolicy.enforce_threshold !== false,
      })
      setSavedMessage('Progression policy saved')
    } catch (err: any) {
      setPolicyError(err?.message || 'Unable to save progression policy.')
    } finally {
      setPolicyLoading(false)
    }
  }

  const updateFeature = (key: SchoolFeatureKey, value: boolean) => {
    setSchoolFeatures((current) => ({ ...current, [key]: value }))
  }

  const saveSchoolFeatures = async () => {
    if (!token || !canManageSchoolSetup) return
    setFeatureLoading(true)
    setFeatureError('')
    try {
      const payload = await api.updateSchoolFeatures(token, { features: schoolFeatures })
      setSchoolFeatures({ ...DEFAULT_SCHOOL_FEATURES, ...(payload?.features || {}) })
      await refreshSession?.(token)
      setSavedMessage('Features saved')
    } catch (err: any) {
      setFeatureError(err?.message || 'Unable to save school features.')
    } finally {
      setFeatureLoading(false)
    }
  }

  const saveReportTemplate = async () => {
    if (!token || !canManageSchoolSetup) return
    setReportTemplateLoading(true)
    setReportTemplateError('')
    try {
      const payload = await api.updateReportSettings(token, { report_pdf_template: reportTemplate })
      setReportTemplate(payload?.selected_template || reportTemplate)
      setReportTemplates(Array.isArray(payload?.templates) && payload.templates.length ? payload.templates : reportTemplates)
      setSavedMessage('Report design saved')
    } catch (err: any) {
      setReportTemplateError(err?.message || 'Unable to save report PDF design.')
    } finally {
      setReportTemplateLoading(false)
    }
  }

  const renderSection = () => {
    if (section === 'preferences') {
      return (
        <SectionCard
          title="Workspace Preferences"
          subtitle="Keep the school portal compact enough for laptop screens."
          actions={<SaveButton savedMessage={savedMessage} onSave={savePreferences} />}
        >
          <SettingRow label="Theme" detail="Use the same restrained SmartLink workspace theme across school screens.">
            <select className={selectClassName()} value={settings.appearance} onChange={(event) => updateSetting('appearance', event.target.value)}>
              <option value="black-white">Black and white</option>
              <option value="light">Light</option>
            </select>
          </SettingRow>
          <SettingRow label="Density" detail="Compact tables and controls help the dashboard fit better on laptops.">
            <select className={selectClassName()} value={settings.density} onChange={(event) => updateSetting('density', event.target.value)}>
              <option value="comfortable">Comfortable</option>
              <option value="compact">Compact</option>
            </select>
          </SettingRow>
          <SettingRow label="Default landing page" detail="Choose which school area opens after sign-in.">
            <select className={selectClassName()} value={settings.landingPage} onChange={(event) => updateSetting('landingPage', event.target.value)}>
              <option value="dashboard">Dashboard</option>
              <option value="students">Students</option>
              <option value="attendance">Attendance</option>
              <option value="fees">Fees</option>
              <option value="results">Results</option>
              <option value="reports">Reports</option>
            </select>
          </SettingRow>
          <SettingRow label="Compact tables" detail="Reduce row height in registers and reports.">
            <Switch checked={settings.compactTables} onCheckedChange={(value) => updateSetting('compactTables', value)} />
          </SettingRow>
        </SectionCard>
      )
    }

    if (section === 'personalized') {
      const previewImageStyle = settings.dashboardBackgroundImage
        ? {
            backgroundImage: `linear-gradient(rgba(0, 0, 0, ${Number(settings.dashboardBackgroundDim || 0) / 100}), rgba(0, 0, 0, ${Number(settings.dashboardBackgroundDim || 0) / 100})), url("${settings.dashboardBackgroundImage}")`,
            backgroundPosition: `${settings.dashboardBackgroundX}% ${settings.dashboardBackgroundY}%`,
            backgroundSize: settings.dashboardBackgroundMode === 'custom' ? `${settings.dashboardBackgroundScale}% auto` : settings.dashboardBackgroundMode,
          }
        : undefined
      const panelAlpha = settings.transparentSectionsEnabled
        ? Math.max(0.55, Math.min(1, 1 - Number(settings.sectionTransparency || 0) / 100))
        : 1

      return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
          <SectionCard
            title="Personalized Workspace"
            subtitle="Tune the dashboard canvas and page surfaces for this user."
            actions={<SaveButton savedMessage={savedMessage} onSave={savePreferences} />}
          >
            <div className="grid gap-4 p-4">
              <div className="grid gap-3 md:grid-cols-2">
                <SettingRow label="Portal theme" detail="Choose the overall workspace mode.">
                  <select className={selectClassName()} value={settings.appearance} onChange={(event) => updateSetting('appearance', event.target.value)}>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </SettingRow>
                <SettingRow label="Dashboard focus" detail="Decide how much visual emphasis the dashboard should use.">
                  <select className={selectClassName()} value={settings.dashboardFocus} onChange={(event) => updateSetting('dashboardFocus', event.target.value)}>
                    <option value="standard">Standard finance view</option>
                    <option value="focused">Focused decision view</option>
                    <option value="executive">Executive overview</option>
                  </select>
                </SettingRow>
              </div>

              <div className="rounded-[8px] border border-[#dce3ed] bg-[#f8fafc] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold text-[#0f172a]">Page background image</div>
                    <p className="mt-1 text-[11px] leading-5 text-[#64748b]">Applies inside portal pages only. The sidebar stays clean and stable.</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="inline-flex h-8 cursor-pointer items-center rounded-[5px] border border-[#d7dde6] bg-white px-3 text-[12px] font-semibold text-[#334155] transition hover:border-[#0f766e]/40 hover:bg-[#f0fdfa]">
                      Upload image
                      <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={handlePersonalizedImage} />
                    </label>
                    {settings.dashboardBackgroundImage ? (
                      <button type="button" onClick={clearPersonalizedImage} className="inline-flex h-8 items-center rounded-[5px] border border-[#fed7aa] bg-white px-3 text-[12px] font-semibold text-[#9a3412]">
                        Remove
                      </button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] font-medium text-[#64748b]">
                  <label className="inline-flex items-center gap-2">
                    <Switch checked={settings.dashboardBackgroundEnabled} onCheckedChange={(value) => updateSetting('dashboardBackgroundEnabled', value)} />
                    Show image background
                  </label>
                  <span>{settings.dashboardBackgroundName || 'No image selected'}</span>
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <SettingRow label="Image fit" detail="Use cover for polished full-page art or custom for precise placement.">
                  <select className={selectClassName()} value={settings.dashboardBackgroundMode} onChange={(event) => updateSetting('dashboardBackgroundMode', event.target.value)}>
                    <option value="cover">Cover page</option>
                    <option value="contain">Contain image</option>
                    <option value="custom">Custom scale</option>
                  </select>
                </SettingRow>
                <SettingRow label="Accent tone" detail="Subtle color cue for selected controls and personalized surfaces.">
                  <select className={selectClassName()} value={settings.accentTone} onChange={(event) => updateSetting('accentTone', event.target.value)}>
                    <option value="smartlink">SmartLink teal</option>
                    <option value="navy">Executive navy</option>
                    <option value="emerald">Emerald ledger</option>
                    <option value="graphite">Graphite neutral</option>
                    <option value="copper">Copper finance</option>
                  </select>
                </SettingRow>
              </div>

              <div className="rounded-[8px] border border-[#dce3ed] bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-[12px] font-semibold text-[#0f172a]">Transparent sections</div>
                    <p className="mt-1 text-[11px] leading-5 text-[#64748b]">Make every page section and card softly transparent over the canvas.</p>
                  </div>
                  <Switch checked={settings.transparentSectionsEnabled} onCheckedChange={(value) => updateSetting('transparentSectionsEnabled', value)} />
                </div>
              </div>

              <div className="grid gap-4 rounded-[8px] border border-[#dce3ed] bg-white p-4 md:grid-cols-2">
                <label className="grid gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Horizontal position: {settings.dashboardBackgroundX}%
                  <input type="range" min="0" max="100" value={settings.dashboardBackgroundX} onChange={(event) => updateSetting('dashboardBackgroundX', Number(event.target.value))} className={rangeClassName()} style={rangeStyle(settings.dashboardBackgroundX, 0, 100)} />
                </label>
                <label className="grid gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Vertical position: {settings.dashboardBackgroundY}%
                  <input type="range" min="0" max="100" value={settings.dashboardBackgroundY} onChange={(event) => updateSetting('dashboardBackgroundY', Number(event.target.value))} className={rangeClassName()} style={rangeStyle(settings.dashboardBackgroundY, 0, 100)} />
                </label>
                <label className="grid gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Custom scale: {settings.dashboardBackgroundScale}%
                  <input type="range" min="60" max="180" value={settings.dashboardBackgroundScale} onChange={(event) => updateSetting('dashboardBackgroundScale', Number(event.target.value))} className={rangeClassName()} style={rangeStyle(settings.dashboardBackgroundScale, 60, 180)} />
                </label>
                <label className="grid gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Background quietness: {settings.dashboardBackgroundDim}%
                  <input type="range" min="35" max="88" value={settings.dashboardBackgroundDim} onChange={(event) => updateSetting('dashboardBackgroundDim', Number(event.target.value))} className={rangeClassName()} style={rangeStyle(settings.dashboardBackgroundDim, 35, 88)} />
                </label>
                <label className="grid gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Section transparency: {settings.sectionTransparency}%
                  <input type="range" min="0" max="35" value={settings.sectionTransparency} onChange={(event) => updateSetting('sectionTransparency', Number(event.target.value))} className={rangeClassName()} style={rangeStyle(settings.sectionTransparency, 0, 35)} />
                </label>
                <label className="grid gap-2 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]">
                  Section glass blur: {settings.sectionBlur}px
                  <input type="range" min="0" max="22" value={settings.sectionBlur} onChange={(event) => updateSetting('sectionBlur', Number(event.target.value))} className={rangeClassName()} style={rangeStyle(settings.sectionBlur, 0, 22)} />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <SettingRow label="Page rhythm" detail="Choose how spacious dashboard sections feel.">
                  <select className={selectClassName()} value={settings.pageRhythm} onChange={(event) => updateSetting('pageRhythm', event.target.value)}>
                    <option value="balanced">Balanced</option>
                    <option value="compact">Efficient</option>
                    <option value="spacious">Spacious</option>
                  </select>
                </SettingRow>
                <SettingRow label="Number emphasis" detail="Make finance numbers calmer or more prominent.">
                  <select className={selectClassName()} value={settings.numberEmphasis} onChange={(event) => updateSetting('numberEmphasis', event.target.value)}>
                    <option value="standard">Standard</option>
                    <option value="strong">Strong</option>
                    <option value="quiet">Quiet</option>
                  </select>
                </SettingRow>
                <SettingRow label="Motion style" detail="Control animation intensity across personalized pages.">
                  <select className={selectClassName()} value={settings.motionStyle} onChange={(event) => updateSetting('motionStyle', event.target.value)}>
                    <option value="calm">Calm</option>
                    <option value="standard">Standard</option>
                    <option value="reduced">Reduced</option>
                  </select>
                </SettingRow>
              </div>

              <div className="flex flex-wrap justify-between gap-2 border-t border-[#eef2f7] pt-3">
                <button type="button" onClick={resetPersonalizedLook} className="inline-flex h-8 items-center rounded-[5px] border border-[#d7dde6] bg-white px-3 text-[12px] font-semibold text-[#475569]">
                  Reset personalized look
                </button>
                <div className="text-[11px] font-medium leading-5 text-[#64748b]">Changes are saved to this user profile and applied to the page canvas.</div>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Live Preview" subtitle="A close preview of the page canvas and section transparency.">
            <div className="p-4">
              <div className="overflow-hidden rounded-[10px] border border-[#dce3ed] bg-[#111827] p-3 shadow-sm">
                <div className="relative min-h-[360px] overflow-hidden rounded-[8px] bg-[#eef2f7]" style={previewImageStyle}>
                  <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-white/0" />
                  <div className="relative grid gap-3 p-4">
                    <div className="flex items-center justify-between gap-3 rounded-[7px] border border-white/30 bg-white/80 px-3 py-2 backdrop-blur">
                      <div>
                        <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#64748b]">Preview</div>
                        <div className="mt-1 text-[14px] font-semibold text-[#0f172a]">Bursar Dashboard</div>
                      </div>
                      <span className="rounded-full bg-[#0f766e] px-2 py-1 text-[10px] font-bold text-white">{settings.accentTone}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {['Expected fees', 'Outstanding'].map((label, index) => (
                        <div key={label} className="rounded-[7px] border border-white/35 p-3 shadow-sm" style={{ backgroundColor: `rgba(255,255,255,${panelAlpha})`, backdropFilter: `blur(${settings.sectionBlur}px)` }}>
                          <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#64748b]">{label}</div>
                          <div className={`mt-2 font-semibold text-[#0f172a] ${settings.numberEmphasis === 'strong' ? 'text-[22px]' : settings.numberEmphasis === 'quiet' ? 'text-[16px]' : 'text-[19px]'}`}>
                            {index ? money(13000000) : money(24500000)}
                          </div>
                          <div className="mt-2 h-1.5 rounded-full bg-[#e2e8f0]">
                            <div className="h-full rounded-full bg-[#0f766e]" style={{ width: index ? '44%' : '68%' }} />
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-[7px] border border-white/35 p-3" style={{ backgroundColor: `rgba(255,255,255,${panelAlpha})`, backdropFilter: `blur(${settings.sectionBlur}px)` }}>
                      <div className="flex items-center justify-between text-[12px] font-semibold text-[#334155]">
                        <span>Attention queue</span>
                        <span className="text-[#0f766e]">Ready</span>
                      </div>
                      <div className="mt-3 grid gap-2">
                        {['Unpaid accounts', 'Overdue learners', 'Receipts ready'].map((item) => (
                          <div key={item} className="flex items-center justify-between border-t border-[#e2e8f0]/80 pt-2 text-[11px] font-medium text-[#64748b]">
                            <span>{item}</span>
                            <span className="font-semibold text-[#0f172a]">View</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>
      )
    }

    if (section === 'notifications') {
      return (
        <SectionCard
          title="School Notifications"
          subtitle="Alerts are scoped to learner, parent, fee and academic workflows."
          actions={<SaveButton savedMessage={savedMessage} onSave={savePreferences} />}
        >
          <SettingRow label="Attendance alerts" detail="Notify class teachers and guardians when a learner is absent or late.">
            <Switch checked={settings.attendanceAlerts} onCheckedChange={(value) => updateSetting('attendanceAlerts', value)} />
          </SettingRow>
          <SettingRow label="Fee reminders" detail="Prepare parent reminders for outstanding balances and new receipts.">
            <Switch checked={settings.feeReminders} onCheckedChange={(value) => updateSetting('feeReminders', value)} />
          </SettingRow>
          <SettingRow label="Homework reminders" detail="Send due-date nudges for assignments that need parent follow-up.">
            <Switch checked={settings.homeworkReminders} onCheckedChange={(value) => updateSetting('homeworkReminders', value)} />
          </SettingRow>
          <SettingRow label="Weekly report digest" detail="Send leadership a summary of attendance, fees, results and messages.">
            <Switch checked={settings.reportDigest} onCheckedChange={(value) => updateSetting('reportDigest', value)} />
          </SettingRow>
          <SettingRow label="Browser notifications" detail="Show desktop alerts on this browser for urgent school events.">
            <Switch checked={settings.browserNotifications} onCheckedChange={(value) => updateSetting('browserNotifications', value)} />
          </SettingRow>
        </SectionCard>
      )
    }

    if (section === 'security') {
      return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <SectionCard
            title="Account Security"
            subtitle="Controls for protecting student, parent, finance and academic records."
            actions={<SaveButton savedMessage={savedMessage} onSave={savePreferences} />}
          >
            <SettingRow label="Session timeout" detail="Automatically lock the school workspace after inactivity.">
              <select className={selectClassName()} value={settings.sessionTimeout} onChange={(event) => updateSetting('sessionTimeout', event.target.value)}>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
                <option value="60">1 hour</option>
              </select>
            </SettingRow>
            <SettingRow label="Step-up verification" detail="Require an email code for sensitive actions like exports and user changes.">
              <Switch checked={settings.requireStepUp} onCheckedChange={(value) => updateSetting('requireStepUp', value)} />
            </SettingRow>
            <SettingRow label="Trust this device" detail="Reduce repeated prompts only on a secure school computer.">
              <Switch checked={settings.trustedDevice} onCheckedChange={(value) => updateSetting('trustedDevice', value)} />
            </SettingRow>
          </SectionCard>

          <SectionCard title="Change Password" subtitle="Use a strong password for school administrator accounts.">
            <div className="grid gap-3 p-4">
              <Input type="password" placeholder="Current password" className="h-8 text-[12px]" />
              <Input type="password" placeholder="New password" className="h-8 text-[12px]" />
              <Input type="password" placeholder="Confirm new password" className="h-8 text-[12px]" />
              <Button type="button" onClick={() => setSettingsModal('password')} className="h-8 rounded-[5px] text-[12px]">
                <KeyRound className="size-3.5" />
                Update password
              </Button>
            </div>
          </SectionCard>
        </div>
      )
    }

    if (section === 'profile') {
      const name = user?.fullName || user?.full_name || user?.name || 'Profile not configured'
      const email = user?.email || 'Email not configured'
      const role = roleLabelFor(user)
      const schoolName = user?.schoolName || user?.school_name || 'School not configured'
      const schoolLocation = [user?.schoolCity || user?.school_city, user?.schoolCountry || user?.school_country].filter(Boolean).join(', ') || 'Location not configured'
      return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
          <SectionCard title="Personal Profile" subtitle="This profile appears on school actions, exports and audit entries.">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                Full name
                <Input value={name} readOnly className="h-8 text-[12px]" />
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                Email
                <Input value={email} readOnly className="h-8 text-[12px]" />
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                Role
                <Input value={role} readOnly className="h-8 text-[12px]" />
              </label>
              <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                School
                <Input value={schoolName} readOnly className="h-8 text-[12px]" />
              </label>
            </div>
          </SectionCard>

          <SectionCard title="Account Scope" subtitle="School-only access summary.">
            <div className="grid gap-2 p-4">
              {[
                ['School', schoolLocation],
                ['Students', 'View learner records in your role scope'],
                ['Attendance', 'Submit and review class registers'],
                ['Results', 'Enter marks and export reports'],
              ].map(([label, detail]) => (
                <div key={label} className="flex items-start gap-2 rounded-[5px] border border-[#e2e8f0] bg-white p-2">
                  <CheckCircle2 className="mt-0.5 size-4 text-[#16a34a]" />
                  <span>
                    <span className="block text-[12px] font-semibold text-[#111827]">{label}</span>
                    <span className="text-[11px] leading-5 text-[#6b7280]">{detail}</span>
                  </span>
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )
    }

    if (section === 'users') {
      return (
        <div className="grid gap-3">
          <Toolbar>
            <div className="relative min-w-[260px] flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#6b7280]" />
              <Input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} className="h-8 pl-9 text-[12px]" placeholder="Search staff, role or scope..." />
            </div>
            {canInviteUsers ? <Button type="button" variant="outline" onClick={() => { setInviteError(''); setInviteResult(null); setSettingsModal('invite') }} className="h-8 rounded-[5px] text-[12px]">
              <Users className="size-3.5" />
              Invite user
            </Button> : null}
          </Toolbar>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <SectionCard title="School Users" subtitle={canEditPermissions ? 'Select a user to adjust individual permission overrides.' : 'People with access to this school workspace.'}>
              <PortalTable
                columns={[
                  { key: 'name', label: 'Name' },
                  { key: 'email', label: 'Email' },
                  { key: 'role', label: 'Role' },
                  { key: 'scope', label: 'Scope' },
                  { key: 'status', label: 'Status', render: (row) => <Pill value={row.status} /> },
                ]}
                rows={filteredUsers}
                onRowClick={canEditPermissions ? openPermissionEditor : undefined}
                emptyMessage="No school users are available for this role."
              />
            </SectionCard>
            <SectionCard title="School Roles" subtitle="Role templates for school operations.">
              <PortalTable
                columns={[
                  { key: 'role', label: 'Role' },
                  { key: 'users', label: 'Users' },
                  { key: 'access', label: 'Access' },
                ]}
                rows={roleRowsLive}
                emptyMessage="No role records are available."
              />
            </SectionCard>
          </div>
        </div>
      )
    }

    if (section === 'audit') {
      return (
        <div className="grid gap-3">
          <SectionKpiStrip
            items={[
              { label: 'Events Today', value: '0', helper: 'audit storage', delta: 'not configured' },
              { label: 'Fee Changes', value: '0', helper: 'receipts and balances', delta: 'not configured' },
              { label: 'Academic Changes', value: '0', helper: 'marks and reports', delta: 'not configured' },
              { label: 'Sensitive Actions', value: '0', helper: 'exports and user access', delta: 'not configured' },
            ]}
          />
          <SectionCard title="School Audit Log" subtitle="Chronological record of important school actions.">
            <PortalTable
              columns={[
                { key: 'time', label: 'Time' },
                { key: 'actor', label: 'Actor' },
                { key: 'action', label: 'Action' },
                { key: 'area', label: 'Area' },
                { key: 'detail', label: 'Detail' },
              ]}
              rows={[]}
              emptyMessage="No audit log table is configured for SmartLink Schools yet."
            />
          </SectionCard>
        </div>
      )
    }

    if (section === 'organization') {
      const schoolName = user?.schoolName || user?.school_name || 'School not configured'
      const schoolLocation = [user?.schoolCity || user?.school_city, user?.schoolCountry || user?.school_country].filter(Boolean).join(', ') || 'Location not configured'
      return (
        <div className="grid gap-3">
          <SectionCard
            title="Report PDF Design"
            subtitle="Choose the results PDF design used when report cards are downloaded."
            actions={<SaveButton savedMessage={savedMessage} onSave={saveReportTemplate} disabled={!canManageSchoolSetup || reportTemplateLoading} />}
          >
            <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {reportTemplates.map((template) => {
                const selected = reportTemplate === template.id
                return (
                  <button
                    key={template.id}
                    type="button"
                    aria-pressed={selected}
                    disabled={!canManageSchoolSetup || reportTemplateLoading}
                    onClick={() => setReportTemplate(template.id)}
                    className={`min-h-[118px] rounded-[6px] border bg-white p-3 text-left transition ${
                      selected
                        ? 'border-[#111827] shadow-[inset_0_0_0_1px_#111827]'
                        : 'border-[#e5e7eb] hover:border-[#9ca3af]'
                    } disabled:cursor-not-allowed disabled:opacity-70`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="grid size-8 place-items-center rounded-[5px] bg-[#f3f4f6] text-[#111827]">
                        <FileText className="size-4" />
                      </span>
                      <span className={`rounded-[4px] px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${selected ? 'bg-[#111827] text-white' : 'bg-[#f3f4f6] text-[#6b7280]'}`}>
                        {selected ? 'Selected' : 'Option'}
                      </span>
                    </span>
                    <span className="mt-3 block text-[12px] font-bold text-[#111827]">{template.name}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-[#6b7280]">{template.description}</span>
                  </button>
                )
              })}
            </div>
            {reportTemplateError ? <div className="mx-4 mb-4 rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{reportTemplateError}</div> : null}
          </SectionCard>

          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
            <SectionCard title="School Details" subtitle="Identity used across receipts, reports and parent communication.">
              <div className="grid gap-3 p-4 sm:grid-cols-2">
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                  School name
                  <Input value={schoolName} readOnly className="h-8 text-[12px]" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                  Location
                  <Input value={schoolLocation} readOnly className="h-8 text-[12px]" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                  Academic term
                  <Input value="Not configured" readOnly className="h-8 text-[12px]" />
                </label>
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                  Report footer
                  <Input value="Generated by SmartLink Schools" readOnly className="h-8 text-[12px]" />
                </label>
              </div>
            </SectionCard>
            <SectionCard title="Progression Policy" subtitle="School-wide pass average for year-end movement.">
              <div className="grid gap-3 p-4">
                <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                  Minimum promotion average
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={progressionPolicy.minimum_average}
                    disabled={!canManageSchoolSetup}
                    onChange={(event) => setProgressionPolicy({ ...progressionPolicy, minimum_average: event.target.value })}
                    className="h-8 text-[12px]"
                  />
                </label>
                <SettingRow label="Enforce threshold" detail="Learners below the minimum are flagged to repeat unless a headteacher records a promotion reason.">
                  <Switch
                    checked={progressionPolicy.enforce_threshold}
                    disabled={!canManageSchoolSetup}
                    onCheckedChange={(value) => setProgressionPolicy({ ...progressionPolicy, enforce_threshold: value })}
                  />
                </SettingRow>
                {policyError ? <div className="rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{policyError}</div> : null}
                <Button type="button" disabled={!canManageSchoolSetup || policyLoading} className="h-8 justify-self-start rounded-[5px] px-3 text-[12px]" onClick={saveProgressionPolicy}>
                  <Save className="size-3.5" />
                  Save policy
                </Button>
              </div>
            </SectionCard>
          </div>

          <SectionCard title="Class Setup & Progression Rules" subtitle="Create classes here, then set their next class or terminal status.">
            <div className="grid gap-4 p-4">
              {canManageSchoolSetup ? (
                <div className="grid gap-3 rounded-[6px] border border-[#e5e7eb] bg-[#f8fafc] p-3">
                  <div className="text-[12px] font-bold text-[#111827]">Create Class</div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_130px_180px]">
                    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                      Class name
                      <Input value={classForm.name} onChange={(event) => setClassForm({ ...classForm, name: event.target.value })} placeholder="Year 6A" className="h-8 text-[12px]" />
                    </label>
                    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                      Grade level
                      <Input value={classForm.grade_level} onChange={(event) => setClassForm({ ...classForm, grade_level: event.target.value })} placeholder="Year 6" className="h-8 text-[12px]" />
                    </label>
                    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                      Class teacher
                      <select className={selectClassName()} value={classForm.teacher_user_id} onChange={(event) => setClassForm({ ...classForm, teacher_user_id: event.target.value })}>
                        <option value="">Unassigned</option>
                        {teacherOptions.map((row) => <option key={row.id} value={row.id}>{row.full_name || row.name || row.email}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_auto] md:items-end">
                    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                      Next class
                      <select className={selectClassName()} value={classForm.to_class_id} disabled={classForm.is_terminal_class} onChange={(event) => setClassForm({ ...classForm, to_class_id: event.target.value })}>
                        <option value="">Set later</option>
                        {dbClasses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                    </label>
                    <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
                      <input
                        type="checkbox"
                        checked={classForm.is_terminal_class}
                        onChange={(event) => setClassForm({ ...classForm, is_terminal_class: event.target.checked, to_class_id: event.target.checked ? '' : classForm.to_class_id })}
                      />
                      Terminal class
                    </label>
                    <div className="flex gap-2">
                      <Button type="button" disabled={classLoading || !classForm.name.trim()} className="h-8 rounded-[5px] px-3 text-[12px]" onClick={createSchoolClass}>
                        <Plus className="size-3.5" />
                        Add class
                      </Button>
                      <Button type="button" variant="outline" className="h-8 rounded-[5px] px-3 text-[12px]" onClick={resetClassForm}>Clear</Button>
                    </div>
                  </div>
                </div>
              ) : null}

              {canManageSchoolSetup && setupEditModal !== 'progression' ? (
                <div className="grid gap-3 rounded-[6px] border border-[#e5e7eb] bg-white p-3">
                  <div className="text-[12px] font-bold text-[#111827]">Set Progression Rule</div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_160px_auto] md:items-end">
                    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                      From class
                      <select className={selectClassName()} value={progressionRuleForm.from_class_id} onChange={(event) => setProgressionRuleForm({ ...progressionRuleForm, from_class_id: event.target.value })}>
                        <option value="">Select class</option>
                        {dbClasses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                    </label>
                    <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                      Next class
                      <select className={selectClassName()} value={progressionRuleForm.to_class_id} disabled={progressionRuleForm.is_terminal_class} onChange={(event) => setProgressionRuleForm({ ...progressionRuleForm, to_class_id: event.target.value })}>
                        <option value="">No next class</option>
                        {dbClasses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                      </select>
                    </label>
                    <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151]">
                      <input
                        type="checkbox"
                        checked={progressionRuleForm.is_terminal_class}
                        onChange={(event) => setProgressionRuleForm({ ...progressionRuleForm, is_terminal_class: event.target.checked, to_class_id: event.target.checked ? '' : progressionRuleForm.to_class_id })}
                      />
                      Terminal class
                    </label>
                    <Button type="button" disabled={classLoading || !progressionRuleForm.from_class_id} className="h-8 rounded-[5px] px-3 text-[12px]" onClick={saveProgressionRule}>
                      <Save className="size-3.5" />
                      Save rule
                    </Button>
                  </div>
                </div>
              ) : null}

              {classError ? <div className="rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{classError}</div> : null}

              <PortalTable
                columns={[
                  { key: 'className', label: 'Class' },
                  { key: 'teacher', label: 'Teacher' },
                  { key: 'students', label: 'Students' },
                  { key: 'progression', label: 'Progression' },
                ]}
                rows={classRowsLive}
                emptyMessage="No classes are available for this role."
              />

              <PortalTable
                columns={[
                  { key: 'from_class_name', label: 'From Class' },
                  { key: 'nextClass', label: 'Next' },
                  { key: 'status', label: 'Status', render: (row) => <Pill value={row.status} /> },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (row) => canManageSchoolSetup ? (
                      <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" onClick={(event) => { event.stopPropagation(); editProgressionRule(row) }} aria-label="Edit progression rule"><Edit3 className="size-3.5" /></button>
                    ) : '-',
                  },
                ]}
                rows={progressionRuleRows}
                emptyMessage="No class progression rules have been configured yet."
              />
            </div>
            </SectionCard>

          <SectionCard title="Subjects" subtitle="Headteachers can set the school subjects used in assessments, homework and teacher assignments.">
            <div className="grid gap-3 p-4">
              {canManageSchoolSetup && setupEditModal !== 'subject' ? (
                <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_160px_auto]">
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                    Subject name
                    <Input value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} placeholder="Mathematics" className="h-8 text-[12px]" />
                  </label>
                  <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">
                    Code
                    <Input value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value })} placeholder="MATH" className="h-8 text-[12px] uppercase" />
                  </label>
                  <div className="flex items-end gap-2">
                    <Button type="button" disabled={subjectLoading || !subjectForm.name.trim()} className="h-8 rounded-[5px] px-3 text-[12px]" onClick={saveSubject}>
                      {editingSubjectId ? <Save className="size-3.5" /> : <Plus className="size-3.5" />}
                      {editingSubjectId ? 'Save' : 'Add'}
                    </Button>
                    {editingSubjectId ? (
                      <Button type="button" variant="outline" className="h-8 rounded-[5px] px-3 text-[12px]" onClick={resetSubjectForm}>Cancel</Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {subjectError ? <div className="rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{subjectError}</div> : null}
              <PortalTable
                columns={[
                  { key: 'name', label: 'Subject' },
                  { key: 'code', label: 'Code' },
                  {
                    key: 'actions',
                    label: 'Actions',
                    render: (row) => canManageSchoolSetup ? (
                      <span className="inline-flex gap-1">
                        <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#e2e8f0] text-[#374151]" onClick={(event) => { event.stopPropagation(); editSubject(row) }} aria-label="Edit subject"><Edit3 className="size-3.5" /></button>
                        <button type="button" className="grid size-7 place-items-center rounded-[4px] border border-[#fee2e2] text-[#dc2626]" onClick={(event) => { event.stopPropagation(); removeSubject(row) }} aria-label="Remove subject"><Trash2 className="size-3.5" /></button>
                      </span>
                    ) : '-',
                  },
                ]}
                rows={subjectRowsLive}
                emptyMessage="No subjects have been added yet."
              />
            </div>
          </SectionCard>
        </div>
      )
    }

    if (section === 'features') {
      return (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <SectionCard
            title="School Feature Assignment"
            subtitle="Switch timetable modules on only when the school is ready to use them."
            actions={<SaveButton savedMessage={savedMessage} onSave={saveSchoolFeatures} disabled={!canManageSchoolSetup || featureLoading} />}
          >
            <div className="divide-y divide-[var(--mera-panel-border-soft)]">
              {schoolFeatureDefinitions.map((feature) => (
                <SettingRow key={feature.key} label={feature.title} detail={feature.detail}>
                  <div className="flex items-center justify-end gap-3">
                    <span className="hidden text-right text-[10px] font-bold uppercase tracking-[0.08em] text-[#9ca3af] sm:block">{feature.audience}</span>
                    <Switch
                      checked={schoolFeatures[feature.key]}
                      disabled={!canManageSchoolSetup || featureLoading}
                      onCheckedChange={(value) => updateFeature(feature.key, value)}
                    />
                  </div>
                </SettingRow>
              ))}
            </div>
            {featureError ? <div className="mx-4 mb-4 rounded-[5px] border border-[#fecaca] bg-[#fef2f2] px-3 py-2 text-[12px] font-semibold text-[#b91c1c]">{featureError}</div> : null}
          </SectionCard>

          <SectionCard title="Assigned Modules" subtitle="Current timetable feature state for this school.">
            <div className="grid gap-2 p-4">
              {schoolFeatureDefinitions.map((feature) => (
                <div key={feature.key} className="flex items-center justify-between gap-3 rounded-[5px] border border-[#e5e7eb] bg-white px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-[12px] font-semibold text-[#111827]">{feature.title}</div>
                    <div className="mt-0.5 truncate text-[11px] text-[#6b7280]">{feature.audience}</div>
                  </div>
                  <Pill value={schoolFeatures[feature.key] ? 'Enabled' : 'Disabled'} />
                </div>
              ))}
            </div>
          </SectionCard>
        </div>
      )
    }

    if (section === 'integrations') {
      return (
        <div className="grid gap-3">
          <SectionCard title="School Integrations" subtitle="Only school communication, finance and reporting connectors are shown.">
            <PortalTable
              columns={[
                { key: 'name', label: 'Integration' },
                { key: 'category', label: 'Category' },
                { key: 'status', label: 'Status', render: (row) => <Pill value={row.status} /> },
                { key: 'owner', label: 'Owner' },
              ]}
              rows={integrationRows}
            />
          </SectionCard>
          <div className="grid gap-3 md:grid-cols-3">
            {[
              [Bell, 'Parent Messaging', 'SMS and WhatsApp-ready templates for attendance, fees and homework.'],
              [ReceiptText, 'Payment Imports', 'Upload or connect payment files for fee receipts.'],
              [Download, 'Report Exports', 'PDF and CSV output for leadership and class teachers.'],
            ].map(([IconValue, title, detail]) => {
              const CardIcon = IconValue as any
              return (
                <article key={String(title)} className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
                  <CardIcon className="size-4 text-[#111827]" />
                  <h3 className="mt-3 text-[12px] font-bold uppercase tracking-[0.08em] text-[#111827]">{title as string}</h3>
                  <p className="mt-1 text-[11px] leading-5 text-[#6b7280]">{detail as string}</p>
                </article>
              )
            })}
          </div>
        </div>
      )
    }

    return (
      <div className="grid gap-3">
        <SectionCard title="School Data Controls" subtitle="Manage data exports, retention and backup expectations.">
          <PortalTable
            columns={[
              { key: 'dataset', label: 'Dataset' },
              { key: 'retention', label: 'Retention' },
              { key: 'export', label: 'Export' },
              { key: 'owner', label: 'Owner' },
            ]}
            rows={dataRows}
          />
        </SectionCard>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ['Student export', 'Create a CSV/PDF pack for selected classes.'],
            ['Fee backup', 'Download current receipt and balance records.'],
            ['Report archive', 'Save term reports and attendance summaries.'],
          ].map(([title, detail]) => (
            <article key={title} className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
              <Database className="size-4 text-[#111827]" />
              <h3 className="mt-3 text-[12px] font-bold uppercase tracking-[0.08em] text-[#111827]">{title}</h3>
              <p className="mt-1 text-[11px] leading-5 text-[#6b7280]">{detail}</p>
              <Button type="button" variant="outline" onClick={() => setSettingsModal('export')} className="mt-3 h-8 rounded-[5px] text-[12px]">
                <Download className="size-3.5" />
                Prepare
              </Button>
            </article>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="grid gap-3 p-4">
      <section className="rounded-[6px] border border-[var(--mera-panel-border)] bg-[var(--mera-panel)] p-4 shadow-[var(--mera-shadow-card)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-3">
            <span className="grid size-8 place-items-center rounded-[6px] bg-[#f3f4f6] text-[#111827]">
              <Icon className="size-4" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[22px] font-semibold tracking-[-0.035em] text-[var(--mera-panel-text)]">{meta.title}</h1>
              <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--mera-panel-text-muted)]">{meta.subtitle}</p>
            </div>
          </div>
        </div>
      </section>
      {renderSection()}
      <ModalShell
        open={setupEditModal === 'subject'}
        onOpenChange={(open) => { if (!open) { setSetupEditModal(null); resetSubjectForm() } }}
        title="Edit subject"
        description="Update the subject name and code used throughout the school workspace."
        footer={<><Button type="button" variant="outline" onClick={() => { setSetupEditModal(null); resetSubjectForm() }}>Cancel</Button><Button type="button" disabled={subjectLoading || !subjectForm.name.trim()} onClick={saveSubject}><Save className="size-3.5" />{subjectLoading ? 'Saving…' : 'Save subject'}</Button></>}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Subject name<Input value={subjectForm.name} onChange={(event) => setSubjectForm({ ...subjectForm, name: event.target.value })} className="h-8 text-[12px]" /></label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Code<Input value={subjectForm.code} onChange={(event) => setSubjectForm({ ...subjectForm, code: event.target.value.toUpperCase() })} className="h-8 text-[12px] uppercase" /></label>
          {subjectError ? <div className="rounded-[5px] border border-red-200 bg-red-50 p-3 text-[12px] text-red-700 md:col-span-2">{subjectError}</div> : null}
        </div>
      </ModalShell>
      <ModalShell
        open={setupEditModal === 'progression'}
        onOpenChange={(open) => { if (!open) { setSetupEditModal(null); setClassError('') } }}
        title="Edit progression rule"
        description="Choose the next class or mark the current class as terminal."
        footer={<><Button type="button" variant="outline" onClick={() => { setSetupEditModal(null); setClassError('') }}>Cancel</Button><Button type="button" disabled={classLoading || !progressionRuleForm.from_class_id} onClick={saveProgressionRule}><Save className="size-3.5" />{classLoading ? 'Saving…' : 'Save rule'}</Button></>}
      >
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">From class<select className={selectClassName()} value={progressionRuleForm.from_class_id} onChange={(event) => setProgressionRuleForm({ ...progressionRuleForm, from_class_id: event.target.value })}><option value="">Select class</option>{dbClasses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#6b7280]">Next class<select className={selectClassName()} value={progressionRuleForm.to_class_id} disabled={progressionRuleForm.is_terminal_class} onChange={(event) => setProgressionRuleForm({ ...progressionRuleForm, to_class_id: event.target.value })}><option value="">No next class</option>{dbClasses.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
          <label className="flex h-8 items-center gap-2 text-[12px] font-semibold text-[#374151] md:col-span-2"><input type="checkbox" checked={progressionRuleForm.is_terminal_class} onChange={(event) => setProgressionRuleForm({ ...progressionRuleForm, is_terminal_class: event.target.checked, to_class_id: event.target.checked ? '' : progressionRuleForm.to_class_id })} />Terminal class</label>
          {classError ? <div className="rounded-[5px] border border-red-200 bg-red-50 p-3 text-[12px] text-red-700 md:col-span-2">{classError}</div> : null}
        </div>
      </ModalShell>
      <ModalShell
        open={Boolean(settingsModal)}
        onOpenChange={(open) => !open && setSettingsModal(null)}
        title={settingsModal === 'invite' ? 'Invite School User' : settingsModal === 'password' ? 'Update Password' : 'Prepare School Export'}
        description={settingsModal === 'invite' ? 'Add a staff, parent or guardian account for this school workspace.' : settingsModal === 'password' ? 'Update the password for the signed-in school account.' : 'Prepare a school-only data export request.'}
        footer={(
          <>
            <Button type="button" variant="outline" className="h-8 rounded-[5px] text-[12px]" onClick={() => setSettingsModal(null)}>Cancel</Button>
            <Button type="button" disabled={inviteLoading} className="h-8 rounded-[5px] text-[12px]" onClick={completeSettingsModal}>{settingsModal === 'export' ? 'Prepare' : settingsModal === 'invite' && inviteResult ? 'Done' : inviteLoading ? 'Creating…' : 'Save'}</Button>
          </>
        )}
      >
        <div className="grid gap-3">
          {settingsModal === 'invite' ? (
            inviteResult ? (
              <div className="grid gap-3 rounded-[7px] border border-emerald-200 bg-emerald-50 p-4 text-[12px] text-emerald-900">
                <div className="font-semibold">{inviteResult.user?.full_name} can now sign in as {formatRoleLabel(inviteResult.user?.role)}.</div>
                <div>Temporary password</div>
                <code className="select-all rounded-[5px] border border-emerald-200 bg-white px-3 py-2 font-mono text-[14px] font-semibold text-[#111827]">{inviteResult.temporary_password}</code>
                <p className="text-[11px] leading-5 text-emerald-800">{inviteResult.temporary_password_notice}</p>
              </div>
            ) : (
              <>
                {inviteError ? <div className="rounded-[6px] border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{inviteError}</div> : null}
                <Input value={inviteForm.full_name} onChange={(event) => setInviteForm({ ...inviteForm, full_name: event.target.value })} placeholder="Full name" className="h-8 text-[12px]" />
                <Input type="email" value={inviteForm.email} onChange={(event) => setInviteForm({ ...inviteForm, email: event.target.value })} placeholder="Email address" className="h-8 text-[12px]" />
                <Input value={inviteForm.phone} onChange={(event) => setInviteForm({ ...inviteForm, phone: event.target.value })} placeholder="Phone number (optional)" className="h-8 text-[12px]" />
                <select className={selectClassName()} value={inviteForm.role} onChange={(event) => setInviteForm({ ...inviteForm, role: event.target.value })}>
                  <option value="teacher">Teacher</option>
                  <option value="bursar">Bursar</option>
                  <option value="librarian">Librarian</option>
                  <option value="headteacher">Headteacher</option>
                  <option value="parent">Parent / guardian</option>
                </select>
                {inviteForm.role === 'parent' ? <div className="grid gap-2 rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-3"><Input value={inviteForm.student_ref} onChange={(event) => setInviteForm({ ...inviteForm, student_ref: event.target.value })} placeholder="Student public reference to link (optional)" className="h-8 text-[12px]" /><select className={selectClassName()} value={inviteForm.guardian_number} onChange={(event) => setInviteForm({ ...inviteForm, guardian_number: event.target.value })}><option value="1">Primary guardian</option><option value="2">Secondary guardian</option></select><p className="text-[10px] leading-4 text-[#64748b]">Only linked guardians can see published parent-safe academic insights. The student reference is a public UUID, never a database ID.</p></div> : null}
              </>
            )
          ) : null}
          {settingsModal === 'password' ? (
            <>
              <Input type="password" placeholder="Current password" className="h-8 text-[12px]" />
              <Input type="password" placeholder="New password" className="h-8 text-[12px]" />
              <Input type="password" placeholder="Confirm new password" className="h-8 text-[12px]" />
            </>
          ) : null}
          {settingsModal === 'export' ? (
            <>
              <select className={selectClassName()} defaultValue="students">
                <option value="students">Student records</option>
                <option value="attendance">Attendance registers</option>
                <option value="fees">Fee records</option>
                <option value="results">Assessment results</option>
              </select>
              <select className={selectClassName()} defaultValue="csv">
                <option value="csv">CSV</option>
                <option value="pdf">PDF</option>
              </select>
            </>
          ) : null}
        </div>
      </ModalShell>
      <ModalShell
        open={Boolean(permissionEditor)}
        onOpenChange={(open) => !open && setPermissionEditor(null)}
        title={permissionEditor?.user?.full_name ? `Permissions · ${permissionEditor.user.full_name}` : 'User permissions'}
        description="Role defaults remain visible. Any change here becomes an explicit user-level allow or deny override."
        className="max-w-3xl"
        footer={<><Button type="button" variant="outline" onClick={() => setPermissionEditor(null)}>Close</Button><Button type="button" disabled={permissionLoading} onClick={saveUserPermissions}><Save className="size-3.5"/>{permissionLoading ? 'Saving…' : 'Save permissions'}</Button></>}
      >
        {permissionError ? <div className="rounded-[6px] border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{permissionError}</div> : null}
        <div className="max-h-[62vh] divide-y overflow-y-auto rounded-[7px] border border-[#e2e8f0]">
          {(permissionEditor?.permissions || []).map((item: any) => (
            <div key={item.code} className="flex items-center justify-between gap-4 p-3">
              <div className="min-w-0"><div className="text-[12px] font-semibold text-[#111827]">{item.label}</div><div className="mt-0.5 text-[11px] leading-4 text-[#64748b]">{item.description}</div><div className="mt-1 font-mono text-[9px] text-[#94a3b8]">{item.code} · role default {item.role_default ? 'allowed' : 'denied'}</div></div>
              <Switch checked={Boolean(item.allowed)} onCheckedChange={(allowed) => togglePermission(item.code, allowed)} />
            </div>
          ))}
        </div>
      </ModalShell>
    </div>
  )
}

function SaveButton({ savedMessage, onSave, disabled = false }: { savedMessage: string; onSave: () => void; disabled?: boolean }) {
  return (
    <Button type="button" onClick={onSave} disabled={disabled} className="h-8 rounded-[5px] px-3 text-[12px]">
      <Save className="size-3.5" />
      {savedMessage || 'Save'}
    </Button>
  )
}
