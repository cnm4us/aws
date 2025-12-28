import React, { useEffect, useState } from 'react'
import { prefetchForHref } from '../../ui/routes'
import styles from '../../styles/menu.module.css'

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
    { label: 'Group Review', href: '/admin/review/groups', count: groupCount },
    { label: 'Channel Review', href: '/admin/review/channels', count: channelCount },
  ]
  return (
    <div className={styles.list}>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          onMouseEnter={() => prefetchForHref(it.href)}
          onFocus={() => prefetchForHref(it.href)}
          onClick={() => onNavigate && onNavigate()}
          className={styles.itemLink}
        >
          <span>{it.label}</span>
          <span className={styles.note}>{it.count != null ? it.count : '–'}</span>
        </a>
      ))}
    </div>
  )
}
