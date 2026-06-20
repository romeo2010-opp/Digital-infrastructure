import { ReactNode } from 'react'

interface ToolbarProps {
  children: ReactNode
}

export function Toolbar({ children }: ToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-[6px] border border-[#e2e8f0] bg-white px-3 py-2 shadow-none">
      {children}
    </div>
  )
}
