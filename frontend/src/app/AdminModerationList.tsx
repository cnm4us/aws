import React, { useEffect, useMemo, useState } from 'react'

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
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>{title}</div>
      {showSpinner && <div style={{ color: '#fff', opacity: 0.8 }}>Loading…</div>}
      {error && <div style={{ color: '#ffb3b3' }}>Failed to load.</div>}
      {!loading && !error && (
        <div style={{ width: '100%', maxWidth: 800 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 8, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.8)', fontSize: 13, textTransform: 'uppercase', letterSpacing: 1 }}>
            <div>Name</div>
            <div style={{ textAlign: 'right' }}>Items Waiting</div>
          </div>
          {items.map((it) => (
            <a
              key={it.id}
              href={`/spaces/${it.id}/moderation`}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px',
                gap: 8,
                padding: '12px 12px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                color: '#fff',
                textDecoration: 'none',
              }}
            >
              <div>{it.name || it.slug}</div>
              <div style={{ textAlign: 'right' }}>{it.pending}</div>
            </a>
          ))}
          {items.length === 0 && (
            <div style={{ padding: '12px 12px', color: 'rgba(255,255,255,0.7)' }}>No spaces found.</div>
          )}
        </div>
      )}
    </div>
  )
}
