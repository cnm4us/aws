import React, { useEffect, useState } from 'react'

type SiteSettings = {
  allowGroupCreation: boolean
  allowChannelCreation: boolean
  requireGroupReview: boolean
  requireChannelReview: boolean
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function AdminSiteSettingsPage() {
  const [settings, setSettings] = useState<SiteSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch('/api/admin/site-settings', { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = (await res.json()) as SiteSettings
        if (canceled) return
        setSettings(data)
      } catch (e) {
        if (!canceled) setError('Failed to load settings')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [])

  async function save() {
    if (!settings || saving) return
    setSaving(true); setSaved(null)
    try {
      const csrf = getCsrfToken()
      const res = await fetch('/api/admin/site-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify(settings),
      })
      if (!res.ok) throw new Error('save_failed')
      setSaved('Saved')
      setTimeout(() => setSaved(null), 1200)
    } catch (e) {
      setSaved('Failed')
    } finally { setSaving(false) }
  }

  const s = settings

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Admin • Site Settings (SPA beta)</h1>
      <div style={{ marginBottom: 12 }}>
        <a href="/admin/settings" style={{ color: '#9cf', textDecoration: 'none' }}>Legacy Settings</a>
      </div>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      {loading || !s ? (
        <div>Loading…</div>
      ) : (
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)', maxWidth: 560 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div style={{ fontWeight: 600 }}>Global Flags</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button onClick={save} disabled={saving} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#1976d2', color: '#fff' }}>{saving ? 'Saving…' : 'Save'}</button>
              {saved && <span style={{ fontSize: 12, opacity: 0.8 }}>{saved}</span>}
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <input type="checkbox" checked={!!s.allowGroupCreation} onChange={(e) => setSettings({ ...s, allowGroupCreation: e.target.checked })} />
            Allow new groups
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <input type="checkbox" checked={!!s.allowChannelCreation} onChange={(e) => setSettings({ ...s, allowChannelCreation: e.target.checked })} />
            Allow new channels
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <input type="checkbox" checked={!!s.requireGroupReview} onChange={(e) => setSettings({ ...s, requireGroupReview: e.target.checked })} />
            Require review for new groups
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input type="checkbox" checked={!!s.requireChannelReview} onChange={(e) => setSettings({ ...s, requireChannelReview: e.target.checked })} />
            Require review for new channels
          </label>
        </div>
      )}
    </div>
  )
}

