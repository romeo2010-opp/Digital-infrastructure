import { ReactNode } from 'react'

interface ToolbarProps {
  children: ReactNode
}

export function Toolbar({ children }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[1.25rem] border border-slate-200 bg-white px-3.5 py-3 shadow-[0_2px_8px_rgba(15,23,42,0.06)]">
      {children}
    </div>
  )
}
