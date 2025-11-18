import React, { useEffect, useState } from 'react'
import { prefetchForHref } from '../../ui/routes'

export default function AdminMenu(props: { onNavigate?: () => void }) {
  const { onNavigate } = props
  const [groupCount, setGroupCount] = useState<number | null>(null)
  const [channelCount, setChannelCount] = useState<number | null>(null)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const [gRes, cRes] = await Promise.all([
          fetch('/api/admin/moderation/groups', { credentials: 'same-origin' }),
          fetch('/api/admin/moderation/channels', { credentials: 'same-origin' }),
        ])
        if (!gRes.ok || !cRes.ok) throw new Error('failed_counts')
        const gData = await gRes.json()
        const cData = await cRes.json()
        if (canceled) return
        const gTotal = Array.isArray(gData?.items) ? gData.items.reduce((sum: number, it: any) => sum + (Number(it?.pending || 0) || 0), 0) : 0
        const cTotal = Array.isArray(cData?.items) ? cData.items.reduce((sum: number, it: any) => sum + (Number(it?.pending || 0) || 0), 0) : 0
        setGroupCount(gTotal)
        setChannelCount(cTotal)
      } catch {
        if (canceled) return
        setGroupCount(0)
        setChannelCount(0)
      }
    })()
    return () => { canceled = true }
  }, [])

  const items = [
    { label: 'Group Moderation', href: '/admin/moderation/groups', count: groupCount },
    { label: 'Channel Moderation', href: '/admin/moderation/channels', count: channelCount },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          onMouseEnter={() => prefetchForHref(it.href)}
          onFocus={() => prefetchForHref(it.href)}
          onClick={() => onNavigate && onNavigate()}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontSize: 15,
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
            textDecoration: 'none',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          <span>{it.label}</span>
          <span style={{ fontSize: 13, opacity: 0.9 }}>{it.count != null ? it.count : '–'}</span>
        </a>
      ))}
    </div>
  )
}
