import React, { useEffect, useMemo, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type UploadListItem = {
  id: number
  modified_filename: string | null
  description: string | null
  size_bytes: number | null
  duration_seconds: number | null
  status: string
  created_at: string
  s3_key?: string
  video_role?: string | null
  create_video_project_id?: number | null
}

type ProjectListItem = {
  id: number
  name: string | null
  status: string
  updatedAt: string
}

function fmtSize(sizeBytes: number | null): string {
  const b = sizeBytes == null ? 0 : Number(sizeBytes)
  if (!Number.isFinite(b) || b <= 0) return '—'
  const kb = b / 1024
  if (kb < 1024) return `${Math.round(kb)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(1)} MB`
}

function fmtDuration(seconds: number | null): string {
  const s = seconds == null ? 0 : Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return '—'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) return null
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
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

export default function Exports() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<MeResponse | null>(null)
  const [exportsList, setExportsList] = useState<UploadListItem[]>([])
  const [projects, setProjects] = useState<ProjectListItem[]>([])
  const [sendingId, setSendingId] = useState<number | null>(null)

  const projectsById = useMemo(() => {
    const m = new Map<number, ProjectListItem>()
    for (const p of projects) m.set(Number(p.id), p)
    return m
  }, [projects])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        if (cancelled) return
        setMe(user)
        if (!user || !user.userId) throw new Error('not_authenticated')

        const [uploadsRes, projectsRes] = await Promise.all([
          fetch(`/api/uploads?kind=video&user_id=${encodeURIComponent(String(user.userId))}&limit=500`, { credentials: 'same-origin' }),
          fetch('/api/create-video/projects', { credentials: 'same-origin' }),
        ])
        const uploadsJson: any = await uploadsRes.json().catch(() => null)
        const projectsJson: any = await projectsRes.json().catch(() => null)
        if (!uploadsRes.ok) throw new Error(String(uploadsJson?.error || 'failed_to_load_exports'))
        if (!projectsRes.ok) throw new Error(String(projectsJson?.error || 'failed_to_load_projects'))

        const raw: UploadListItem[] = Array.isArray(uploadsJson) ? uploadsJson : Array.isArray(uploadsJson?.items) ? uploadsJson.items : []
        const items = raw
          .filter((u) => {
            const role = u.video_role ? String(u.video_role) : ''
            if (role === 'export') return true
            const key = String((u as any).s3_key || '')
            return key.includes('/renders/') || key.startsWith('renders/')
          })
          .slice()
          .sort((a, b) => Number(b.id) - Number(a.id))
        setExportsList(items)

        const projItems: ProjectListItem[] = Array.isArray(projectsJson?.items) ? projectsJson.items : []
        setProjects(projItems)
      } catch (e: any) {
        if (cancelled) return
        setError(e?.message || 'Failed to load exports')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Exports</h1>
          <p style={{ color: '#bbb' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Exports</h1>
          <p style={{ color: '#ff9b9b' }}>{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/create-video" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Back to Timeline
          </a>
          <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            Uploads
          </a>
        </div>

        <h1 style={{ margin: '12px 0 10px', fontSize: 28 }}>Exports</h1>
        <p style={{ margin: 0, color: '#bbb' }}>Rendered MP4s from Create Video. Send to HLS when ready.</p>

        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
          {exportsList.map((u) => {
            const projectId = u.create_video_project_id != null ? Number(u.create_video_project_id) : null
            const project = projectId != null ? projectsById.get(projectId) : undefined
            const title = u.modified_filename && String(u.modified_filename).trim() ? String(u.modified_filename) : project?.name ? String(project.name) : `Export #${u.id}`
            return (
              <div
                key={u.id}
                style={{
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.04)',
                  borderRadius: 12,
                  overflow: 'hidden',
                }}
              >
                <div style={{ position: 'relative', aspectRatio: '16 / 9', background: '#0b0b0b' }}>
                  <img
                    src={`/api/uploads/${encodeURIComponent(String(u.id))}/thumb`}
                    alt=""
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>

                <div style={{ padding: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>{title}</div>
                  <div style={{ color: '#9a9a9a', fontSize: 13 }}>
                    {String(u.created_at || '').slice(0, 10)} · {fmtSize(u.size_bytes)} · {fmtDuration(u.duration_seconds)}
                  </div>

                  <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ color: '#9a9a9a', fontSize: 13 }}>{projectId ? `Timeline #${projectId}` : ''}</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        disabled={!projectId}
                        onClick={() => {
                          if (!projectId) return
                          window.location.href = `/create-video?project=${encodeURIComponent(String(projectId))}`
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: '#0c0c0c',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: projectId ? 'pointer' : 'default',
                          opacity: projectId ? 1 : 0.5,
                        }}
                      >
                        Open Timeline
                      </button>
                      <button
                        type="button"
                        disabled={sendingId === u.id}
                        onClick={async () => {
                          if (!me?.userId) return
                          setSendingId(u.id)
                          try {
                            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                            const csrf = getCsrfToken()
                            if (csrf) headers['x-csrf-token'] = csrf
                            const res = await fetch('/api/productions', {
                              method: 'POST',
                              credentials: 'same-origin',
                              headers,
                              body: JSON.stringify({ uploadId: u.id, name: title }),
                            })
                            const json: any = await res.json().catch(() => null)
                            if (!res.ok) throw new Error(String(json?.error || json?.detail || 'failed_to_send'))
                            const productionId = Number(json?.production?.id)
                            window.location.href = Number.isFinite(productionId) && productionId > 0 ? `/productions?id=${encodeURIComponent(String(productionId))}` : '/productions'
                          } catch (e: any) {
                            window.alert(e?.message || 'Failed to start HLS')
                          } finally {
                            setSendingId(null)
                          }
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 10,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: '#0a84ff',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                          opacity: sendingId === u.id ? 0.7 : 1,
                        }}
                      >
                        Send to HLS
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
          {!exportsList.length ? <div style={{ color: '#bbb' }}>No exports yet.</div> : null}
        </div>
      </div>
    </div>
  )
}

