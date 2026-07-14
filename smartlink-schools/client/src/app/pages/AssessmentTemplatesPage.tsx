import { useEffect, useState } from 'react'
import { Archive, Check, Copy, LayoutTemplate, Search, Star } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { toast } from 'sonner'
import { PageBackButton } from '../components/PageBackButton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { usePortal } from '../lib/portalContext'

const human=(value:any)=>String(value||'-').replaceAll('_',' ').replace(/\b\w/g,(letter)=>letter.toUpperCase())

function TemplatePreview({template}:{template:any}){
  const {token,api}=usePortal()
  const [url,setUrl]=useState('')
  useEffect(()=>{let active=true;let objectUrl='';if(!template.preview_image_path)return;api.getAssessmentTemplatePreview(token,template.public_ref).then((blob:Blob)=>{if(!active)return;objectUrl=URL.createObjectURL(blob);setUrl(objectUrl)}).catch(()=>{});return()=>{active=false;if(objectUrl)URL.revokeObjectURL(objectUrl)}},[token,template.public_ref,template.preview_image_path])
  if(url)return <img src={url} alt={`${template.template_name} preview`} className="h-48 w-full object-contain object-top"/>
  const layout=template.layout_json||{}
  return <div className="grid h-48 place-items-center bg-[#f8fafc] p-6 text-center"><div><LayoutTemplate className="mx-auto size-8 text-[#64748b]"/><div className="mt-3 text-[13px] font-semibold">{human(layout.cover_style||layout.style||'Structured cover')}</div><div className="mt-1 text-[11px] text-[#64748b]">{(layout.sections||[]).map(human).join(' · ')||'Editable SmartLink template'}</div></div></div>
}

export function AssessmentTemplatesPage(){
  const {token,api,user}=usePortal()
  const navigate=useNavigate()
  const [searchParams]=useSearchParams()
  const assessmentId=searchParams.get('assessment_id')||''
  const role=String(user?.role||'')
  const canApprove=['school_owner','headteacher','admin','super_admin'].includes(role)
  const [templates,setTemplates]=useState<any[]>([])
  const [q,setQ]=useState('')
  const [source,setSource]=useState('')
  const [loading,setLoading]=useState(false)
  const load=async()=>{setLoading(true);try{const result=await api.listAssessmentTemplates(token,{q,source_type:source});setTemplates(result.templates||[])}catch(error:any){toast.error(error.message||'Unable to load assessment templates.')}finally{setLoading(false)}}
  useEffect(()=>{load()},[token])
  const action=async(callback:()=>Promise<any>,message:string)=>{try{await callback();toast.success(message);await load()}catch(error:any){toast.error(error.message||'Template action failed.')}}
  return <main className="grid gap-3 p-4">
    <PageBackButton fallback={assessmentId?`/exam-builder/${assessmentId}`:'/exam-builder'} label="Back to Assessment Builder"/>
    <section className="rounded-[7px] border bg-white p-4"><h1 className="text-[22px] font-semibold">Assessment Cover Templates</h1><p className="mt-1 text-[13px] text-[#64748b]">SmartLink templates, school-created covers, and reviewed covers extracted from your own PDFs.</p></section>
    <section className="rounded-[7px] border bg-white p-3"><div className="flex flex-wrap gap-2"><div className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#64748b]"/><Input value={q} onChange={(event)=>setQ(event.target.value)} onKeyDown={(event)=>event.key==='Enter'&&load()} className="pl-9" placeholder="Search cover templates"/></div><select value={source} onChange={(event)=>setSource(event.target.value)} className="h-9 rounded-[6px] border bg-white px-3 text-[12px]"><option value="">All sources</option><option value="built_in">Built-in</option><option value="school_created">School-created</option><option value="imported_pdf">Imported PDF</option><option value="duplicated">Duplicated</option></select><Button onClick={load}>Apply</Button></div></section>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{templates.map((template)=><article key={template.public_ref} className="overflow-hidden rounded-[7px] border bg-white"><TemplatePreview template={template}/><div className="border-t p-3"><div className="flex items-start justify-between gap-2"><div><h2 className="text-[14px] font-semibold">{template.template_name}</h2><p className="mt-1 text-[11px] text-[#64748b]">{human(template.source_type)} · {human(template.template_category)} · {human(template.review_status)}</p></div>{template.is_default?<Star className="size-4 fill-amber-400 text-amber-500"/>:null}</div><p className="mt-2 min-h-8 text-[12px] text-[#475569]">{template.template_description||'No description.'}</p><div className="mt-3 flex flex-wrap gap-2">{assessmentId&&template.review_status==='approved'?<Button className="h-8 text-[11px]" onClick={()=>action(async()=>{await api.applyAssessmentTemplate(token,template.public_ref,assessmentId);navigate(`/exam-builder/${assessmentId}`)},'Cover template applied.')}><Check className="size-3"/>Use template</Button>:null}<Button variant="outline" className="h-8 text-[11px]" onClick={()=>action(()=>api.duplicateAssessmentTemplate(token,template.public_ref), 'Template duplicated.')}><Copy className="size-3"/>Duplicate</Button>{canApprove&&template.review_status==='pending'?<Button className="h-8 text-[11px]" onClick={()=>action(()=>api.approveAssessmentTemplate(token,template.public_ref),'Template approved.')}><Check className="size-3"/>Approve</Button>:null}{canApprove&&template.review_status==='approved'?<Button variant="outline" className="h-8 text-[11px]" onClick={()=>action(()=>api.setDefaultAssessmentTemplate(token,template.public_ref,template.template_category==='general'?'exam':template.template_category),'Default template updated.')}><Star className="size-3"/>Set default</Button>:null}{canApprove&&template.source_type!=='built_in'?<Button variant="outline" className="h-8 text-[11px] text-red-700" onClick={()=>action(()=>api.archiveAssessmentTemplate(token,template.public_ref),'Template archived.')}><Archive className="size-3"/>Archive</Button>:null}</div></div></article>)}{!templates.length?<div className="rounded-[7px] border bg-white p-8 text-[13px] text-[#64748b] sm:col-span-2 xl:col-span-3">{loading?'Loading templates…':'No school templates have been created yet. Start with a built-in SmartLink template or save a cover page from an imported assessment.'}</div>:null}</section>
  </main>
}
