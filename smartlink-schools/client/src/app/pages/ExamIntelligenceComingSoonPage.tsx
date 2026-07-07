import { BarChart3, BookMarked, BrainCircuit, ClipboardCheck, FileSearch, GraduationCap } from 'lucide-react'

const previews = [
  { title: 'Past-paper pattern analysis', icon: FileSearch },
  { title: 'Syllabus coverage insights', icon: BookMarked },
  { title: 'Revision priority forecasts', icon: BarChart3 },
  { title: 'Student weakness tracking', icon: BrainCircuit },
  { title: 'Mock exam generation', icon: ClipboardCheck },
  { title: 'Teacher planning support', icon: GraduationCap },
]

export function ExamIntelligenceComingSoonPage() {
  return (
    <div className="min-h-full bg-[#f6f7f9] px-4 py-6 text-[#111827]">
      <section className="mx-auto grid min-h-[calc(100vh-9rem)] max-w-6xl content-center gap-6">
        <div className="grid gap-4 rounded-[8px] border border-[#e2e8f0] bg-white p-6 shadow-sm md:p-8">
          <div className="max-w-3xl">
            <span className="inline-flex h-8 items-center rounded-[5px] border border-[#dbe3ee] bg-[#f8fafc] px-3 text-[11px] font-bold uppercase tracking-[0.12em] text-[#64748b]">
              Coming Soon
            </span>
            <h1 className="mt-5 text-[clamp(2rem,5vw,4.25rem)] font-semibold leading-[0.98] tracking-[0] text-[#0f172a]">
              Exam Intelligence
            </h1>
            <p className="mt-4 max-w-2xl text-[16px] leading-7 text-[#475569]">
              SmartLink is preparing advanced exam analytics, syllabus coverage tracking, past-paper intelligence, and revision intelligence tools for schools.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {previews.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.title} className="flex min-h-[92px] items-center gap-3 rounded-[8px] border border-[#e5e7eb] bg-[#fbfcfd] p-4">
                  <span className="grid size-10 shrink-0 place-items-center rounded-[7px] bg-[#111827] text-white">
                    <Icon className="size-5" />
                  </span>
                  <span className="text-[14px] font-semibold leading-5 text-[#111827]">{item.title}</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>
    </div>
  )
}
