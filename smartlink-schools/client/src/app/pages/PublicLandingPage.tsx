import { type ChangeEvent, type ReactNode, useEffect, useMemo, useState } from 'react'
import '../../styles/publicLanding.css'

const portalDefaultUrl = 'https://portal.publicurl.com'

const heroImage = 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=2200&q=86'
const aboutImage = 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=900&q=84'

const lifeImages = [
  'https://images.unsplash.com/photo-1588072432836-e10032774350?auto=format&fit=crop&w=620&q=82',
  'https://images.unsplash.com/photo-1523580846011-d3a5bc25702b?auto=format&fit=crop&w=620&q=82',
  'https://images.unsplash.com/photo-1497633762265-9d179a990aa6?auto=format&fit=crop&w=620&q=82',
  'https://images.unsplash.com/photo-1523240795612-9a054b0db644?auto=format&fit=crop&w=620&q=82',
]

const galleryImages = [
  'https://images.unsplash.com/photo-1571260899304-425eee4c7efc?auto=format&fit=crop&w=520&q=80',
  'https://images.unsplash.com/photo-1517486808906-6ca8b3f04846?auto=format&fit=crop&w=520&q=80',
  'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=520&q=80',
  'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=520&q=80',
  'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=520&q=80',
  'https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=520&q=80',
]

const stageOptions = ['Early Years', 'Primary', 'Junior Secondary', 'Senior Secondary', 'Sixth Form']
const moduleOptions = ['Admissions', 'Timetables', 'Fees', 'Attendance', 'Results', 'Parent Messages', 'Library', 'Transport']
const facilityTypes = ['Classroom', 'Science Lab', 'Computer Lab', 'Library', 'Hall', 'Sports Ground', 'Office', 'Custom']
const dayOptions = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type CsvPreview = {
  name: string
  headers: string[]
  rows: string[][]
}

type SubjectDraft = {
  name: string
  code: string
  stage: string
  core: boolean
}

type SetupForm = {
  schoolName: string
  legalName: string
  motto: string
  location: string
  schoolType: string
  managerName: string
  managerEmail: string
  phone: string
  website: string
  logoUrl: string
  curriculum: string
  language: string
  grading: string
  stages: string[]
  subjectName: string
  subjectCode: string
  subjectStage: string
  subjects: SubjectDraft[]
  teachersCsv: CsvPreview | null
  studentsCsv: CsvPreview | null
  teacherMap: Record<string, string>
  studentMap: Record<string, string>
  facilityName: string
  facilityType: string
  facilityCapacity: string
  facilities: Array<{ name: string; type: string; capacity: string }>
  activityName: string
  activityDay: string
  activityTime: string
  weeklyActivities: Array<{ name: string; day: string; time: string }>
  assessmentName: string
  assessmentFrequency: string
  assessments: Array<{ name: string; frequency: string }>
  bellName: string
  bellStart: string
  bellEnd: string
  bellType: string
  bellPeriods: Array<{ name: string; start: string; end: string; type: string }>
  modules: string[]
}

const initialSetupForm: SetupForm = {
  schoolName: 'SmartLink Demonstration School',
  legalName: 'SmartLink Demonstration School Ltd',
  motto: 'Learn with purpose',
  location: 'Blantyre, Malawi',
  schoolType: 'Independent day school',
  managerName: 'School Manager',
  managerEmail: 'manager@school.mw',
  phone: '+265 888 000 000',
  website: 'https://school.mw',
  logoUrl: '',
  curriculum: 'Cambridge Pathway',
  language: 'English',
  grading: 'Percentage and grades',
  stages: ['Primary', 'Junior Secondary'],
  subjectName: 'Mathematics',
  subjectCode: 'MATH',
  subjectStage: 'Primary',
  subjects: [
    { name: 'English', code: 'ENG', stage: 'Primary', core: true },
    { name: 'Mathematics', code: 'MATH', stage: 'Primary', core: true },
    { name: 'Science', code: 'SCI', stage: 'Primary', core: true },
  ],
  teachersCsv: null,
  studentsCsv: null,
  teacherMap: {},
  studentMap: {},
  facilityName: 'Year 1 Classroom',
  facilityType: 'Classroom',
  facilityCapacity: '32',
  facilities: [
    { name: 'Main Hall', type: 'Hall', capacity: '300' },
    { name: 'Computer Lab', type: 'Computer Lab', capacity: '28' },
  ],
  activityName: 'Assembly',
  activityDay: 'Monday',
  activityTime: '07:30',
  weeklyActivities: [{ name: 'Assembly', day: 'Monday', time: '07:30' }],
  assessmentName: 'Weekly Test',
  assessmentFrequency: 'Every Friday',
  assessments: [{ name: 'End of Term Examination', frequency: 'Once per term' }],
  bellName: 'Period 1',
  bellStart: '07:45',
  bellEnd: '08:25',
  bellType: 'Teaching',
  bellPeriods: [
    { name: 'Period 1', start: '07:45', end: '08:25', type: 'Teaching' },
    { name: 'Period 2', start: '08:25', end: '09:05', type: 'Teaching' },
    { name: 'Morning Break', start: '09:05', end: '09:25', type: 'Break' },
  ],
  modules: ['Timetables', 'Fees', 'Attendance', 'Results'],
}

const setupSteps = [
  { key: 'identity', number: '01', label: 'Identity', title: 'Give the school a face', copy: 'Logo, legal name, contacts and the public tone of the school.' },
  { key: 'curriculum', number: '02', label: 'Curriculum', title: 'Define the academic spine', copy: 'Choose curriculum, stages and the subject catalogue that classes will inherit.' },
  { key: 'people', number: '03', label: 'People', title: 'Import staff and learners', copy: 'Upload CSV files, preview their contents and map columns before the portal creates records.' },
  { key: 'campus', number: '04', label: 'Campus', title: 'Add facilities and resources', copy: 'Classrooms, labs, halls and specialist spaces become timetable-aware from the start.' },
  { key: 'rhythm', number: '05', label: 'Rhythm', title: 'Set the weekly rhythm', copy: 'Weekly activities, recurring assessments and the bell day pattern sit together.' },
  { key: 'launch', number: '06', label: 'Launch', title: 'Review the setup passport', copy: 'A final readiness view catches missing data before managers enter the portal.' },
]

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

function csvSplit(line: string) {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    const next = line[index + 1]
    if (char === '"' && quoted && next === '"') {
      current += '"'
      index += 1
      continue
    }
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  cells.push(current.trim())
  return cells
}

function parseCsvPreview(text: string, name: string): CsvPreview {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const headers = csvSplit(lines[0] || '')
  const rows = lines.slice(1, 7).map(csvSplit)
  return { name, headers, rows }
}

function bestColumn(headers: string[], options: string[]) {
  const normalized = headers.map((header) => ({ raw: header, key: header.toLowerCase().replace(/[^a-z0-9]/g, '') }))
  const match = normalized.find((header) => options.some((option) => header.key.includes(option)))
  return match?.raw || ''
}

function InfoHint({ text }: { text: string }) {
  return <button className="sl-info-dot" type="button" title={text} aria-label={text}>i</button>
}

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <label className="sl-setup-field">
      <span>{label}{hint ? <InfoHint text={hint} /> : null}</span>
      {children}
    </label>
  )
}

function CsvUploader({
  title,
  required,
  preview,
  mapping,
  onUpload,
  onMap,
}: {
  title: string
  required: string[]
  preview: CsvPreview | null
  mapping: Record<string, string>
  onUpload: (preview: CsvPreview) => void
  onMap: (field: string, column: string) => void
}) {
  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (!file.name.toLowerCase().endsWith('.csv')) {
      event.target.value = ''
      return
    }
    const reader = new FileReader()
    reader.onload = () => onUpload(parseCsvPreview(String(reader.result || ''), file.name))
    reader.readAsText(file)
  }

  return (
    <div className="sl-csv-box">
      <div className="sl-csv-head">
        <div>
          <h4>{title}</h4>
          <p>CSV only. Required fields: {required.join(', ')}.</p>
        </div>
        <label className="sl-file-btn">
          Upload CSV
          <input type="file" accept=".csv,text/csv" onChange={upload} />
        </label>
      </div>

      {preview ? (
        <>
          <div className="sl-csv-meta">
            <span>{preview.name}</span>
            <span>{preview.headers.length} columns</span>
            <span>{preview.rows.length} preview rows</span>
          </div>
          <div className="sl-csv-map">
            {required.map((field) => (
              <label key={field}>
                <span>{field}</span>
                <select value={mapping[field] || ''} onChange={(event) => onMap(field, event.target.value)}>
                  <option value="">Select column</option>
                  {preview.headers.map((header) => <option key={header} value={header}>{header}</option>)}
                </select>
              </label>
            ))}
          </div>
          <div className="sl-csv-preview">
            <table>
              <thead><tr>{preview.headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
              <tbody>
                {preview.rows.map((row, rowIndex) => (
                  // eslint-disable-next-line react/no-array-index-key
                  <tr key={rowIndex}>{preview.headers.map((header, index) => <td key={header}>{row[index] || '-'}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="sl-csv-empty">
          <strong>No CSV uploaded yet.</strong>
          <span>Use columns like first_name, last_name, dob, gender, class, email, phone and guardian_name.</span>
        </div>
      )}
    </div>
  )
}

function publicPath(target: 'home' | 'setup') {
  if (typeof window === 'undefined') return target === 'setup' ? '/setup' : '/'
  const localPublic = window.location.pathname.startsWith('/public')
  if (target === 'home') return localPublic ? '/public' : '/'
  return localPublic ? '/public/setup' : '/setup'
}

export function PublicLandingPage({ portalUrl = portalDefaultUrl }: { portalUrl?: string }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [route, setRoute] = useState(() => (typeof window !== 'undefined' && window.location.pathname.includes('/setup') ? 'setup' : 'home'))
  const [activeStep, setActiveStep] = useState(0)
  const [submitted, setSubmitted] = useState(false)
  const [form, setForm] = useState<SetupForm>(initialSetupForm)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    const onPop = () => setRoute(window.location.pathname.includes('/setup') ? 'setup' : 'home')
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  useEffect(() => {
    document.title = route === 'setup' ? 'SmartLink Schools - Setup' : 'SmartLink Schools - Public'
  }, [route])

  const readiness = useMemo(() => {
    const checks = [
      Boolean(form.schoolName && form.location && form.managerEmail),
      form.stages.length > 0 && form.subjects.length >= 3,
      Boolean(form.teachersCsv && form.studentsCsv),
      form.facilities.length > 0,
      form.weeklyActivities.length > 0 && form.bellPeriods.length >= 2,
      form.modules.length > 0,
    ]
    return Math.round((checks.filter(Boolean).length / checks.length) * 100)
  }, [form])

  const setupSummary = useMemo(() => ([
    ['School', form.schoolName],
    ['Location', form.location],
    ['Curriculum', form.curriculum],
    ['Stages', form.stages.join(', ') || 'Not selected'],
    ['Subjects', `${form.subjects.length} subjects`],
    ['People files', `${form.teachersCsv ? 'Teachers ready' : 'Teachers missing'}, ${form.studentsCsv ? 'students ready' : 'students missing'}`],
    ['Campus', `${form.facilities.length} facilities`],
    ['Rhythm', `${form.weeklyActivities.length} weekly activities, ${form.bellPeriods.length} bell periods`],
    ['Modules', form.modules.join(', ') || 'Core workspace only'],
  ]), [form])

  const update = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => setForm((current) => ({ ...current, [key]: value }))

  const goRoute = (next: 'home' | 'setup') => {
    const path = publicPath(next)
    window.history.pushState({}, '', path)
    setRoute(next)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const startSetup = () => goRoute('setup')

  const addSubject = () => {
    if (!form.subjectName.trim()) return
    update('subjects', [...form.subjects, { name: form.subjectName.trim(), code: form.subjectCode.trim() || form.subjectName.slice(0, 3).toUpperCase(), stage: form.subjectStage, core: true }])
    setForm((current) => ({ ...current, subjectName: '', subjectCode: '' }))
  }

  const addFacility = () => {
    if (!form.facilityName.trim()) return
    update('facilities', [...form.facilities, { name: form.facilityName.trim(), type: form.facilityType, capacity: form.facilityCapacity }])
    setForm((current) => ({ ...current, facilityName: '', facilityCapacity: '' }))
  }

  const addActivity = () => {
    if (!form.activityName.trim()) return
    update('weeklyActivities', [...form.weeklyActivities, { name: form.activityName.trim(), day: form.activityDay, time: form.activityTime }])
    setForm((current) => ({ ...current, activityName: '', activityTime: '' }))
  }

  const addAssessment = () => {
    if (!form.assessmentName.trim()) return
    update('assessments', [...form.assessments, { name: form.assessmentName.trim(), frequency: form.assessmentFrequency }])
    setForm((current) => ({ ...current, assessmentName: '' }))
  }

  const addBell = () => {
    if (!form.bellName.trim() || !form.bellStart || !form.bellEnd) return
    update('bellPeriods', [...form.bellPeriods, { name: form.bellName.trim(), start: form.bellStart, end: form.bellEnd, type: form.bellType }])
    setForm((current) => ({ ...current, bellName: '', bellStart: '', bellEnd: '' }))
  }

  const uploadLogo = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    update('logoUrl', URL.createObjectURL(file))
  }

  const uploadTeachers = (preview: CsvPreview) => {
    update('teachersCsv', preview)
    update('teacherMap', {
      first_name: bestColumn(preview.headers, ['firstname', 'first', 'name']),
      last_name: bestColumn(preview.headers, ['lastname', 'surname']),
      email: bestColumn(preview.headers, ['email']),
      phone: bestColumn(preview.headers, ['phone', 'mobile']),
      subject: bestColumn(preview.headers, ['subject']),
    })
  }

  const uploadStudents = (preview: CsvPreview) => {
    update('studentsCsv', preview)
    update('studentMap', {
      first_name: bestColumn(preview.headers, ['firstname', 'first', 'name']),
      last_name: bestColumn(preview.headers, ['lastname', 'surname']),
      dob: bestColumn(preview.headers, ['dob', 'birth', 'dateofbirth']),
      class: bestColumn(preview.headers, ['class', 'grade', 'year']),
      guardian_name: bestColumn(preview.headers, ['guardian', 'parent']),
      guardian_phone: bestColumn(preview.headers, ['guardianphone', 'parentphone', 'phone']),
    })
  }

  const currentStep = setupSteps[activeStep]

  return (
    <main className="sl-public">
      <header className={`sl-public-header ${scrolled || route === 'setup' ? 'scrolled' : ''}`}>
        <div className="sl-public-wrap sl-public-nav">
          <button className="sl-public-brand sl-brand-button" type="button" onClick={() => goRoute('home')}>SmartLink Schools</button>
          <div className="sl-public-nav-actions">
            <a className="sl-public-portal-link" href={portalUrl}>Portal Login</a>
            <button className="sl-public-menu-btn" type="button" onClick={() => setMenuOpen(true)}>
              <span className="sl-public-lines"><span /><span /></span>
              Menu
            </button>
          </div>
        </div>
      </header>

      <div className={`sl-public-overlay ${menuOpen ? 'open' : ''}`} aria-hidden={!menuOpen}>
        <button className="sl-public-overlay-close" type="button" onClick={() => setMenuOpen(false)}>Close x</button>
        <div className="sl-public-label">SmartLink Schools</div>
        <div className="sl-public-overlay-rule" />
        <nav className="sl-public-overlay-links">
          <button type="button" onClick={() => { setMenuOpen(false); goRoute('home') }}>Public Site</button>
          <a href="#platform" onClick={() => setMenuOpen(false)}>Platform</a>
          <button type="button" onClick={() => { setMenuOpen(false); startSetup() }}>School Setup</button>
          <a href={portalUrl} onClick={() => setMenuOpen(false)}>Portal Login</a>
        </nav>
      </div>

      {route === 'setup' ? (
        <>
          <section className={`sl-setup-top ${activeStep > 0 ? 'compact' : ''}`}>
            <div className="sl-public-wrap sl-setup-top-grid">
              <div className="sl-logo-uploader">
                <label>
                  {form.logoUrl ? <img src={form.logoUrl} alt="School logo preview" /> : <span>{form.schoolName.slice(0, 2).toUpperCase()}</span>}
                  <input type="file" accept="image/*" onChange={uploadLogo} />
                </label>
                <p>School logo</p>
              </div>
              <div className="sl-setup-top-copy">
                <div className="sl-public-label">Setup Passport</div>
                <h1>{form.schoolName || 'New School Workspace'}</h1>
                <p>{form.location} · {form.curriculum} · {form.modules.length} launch modules selected</p>
              </div>
              <div className="sl-readiness-seal">
                <span>{readiness}%</span>
                <p>Readiness</p>
              </div>
            </div>
          </section>

          <section className="sl-setup-lower">
            <div className="sl-public-wrap">
              <div className="sl-progress-track"><span style={{ width: `${((activeStep + 1) / setupSteps.length) * 100}%` }} /></div>
              <div className="sl-setup-shell">
                <aside className="sl-setup-side">
                  {setupSteps.map((step, index) => (
                    <button key={step.key} type="button" className={index === activeStep ? 'active' : index < activeStep ? 'done' : ''} onClick={() => setActiveStep(index)}>
                      <span>{step.number}</span>
                      <strong>{step.label}</strong>
                    </button>
                  ))}
                </aside>

                <section className="sl-setup-card">
                  <div className="sl-public-label">{currentStep.number} / {currentStep.label}</div>
                  <h2>{currentStep.title}</h2>
                  <p>{currentStep.copy}</p>

                  <div className="sl-step-motion" key={currentStep.key}>
                    {activeStep === 0 ? (
                      <div className="sl-form-grid">
                        <Field label="School name" hint="This appears on the public site, portal and generated reports."><input value={form.schoolName} onChange={(event) => update('schoolName', event.target.value)} /></Field>
                        <Field label="Legal name" hint="Used for invoices, official letters and compliance documents."><input value={form.legalName} onChange={(event) => update('legalName', event.target.value)} /></Field>
                        <Field label="Motto" hint="A short phrase used in the public profile."><input value={form.motto} onChange={(event) => update('motto', event.target.value)} /></Field>
                        <Field label="Location" hint="City, district or campus location."><input value={form.location} onChange={(event) => update('location', event.target.value)} /></Field>
                        <Field label="Manager name"><input value={form.managerName} onChange={(event) => update('managerName', event.target.value)} /></Field>
                        <Field label="Manager email"><input type="email" value={form.managerEmail} onChange={(event) => update('managerEmail', event.target.value)} /></Field>
                        <Field label="Phone"><input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></Field>
                        <Field label="Website"><input value={form.website} onChange={(event) => update('website', event.target.value)} /></Field>
                      </div>
                    ) : null}

                    {activeStep === 1 ? (
                      <div className="sl-form-grid">
                        <Field label="Curriculum" hint="This controls default classes, subjects and assessment templates.">
                          <select value={form.curriculum} onChange={(event) => update('curriculum', event.target.value)}>
                            <option>Cambridge Pathway</option>
                            <option>Malawi National Curriculum</option>
                            <option>International Primary Curriculum</option>
                            <option>Custom blended curriculum</option>
                          </select>
                        </Field>
                        <Field label="Teaching language"><input value={form.language} onChange={(event) => update('language', event.target.value)} /></Field>
                        <Field label="Grading style"><input value={form.grading} onChange={(event) => update('grading', event.target.value)} /></Field>
                        <div className="sl-choice-block">
                          <span>Stages offered <InfoHint text="Select every stage that should be created during setup." /></span>
                          <div>{stageOptions.map((stage) => <button key={stage} type="button" className={form.stages.includes(stage) ? 'active' : ''} onClick={() => update('stages', toggleValue(form.stages, stage))}>{stage}</button>)}</div>
                        </div>
                        <div className="sl-subject-builder">
                          <Field label="Subject name"><input value={form.subjectName} onChange={(event) => update('subjectName', event.target.value)} /></Field>
                          <Field label="Code"><input value={form.subjectCode} onChange={(event) => update('subjectCode', event.target.value)} /></Field>
                          <Field label="Stage"><select value={form.subjectStage} onChange={(event) => update('subjectStage', event.target.value)}>{stageOptions.map((stage) => <option key={stage}>{stage}</option>)}</select></Field>
                          <button type="button" className="sl-mini-add" onClick={addSubject}>Add subject</button>
                        </div>
                        <div className="sl-chip-list">{form.subjects.map((subject) => <span key={`${subject.name}-${subject.code}`}>{subject.code} · {subject.name}</span>)}</div>
                      </div>
                    ) : null}

                    {activeStep === 2 ? (
                      <div className="sl-csv-grid">
                        <CsvUploader
                          title="Teachers"
                          required={['first_name', 'last_name', 'email', 'phone', 'subject']}
                          preview={form.teachersCsv}
                          mapping={form.teacherMap}
                          onUpload={uploadTeachers}
                          onMap={(field, column) => update('teacherMap', { ...form.teacherMap, [field]: column })}
                        />
                        <CsvUploader
                          title="Students"
                          required={['first_name', 'last_name', 'dob', 'class', 'guardian_name', 'guardian_phone']}
                          preview={form.studentsCsv}
                          mapping={form.studentMap}
                          onUpload={uploadStudents}
                          onMap={(field, column) => update('studentMap', { ...form.studentMap, [field]: column })}
                        />
                        <div className="sl-data-quality">
                          <strong>Data quality checks</strong>
                          <span>DOB column present: {form.studentMap.dob ? 'Yes' : 'No'}</span>
                          <span>Teacher contact mapped: {form.teacherMap.email || form.teacherMap.phone ? 'Yes' : 'No'}</span>
                          <span>Guardian contact mapped: {form.studentMap.guardian_phone ? 'Yes' : 'No'}</span>
                        </div>
                      </div>
                    ) : null}

                    {activeStep === 3 ? (
                      <div className="sl-form-grid">
                        <Field label="Facility name" hint="Classrooms, halls and labs become available to timetable rules."><input value={form.facilityName} onChange={(event) => update('facilityName', event.target.value)} /></Field>
                        <Field label="Facility type"><select value={form.facilityType} onChange={(event) => update('facilityType', event.target.value)}>{facilityTypes.map((type) => <option key={type}>{type}</option>)}</select></Field>
                        <Field label="Capacity"><input type="number" min="1" value={form.facilityCapacity} onChange={(event) => update('facilityCapacity', event.target.value)} /></Field>
                        <button type="button" className="sl-mini-add align-end" onClick={addFacility}>Add facility</button>
                        <div className="sl-compact-table">{form.facilities.map((facility) => <div key={`${facility.name}-${facility.type}`}><strong>{facility.name}</strong><span>{facility.type}</span><span>{facility.capacity || '-'} seats</span></div>)}</div>
                      </div>
                    ) : null}

                    {activeStep === 4 ? (
                      <div className="sl-form-grid">
                        <Field label="Weekly activity" hint="Assembly, chapel, clubs and sports can block normal lessons."><input value={form.activityName} onChange={(event) => update('activityName', event.target.value)} /></Field>
                        <Field label="Day"><select value={form.activityDay} onChange={(event) => update('activityDay', event.target.value)}>{dayOptions.map((day) => <option key={day}>{day}</option>)}</select></Field>
                        <Field label="Time"><input type="time" value={form.activityTime} onChange={(event) => update('activityTime', event.target.value)} /></Field>
                        <button type="button" className="sl-mini-add align-end" onClick={addActivity}>Add activity</button>
                        <Field label="Recurring assessment" hint="Common tests can be remembered before exam sessions are generated."><input value={form.assessmentName} onChange={(event) => update('assessmentName', event.target.value)} /></Field>
                        <Field label="Frequency"><input value={form.assessmentFrequency} onChange={(event) => update('assessmentFrequency', event.target.value)} /></Field>
                        <button type="button" className="sl-mini-add align-end" onClick={addAssessment}>Add assessment</button>
                        <div className="sl-rhythm-grid">
                          <div><strong>Weekly activities</strong>{form.weeklyActivities.map((item) => <span key={`${item.name}-${item.day}`}>{item.day} {item.time} · {item.name}</span>)}</div>
                          <div><strong>Assessments</strong>{form.assessments.map((item) => <span key={`${item.name}-${item.frequency}`}>{item.name} · {item.frequency}</span>)}</div>
                        </div>
                        <div className="sl-bell-builder">
                          <Field label="Period name" hint="Use teaching periods, break, lunch or custom blocks."><input value={form.bellName} onChange={(event) => update('bellName', event.target.value)} /></Field>
                          <Field label="Start"><input type="time" value={form.bellStart} onChange={(event) => update('bellStart', event.target.value)} /></Field>
                          <Field label="End"><input type="time" value={form.bellEnd} onChange={(event) => update('bellEnd', event.target.value)} /></Field>
                          <Field label="Type"><select value={form.bellType} onChange={(event) => update('bellType', event.target.value)}><option>Teaching</option><option>Break</option><option>Lunch</option><option>Assembly</option><option>Custom</option></select></Field>
                          <button type="button" className="sl-mini-add" onClick={addBell}>Add period</button>
                        </div>
                        <div className="sl-bell-timeline">{form.bellPeriods.map((period) => <div key={`${period.name}-${period.start}`}><span>{period.start}</span><strong>{period.name}</strong><em>{period.end}</em></div>)}</div>
                      </div>
                    ) : null}

                    {activeStep === 5 ? (
                      <div className="sl-launch-grid">
                        <div className="sl-passport">
                          {setupSummary.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
                        </div>
                        <div className="sl-choice-block launch-modules">
                          <span>Portal modules <InfoHint text="Only selected modules are switched on for the manager during launch." /></span>
                          <div>{moduleOptions.map((module) => <button key={module} type="button" className={form.modules.includes(module) ? 'active' : ''} onClick={() => update('modules', toggleValue(form.modules, module))}>{module}</button>)}</div>
                        </div>
                        <div className="sl-launch-checklist">
                          <strong>Launch checklist</strong>
                          <span>Setup passport ready</span>
                          <span>CSV column maps reviewed</span>
                          <span>Bell periods prepared</span>
                          <span>Portal modules selected</span>
                        </div>
                        {submitted ? <div className="sl-setup-complete">Setup brief prepared. The next step is to create the real workspace in the portal.</div> : null}
                      </div>
                    ) : null}
                  </div>

                  <div className="sl-setup-actions">
                    <button type="button" className="sl-public-btn" disabled={activeStep === 0} onClick={() => setActiveStep((step) => Math.max(0, step - 1))}>Back</button>
                    {activeStep < setupSteps.length - 1 ? (
                      <button type="button" className="sl-public-btn-block" onClick={() => setActiveStep((step) => Math.min(setupSteps.length - 1, step + 1))}>Continue</button>
                    ) : (
                      <button type="button" className="sl-public-btn-block" onClick={() => setSubmitted(true)}>Create Setup Brief</button>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </section>
        </>
      ) : (
        <>
          <section className="sl-public-hero sl-public-home-hero" id="top" style={{ backgroundImage: `linear-gradient(180deg, rgba(17,16,17,0.32), rgba(17,16,17,0.74)), url('${heroImage}')` }}>
            <div className="sl-public-hero-inner">
              <div className="sl-public-label">Public site at publicurl.com</div>
              <h1>Run the school before the bell rings.</h1>
              <p>SmartLink Schools gives managers one refined command centre for setup, timetables, fees, attendance, assessment and parent communication.</p>
              <div className="sl-landing-intake">
                <Field label="School name"><input value={form.schoolName} onChange={(event) => update('schoolName', event.target.value)} /></Field>
                <Field label="Location"><input value={form.location} onChange={(event) => update('location', event.target.value)} /></Field>
                <Field label="Manager email"><input type="email" value={form.managerEmail} onChange={(event) => update('managerEmail', event.target.value)} /></Field>
                <button type="button" className="sl-public-btn-block" onClick={startSetup}>Start School Setup</button>
              </div>
              <div className="sl-public-hero-actions">
                <a href="#platform" className="sl-public-btn">View Platform</a>
                <a href={portalUrl} className="sl-public-btn">Open Portal</a>
              </div>
            </div>
          </section>

          <div className="sl-public-facts">
            <div className="sl-public-wrap sl-public-facts-row">
              <div className="sl-public-fact"><div className="num">1</div><div className="lbl">School Workspace</div></div>
              <div className="sl-public-fact"><div className="num">8</div><div className="lbl">Launch Modules</div></div>
              <div className="sl-public-fact"><div className="num">6</div><div className="lbl">Setup Steps</div></div>
              <div className="sl-public-fact"><div className="num">CSV</div><div className="lbl">Bulk Upload</div></div>
            </div>
          </div>

          <section id="platform" className="sl-public-section">
            <div className="sl-public-wrap sl-public-about-grid">
              <div className="sl-public-framed"><img src={aboutImage} alt="School learners working in a classroom" /></div>
              <div className="sl-public-about-copy">
                <div className="sl-public-label">The Platform</div>
                <h2>A school system that starts with structure.</h2>
                <p>Most school software begins after the school is already messy. SmartLink begins earlier: the profile, curriculum, class map, academic calendar and timetable rules are defined before the workspace opens.</p>
                <p>The result is a calmer portal. Teachers see what they teach, finance sees what is due, managers see what is missing, and families see the school as one connected institution.</p>
              </div>
            </div>
          </section>

          <section className="sl-public-academics" id="operations">
            <div className="sl-public-wrap">
              <div className="sl-public-section-head">
                <div className="sl-public-label">Operations</div>
                <h2>Everything follows the same record.</h2>
                <p>One school definition drives daily work across learning, administration and communication.</p>
              </div>
              <div className="sl-public-card-grid-3">
                <article className="sl-public-card"><span className="sl-public-label">Academic</span><h3>Classes, subjects and results</h3><p>Build class groups, assign teachers, record assessments and review learner progress.</p><div className="ages">CURRICULUM FIRST</div></article>
                <article className="sl-public-card"><span className="sl-public-label">Timetable</span><h3>Periods, rooms and rules</h3><p>Define teaching days, bell schedules, weekly activities and room constraints before publication.</p><div className="ages">CONFLICT AWARE</div></article>
                <article className="sl-public-card"><span className="sl-public-label">Portal</span><h3>Students, staff and families</h3><p>Staff login at the portal, while students and guardians access results, fees, notices and updates.</p><div className="ages">PORTAL.PUBLICURL.COM</div></article>
              </div>
            </div>
          </section>

          <section className="sl-public-section">
            <div className="sl-public-wrap">
              <div className="sl-public-section-head"><div className="sl-public-label">School Life</div><h2>Built for the real school day.</h2><p>The platform follows assemblies, labs, clubs, examination sessions and parent-facing moments.</p></div>
              <div className="sl-public-life-grid">
                {['Daily learning', 'Campus resources', 'Library and study', 'Community'].map((title, index) => (
                  <article className="sl-public-life-card" key={title}><img src={lifeImages[index]} alt="" /><div className="lc-body"><h4>{title}</h4><p>{['Class registers, lessons and academic progress stay connected.', 'Rooms, laboratories and equipment become timetable-aware.', 'Support structured study periods and learning resources.', 'Keep families aligned through notices, fees and results.'][index]}</p></div></article>
                ))}
              </div>
            </div>
          </section>

          <section className="sl-public-gallery" id="gallery">
            <div className="sl-public-wrap"><div className="sl-public-section-head"><div className="sl-public-label">Gallery</div><h2>Schools in motion.</h2><p>Use the public site for the school story, then move the operational work into the portal.</p></div></div>
            <div className="sl-public-g-grid">{galleryImages.map((src) => <img key={src} src={src} alt="" />)}</div>
          </section>

          <section className="sl-public-testimonial">
            <div className="sl-public-wrap"><div className="sl-public-label">Manager Voice</div><blockquote>"The setup flow made us define the school properly before adding data. That changed the quality of every timetable, report and parent message that followed."</blockquote><cite>School Operations Manager</cite></div>
          </section>

          <section className="sl-public-cta">
            <div className="sl-public-wrap"><h2>Keep the public site elegant. Keep the work in the portal.</h2><p>Public visitors land on publicurl.com. Staff, students and guardians sign in at portal.publicurl.com.</p><button type="button" className="sl-public-btn-block" onClick={startSetup}>Start School Setup</button></div>
          </section>
        </>
      )}

      <footer className="sl-public-footer">
        <div className="sl-public-wrap sl-public-footer-grid">
          <div><h5>SmartLink Schools</h5><p>Public presence, school setup and daily operations for modern schools.</p></div>
          <div><h5>Public</h5><button type="button" onClick={() => goRoute('home')}>Public site</button><button type="button" onClick={startSetup}>School setup</button></div>
          <div><h5>Portal</h5><a href={portalUrl}>Login</a><a href={portalUrl}>Staff workspace</a><a href={portalUrl}>Student portal</a></div>
          <div><h5>Domains</h5><p>publicurl.com</p><p>portal.publicurl.com</p></div>
        </div>
        <div className="sl-public-wrap sl-public-footer-bottom"><span>SmartLink Schools</span><span>Public site and portal split ready</span></div>
      </footer>
    </main>
  )
}
