import { ReactNode } from 'react'

interface ToolbarProps {
  children: ReactNode
}

export function Toolbar({ children }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 shadow-sm">
      {children}
    </div>
  )
}
