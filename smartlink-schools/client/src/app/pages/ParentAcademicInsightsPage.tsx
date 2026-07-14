import { useEffect, useState } from 'react'
import { BookOpenCheck, CalendarCheck, CheckCircle2, HeartHandshake, RefreshCcw, Sparkles, Target } from 'lucide-react'
import { Button } from '../components/ui/button'
import { usePortal } from '../lib/portalContext'

function readableDate(value: any) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
}

function InsightList({ icon: Icon, title, items, tone }: { icon: any; title: string; items: any[]; tone: 'positive' | 'focus' | 'support' }) {
  if (!items?.length) return null
  const palette = tone === 'positive'
    ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]'
    : tone === 'focus'
      ? 'border-[#fde68a] bg-[#fffbeb] text-[#92400e]'
      : 'border-[#ddd6fe] bg-[#f5f3ff] text-[#5b21b6]'
  return (
    <section className={`rounded-[10px] border p-4 ${palette}`}>
      <div className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.08em]">
        <Icon className="size-4" />
        {title}
      </div>
      <ul className="mt-3 grid gap-2 text-[13px] leading-5">
        {items.map((item, index) => <li key={`${title}-${index}`} className="flex gap-2"><span aria-hidden="true">•</span><span>{item}</span></li>)}
      </ul>
    </section>
  )
}

export function ParentAcademicInsightsPage() {
  const { token, api } = usePortal()
  const [data, setData] = useState<any>({ students: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    if (!token) return
    setLoading(true)
    setError('')
    try {
      setData(await api.getParentAcademicInsights(token))
    } catch (err: any) {
      setError(err?.message || 'SmartLink could not load the academic progress updates.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [token])

  const students = data?.students || []
  const updateCount = students.reduce((total: number, row: any) => total + (row.insights?.length || 0), 0)

  return (
    <div className="grid gap-4 p-4">
      <section className="overflow-hidden rounded-[12px] border border-[#ddd6fe] bg-[linear-gradient(130deg,#312e81_0%,#6d28d9_55%,#db2777_125%)] p-6 text-white shadow-[0_18px_45px_rgba(76,29,149,0.2)]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.14em] text-[#ddd6fe]"><Sparkles className="size-4" /> Family learning updates</div>
            <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.035em]">Your child&rsquo;s progress, in clear language</h1>
            <p className="mt-2 text-[13px] leading-6 text-[#ede9fe]">Teacher-approved strengths, focus areas and simple ways to support learning at home.</p>
          </div>
          <Button type="button" variant="outline" onClick={load} disabled={loading} className="border-white/30 bg-white/10 text-white hover:bg-white/20 hover:text-white">
            <RefreshCcw className={`size-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
          </Button>
        </div>
        <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-semibold text-[#ede9fe]">
          <span className="rounded-full bg-white/10 px-3 py-1.5">{students.length} linked {students.length === 1 ? 'student' : 'students'}</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">{updateCount} published {updateCount === 1 ? 'update' : 'updates'}</span>
        </div>
      </section>

      {error ? <div className="rounded-[8px] border border-[#fecaca] bg-[#fef2f2] px-4 py-3 text-[13px] font-semibold text-[#b91c1c]">{error}</div> : null}

      {!loading && !students.length ? (
        <section className="grid min-h-64 place-items-center rounded-[10px] border border-dashed border-[#cbd5e1] bg-white p-8 text-center">
          <div className="max-w-md">
            <HeartHandshake className="mx-auto size-9 text-[#7c3aed]" />
            <h2 className="mt-3 text-[17px] font-semibold text-[#111827]">No student is linked to this account yet</h2>
            <p className="mt-2 text-[13px] leading-6 text-[#64748b]">Ask the school office to link your parent account to the correct student record. SmartLink will never show another learner&rsquo;s information.</p>
          </div>
        </section>
      ) : null}

      {students.map((entry: any) => (
        <section key={entry.student.public_ref} className="overflow-hidden rounded-[10px] border border-[#e2e8f0] bg-white shadow-[0_8px_24px_rgba(15,23,42,0.06)]">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e2e8f0] bg-[#fafafa] px-5 py-4">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.025em] text-[#111827]">{entry.student.name}</h2>
              <p className="mt-1 text-[12px] font-medium text-[#64748b]">{entry.student.class_name || 'Current class'}</p>
            </div>
            <span className="rounded-full border border-[#bbf7d0] bg-[#f0fdf4] px-3 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#166534]">School approved</span>
          </header>

          {!entry.insights?.length ? (
            <div className="p-8 text-center">
              <BookOpenCheck className="mx-auto size-8 text-[#94a3b8]" />
              <div className="mt-3 text-[14px] font-semibold text-[#334155]">No progress update has been published yet</div>
              <p className="mt-1 text-[12px] text-[#64748b]">The school will share an update here after its academic review.</p>
            </div>
          ) : (
            <div className="grid gap-4 p-4">
              {entry.insights.map((insight: any) => (
                <article key={insight.public_ref} className="rounded-[10px] border border-[#e2e8f0] bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.09em] text-[#7c3aed]">{insight.subject_name || 'Overall learning'} · {insight.reporting_period || 'Current period'}</div>
                      <h3 className="mt-2 text-[19px] font-semibold tracking-[-0.03em] text-[#111827]">{insight.headline}</h3>
                    </div>
                    {insight.published_at ? <span className="text-[11px] font-medium text-[#64748b]">Published {readableDate(insight.published_at)}</span> : null}
                  </div>
                  <p className="mt-3 max-w-4xl text-[14px] leading-7 text-[#334155]">{insight.summary_text}</p>

                  <div className="mt-5 grid gap-3 lg:grid-cols-3">
                    <InsightList icon={CheckCircle2} title="Going well" items={insight.strengths || []} tone="positive" />
                    <InsightList icon={Target} title="Current focus" items={insight.focus_areas || []} tone="focus" />
                    <InsightList icon={HeartHandshake} title="Support at home" items={insight.home_support || []} tone="support" />
                  </div>

                  {insight.attendance_effect_text ? (
                    <div className="mt-4 flex gap-3 rounded-[8px] border border-[#e2e8f0] bg-[#f8fafc] p-4 text-[13px] leading-6 text-[#475569]">
                      <CalendarCheck className="mt-0.5 size-4 shrink-0 text-[#7c3aed]" />
                      <div><span className="font-semibold text-[#334155]">Attendance and learning: </span>{insight.attendance_effect_text}</div>
                    </div>
                  ) : null}

                  {insight.completed_interventions?.length ? (
                    <div className="mt-4 text-[12px] text-[#475569]"><span className="font-semibold text-[#334155]">Support already completed:</span> {insight.completed_interventions.join(' · ')}</div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
