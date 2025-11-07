import React, { useEffect, useMemo, useState } from 'react'

type SpaceDetail = {
  id: number
  type: 'group' | 'channel' | 'personal'
  owner_user_id: number | null
  name: string
  slug: string
  settings: any
}

function parsePath(): { kind: 'group'|'channel', id: number } | null {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  const m = p.match(/^\/admin\/(groups|channels)\/(\d+)/)
  if (!m) return null
  const id = Number(m[2])
  if (!Number.isFinite(id) || id <= 0) return null
  return { kind: (m[1] === 'groups' ? 'group' : 'channel'), id }
}

export default function AdminSpaceDetailPage() {
  const parsed = useMemo(parsePath, [])
  const [detail, setDetail] = useState<SpaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!parsed) { setError('Bad id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/admin/spaces/${parsed.id}`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = await res.json()
        if (!canceled) setDetail(data)
      } catch (e) {
        if (!canceled) setError('Failed to load space')
      } finally { if (!canceled) setLoading(false) }
    }
    load()
    return () => { canceled = true }
  }, [parsed?.id])

  const s = detail
  const adminHref = s ? (s.type === 'group' ? `/groups/${s.id}/admin` : s.type === 'channel' ? `/channels/${s.id}/admin` : `/spaces/${s.id}/admin`) : '#'
  const settingsHref = `/spaces/${s?.id || 0}/admin/settings`
  const moderationHref = `/spaces/${s?.id || 0}/moderation`

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Admin • {parsed?.kind === 'group' ? 'Group' : 'Channel'} Detail (SPA)</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      {loading || !s ? (
        <div>Loading…</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Space</div>
            <div>ID: {s.id}</div>
            <div>Type: {s.type}</div>
            <div>Name: {s.name}</div>
            <div>Slug: {s.slug}</div>
            <div>Owner ID: {s.owner_user_id ?? ''}</div>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Settings (raw)</div>
            <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: 0 }}>{JSON.stringify(s.settings ?? {}, null, 2)}</pre>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Shortcuts</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <a href={adminHref} style={{ color: '#9cf', textDecoration: 'none' }}>Members</a>
              <a href={settingsHref} style={{ color: '#9cf', textDecoration: 'none' }}>Settings</a>
              <a href={moderationHref} style={{ color: '#9cf', textDecoration: 'none' }}>Moderation</a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

