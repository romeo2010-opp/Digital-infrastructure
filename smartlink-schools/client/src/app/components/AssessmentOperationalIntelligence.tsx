import { useEffect, useState } from 'react'
import { SectionCard } from './SectionCard'
import { PortalTable } from './PortalTable'
import { usePortal } from '../lib/portalContext'

export function AssessmentOperationalIntelligence({ assessmentId }: { assessmentId: string | number }) {
  const { token, api } = usePortal()
  const [data, setData] = useState<any>(null)
  useEffect(() => {
    if (!assessmentId) return
    api.getAssessmentOperationalIntelligence(token, assessmentId).then(setData).catch(() => setData(null))
  }, [api, assessmentId, token])
  if (!data) return null
  const distribution = data.distribution || {}
  const completion = data.completion || {}
  const mapping = data.mapping || {}
  return <SectionCard title="Assessment Intelligence" subtitle="Published distributions, mapping quality and question observations; small samples remain explicitly limited.">
    <div className="grid gap-2 border-b border-[#e2e8f0] p-3 sm:grid-cols-4 xl:grid-cols-8">
      {[
        ['Official scripts', completion.official_scripts ?? 0], ['Absent', completion.absent ?? 0], ['Incomplete', completion.incomplete ?? 0],
        ['Average', distribution.average === null ? '—' : `${distribution.average}%`], ['Median', distribution.median === null ? '—' : `${distribution.median}%`],
        ['Highest', distribution.highest === null ? '—' : `${distribution.highest}%`], ['Lowest', distribution.lowest === null ? '—' : `${distribution.lowest}%`],
        ['Mapping', `${Number(mapping.coverage_percentage || 0).toFixed(0)}%`],
      ].map(([label, value]) => <div key={String(label)} className="rounded-[6px] border border-[#e2e8f0] bg-[#f8fafc] p-2"><div className="text-[9px] font-bold uppercase text-[#64748b]">{label}</div><div className="mt-1 text-[17px] font-semibold text-[#111827]">{value}</div></div>)}
    </div>
    <div className="border-b border-[#e2e8f0] px-3 py-2 text-[10px] text-[#475569]">Evidence quality: <strong>{String(mapping.evidence_quality || 'unknown').replaceAll('_', ' ')}</strong>. {mapping.evidence_quality === 'overall_only' ? 'Exact topic claims are disabled.' : `${mapping.mapped_questions || 0} of ${mapping.total_questions || 0} questions are validly mapped.`}</div>
    <PortalTable rows={data.question_analytics || []} columns={[
      { key: 'display_number', label: 'Question' },
      { key: 'question_text', label: 'Wording' },
      { key: 'attempts', label: 'Attempts' },
      { key: 'average_mark', label: 'Average mark', render: (row: any) => row.average_mark === null ? '—' : Number(row.average_mark).toFixed(1) },
      { key: 'success_rate', label: 'Success', render: (row: any) => row.success_rate === null ? '—' : `${Number(row.success_rate).toFixed(1)}%` },
      { key: 'zero_mark_rate', label: 'Zero mark', render: (row: any) => row.zero_mark_rate === null ? '—' : `${Number(row.zero_mark_rate).toFixed(1)}%` },
      { key: 'full_mark_rate', label: 'Full mark', render: (row: any) => row.full_mark_rate === null ? '—' : `${Number(row.full_mark_rate).toFixed(1)}%` },
      { key: 'omission_rate', label: 'Omitted', render: (row: any) => row.omission_rate === null ? '—' : `${Number(row.omission_rate).toFixed(1)}%` },
      { key: 'confidence', label: 'Interpretation', render: (row: any) => row.psychometric_claims_available ? 'Supported sample' : 'Insufficient sample' },
    ]} emptyMessage="Question analytics will appear after official question-level marks are published." />
  </SectionCard>
}
