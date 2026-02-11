import React, { useEffect, useMemo, useState } from 'react'
import listCardBgImage from './images/list_bg.png'
import './styles/card-list.css'
import { cardThemeStyle, cardThemeTokens, mergeCardThemeVars } from './styles/cardThemes'

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

type UploadImageOption = {
  id: number
  name: string
  width: number | null
  height: number | null
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

function normalizeHexColor(value: unknown, fallback = '#000000'): string {
  const raw = String(value || '').trim()
  const m = raw.match(/^#?([0-9a-fA-F]{6})$/)
  return m ? `#${m[1].toLowerCase()}` : fallback
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
  const returnBase = useMemo(() => {
    try {
      const qp = new URLSearchParams(window.location.search || '')
      const raw = String(qp.get('return') || '').trim()
      if (!raw) return null
      if (!raw.startsWith('/')) return null
      return raw
    } catch {
      return null
    }
  }, [])

  const buildReturnHref = (base: string, projectId: number) => {
    try {
      const url = new URL(base, window.location.origin)
      url.searchParams.set('project', String(projectId))
      return `${url.pathname}${url.search}${url.hash || ''}`
    } catch {
      return `/create-video?project=${encodeURIComponent(String(projectId))}`
    }
  }

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<ProjectListItem[]>([])

  const activeItems = useMemo(() => items.filter((p) => p.archivedAt == null), [items])
  const timelineCardListStyle = useMemo(
    () =>
      cardThemeStyle(
        mergeCardThemeVars(cardThemeTokens.base, cardThemeTokens.timelines, {
          '--card-bg-image': `url(${listCardBgImage})`,
        })
      ),
    []
  )
  const timelineCardTypeStyle = useMemo(
    () => cardThemeStyle(mergeCardThemeVars(cardThemeTokens.byType.timeline)),
    []
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [createDefaultName, setCreateDefaultName] = useState(() => fmtDefaultTimelineName())
  const [createName, setCreateName] = useState(() => fmtDefaultTimelineName())
  const [createDescription, setCreateDescription] = useState('')
  const [editOpen, setEditOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editTimelineLoading, setEditTimelineLoading] = useState(false)
  const [editTimelineError, setEditTimelineError] = useState<string | null>(null)
  const [editTimelineRaw, setEditTimelineRaw] = useState<any | null>(null)
  const [editTimelineBackgroundMode, setEditTimelineBackgroundMode] = useState<'none' | 'color' | 'image'>('none')
  const [editTimelineBackgroundColor, setEditTimelineBackgroundColor] = useState('#000000')
  const [editTimelineBackgroundUploadId, setEditTimelineBackgroundUploadId] = useState<number | null>(null)
  const [editImageOptions, setEditImageOptions] = useState<UploadImageOption[]>([])
  const [editImageOptionsLoading, setEditImageOptionsLoading] = useState(false)
  const [editImageOptionsError, setEditImageOptionsError] = useState<string | null>(null)
  const [pendingTimelineBackgroundPick, setPendingTimelineBackgroundPick] = useState<{ timelineId: number; uploadId: number } | null>(null)

  const selectedEditImage = useMemo(
    () => (editTimelineBackgroundUploadId == null ? null : editImageOptions.find((it) => Number(it.id) === Number(editTimelineBackgroundUploadId)) || null),
    [editImageOptions, editTimelineBackgroundUploadId]
  )

  const pickFromAssets = useMemo(() => {
    try {
      const qp = new URLSearchParams(window.location.search || '')
      const type = String(qp.get('cvPickType') || '').trim()
      if (!type) return null
      const uploadId = Number(String(qp.get('cvPickUploadId') || '0'))
      const timelineId = Number(String(qp.get('tlEditId') || '0'))
      return {
        type,
        uploadId: Number.isFinite(uploadId) && uploadId > 0 ? Math.round(uploadId) : null,
        timelineId: Number.isFinite(timelineId) && timelineId > 0 ? Math.round(timelineId) : null,
      }
    } catch {
      return null
    }
  }, [])

  const openTimelineBackgroundPicker = React.useCallback(() => {
    if (!editId) return
    try {
      const current = new URL(window.location.href)
      current.searchParams.set('tlEditId', String(editId))
      current.searchParams.delete('cvPickType')
      current.searchParams.delete('cvPickUploadId')
      const ret = `${current.pathname}${current.search}${current.hash || ''}`
      const u = new URL('/assets/graphic', window.location.origin)
      u.searchParams.set('mode', 'pick')
      u.searchParams.set('pickType', 'timelineBackground')
      u.searchParams.set('return', ret)
      window.location.href = `${u.pathname}${u.search}`
    } catch {
      window.location.href = `/assets/graphic?mode=pick&pickType=timelineBackground&return=${encodeURIComponent(`/timelines?tlEditId=${editId}`)}`
    }
  }, [editId])

  const handledPickFromAssetsRef = React.useRef(false)
  useEffect(() => {
    if (handledPickFromAssetsRef.current) return
    if (!pickFromAssets) return
    if (loading) return
    handledPickFromAssetsRef.current = true

    const cleanUrl = () => {
      try {
        const url = new URL(window.location.href)
        url.searchParams.delete('cvPickType')
        url.searchParams.delete('cvPickUploadId')
        window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash || ''}`)
      } catch {}
    }

    if (pickFromAssets.type === 'timelineBackground' && pickFromAssets.uploadId && pickFromAssets.timelineId) {
      setPendingTimelineBackgroundPick({
        timelineId: pickFromAssets.timelineId,
        uploadId: pickFromAssets.uploadId,
      })
      openEdit(pickFromAssets.timelineId)
    }
    cleanUrl()
  }, [loading, pickFromAssets, items])

  useEffect(() => {
    if (!pendingTimelineBackgroundPick) return
    if (!editOpen) return
    if (!editId || Number(editId) !== Number(pendingTimelineBackgroundPick.timelineId)) return
    if (editTimelineLoading) return
    if (!editTimelineRaw || typeof editTimelineRaw !== 'object') return

    setEditTimelineBackgroundMode('image')
    setEditTimelineBackgroundUploadId(Number(pendingTimelineBackgroundPick.uploadId))
    void hydrateEditSelectedImage(Number(pendingTimelineBackgroundPick.uploadId))
    void loadEditImageOptions(false)
    setPendingTimelineBackgroundPick(null)
  }, [pendingTimelineBackgroundPick, editOpen, editId, editTimelineLoading, editTimelineRaw, editImageOptions])

  async function loadEditImageOptions(force = false) {
    if (editImageOptionsLoading) return
    if (!force && editImageOptions.length > 0) return
    try {
      setEditImageOptionsLoading(true)
      setEditImageOptionsError(null)
      const res = await fetch('/api/uploads?kind=image&image_role=overlay&limit=200', { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load_images'))
      const rawItems: any[] = Array.isArray(json?.items) ? json.items : Array.isArray(json?.uploads) ? json.uploads : Array.isArray(json) ? json : []
      const next: UploadImageOption[] = []
      for (const raw of rawItems) {
        const id = Number((raw as any)?.id)
        if (!Number.isFinite(id) || id <= 0) continue
        const name = String((raw as any)?.modified_filename || (raw as any)?.original_filename || `Image ${id}`).trim() || `Image ${id}`
        const width = Number((raw as any)?.width)
        const height = Number((raw as any)?.height)
        next.push({
          id,
          name,
          width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
          height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
        })
      }
      next.sort((a, b) => a.name.localeCompare(b.name))
      setEditImageOptions(next)
    } catch (e: any) {
      setEditImageOptionsError(e?.message || 'Failed to load images')
    } finally {
      setEditImageOptionsLoading(false)
    }
  }

  async function hydrateEditSelectedImage(uploadId: number) {
    try {
      if (editImageOptions.some((it) => Number(it.id) === Number(uploadId))) return
      const res = await fetch(`/api/uploads/${encodeURIComponent(String(uploadId))}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) return
      const up = json?.upload && typeof json.upload === 'object' ? json.upload : json
      const id = Number((up as any)?.id)
      if (!Number.isFinite(id) || id <= 0) return
      const name = String((up as any)?.modified_filename || (up as any)?.original_filename || `Image ${id}`).trim() || `Image ${id}`
      const width = Number((up as any)?.width)
      const height = Number((up as any)?.height)
      setEditImageOptions((prev) => {
        if (prev.some((it) => Number(it.id) === id)) return prev
        return prev.concat({
          id,
          name,
          width: Number.isFinite(width) && width > 0 ? Math.round(width) : null,
          height: Number.isFinite(height) && height > 0 ? Math.round(height) : null,
        })
      })
    } catch {}
  }

  async function loadEditTimeline(projectId: number) {
    try {
      setEditTimelineLoading(true)
      setEditTimelineError(null)
      const res = await fetch(`/api/create-video/projects/${encodeURIComponent(String(projectId))}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load_timeline'))
      const project = json?.project && typeof json.project === 'object' ? json.project : null
      const tl = project?.timeline && typeof project.timeline === 'object' ? project.timeline : null
      setEditTimelineRaw(tl)
      const modeRaw = String((tl as any)?.timelineBackgroundMode || 'none').trim().toLowerCase()
      const mode: 'none' | 'color' | 'image' = modeRaw === 'color' ? 'color' : modeRaw === 'image' ? 'image' : 'none'
      const uploadIdRaw = Number((tl as any)?.timelineBackgroundUploadId)
      const uploadId = Number.isFinite(uploadIdRaw) && uploadIdRaw > 0 ? Math.round(uploadIdRaw) : null
      setEditTimelineBackgroundMode(mode)
      setEditTimelineBackgroundColor(normalizeHexColor((tl as any)?.timelineBackgroundColor, '#000000'))
      setEditTimelineBackgroundUploadId(uploadId)
      if (uploadId != null) void hydrateEditSelectedImage(uploadId)
    } catch (e: any) {
      setEditTimelineError(e?.message || 'Failed to load timeline settings')
      setEditTimelineRaw(null)
      setEditTimelineBackgroundMode('none')
      setEditTimelineBackgroundColor('#000000')
      setEditTimelineBackgroundUploadId(null)
    } finally {
      setEditTimelineLoading(false)
    }
  }

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
    setEditSaving(false)
    setEditTimelineError(null)
    setEditTimelineRaw(null)
    setEditTimelineBackgroundMode('none')
    setEditTimelineBackgroundColor('#000000')
    setEditTimelineBackgroundUploadId(null)
    setEditOpen(true)
    void loadEditTimeline(Number(current.id))
    void loadEditImageOptions(false)
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
        window.location.href = returnBase ? buildReturnHref(returnBase, id) : `/create-video?project=${encodeURIComponent(String(id))}`
      } else {
        await refresh()
      }
    } catch (e: any) {
      window.alert(e?.message || 'Failed to create timeline')
    }
  }

  async function saveEdit() {
    if (!editId || editSaving) return
    try {
      setEditSaving(true)
      const name = String(editName || '').trim()
      const description = String(editDescription || '').trim()
      if (!name) {
        window.alert('Name is required')
        setEditSaving(false)
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
      if (editTimelineRaw && typeof editTimelineRaw === 'object') {
        const mode: 'none' | 'color' | 'image' =
          editTimelineBackgroundMode === 'image' && editTimelineBackgroundUploadId == null
            ? 'none'
            : editTimelineBackgroundMode === 'color'
              ? 'color'
              : editTimelineBackgroundMode === 'image'
                ? 'image'
                : 'none'
        const nextTimeline = {
          ...(editTimelineRaw as any),
          timelineBackgroundMode: mode,
          timelineBackgroundColor: normalizeHexColor(editTimelineBackgroundColor, '#000000'),
          timelineBackgroundUploadId: mode === 'image' ? Number(editTimelineBackgroundUploadId) : null,
        }
        const tlRes = await fetch(`/api/create-video/projects/${encodeURIComponent(String(editId))}/timeline`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ timeline: nextTimeline }),
        })
        const tlJson: any = await tlRes.json().catch(() => null)
        if (!tlRes.ok) throw new Error(String(tlJson?.error || 'failed_to_save_timeline'))
      }
      setItems((prev) =>
        prev.map((p) => (Number(p.id) === Number(editId) ? { ...p, name, description: description || null } : p))
      )
      setEditOpen(false)
    } catch (e: any) {
      window.alert(e?.message || 'Failed to save timeline')
    } finally {
      setEditSaving(false)
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

        <div className="card-list" style={{ ...timelineCardListStyle, marginTop: 16 }}>
          {activeItems.map((p) => {
            const title = (p.name || '').trim() || `Timeline #${p.id}`
            return (
              <div
                key={p.id}
                className="card-item"
                data-card-type="timeline"
                style={timelineCardTypeStyle}
              >
                <div className="card-main">
                  <div className="card-head">
                    <div className="card-title">{title}</div>
                    <div className="card-meta">
                      Updated: {fmtDate(p.updatedAt)} • Created: {fmtDate(p.createdAt)}
                    </div>
                  </div>

                  <div className="card-actions card-actions-right card-actions-scroll">
                    <button
                      className="card-btn card-btn-open"
                      type="button"
                      onClick={() => {
                        const pid = Number(p.id)
                        if (!Number.isFinite(pid) || pid <= 0) return
                        window.location.href = returnBase
                          ? buildReturnHref(returnBase, pid)
                          : `/create-video?project=${encodeURIComponent(String(pid))}`
                      }}
                    >
                      Open
                    </button>
                    <button
                      className="card-btn card-btn-edit"
                      type="button"
                      onClick={() => openEdit(p.id)}
                    >
                      Edit
                    </button>
                    <button
                      className="card-btn card-btn-delete"
                      type="button"
                      onClick={() => deleteTimeline(p.id)}
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
            zIndex: 1100,
            background: 'rgba(0,0,0,0.86)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: '64px 16px 80px',
          }}
          onClick={() => setEditOpen(false)}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 560,
              margin: '0 auto',
              borderRadius: 14,
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
              padding: 16,
              boxSizing: 'border-box',
              color: '#fff',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
              <div style={{ fontWeight: 900, fontSize: 18 }}>Timeline Properties</div>
              <button
                type="button"
                onClick={() => setEditOpen(false)}
                style={{
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  borderRadius: 10,
                  padding: '6px 10px',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
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
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0b0b0b',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 900,
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
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0b0b0b',
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 900,
                    resize: 'vertical',
                  }}
                />
              </div>

              <div style={{ border: '1px solid rgba(96,165,250,0.35)', borderRadius: 12, padding: 10, background: 'rgba(255,255,255,0.03)' }}>
                <div style={{ fontSize: 13, color: '#bbb', marginBottom: 8, fontWeight: 900 }}>Timeline Background</div>
                {editTimelineLoading ? <div style={{ color: '#bbb', fontSize: 13, marginBottom: 8 }}>Loading timeline settings…</div> : null}
                {editTimelineError ? <div style={{ color: '#ff9b9b', fontSize: 13, marginBottom: 8 }}>{editTimelineError}</div> : null}
                <div style={{ display: 'grid', gap: 8 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontSize: 13 }}>Mode</div>
                    <select
                      value={editTimelineBackgroundMode}
                      onChange={(e) => {
                        const mode = String(e.target.value || 'none').trim().toLowerCase()
                        setEditTimelineBackgroundMode(mode === 'color' ? 'color' : mode === 'image' ? 'image' : 'none')
                      }}
                      disabled={editTimelineLoading}
                      style={{
                        width: '100%',
                        maxWidth: '100%',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0b0b0b',
                        color: '#fff',
                        padding: '10px 12px',
                        fontSize: 14,
                        fontWeight: 900,
                        boxSizing: 'border-box',
                      }}
                    >
                      <option value="none">None (Black)</option>
                      <option value="color">Color</option>
                      <option value="image">Image</option>
                    </select>
                  </label>

                  {editTimelineBackgroundMode === 'color' ? (
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Color</div>
                      <input
                        type="color"
                        value={editTimelineBackgroundColor}
                        onChange={(e) => setEditTimelineBackgroundColor(normalizeHexColor(e.target.value, '#000000'))}
                        disabled={editTimelineLoading}
                        style={{
                          width: '100%',
                          height: 40,
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: 'transparent',
                          padding: 0,
                          cursor: 'pointer',
                        }}
                      />
                    </label>
                  ) : null}

                  {editTimelineBackgroundMode === 'image' ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Image</div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'end' }}>
                        <select
                          value={editTimelineBackgroundUploadId != null ? String(editTimelineBackgroundUploadId) : ''}
                          onChange={(e) => {
                            const raw = Number(e.target.value)
                            setEditTimelineBackgroundUploadId(Number.isFinite(raw) && raw > 0 ? Math.round(raw) : null)
                          }}
                          disabled={editTimelineLoading}
                          style={{
                            width: '100%',
                            maxWidth: '100%',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: '#0b0b0b',
                            color: '#fff',
                            padding: '10px 12px',
                            fontSize: 14,
                            fontWeight: 900,
                            boxSizing: 'border-box',
                          }}
                        >
                          <option value="">No image selected</option>
                          {editTimelineBackgroundUploadId != null && !selectedEditImage ? (
                            <option value={String(editTimelineBackgroundUploadId)}>Image #{editTimelineBackgroundUploadId}</option>
                          ) : null}
                          {editImageOptions.map((it) => (
                            <option key={it.id} value={String(it.id)}>
                              {it.name}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => void loadEditImageOptions(true)}
                          disabled={editImageOptionsLoading || editTimelineLoading}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: 'rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontWeight: 800,
                            cursor: editImageOptionsLoading || editTimelineLoading ? 'default' : 'pointer',
                          }}
                        >
                          {editImageOptionsLoading ? 'Loading…' : 'Refresh'}
                        </button>
                      </div>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          onClick={openTimelineBackgroundPicker}
                          disabled={editTimelineLoading}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(96,165,250,0.95)',
                            background: 'rgba(96,165,250,0.14)',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: editTimelineLoading ? 'default' : 'pointer',
                          }}
                        >
                          Pick Image
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditTimelineBackgroundUploadId(null)}
                          disabled={editTimelineLoading}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 10,
                            border: '1px solid rgba(255,255,255,0.18)',
                            background: 'rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontWeight: 800,
                            cursor: editTimelineLoading ? 'default' : 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      </div>
                      {editImageOptionsError ? <div style={{ color: '#ff9b9b', fontSize: 12 }}>{editImageOptionsError}</div> : null}
                      {selectedEditImage ? (
                        <div style={{ color: '#9aa3ad', fontSize: 12 }}>
                          {selectedEditImage.name}
                          {selectedEditImage.width && selectedEditImage.height ? ` • ${selectedEditImage.width}x${selectedEditImage.height}` : ''}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12 }}>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={editSaving || editTimelineLoading}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: '1px solid rgba(96,165,250,0.95)',
                  background: editSaving ? 'rgba(96,165,250,0.08)' : 'rgba(96,165,250,0.14)',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: editSaving || editTimelineLoading ? 'default' : 'pointer',
                }}
              >
                {editSaving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
