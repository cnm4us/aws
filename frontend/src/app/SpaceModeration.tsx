import React, { useEffect, useMemo, useState } from 'react'

type QueueItem = {
  publication: {
    id: number
    upload_id: number
    production_id: number | null
    space_id: number
    status: string
    requested_by: number | null
    approved_by: number | null
    visibility: string
    published_at: string | null
    created_at: string
  }
  upload: {
    id: number
    original_filename?: string | null
    modified_filename?: string | null
    poster_portrait_cdn?: string | null
    poster_landscape_cdn?: string | null
  }
  requester: { displayName: string | null; email: string | null } | null
}

function parseSpaceId(): number | null {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  const m = p.match(/\/spaces\/(\d+)\//) || p.match(/\/spaces\/(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function SpaceModerationPage() {
  const spaceId = useMemo(parseSpaceId, [])
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!spaceId) { setError('Bad space id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/spaces/${spaceId}/moderation/queue`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = await res.json()
        if (canceled) return
        setItems(Array.isArray(data?.items) ? data.items : [])
      } catch (e) {
        if (!canceled) setError('Failed to load moderation queue')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [spaceId])

  async function approve(publicationId: number) {
    if (busy[publicationId]) return
    setBusy((b) => ({ ...b, [publicationId]: true }))
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/publications/${publicationId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, credentials: 'same-origin', body: JSON.stringify({}) })
      if (!res.ok) throw new Error('approve_failed')
      // Remove from list
      setItems((prev) => prev.filter((it) => it.publication.id !== publicationId))
    } catch {}
    finally { setBusy((b) => ({ ...b, [publicationId]: false })) }
  }

  async function reject(publicationId: number) {
    if (busy[publicationId]) return
    setBusy((b) => ({ ...b, [publicationId]: true }))
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/publications/${publicationId}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, credentials: 'same-origin', body: JSON.stringify({}) })
      if (!res.ok) throw new Error('reject_failed')
      setItems((prev) => prev.filter((it) => it.publication.id !== publicationId))
    } catch {}
    finally { setBusy((b) => ({ ...b, [publicationId]: false })) }
  }

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Space Moderation • Review Queue</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 820 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Publication</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Production</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Asset</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Requester</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Requested At</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!items.length && !loading ? (
              <tr><td colSpan={6} style={{ padding: '12px 10px', opacity: 0.8 }}>No pending items.</td></tr>
            ) : items.map((it) => (
              <tr key={it.publication.id}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>#{it.publication.id}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{it.publication.production_id ?? ''}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {it.upload.modified_filename || it.upload.original_filename || `Upload ${it.upload.id}`}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {it.requester?.displayName || it.requester?.email || ''}
                </td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{new Date(it.publication.created_at).toLocaleString()}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <button onClick={() => approve(it.publication.id)} disabled={!!busy[it.publication.id]} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#2e7d32', color: '#fff', marginRight: 8 }}>Approve</button>
                  <button onClick={() => reject(it.publication.id)} disabled={!!busy[it.publication.id]} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#b71c1c', color: '#fff' }}>Reject</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <div style={{ marginTop: 10, opacity: 0.8 }}>Loading…</div> : null}
    </div>
  )
}
