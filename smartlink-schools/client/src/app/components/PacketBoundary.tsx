import type { ReactNode } from 'react'
import { PanelSkeleton } from './LiveDataSkeleton'
import { usePortal } from '../lib/portalContext'
import { normalizePacketKeys, type MeraPacketKey } from '../lib/packetRegistry'

function hasPacketValue(data: any, key: MeraPacketKey) {
  return Object.prototype.hasOwnProperty.call(data || {}, key) && data?.[key] !== undefined
}

export function PacketBoundary({
  packet,
  packets,
  children,
  skeleton,
  errorFallback,
}: {
  packet?: MeraPacketKey
  packets?: readonly MeraPacketKey[]
  children: ReactNode
  skeleton?: ReactNode
  errorFallback?: ReactNode
}) {
  const { data, packetStatus, packetErrors } = usePortal()
  const keys = normalizePacketKeys(packets?.length ? packets : packet ? [packet] : [])
  const missingLoading = keys.some((key) => packetStatus[key] === 'loading' && !hasPacketValue(data, key))
  const firstErrorKey = keys.find((key) => packetStatus[key] === 'error' || packetStatus[key] === 'forbidden')

  if (missingLoading) return <>{skeleton || <PanelSkeleton />}</>
  if (firstErrorKey && errorFallback) return <>{errorFallback}</>
  if (firstErrorKey) {
    return (
      <div className="rounded-md border border-[#e2e8f0] bg-[#fef2f2] px-3 py-2 text-sm text-[#dc2626]">
        {packetErrors[firstErrorKey] || 'Unable to load this MERA data packet.'}
      </div>
    )
  }
  return <>{children}</>
}
