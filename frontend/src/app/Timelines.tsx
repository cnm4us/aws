import React, { useEffect, useMemo, useState } from 'react'

type ProjectListItem = {
  id: number
  name: string | null
  status: string
  lastExportUploadId: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

function getCsrfToken(): string | null {
  try {
    const cookies: Record<string, string> = {}
    const raw = String(document.cookie || '')
    if (!raw) return null
    for (const part of raw.split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      const name = part.slice(0, idx).trim()
      if (!name) continue
      const value = decodeURIComponent(part.slice(idx + 1).trim())
      cookies[name] = value
    }
    return cookies.csrf || null
  } catch {
    return null
  }
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  const d = new Date(String(s))
  if (Number.isNaN(d.getTime())) return String(s)
  return d.toISOString().slice(0, 10)
}

export default function Timelines() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ProjectListItem[]>([])

  const activeItems = useMemo(() => items.filter((p) => p.archivedAt == null), [items])
  const archivedItems = useMemo(() => items.filter((p) => p.archivedAt != null), [items])

  async function refresh() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/create-video/projects', { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const list: ProjectListItem[] = Array.isArray(json?.items) ? json.items : []
      setItems(list)
    } catch (e: any) {
      setError(e?.message || 'Failed to load timelines')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function createNew() {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch('/api/create-video/projects', { method: 'POST', credentials: 'same-origin', headers, body: '{}' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_create'))
      const id = Number(json?.project?.id)
      if (Number.isFinite(id) && id > 0) {
        window.location.href = `/create-video?project=${encodeURIComponent(String(id))}`
      } else {
        await refresh()
      }
    } catch (e: any) {
      window.alert(e?.message || 'Failed to create timeline')
    }
  }

  async function rename(id: number) {
    const current = items.find((p) => Number(p.id) === Number(id))
    const currentName = current?.name ? String(current.name) : ''
    const next = window.prompt('Timeline name:', currentName || 'Untitled')
    if (next == null) return
    const name = String(next).trim()
    if (!name) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ name }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_rename'))
      setItems((prev) => prev.map((p) => (Number(p.id) === Number(id) ? { ...p, name } : p)))
    } catch (e: any) {
      window.alert(e?.message || 'Failed to rename timeline')
    }
  }

  async function archive(id: number) {
    const ok = window.confirm('Archive this timeline?')
    if (!ok) return
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(id))}/archive`, {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: '{}',
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_archive'))
      await refresh()
    } catch (e: any) {
      window.alert(e?.message || 'Failed to archive timeline')
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/create-video" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Create Video
          </a>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            Assets
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Timelines</h1>
            <p style={{ margin: '4px 0 0 0', color: '#bbb' }}>Create and manage your Create Video projects.</p>
          </div>
          <button
            type="button"
            onClick={createNew}
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              border: '1px solid rgba(10,132,255,0.55)',
              background: '#0a84ff',
              color: '#fff',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            New Timeline
          </button>
        </div>

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}

        <div style={{ marginTop: 16, display: 'grid', gap: 12 }}>
          {activeItems.map((p) => {
            const title = (p.name || '').trim() || `Timeline #${p.id}`
            return (
              <div
                key={p.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 16,
                  background: 'rgba(255,255,255,0.03)',
                  padding: 14,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 16, wordBreak: 'break-word' }}>{title}</div>
                    <div style={{ color: '#9a9a9a', fontSize: 13, marginTop: 4 }}>
                      Updated: {fmtDate(p.updatedAt)} • Created: {fmtDate(p.createdAt)}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => (window.location.href = `/create-video?project=${encodeURIComponent(String(p.id))}`)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(10,132,255,0.55)',
                        background: 'rgba(10,132,255,0.16)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => rename(p.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => archive(p.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,155,155,0.40)',
                        background: 'rgba(255,0,0,0.14)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Archive
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {archivedItems.length ? (
          <div style={{ marginTop: 22 }}>
            <div style={{ fontWeight: 900, marginBottom: 10 }}>Archived</div>
            <div style={{ display: 'grid', gap: 12 }}>
              {archivedItems.map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: '1px solid rgba(255,255,255,0.10)',
                    borderRadius: 16,
                    background: 'rgba(255,255,255,0.02)',
                    padding: 14,
                    opacity: 0.8,
                  }}
                >
                  <div style={{ fontWeight: 900, wordBreak: 'break-word' }}>{(p.name || '').trim() || `Timeline #${p.id}`}</div>
                  <div style={{ color: '#9a9a9a', fontSize: 13, marginTop: 4 }}>Archived: {fmtDate(p.archivedAt)}</div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

