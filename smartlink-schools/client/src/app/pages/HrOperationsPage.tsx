import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { Check, Download, FileText, Plus, Save, UserCheck, XCircle } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { ModalShell } from '../components/ModalShell'
import { PageBackButton } from '../components/PageBackButton'
import { PortalTable } from '../components/PortalTable'
import { SectionCard } from '../components/SectionCard'
import { SectionKpiStrip } from '../components/SectionKpiStrip'
import { usePortal } from '../lib/portalContext'

const selectClass = 'h-9 w-full rounded-[6px] border border-[#d9dce3] bg-white px-2.5 text-[12px] font-medium text-[#111827] outline-none focus:border-[#111827]/35'
const labelClass = 'grid gap-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[#64748b]'
const money = (value: any, currency = 'MWK') => `${currency} ${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
const date = (value: any) => value ? String(value).slice(0, 10) : '-'
const label = (value: any) => String(value || '-').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
const badge = (value: any) => <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[.06em] ${/paid|approved|completed/i.test(String(value)) ? 'border-[#bbf7d0] bg-[#f0fdf4] text-[#166534]' : /pending|draft|withheld/i.test(String(value)) ? 'border-[#fed7aa] bg-[#fff7ed] text-[#9a3412]' : /cancel|reject/i.test(String(value)) ? 'border-[#fecaca] bg-[#fef2f2] text-[#991b1b]' : 'border-[#e2e8f0] bg-[#f8fafc] text-[#475569]'}`}>{label(value)}</span>

function PageHeader({ eyebrow, title, description, actions }: any) {
  return <section className="rounded-[7px] border border-[var(--mera-panel-border)] bg-white p-4 shadow-[var(--mera-shadow-card)]"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#7c3aed]">{eyebrow}</p><h1 className="mt-1 text-[22px] font-semibold tracking-[-.035em] text-[#111827]">{title}</h1><p className="mt-1 max-w-3xl text-[13px] leading-5 text-[#64748b]">{description}</p></div><div className="flex flex-wrap gap-2">{actions}</div></div></section>
}

export function PayrollPage() {
  const { runRef } = useParams()
  return runRef ? <PayrollDetail runRef={runRef} /> : <PayrollOverview />
}

function PayrollOverview() {
  const { token, api, runAction, user } = usePortal()
  const navigate = useNavigate()
  const [data, setData] = useState<any>({ runs: [], salary_profiles: [], missing_salary_profiles: [], summary: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [runOpen, setRunOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runForm, setRunForm] = useState<any>({ title: '', payroll_period_start: '', payroll_period_end: '', notes: '' })
  const [profileForm, setProfileForm] = useState<any>({ staff_user_ref: '', base_salary: '', currency: 'MWK', payment_frequency: 'monthly' })
  const [settingsForm, setSettingsForm] = useState<any>({})
  const refresh = async () => { if(!token)return;setLoading(true);setError('');try{setData(await api.getPayrollDashboard(token))}catch(err:any){setError(err?.message||'Unable to load payroll.')}finally{setLoading(false)} }
  useEffect(()=>{refresh()},[token])
  const current=data.current_run, summary=data.summary||{}
  const staffOptions=[...(data.missing_salary_profiles||[]),...(data.salary_profiles||[]).map((item:any)=>({staff_ref:item.staff_ref,full_name:item.full_name,role:item.role}))].filter((item:any,index:number,items:any[])=>items.findIndex((candidate:any)=>candidate.staff_ref===item.staff_ref)===index)
  const createRun=async()=>{await runAction(()=>api.createPayrollRun(token,runForm),'Creating payroll run...',{refresh:false});setRunOpen(false);setRunForm({title:'',payroll_period_start:'',payroll_period_end:'',notes:''});await refresh()}
  const saveProfile=async()=>{await runAction(()=>api.saveSalaryProfile(token,profileForm),'Saving salary profile...',{refresh:false});setProfileOpen(false);setProfileForm({staff_user_ref:'',base_salary:'',currency:'MWK',payment_frequency:'monthly'});await refresh()}
  const openSettings=()=>{setSettingsForm({...data.settings});setSettingsOpen(true)}
  const saveSettings=async()=>{await runAction(()=>api.updateHrSettings(token,settingsForm),'Saving HR settings...',{refresh:false});setSettingsOpen(false);await refresh()}
  return <main className="grid gap-3 p-4">
    <PageHeader eyebrow="Finance · Confidential" title="Payroll" description="Salary obligations, configurable allowances and deductions, approval status and payment control." actions={<>{['school_owner','director','owner'].includes(String(user?.role||'').toLowerCase())?<Button variant="outline" onClick={openSettings}>HR settings</Button>:null}<Button variant="outline" onClick={()=>setProfileOpen(true)}><UserCheck className="size-4"/>Salary profile</Button><Button onClick={()=>setRunOpen(true)}><Plus className="size-4"/>Create payroll run</Button></>} />
    {error?<div className="rounded border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</div>:null}
    <SectionKpiStrip items={[
      {label:'Current Payroll Net Total',value:money(summary.net_total,current?.currency),helper:'net obligation',tone:'neutral'},
      {label:'Gross Salary Total',value:money(summary.gross_total,current?.currency),helper:'before deductions'},
      {label:'Total Deductions',value:money(summary.deductions,current?.currency),helper:'configured deductions',tone:summary.deductions?'warn':'good'},
      {label:'Total Allowances',value:money(summary.allowances,current?.currency),helper:'configured allowances'},
      {label:'Staff Included',value:summary.staff_count||0,helper:'payroll items'},
      {label:'Payroll Status',value:label(summary.status),helper:'current run',tone:/paid|approved/.test(summary.status)?'good':'warn'},
      {label:'Missing Salary Profiles',value:summary.missing_profiles||0,helper:'active staff',tone:summary.missing_profiles?'warn':'good'},
      {label:'Payroll vs Collections',value:`${Number(summary.payroll_collection_percent||0).toFixed(1)}%`,helper:'last 12 months'},
    ]}/>
    {current?<SectionCard title="Current Payroll Run" subtitle={`${date(current.payroll_period_start)} to ${date(current.payroll_period_end)}`}><div className="grid gap-3 p-4 sm:grid-cols-3"><div><div className="text-[11px] text-[#64748b]">Run</div><div className="font-semibold">{current.title}</div></div><div><div className="text-[11px] text-[#64748b]">Net total</div><div className="font-semibold">{money(current.total_net_pay,current.currency)}</div></div><div className="flex items-center justify-between gap-2"><div>{badge(current.status)}</div><Button variant="outline" onClick={()=>navigate(`/finance/payroll/${current.public_ref}`)}>Open run</Button></div></div></SectionCard>:<SectionCard title="No current payroll" subtitle="Create a run when salary profiles are ready."><div className="p-6 text-[13px] text-[#64748b]">No payroll run has been created for this period. Create a payroll run to calculate salary obligations for staff.</div></SectionCard>}
    <div className="grid gap-3 xl:grid-cols-2"><SectionCard title="Payroll Runs History" subtitle={loading?'Loading payroll records...':'Real payroll records for this school'}><PortalTable columns={[{key:'title',label:'Run'},{key:'payroll_period_end',label:'Period End',render:(r)=>date(r.payroll_period_end)},{key:'total_net_pay',label:'Net Pay',render:(r)=>money(r.total_net_pay,r.currency)},{key:'staff_count',label:'Staff'},{key:'status',label:'Status',render:(r)=>badge(r.status)}]} rows={data.runs||[]} onRowClick={(row)=>navigate(`/finance/payroll/${row.public_ref}`)} emptyMessage="No payroll runs have been created."/></SectionCard><SectionCard title="Salary Profiles" subtitle="Only authorized payroll users can view these amounts."><PortalTable columns={[{key:'full_name',label:'Staff'},{key:'role',label:'Role',render:(r)=>label(r.role)},{key:'base_salary',label:'Base Salary',render:(r)=>money(r.base_salary,r.currency)},{key:'payment_frequency',label:'Frequency',render:(r)=>label(r.payment_frequency)}]} rows={data.salary_profiles||[]} emptyMessage="No staff salary profiles are configured yet. Add salary profiles before generating payroll."/></SectionCard></div>
    <ModalShell open={settingsOpen} onOpenChange={setSettingsOpen} title="Payroll and leave settings" description="School-level controls for sensitive payroll access and leave coverage." footer={<><Button variant="outline" onClick={()=>setSettingsOpen(false)}>Cancel</Button><Button onClick={saveSettings}><Save className="size-4"/>Save settings</Button></>}><div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>Payroll frequency<select className={selectClass} value={settingsForm.payroll_frequency||'monthly'} onChange={(e)=>setSettingsForm({...settingsForm,payroll_frequency:e.target.value})}>{['monthly','weekly','termly','custom'].map((v)=><option key={v} value={v}>{label(v)}</option>)}</select></label><label className={labelClass}>Currency<Input maxLength={3} value={settingsForm.default_currency||'MWK'} onChange={(e)=>setSettingsForm({...settingsForm,default_currency:e.target.value.toUpperCase()})}/></label>{[['allow_bursar_payroll_access','Allow bursar payroll access'],['allow_teacher_payslip_view','Allow teacher payslip view'],['require_leave_coverage','Require leave coverage'],['notify_director_leave_request','Notify director of leave']].map(([key,title])=><label key={key} className="flex items-center justify-between gap-3 rounded-[6px] border p-3 text-[12px] font-semibold"><span>{title}</span><input type="checkbox" checked={Boolean(settingsForm[key])} onChange={(e)=>setSettingsForm({...settingsForm,[key]:e.target.checked})}/></label>)}</div></ModalShell>
    <ModalShell open={runOpen} onOpenChange={setRunOpen} title="Create payroll run" description="Create a draft period. Staff items are generated separately from active salary profiles." footer={<><Button variant="outline" onClick={()=>setRunOpen(false)}>Cancel</Button><Button disabled={!runForm.payroll_period_start||!runForm.payroll_period_end} onClick={createRun}>Create run</Button></>}><div className="grid gap-3 sm:grid-cols-2"><label className={`${labelClass} sm:col-span-2`}>Title<Input value={runForm.title} onChange={(e)=>setRunForm({...runForm,title:e.target.value})}/></label><label className={labelClass}>Period start<Input type="date" value={runForm.payroll_period_start} onChange={(e)=>setRunForm({...runForm,payroll_period_start:e.target.value})}/></label><label className={labelClass}>Period end<Input type="date" value={runForm.payroll_period_end} onChange={(e)=>setRunForm({...runForm,payroll_period_end:e.target.value})}/></label><label className={`${labelClass} sm:col-span-2`}>Notes<Textarea value={runForm.notes} onChange={(e)=>setRunForm({...runForm,notes:e.target.value})}/></label></div></ModalShell>
    <ModalShell open={profileOpen} onOpenChange={setProfileOpen} title="Add salary profile" description="No tax assumptions are made. Configure only the agreed base salary and payment channel." footer={<><Button variant="outline" onClick={()=>setProfileOpen(false)}>Cancel</Button><Button disabled={!profileForm.staff_user_ref||profileForm.base_salary==='' } onClick={saveProfile}><Save className="size-4"/>Save profile</Button></>}><div className="grid gap-3 sm:grid-cols-2"><label className={`${labelClass} sm:col-span-2`}>Staff member<select className={selectClass} value={profileForm.staff_user_ref} onChange={(e)=>setProfileForm({...profileForm,staff_user_ref:e.target.value})}><option value="">Select staff</option>{staffOptions.map((item:any)=><option key={item.staff_ref} value={item.staff_ref}>{item.full_name} · {label(item.role)}</option>)}</select></label><label className={labelClass}>Base salary<Input type="number" min="0" value={profileForm.base_salary} onChange={(e)=>setProfileForm({...profileForm,base_salary:e.target.value})}/></label><label className={labelClass}>Frequency<select className={selectClass} value={profileForm.payment_frequency} onChange={(e)=>setProfileForm({...profileForm,payment_frequency:e.target.value})}>{['monthly','weekly','termly','custom'].map((item)=><option key={item}>{label(item)}</option>)}</select></label></div></ModalShell>
  </main>
}

function PayrollDetail({runRef}:{runRef:string}) {
  const {token,api,runAction,user}=usePortal();const navigate=useNavigate();const [data,setData]=useState<any>({run:{},items:[],summary:{}});const [error,setError]=useState('');const [item,setItem]=useState<any>(null);const [form,setForm]=useState<any>({base_salary:'',status:'draft',allowance_title:'',allowance_amount:'',deduction_title:'',deduction_amount:'',notes:''})
  const refresh=async()=>{try{setData(await api.getPayrollRun(token,runRef))}catch(err:any){setError(err?.message||'Unable to load payroll run.')}};useEffect(()=>{refresh()},[token,runRef]);const run=data.run||{},summary=data.summary||{}
  const transition=async(action:any)=>{if(!window.confirm(`${label(action)} this payroll run?`))return;await runAction(()=>api.transitionPayrollRun(token,runRef,action),`${label(action)} payroll...`,{refresh:false});await refresh()}
  const generate=async()=>{await runAction(()=>api.generatePayrollItems(token,runRef),'Generating payroll items...',{refresh:false});await refresh()}
  const openItem=(row:any)=>{setItem(row);setForm({base_salary:row.base_salary,status:row.status,allowance_title:'',allowance_amount:'',deduction_title:'',deduction_amount:'',notes:row.notes||''})}
  const saveItem=async()=>{const payload:any={base_salary:Number(form.base_salary),status:form.status,notes:form.notes,allowances:[],deductions:[]};if(form.allowance_title&&Number(form.allowance_amount)>0)payload.allowances=[{title:form.allowance_title,amount:Number(form.allowance_amount)}];if(form.deduction_title&&Number(form.deduction_amount)>0)payload.deductions=[{title:form.deduction_title,amount:Number(form.deduction_amount)}];await runAction(()=>api.updatePayrollItem(token,item.public_ref,payload),'Updating payroll item...',{refresh:false});setItem(null);await refresh()}
  const exportCsv=()=>{const headers=['Staff','Role','Base salary','Allowances','Deductions','Net pay','Status'];const lines=[headers,...data.items.map((r:any)=>[r.full_name,r.role,r.base_salary,r.allowances_total,r.deductions_total,r.net_pay,r.status])].map((row:any[])=>row.map((v)=>`"${String(v??'').replaceAll('"','""')}"`).join(','));const blob=new Blob([lines.join('\n')],{type:'text/csv'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`${run.title||'payroll'}.csv`;a.click();URL.revokeObjectURL(url)}
  const ownerIsFinalApprover=['school_owner','director','owner'].includes(String(user?.role||'').toLowerCase())
  return <main className="grid gap-3 p-4"><PageBackButton fallback="/finance/payroll" label="Back to Payroll"/><PageHeader eyebrow="Payroll run" title={run.title||'Payroll'} description={`${date(run.payroll_period_start)} to ${date(run.payroll_period_end)} · ${label(run.status)}`} actions={<><Button variant="outline" onClick={exportCsv}><Download className="size-4"/>Export</Button>{run.status==='draft'?<><Button variant="outline" onClick={generate}>Generate items</Button>{ownerIsFinalApprover?<Button onClick={()=>transition('approve')}><Check className="size-4"/>Approve payroll</Button>:<Button onClick={()=>transition('submit')}>Submit to school owner</Button>}</>:null}{run.status==='pending_approval'&&ownerIsFinalApprover?<Button onClick={()=>transition('approve')}><Check className="size-4"/>Approve payroll</Button>:null}{run.status==='approved'?<Button onClick={()=>transition('pay')}>Mark paid</Button>:null}{!['paid','cancelled'].includes(run.status)?<Button variant="destructive" onClick={()=>transition('cancel')}>Cancel</Button>:null}</>}/>{error?<div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>:null}<SectionKpiStrip items={[{label:'Gross Pay',value:money(summary.gross,run.currency)},{label:'Allowances',value:money(summary.allowances,run.currency)},{label:'Deductions',value:money(summary.deductions,run.currency),tone:summary.deductions?'warn':'good'},{label:'Net Pay',value:money(summary.net,run.currency)},{label:'Staff',value:summary.staff_count||0},{label:'Unpaid / Withheld',value:summary.unpaid_or_withheld||0,tone:summary.unpaid_or_withheld?'warn':'good'},{label:'Unpaid Leave Days',value:summary.unpaid_leave_days||0,helper:'review only; not auto-deducted',tone:summary.unpaid_leave_days?'warn':'good'}]}/><SectionCard title="Staff Payroll" subtitle={run.status==='paid'?'Paid payroll is read-only.':'Select a draft item to configure allowances, deductions or withholding.'}><PortalTable columns={[{key:'full_name',label:'Staff'},{key:'role',label:'Role',render:(r)=>label(r.role)},{key:'base_salary',label:'Base',render:(r)=>money(r.base_salary,run.currency)},{key:'allowances_total',label:'Allowances',render:(r)=>money(r.allowances_total,run.currency)},{key:'deductions_total',label:'Deductions',render:(r)=>money(r.deductions_total,run.currency)},{key:'net_pay',label:'Net',render:(r)=>money(r.net_pay,run.currency)},{key:'status',label:'Status',render:(r)=>badge(r.status)},{key:'payslip',label:'Payslip',render:(r)=><button className="text-[11px] font-semibold text-[#5b21d6]" onClick={(e)=>{e.stopPropagation();navigate(`/finance/payroll/${runRef}/items/${r.public_ref}/payslip`)}}>View</button>}]} rows={data.items||[]} onRowClick={run.status==='draft'?openItem:undefined} emptyMessage="No payroll items exist. Generate items from active salary profiles."/></SectionCard><ModalShell open={Boolean(item)} onOpenChange={(open)=>!open&&setItem(null)} title={`Edit ${item?.full_name||'payroll item'}`} description="Allowances and deductions are manually configured. Unpaid leave is not deducted automatically." footer={<><Button variant="outline" onClick={()=>setItem(null)}>Cancel</Button><Button onClick={saveItem}><Save className="size-4"/>Save item</Button></>}><div className="grid gap-3 sm:grid-cols-2"><label className={labelClass}>Base salary<Input type="number" min="0" value={form.base_salary} onChange={(e)=>setForm({...form,base_salary:e.target.value})}/></label><label className={labelClass}>Payment status<select className={selectClass} value={form.status} onChange={(e)=>setForm({...form,status:e.target.value})}><option value="draft">Draft</option><option value="withheld">Withheld</option></select></label><label className={labelClass}>Allowance title<Input value={form.allowance_title} onChange={(e)=>setForm({...form,allowance_title:e.target.value})}/></label><label className={labelClass}>Allowance amount<Input type="number" min="0" value={form.allowance_amount} onChange={(e)=>setForm({...form,allowance_amount:e.target.value})}/></label><label className={labelClass}>Deduction title<Input value={form.deduction_title} onChange={(e)=>setForm({...form,deduction_title:e.target.value})}/></label><label className={labelClass}>Deduction amount<Input type="number" min="0" value={form.deduction_amount} onChange={(e)=>setForm({...form,deduction_amount:e.target.value})}/></label><label className={`${labelClass} sm:col-span-2`}>Notes<Textarea value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/></label></div></ModalShell></main>
}

export function PayslipPage(){const {runRef,itemRef}=useParams();const {token,api,user}=usePortal();const [data,setData]=useState<any>(null);useEffect(()=>{if(token&&runRef)api.getPayrollRun(token,runRef).then((payload:any)=>setData({...payload,item:payload.items.find((row:any)=>row.public_ref===itemRef)}))},[token,runRef,itemRef]);const item=data?.item,run=data?.run;if(!item)return <main className="p-6 text-[13px] text-[#64748b]">Loading payslip…</main>;return <main className="mx-auto grid max-w-[850px] gap-4 p-5 print:p-0"><div className="print:hidden"><PageBackButton fallback={`/finance/payroll/${runRef}`} label="Back to Payroll Run"/></div><section className="rounded-[8px] border bg-white p-8 shadow-sm print:border-0 print:shadow-none"><div className="flex justify-between border-b pb-5"><div><div className="text-[20px] font-bold">{user?.schoolName||'SmartLink School'}</div><div className="text-[12px] text-[#64748b]">Confidential staff payslip</div></div><div className="text-right"><div className="font-semibold">{run.title}</div><div className="text-[12px] text-[#64748b]">{date(run.payroll_period_start)} – {date(run.payroll_period_end)}</div></div></div><div className="grid gap-3 py-6 sm:grid-cols-2"><div><div className="text-[11px] uppercase text-[#64748b]">Staff member</div><div className="font-semibold">{item.full_name}</div></div><div><div className="text-[11px] uppercase text-[#64748b]">Status</div>{badge(item.status)}</div></div><PortalTable columns={[{key:'description',label:'Description'},{key:'amount',label:'Amount',render:(r)=>money(r.amount,run.currency)}]} rows={[{id:'base',description:'Base salary',amount:item.base_salary},...(item.components||[]).map((c:any)=>({id:c.public_ref,description:`${label(c.component_type)} · ${c.title}`,amount:c.component_type==='deduction'?-Number(c.amount):c.amount}))]}/><div className="mt-6 flex justify-end"><div className="min-w-[250px] rounded-[7px] bg-[#f5f3ff] p-4"><div className="text-[11px] uppercase text-[#6d28d9]">Net pay</div><div className="mt-1 text-[24px] font-bold text-[#4c1d95]">{money(item.net_pay,run.currency)}</div></div></div><div className="mt-8 border-t pt-4 text-[10px] text-[#94a3b8]">Generated from approved SmartLink Schools payroll records on {new Date().toLocaleDateString()}.</div></section><Button className="print:hidden" onClick={()=>window.print()}><FileText className="size-4"/>Print payslip</Button></main>}

export function LeavePage(){const {leaveRef}=useParams();return leaveRef?<LeaveDetail leaveRef={leaveRef}/>:<LeaveOverview/>}

export function MyLeavePage() {
  const { token, api, runAction } = usePortal()
  const [data, setData] = useState<any>({ requests: [], balances: [], summary: {} })
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState<any>({ leave_type: 'sick', start_date: '', end_date: '', reason: '' })

  const refresh = async () => {
    if (!token) return
    try {
      setData(await api.getMyLeaveDashboard(token))
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Unable to load your leave requests.')
    }
  }

  useEffect(() => { refresh() }, [token])

  const create = async () => {
    await runAction(() => api.createMyLeaveRequest(token, form), 'Submitting leave request...', { refresh: false })
    setOpen(false)
    setForm({ leave_type: 'sick', start_date: '', end_date: '', reason: '' })
    await refresh()
  }

  const cancel = async (row: any) => {
    if (!window.confirm('Cancel this pending leave request?')) return
    await runAction(() => api.cancelMyLeaveRequest(token, row.public_ref), 'Cancelling leave request...', { refresh: false })
    await refresh()
  }

  const summary = data.summary || {}
  const annualBalance = (data.balances || []).find((row: any) => row.leave_type === 'annual')
  const canRequestLeave = data.can_request_leave !== false
  return (
    <main className="grid gap-3 p-4">
      <PageHeader
        eyebrow="Staff self-service"
        title="My Leave"
        description="Request leave, follow its approval status and review your available leave balance. Leadership assigns teaching coverage during review."
        actions={canRequestLeave ? <Button onClick={() => setOpen(true)}><Plus className="size-4" />Request leave</Button> : null}
      />
      {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div> : null}
      {!canRequestLeave ? <div className="rounded border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-900">Teacher leave requests are currently disabled in the school's leave settings. Your existing requests and balances remain available below.</div> : null}
      <SectionKpiStrip items={[
        { label: 'My Pending Requests', value: summary.pending || 0, tone: summary.pending ? 'warn' : 'good' },
        { label: 'My Approved Leave', value: summary.approved || 0, tone: 'good' },
        { label: 'My Upcoming Leave', value: summary.upcoming || 0 },
        { label: 'Annual Days Remaining', value: annualBalance?.remaining_days ?? 'Not configured', helper: annualBalance ? `${annualBalance.leave_year} entitlement` : 'Ask leadership to configure entitlement' },
      ]} />
      <SectionCard title="My Leave Requests" subtitle="Only your own requests are visible here.">
        <PortalTable
          columns={[
            { key: 'leave_type', label: 'Type', render: (row) => label(row.leave_type) },
            { key: 'start_date', label: 'Start', render: (row) => date(row.start_date) },
            { key: 'end_date', label: 'End', render: (row) => date(row.end_date) },
            { key: 'total_days', label: 'Days' },
            { key: 'coverage_name', label: 'Coverage', render: (row) => row.coverage_name || 'Assigned during review' },
            { key: 'status', label: 'Status', render: (row) => badge(row.status) },
            { key: 'actions', label: 'Actions', render: (row) => row.status === 'pending' ? <Button type="button" variant="outline" className="h-7 text-[11px]" onClick={(event) => { event.stopPropagation(); cancel(row) }}>Cancel</Button> : null },
          ]}
          rows={data.requests || []}
          emptyMessage="You have not submitted a leave request yet."
        />
      </SectionCard>
      <ModalShell
        open={open && canRequestLeave}
        onOpenChange={setOpen}
        title="Request leave"
        description="Your request will be sent to school leadership for approval and coverage planning."
        footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={!form.start_date || !form.end_date || !form.reason.trim()} onClick={create}>Submit request</Button></>}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={`${labelClass} sm:col-span-2`}>Leave type<select className={selectClass} value={form.leave_type} onChange={(event) => setForm({ ...form, leave_type: event.target.value })}>{['sick','annual','maternity','paternity','compassionate','unpaid','study','other'].map((value) => <option key={value} value={value}>{label(value)}</option>)}</select></label>
          <label className={labelClass}>Start date<Input type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} /></label>
          <label className={labelClass}>End date<Input type="date" min={form.start_date || undefined} value={form.end_date} onChange={(event) => setForm({ ...form, end_date: event.target.value })} /></label>
          <label className={`${labelClass} sm:col-span-2`}>Reason<Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="Explain the reason and anything leadership should consider." /></label>
        </div>
      </ModalShell>
    </main>
  )
}

function LeaveSettingsButton() {
  const { token, api, runAction, user } = usePortal()
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<any>({ allow_teacher_leave_requests: false, require_leave_coverage: true, notify_director_leave_request: true })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const isOwner = String(user?.role || '').toLowerCase() === 'school_owner'

  if (!isOwner) return null

  const openSettings = async () => {
    setOpen(true)
    setError('')
    setLoading(true)
    try { setSettings(await api.getHrSettings(token)) }
    catch (err: any) { setError(err?.message || 'Unable to load leave settings.') }
    finally { setLoading(false) }
  }
  const saveSettings = async () => {
    await runAction(() => api.updateHrSettings(token, settings), 'Saving leave settings...', { refresh: false })
    setOpen(false)
  }

  return <>
    <Button variant="outline" onClick={openSettings}>Leave settings</Button>
    <ModalShell open={open} onOpenChange={setOpen} title="Staff leave settings" description="Control teacher self-service requests, coverage planning and leadership notifications." footer={<><Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button><Button disabled={loading || Boolean(error)} onClick={saveSettings}><Save className="size-4"/>Save settings</Button></>}>
      <div className="grid gap-3">
        {loading ? <div className="text-[12px] text-[#64748b]">Loading current leave settings…</div> : null}
        {error ? <div className="rounded border border-red-200 bg-red-50 p-3 text-[12px] text-red-700">{error}</div> : null}
        {[
          ['allow_teacher_leave_requests', 'Allow teachers to request leave'],
          ['require_leave_coverage', 'Require teaching coverage'],
          ['notify_director_leave_request', 'Notify leadership of requests'],
        ].map(([key, title]) => <label key={key} className="flex items-center justify-between gap-3 rounded-[6px] border p-3 text-[12px] font-semibold"><span>{title}</span><input type="checkbox" checked={Boolean(settings[key])} onChange={(event) => setSettings({ ...settings, [key]: event.target.checked })}/></label>)}
      </div>
    </ModalShell>
  </>
}

function LeaveOverview(){const {token,api,runAction}=usePortal();const navigate=useNavigate();const [data,setData]=useState<any>({requests:[],summary:{},leave_by_type:[]});const [staff,setStaff]=useState<any[]>([]);const [open,setOpen]=useState(false);const [error,setError]=useState('');const [form,setForm]=useState<any>({staff_user_ref:'',leave_type:'sick',start_date:'',end_date:'',reason:'',coverage_staff_ref:''});const refresh=async()=>{try{setData(await api.getLeaveDashboard(token));const users=await api.listUsers(token);setStaff((users.users||[]).filter((u:any)=>['teacher','headteacher'].includes(u.role)))}catch(err:any){setError(err?.message||'Unable to load staff leave.')}};useEffect(()=>{refresh()},[token]);const summary=data.summary||{};const create=async()=>{await runAction(()=>api.createLeaveRequest(token,form),'Creating leave request...',{refresh:false});setOpen(false);await refresh()};const max=Math.max(1,...(data.leave_by_type||[]).map((r:any)=>Number(r.value)));return <main className="grid gap-3 p-4"><PageHeader eyebrow="Staff operations" title="Leave" description="Approved leave, pending requests, teaching coverage and attendance impact." actions={<><LeaveSettingsButton/><Button onClick={()=>setOpen(true)}><Plus className="size-4"/>Create leave request</Button></>}/>{error?<div className="rounded border border-red-200 bg-red-50 p-3 text-red-700">{error}</div>:null}<SectionKpiStrip items={[{label:'Currently on Leave',value:summary.currently_on_leave||0,tone:summary.currently_on_leave?'warn':'good'},{label:'Pending Requests',value:summary.pending||0,tone:summary.pending?'warn':'good'},{label:'Ending This Week',value:summary.ending_this_week||0},{label:'Uncovered Leave',value:summary.uncovered||0,tone:summary.uncovered?'bad':'good'},{label:'Approved Leave',value:summary.approved||0},{label:'Rejected / Cancelled',value:summary.rejected_or_cancelled||0}]}/><div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]"><SectionCard title="Leave Requests" subtitle="Select a request to review details, coverage and attendance impact."><PortalTable columns={[{key:'staff_name',label:'Staff'},{key:'leave_type',label:'Type',render:(r)=>label(r.leave_type)},{key:'start_date',label:'Start',render:(r)=>date(r.start_date)},{key:'end_date',label:'End',render:(r)=>date(r.end_date)},{key:'total_days',label:'Days'},{key:'coverage_name',label:'Coverage',render:(r)=>r.coverage_name||'Not assigned'},{key:'status',label:'Status',render:(r)=>badge(r.status)}]} rows={data.requests||[]} onRowClick={(row)=>navigate(`/staff/leave/${row.public_ref}`)} emptyMessage="No leave requests have been recorded. Approved leave will appear here and will affect staff attendance."/></SectionCard><SectionCard title="Leave by Type" subtitle="Recorded requests in the current school dataset."><div className="grid gap-3 p-4">{(data.leave_by_type||[]).map((row:any)=><div key={row.name}><div className="flex justify-between text-[12px]"><span>{label(row.name)}</span><strong>{row.value}</strong></div><div className="mt-1 h-2 overflow-hidden rounded-full bg-[#ede9fe]"><div className="h-full rounded-full bg-gradient-to-r from-[#5b21d6] to-[#ec268f]" style={{width:`${Number(row.value)/max*100}%`}}/></div></div>)}{!data.leave_by_type?.length?<div className="text-[12px] text-[#64748b]">No leave trend is available yet.</div>:null}</div></SectionCard></div><ModalShell open={open} onOpenChange={setOpen} title="Create leave request" description="Approved leave appears as On Leave in staff attendance, not Absent." footer={<><Button variant="outline" onClick={()=>setOpen(false)}>Cancel</Button><Button disabled={!form.staff_user_ref||!form.start_date||!form.end_date||!form.reason} onClick={create}>Submit request</Button></>}><div className="grid gap-3 sm:grid-cols-2"><label className={`${labelClass} sm:col-span-2`}>Staff member<select className={selectClass} value={form.staff_user_ref} onChange={(e)=>setForm({...form,staff_user_ref:e.target.value})}><option value="">Select staff</option>{staff.map((u:any)=><option key={u.public_ref} value={u.public_ref}>{u.full_name}</option>)}</select></label><label className={labelClass}>Leave type<select className={selectClass} value={form.leave_type} onChange={(e)=>setForm({...form,leave_type:e.target.value})}>{['sick','annual','maternity','paternity','compassionate','unpaid','study','other'].map((v)=><option key={v} value={v}>{label(v)}</option>)}</select></label><label className={labelClass}>Coverage teacher<select className={selectClass} value={form.coverage_staff_ref} onChange={(e)=>setForm({...form,coverage_staff_ref:e.target.value})}><option value="">Not assigned</option>{staff.filter((u:any)=>u.public_ref!==form.staff_user_ref).map((u:any)=><option key={u.public_ref} value={u.public_ref}>{u.full_name}</option>)}</select></label><label className={labelClass}>Start date<Input type="date" value={form.start_date} onChange={(e)=>setForm({...form,start_date:e.target.value})}/></label><label className={labelClass}>End date<Input type="date" value={form.end_date} onChange={(e)=>setForm({...form,end_date:e.target.value})}/></label><label className={`${labelClass} sm:col-span-2`}>Reason<Textarea value={form.reason} onChange={(e)=>setForm({...form,reason:e.target.value})}/></label></div></ModalShell></main>}

function LeaveDetail({ leaveRef }: { leaveRef: string }) {
  const { token, api, runAction } = usePortal()
  const [data, setData] = useState<any>({ request: null, balances: [] })
  const [staff, setStaff] = useState<any[]>([])
  const [coverage, setCoverage] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')

  const refresh = async () => {
    try {
      const payload = await api.getLeaveRequest(token, leaveRef)
      setData(payload)
      setCoverage(payload.request?.coverage_ref || '')
      const users = await api.listUsers(token)
      setStaff((users.users || []).filter((user: any) => ['teacher', 'headteacher'].includes(user.role)))
      setError('')
    } catch (err: any) {
      setError(err?.message || 'Unable to load leave request.')
    }
  }

  useEffect(() => { refresh() }, [token, leaveRef])

  const request = data.request
  const act = async (action: any) => {
    if (!window.confirm(`${label(action)} this leave request?`)) return
    await runAction(() => api.transitionLeave(token, leaveRef, action, { coverage_staff_ref: coverage, decision_notes: notes || undefined }), `${label(action)} leave...`, { refresh: false })
    await refresh()
  }
  const saveCoverage = async () => {
    await runAction(() => api.updateLeaveRequest(token, leaveRef, { coverage_staff_ref: coverage, decision_notes: notes }), 'Saving leave coverage...', { refresh: false })
    await refresh()
  }

  if (!request) return <main className="p-4"><PageBackButton fallback="/staff/leave" label="Back to Leave"/><div className="mt-4 text-[13px] text-[#64748b]">{error || 'Loading leave request…'}</div></main>

  return <main className="grid gap-3 p-4">
    <PageBackButton fallback="/staff/leave" label="Back to Leave"/>
    <PageHeader eyebrow="Leave detail" title={`${request.staff_name} · ${label(request.leave_type)}`} description={`${date(request.start_date)} to ${date(request.end_date)} · ${request.total_days} days`} actions={<>{request.status === 'pending' ? <><Button onClick={() => act('approve')}><Check className="size-4"/>Approve</Button><Button variant="destructive" onClick={() => act('reject')}><XCircle className="size-4"/>Reject</Button></> : null}{request.status === 'approved' ? <Button onClick={() => act('complete')}>Mark returned</Button> : null}{['pending', 'approved'].includes(request.status) ? <Button variant="outline" onClick={() => act('cancel')}>Cancel</Button> : null}</>}/>
    <SectionKpiStrip items={[{ label: 'Status', value: label(request.status), tone: request.status === 'approved' ? 'good' : request.status === 'pending' ? 'warn' : 'neutral' }, { label: 'Duration', value: `${request.total_days} days` }, { label: 'Coverage', value: request.coverage_name || 'Not assigned', tone: request.coverage_name ? 'good' : 'warn' }, { label: 'Attendance', value: request.status === 'approved' ? 'On Leave' : 'No change', helper: 'during approved period' }]}/>
    <div className="grid gap-3 xl:grid-cols-2">
      <SectionCard title="Leave Details" subtitle="Request, decision and approval record."><div className="grid gap-3 p-4 text-[13px]"><div><div className="text-[11px] uppercase text-[#64748b]">Reason</div><div>{request.reason}</div></div><div className="grid grid-cols-2 gap-3"><div><div className="text-[11px] uppercase text-[#64748b]">Requested by</div><div>{request.requested_by_name}</div></div><div><div className="text-[11px] uppercase text-[#64748b]">Approved by</div><div>{request.approved_by_name || '-'}</div></div></div><div><div className="text-[11px] uppercase text-[#64748b]">Affected responsibilities</div><div>{request.affected_responsibilities || 'No active teaching assignments found.'}</div></div></div></SectionCard>
      <SectionCard title="Coverage" subtitle="Assign another teacher to reduce class disruption."><div className="grid gap-3 p-4"><label className={labelClass}>Coverage teacher<select className={selectClass} value={coverage} onChange={(event) => setCoverage(event.target.value)}><option value="">Not assigned</option>{staff.filter((user: any) => user.public_ref !== request.staff_ref).map((user: any) => <option key={user.public_ref} value={user.public_ref}>{user.full_name}</option>)}</select></label><label className={labelClass}>Director notes<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={request.decision_notes || 'Coverage or decision notes'}/></label><Button variant="outline" onClick={saveCoverage}><Save className="size-4"/>Save coverage</Button></div></SectionCard>
    </div>
    <SectionCard title="Leave Balances" subtitle="Configured entitlement and used days for this staff member."><PortalTable columns={[{ key: 'leave_type', label: 'Type', render: (row) => label(row.leave_type) }, { key: 'leave_year', label: 'Year' }, { key: 'entitlement_days', label: 'Entitlement' }, { key: 'used_days', label: 'Used' }, { key: 'remaining_days', label: 'Remaining' }]} rows={data.balances || []} emptyMessage="No leave balance has been configured for this staff member."/></SectionCard>
  </main>
}
