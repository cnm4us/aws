import React, { useEffect, useMemo, useState } from 'react'

type SiteFlags = { requireGroupReview: boolean; requireChannelReview: boolean; siteEnforced: boolean }
type SettingsPayload = any
type SettingsResponse = { id: number; name: string | null; type: 'personal'|'group'|'channel'; settings: SettingsPayload; site: SiteFlags }

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

export default function SpaceSettingsPage() {
  const spaceId = useMemo(parseSpaceId, [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<SettingsResponse | null>(null)
  const [comments, setComments] = useState<'inherit'|'on'|'off'>('inherit')
  const [requireReview, setRequireReview] = useState<boolean>(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!spaceId) { setError('Bad space id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/spaces/${spaceId}/settings`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const json = (await res.json()) as SettingsResponse
        if (canceled) return
        setData(json)
        const s = json.settings || {}
        const c = typeof s.comments === 'string' ? s.comments.toLowerCase() : 'inherit'
        setComments(c === 'on' || c === 'off' ? c : 'inherit')
        const rr = !!(s.publishing && typeof s.publishing === 'object' && s.publishing.requireApproval === true)
        setRequireReview(rr)
      } catch (e) {
        if (!canceled) setError('Failed to load settings')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [spaceId])

  async function save() {
    if (!spaceId || !data || saving) return
    setSaving(true); setSaved(null)
    try {
      const body: any = { commentsPolicy: comments }
      if (!data.site.siteEnforced && (data.type === 'group' || data.type === 'channel')) body.requireReview = requireReview
      const csrf = getCsrfToken()
      const res = await fetch(`/api/spaces/${spaceId}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error('save_failed')
      setSaved('Saved')
      setTimeout(() => setSaved(null), 1200)
    } catch (e) {
      setSaved('Failed')
    } finally { setSaving(false) }
  }

  const s = data
  const disabledReview = !!(s && s.site && s.site.siteEnforced)

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Space Settings (SPA){s?.name ? ` • ${s.name}` : ''}</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      {loading || !s ? (
        <div>Loading…</div>
      ) : (
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)', maxWidth: 640 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600 }}>Publishing & Moderation</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={save} disabled={saving} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#1976d2', color: '#fff' }}>{saving ? 'Saving…' : 'Save'}</button>
              {saved && <span style={{ fontSize: 12, opacity: 0.8 }}>{saved}</span>}
            </div>
          </div>
          <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
            <span>Comments</span>
            <select value={comments} onChange={(e) => setComments(e.target.value as any)} style={{ width: 220, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}>
              <option value="inherit">Inherit</option>
              <option value="on">On</option>
              <option value="off">Off</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <span>Require Review Before Publish</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <input type="checkbox" checked={requireReview} onChange={(e) => setRequireReview(e.target.checked)} disabled={disabledReview} />
              {disabledReview && (
                <span style={{ fontSize: 12, opacity: 0.8 }}>Site policy enforced for {s.type}</span>
              )}
            </div>
          </label>
        </div>
      )}
    </div>
  )
}

