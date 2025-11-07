import React, { useMemo, useState } from 'react'

function parseKind(): 'group' | 'channel' {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  return p.startsWith('/admin/channels') ? 'channel' : 'group'
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function AdminSpaceCreatePage() {
  const kind = useMemo(parseKind, [])
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create() {
    if (!name.trim() || saving) return
    setSaving(true); setError(null)
    try {
      const csrf = getCsrfToken()
      const res = await fetch('/api/spaces', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ type: kind, name: name.trim() })
      })
      if (!res.ok) throw new Error('create_failed')
      const data = await res.json()
      const id = Number(data?.id)
      if (Number.isFinite(id) && id > 0) {
        window.location.href = kind === 'group' ? `/admin/groups/${id}` : `/admin/channels/${id}`
      } else {
        window.location.href = kind === 'group' ? '/admin/groups' : '/admin/channels'
      }
    } catch (e: any) {
      setError('Failed to create')
    } finally { setSaving(false) }
  }

  const cancelHref = kind === 'group' ? '/admin/groups' : '/admin/channels'

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Add {kind === 'group' ? 'Group' : 'Channel'}</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      <div style={{ maxWidth: 560, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
        <label style={{ display: 'grid', gap: 6 }}>
          <span>Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
        </label>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <button onClick={create} disabled={saving || !name.trim()} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#1976d2', color: '#fff' }}>{saving ? 'Creating…' : 'Create'}</button>
          <a href={cancelHref} style={{ color: '#9cf', textDecoration: 'none', display: 'inline-block', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)' }}>Cancel</a>
        </div>
      </div>
    </div>
  )
}

