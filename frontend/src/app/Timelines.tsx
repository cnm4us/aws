import React, { useEffect, useMemo, useState } from 'react'

type ProjectListItem = {
  id: number
  name: string | null
  description: string | null
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

function fmtDefaultTimelineName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
    now.getSeconds()
  )}`
}

export default function Timelines() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ProjectListItem[]>([])

  const activeItems = useMemo(() => items.filter((p) => p.archivedAt == null), [items])

  const [createOpen, setCreateOpen] = useState(false)
  const [createDefaultName, setCreateDefaultName] = useState(() => fmtDefaultTimelineName())
  const [createName, setCreateName] = useState(() => fmtDefaultTimelineName())
  const [createDescription, setCreateDescription] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')

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

  function openCreate() {
    const nextDefault = fmtDefaultTimelineName()
    setCreateDefaultName(nextDefault)
    setCreateName(nextDefault)
    setCreateDescription('')
    setCreateOpen(true)
  }

  function openEdit(id: number) {
    const current = items.find((p) => Number(p.id) === Number(id))
    if (!current) return
    setEditId(Number(current.id))
    setEditName((current.name || '').trim() || `Timeline #${current.id}`)
    setEditDescription((current.description || '').trim())
    setEditOpen(true)
  }

  async function createNew() {
    try {
      const nameRaw = String(createName || '').trim()
      const descriptionRaw = String(createDescription || '').trim()
      const name = nameRaw || createDefaultName
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch('/api/create-video/projects', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ name, description: descriptionRaw || null }),
      })
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

  async function saveEdit() {
    if (!editId) return
    try {
      const name = String(editName || '').trim()
      const description = String(editDescription || '').trim()
      if (!name) {
        window.alert('Name is required')
        return
      }
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(editId))}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ name, description: description || null }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_rename'))
      setItems((prev) =>
        prev.map((p) => (Number(p.id) === Number(editId) ? { ...p, name, description: description || null } : p))
      )
      setEditOpen(false)
    } catch (e: any) {
      window.alert(e?.message || 'Failed to save timeline')
    }
  }

  async function deleteTimeline(id: number) {
    const ok = window.confirm('Delete this timeline? This cannot be undone.')
    if (!ok) return
    try {
      const headers: Record<string, string> = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(id))}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        headers,
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_delete'))
      await refresh()
    } catch (e: any) {
      window.alert(e?.message || 'Failed to delete timeline')
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
            onClick={openCreate}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 92 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 900, fontSize: 16, wordBreak: 'break-word' }}>{title}</div>
                    <div style={{ color: '#9a9a9a', fontSize: 13, marginTop: 4 }}>
                      Updated: {fmtDate(p.updatedAt)} • Created: {fmtDate(p.createdAt)}
                    </div>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      gap: 10,
                      flexWrap: 'nowrap',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      marginTop: 'auto',
                      overflowX: 'auto',
                      WebkitOverflowScrolling: 'touch',
                    }}
                  >
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
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => openEdit(p.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteTimeline(p.id)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,155,155,0.40)',
                        background: 'rgba(255,0,0,0.14)',
                        color: '#fff',
                        fontWeight: 900,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {createOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setCreateOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              padding: 14,
              color: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>New Timeline</div>
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                style={{
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Name</div>
                <input
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onFocus={() => {
                    if (createName === createDefaultName) setCreateName('')
                  }}
                  onBlur={() => {
                    if (!String(createName || '').trim()) setCreateName(createDefaultName)
                  }}
                  placeholder={createDefaultName}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#050505',
                    color: '#fff',
                    fontWeight: 800,
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Description (optional)</div>
                <textarea
                  value={createDescription}
                  onChange={(e) => setCreateDescription(e.target.value)}
                  placeholder="Description…"
                  rows={4}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#050505',
                    color: '#fff',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void createNew()}
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
                Create
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            zIndex: 50,
          }}
          onClick={() => setEditOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              borderRadius: 16,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0b0b0b',
              padding: 14,
              color: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Edit Timeline</div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                style={{
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <div>
                <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Name</div>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#050505',
                    color: '#fff',
                    fontWeight: 800,
                  }}
                />
              </div>

              <div>
                <div style={{ fontSize: 13, color: '#bbb', marginBottom: 6 }}>Description (optional)</div>
                <textarea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Description…"
                  rows={4}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#050505',
                    color: '#fff',
                    resize: 'vertical',
                  }}
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void saveEdit()}
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
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
