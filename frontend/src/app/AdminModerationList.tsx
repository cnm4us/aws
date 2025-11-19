import React, { useEffect, useMemo, useState } from 'react'
import styles from '../styles/adminModerationList.module.css'

type Item = { id: number; name: string; slug: string; pending: number }

export default function AdminModerationList(props: { kind: 'group' | 'channel' }) {
  const { kind } = props
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [showSpinner, setShowSpinner] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    let spinnerTimer: any = null
    setError(null)
    const cacheKey = `admin:modlist:${kind}`
    let hadCache = false
    try {
      const raw = sessionStorage.getItem(cacheKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && Array.isArray(parsed.items)) {
          setItems(parsed.items as Item[])
          setLoading(false)
          setShowSpinner(false)
          hadCache = true
        }
      }
    } catch {}

    ;(async () => {
      if (!hadCache) {
        setLoading(true)
        setShowSpinner(false)
        spinnerTimer = setTimeout(() => { if (!canceled) setShowSpinner(true) }, 220)
      }
      try {
        const url = kind === 'group' ? '/api/admin/moderation/groups' : '/api/admin/moderation/channels'
        const res = await fetch(url, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('failed_to_load')
        const data = await res.json()
        if (canceled) return
        const next = Array.isArray(data?.items) ? (data.items as Item[]) : []
        setItems(next)
        try { sessionStorage.setItem(cacheKey, JSON.stringify({ items: next, ts: Date.now() })) } catch {}
        setLoading(false)
        setShowSpinner(false)
      } catch (err: any) {
        if (canceled) return
        setError(err?.message || 'failed_to_load')
        setLoading(false)
        setShowSpinner(false)
      } finally {
        if (spinnerTimer) clearTimeout(spinnerTimer)
      }
    })()
    return () => { canceled = true; if (spinnerTimer) clearTimeout(spinnerTimer) }
  }, [kind])

  const title = useMemo(() => (kind === 'group' ? 'Group Moderation' : 'Channel Moderation'), [kind])

  return (
    <div className={styles.container}>
      <div className={styles.title}>{title}</div>
      {showSpinner && <div className={styles.spinner}>Loading…</div>}
      {error && <div className={styles.error}>Failed to load.</div>}
      {!loading && !error && (
        <div className={styles.wrap}>
          <div className={styles.header}>
            <div>Name</div>
            <div className={styles.right}>Items Waiting</div>
          </div>
          {items.map((it) => (
            <a key={it.id} href={`/spaces/${it.id}/moderation`} className={styles.row}>
              <div>{it.name || it.slug}</div>
              <div className={styles.right}>{it.pending}</div>
            </a>
          ))}
          {items.length === 0 && (
            <div className={styles.empty}>No spaces found.</div>
          )}
        </div>
      )}
    </div>
  )
}
