import React, { useCallback, useEffect, useMemo, useState } from 'react'

type UploadListItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description: string | null
  size_bytes: number | null
  duration_seconds?: number | null
  width: number | null
  height: number | null
  status: string
  kind?: 'video' | 'logo' | 'audio' | 'image' | string
  image_role?: string | null
  created_at: string
  uploaded_at: string | null
  source_deleted_at?: string | null
  s3_key?: string | null
  video_role?: string | null
  poster_portrait_cdn?: string
  poster_landscape_cdn?: string
  poster_cdn?: string
  poster_portrait_s3?: string
  poster_landscape_s3?: string
  poster_s3?: string
}

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return ''
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatDate(input: string | null): string {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return d.toISOString().slice(0, 10)
}

function formatDuration(seconds: number | null | undefined): string {
  const s = seconds == null ? 0 : Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return ''
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

function pickPoster(u: UploadListItem): string | undefined {
  return (
    u.poster_portrait_cdn ||
    u.poster_landscape_cdn ||
    u.poster_cdn ||
    u.poster_portrait_s3 ||
    u.poster_landscape_s3 ||
    u.poster_s3
  )
}

function buildUploadThumbUrl(uploadId: number): string {
  return `/api/uploads/${encodeURIComponent(String(uploadId))}/thumb`
}

function isSourceVideoUpload(u: UploadListItem): boolean {
  const role = u.video_role ? String(u.video_role) : ''
  if (role === 'source') return true
  if (role === 'export') return false
  const key = u.s3_key ? String(u.s3_key) : ''
  if (key.includes('/renders/') || key.startsWith('renders/')) return false
  return true
}

const VideoThumb: React.FC<{
  uploadId: number
  fallbackSrc?: string
  alt: string
  style: React.CSSProperties
}> = ({ uploadId, fallbackSrc, alt, style }) => {
  const [src, setSrc] = useState<string | null>(() => buildUploadThumbUrl(uploadId))
  useEffect(() => {
    setSrc(buildUploadThumbUrl(uploadId))
  }, [uploadId])

  if (!src) {
    return <div style={{ ...style, background: '#111' }} />
  }

  return (
    <img
      src={src}
      alt={alt}
      style={style}
      onError={() => {
        if (fallbackSrc && src !== fallbackSrc) setSrc(fallbackSrc)
        else setSrc(null)
      }}
    />
  )
}

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('not_authenticated')
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
}

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

const UploadsPage: React.FC = () => {
  const kind = useMemo(() => {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('kind') || '').toLowerCase()
    return raw === 'logo' ? 'logo' : raw === 'image' ? 'image' : 'video'
  }, [])

  const imageRole = useMemo(() => {
    try {
      const params = new URLSearchParams(window.location.search)
      const raw = String(params.get('image_role') || params.get('imageRole') || '').trim().toLowerCase()
      if (raw) return raw
    } catch {}
    return kind === 'image' ? 'title_page' : null
  }, [kind])

  const [me, setMe] = useState<MeResponse | null>(null)
  const [uploads, setUploads] = useState<UploadListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Record<number, boolean>>({})

  const [editUpload, setEditUpload] = useState<UploadListItem | null>(null)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const loadUploads = useCallback(
    async (userId: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          limit: '200',
          user_id: String(userId),
          include_productions: '0',
          kind,
        })
        if (kind === 'image' && imageRole) params.set('image_role', imageRole)
        const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('failed_to_fetch_uploads')
        const data = (await res.json()) as UploadListItem[]
        const items = Array.isArray(data) ? data : []
        const visible =
          kind === 'video'
            ? items.filter((u) => !u.source_deleted_at && isSourceVideoUpload(u))
            : items
        setUploads(visible)
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load uploads')
      } finally {
        setLoading(false)
      }
    },
    [kind, imageRole]
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const user = await ensureLoggedIn()
      if (cancelled) return
      setMe(user)
      if (user && user.userId) {
        await loadUploads(user.userId)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadUploads])

  const title = useMemo(() => {
    if (kind === 'video') return 'My Videos'
    if (kind === 'logo') return 'My Logos'
    if (imageRole === 'lower_third') return 'My Lower Third Images'
    if (imageRole === 'overlay') return 'My Overlay Images'
    if (imageRole === 'title_page') return 'My Title Pages'
    return 'My Images'
  }, [imageRole, kind])

  const subtitle = useMemo(() => {
    if (kind === 'video') return 'Raw uploaded video assets (source inputs only).'
    if (kind === 'logo') return 'Upload logos to use as watermarks in videos.'
    if (imageRole === 'lower_third') return 'Upload PNG lower third images to overlay on your videos.'
    if (imageRole === 'overlay') return 'Upload images to insert as full-screen overlays in Create Video.'
    if (imageRole === 'title_page') return 'Upload title page images for use in Create Video.'
    return 'Upload images for use in Create Video.'
  }, [imageRole, kind])

  if (me === null) {
    return (
      <div style={{ color: '#fff', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h2>Uploads</h2>
        <p>
          Please <a href="/login" style={{ color: '#0a84ff' }}>sign in</a> to view your uploads.
        </p>
      </div>
    )
  }

  const uploadNewHref =
    kind === 'video'
      ? '/uploads/new?kind=video'
      : kind === 'image'
        ? `/uploads/new?kind=image&image_role=${encodeURIComponent(String(imageRole || 'title_page'))}`
        : `/uploads/new?kind=${encodeURIComponent(String(kind))}`

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            { label: 'Videos', kind: 'video' },
            { label: 'Logos', kind: 'logo' },
            { label: 'Title Pages', kind: 'image', image_role: 'title_page' },
            { label: 'Lower Third Images', kind: 'image', image_role: 'lower_third' },
            { label: 'Overlay Images', kind: 'image', image_role: 'overlay' },
          ].map((t: any) => {
            const active = kind === t.kind && (t.kind !== 'image' || String(imageRole || '') === String(t.image_role || 'title_page'))
            const href =
              t.kind === 'video'
                ? '/uploads'
                : t.kind === 'image'
                  ? `/uploads?kind=image&image_role=${encodeURIComponent(String(t.image_role || 'title_page'))}`
                  : `/uploads?kind=${encodeURIComponent(String(t.kind))}`
            return (
              <a
                key={`${t.kind}:${t.image_role || ''}`}
                href={href}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: active ? '1px solid rgba(10,132,255,0.75)' : '1px solid rgba(255,255,255,0.16)',
                  background: active ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.04)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: 650,
                }}
              >
                {t.label}
              </a>
            )
          })}
        </div>

        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
            <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>{subtitle}</p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a
              href={uploadNewHref}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '10px 18px',
                borderRadius: 10,
                border: '1px solid rgba(10,132,255,0.55)',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 650,
                background: '#0a84ff',
              }}
            >
              Upload
            </a>
            {kind === 'video' ? (
              <>
                <a
                  href="/create-video"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 18px',
                    borderRadius: 10,
                    border: '1px solid rgba(212,175,55,0.65)',
                    color: '#fff',
                    textDecoration: 'none',
                    fontWeight: 650,
                    background: 'rgba(212,175,55,0.10)',
                  }}
                >
                  Create Video
                </a>
                <a
                  href="/exports"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '10px 18px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.2)',
                    color: '#fff',
                    textDecoration: 'none',
                    fontWeight: 600,
                    background: 'rgba(255,255,255,0.06)',
                  }}
                >
                  Exports
                </a>
              </>
            ) : null}
          </div>
        </header>

        <div
          style={{
            marginBottom: 16,
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.16)',
            background: 'rgba(255,255,255,0.06)',
            color: '#cfd6e3',
            fontSize: 13,
            lineHeight: 1.4,
          }}
        >
          Browsing uploads has moved to <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 800 }}>Assets</a>. Upload links
          still work here.
        </div>

        {loading ? (
          <div style={{ color: '#888', padding: '12px 0' }}>Loading…</div>
        ) : error ? (
          <div style={{ color: '#ff6b6b', padding: '12px 0' }}>{error}</div>
        ) : deleteError ? (
          <div style={{ color: '#ff9b9b', padding: '12px 0' }}>{deleteError}</div>
        ) : uploads.length === 0 ? (
          <div style={{ color: '#bbb', padding: '12px 0' }}>
            {kind === 'video'
              ? 'No videos yet. Upload your first video.'
              : kind === 'logo'
                ? 'No logos yet.'
                : 'No images yet.'}
          </div>
        ) : kind === 'video' ? (
          <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {uploads.map((upload) => {
              const poster = pickPoster(upload)
              const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
              const description = upload.description && upload.description.trim().length > 0 ? upload.description.trim() : null
              const date = formatDate(upload.created_at)
              const size = formatBytes(upload.size_bytes)
              const duration = formatDuration(upload.duration_seconds)
              const aspectRatio = upload.width && upload.height ? `${upload.width} / ${upload.height}` : '9 / 16'
              const meta = [date, size, duration].filter(Boolean).join(' · ')
              return (
                <div
                  key={upload.id}
                  style={{
                    borderRadius: 16,
                    border: '1px solid rgba(255,255,255,0.22)',
                    background: 'rgba(255,255,255,0.03)',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ width: '100%', position: 'relative', aspectRatio, background: '#111' }}>
                    <VideoThumb
                      uploadId={upload.id}
                      fallbackSrc={poster}
                      alt="poster"
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', display: 'block', background: '#111' }}
                    />
                  </div>
                  <div style={{ padding: 12, display: 'grid', gap: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 900, lineHeight: 1.2, wordBreak: 'break-word' }}>{displayName}</div>
                        {description ? (
                          <div style={{ marginTop: 4, color: '#bbb', fontSize: 13, lineHeight: 1.35, whiteSpace: 'pre-wrap' }}>{description}</div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditError(null)
                          setEditUpload(upload)
                          setEditName((upload.modified_filename || upload.original_filename || '').trim())
                          setEditDescription((upload.description || '').trim())
                        }}
                        style={{
                          flex: '0 0 auto',
                          padding: '8px 10px',
                          borderRadius: 10,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: 'rgba(10,132,255,0.16)',
                          color: '#fff',
                          fontWeight: 800,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                    </div>
                    {meta ? <div style={{ color: '#9a9a9a', fontSize: 13 }}>{meta}</div> : null}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div style={{ background: '#080808', borderRadius: 16, border: '1px solid #161616', overflow: 'hidden' }}>
            {uploads.map((upload) => {
              const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
              const description = upload.description && upload.description.trim().length > 0 ? upload.description.trim() : null
              const date = formatDate(upload.created_at)
              const size = formatBytes(upload.size_bytes)
              const dimensions = upload.width && upload.height ? `${upload.width}×${upload.height}` : null
              const metaLine = [date, size, dimensions].filter(Boolean).join(' / ')
              const isDeleting = !!deleting[upload.id]
              const fileHref = `/api/uploads/${encodeURIComponent(String(upload.id))}/file`
              return (
                <div
                  key={upload.id}
                  style={{
                    display: 'flex',
                    gap: 16,
                    padding: '16px 12px',
                    borderBottom: '1px solid #191919',
                    flexWrap: 'wrap',
                    alignItems: 'flex-start',
                  }}
                >
                  <div style={{ flex: '0 0 auto' }}>
                    <img
                      src={fileHref}
                      alt={kind === 'logo' ? 'logo' : 'image'}
                      style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, background: '#111' }}
                    />
                  </div>
                  <div style={{ flex: '1 1 240px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6, wordBreak: 'break-word' }}>
                    <div style={{ color: '#fff', fontWeight: 800, lineHeight: 1.3 }}>{displayName}</div>
                    {description ? <div style={{ color: '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>{description}</div> : null}
                    {metaLine ? <div style={{ color: '#666', lineHeight: 1.35 }}>{metaLine}</div> : null}
                    <div style={{ marginTop: 6, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setEditError(null)
                          setEditUpload(upload)
                          setEditName((upload.modified_filename || upload.original_filename || '').trim())
                          setEditDescription((upload.description || '').trim())
                        }}
                        style={{
                          background: 'transparent',
                          color: '#0a84ff',
                          border: '1px solid rgba(10,132,255,0.55)',
                          borderRadius: 10,
                          padding: '6px 10px',
                          fontWeight: 650,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={async (e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (isDeleting) return
                          const ok = window.confirm(kind === 'logo' ? 'Delete this logo? This cannot be undone.' : 'Delete this image? This cannot be undone.')
                          if (!ok) return
                          setDeleteError(null)
                          setDeleting((prev) => ({ ...prev, [upload.id]: true }))
                          try {
                            const headers: Record<string, string> = {}
                            const csrf = getCsrfToken()
                            if (csrf) headers['x-csrf-token'] = csrf
                            const res = await fetch(`/api/uploads/${upload.id}`, { method: 'DELETE', credentials: 'same-origin', headers })
                            const data = await res.json().catch(() => ({}))
                            if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to delete')
                            setUploads((prev) => prev.filter((u) => u.id !== upload.id))
                          } catch (err: any) {
                            setDeleteError(err?.message || 'Failed to delete')
                          } finally {
                            setDeleting((prev) => {
                              const next = { ...prev }
                              delete next[upload.id]
                              return next
                            })
                          }
                        }}
                        style={{
                          background: 'transparent',
                          color: '#ff9b9b',
                          border: '1px solid rgba(255,155,155,0.35)',
                          borderRadius: 10,
                          padding: '6px 10px',
                          fontWeight: 650,
                          cursor: isDeleting ? 'default' : 'pointer',
                          opacity: isDeleting ? 0.6 : 1,
                        }}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {editUpload ? (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0,0,0,0.65)',
              zIndex: 10050,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
            onClick={() => {
              if (editSaving) return
              setEditUpload(null)
            }}
          >
            <div
              style={{
                width: 'min(720px, 100%)',
                borderRadius: 16,
                background: '#0b0b0b',
                border: '1px solid rgba(255,255,255,0.14)',
                padding: 16,
                color: '#fff',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 800 }}>Edit</div>
                <button
                  type="button"
                  onClick={() => setEditUpload(null)}
                  disabled={editSaving}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0c0c0c',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: editSaving ? 'default' : 'pointer',
                    opacity: editSaving ? 0.6 : 1,
                  }}
                >
                  ✕
                </button>
              </div>

              <div style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 700 }}>Name</div>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                    }}
                    maxLength={512}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 700 }}>Description</div>
                  <textarea
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      minHeight: 120,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                      resize: 'vertical',
                    }}
                    maxLength={2000}
                  />
                </label>

                {editError ? <div style={{ color: '#ff9b9b' }}>{editError}</div> : null}

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={() => setEditUpload(null)}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: '#0c0c0c',
                      color: '#fff',
                      fontWeight: 800,
                      cursor: editSaving ? 'default' : 'pointer',
                      opacity: editSaving ? 0.6 : 1,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={editSaving}
                    onClick={async () => {
                      if (!editUpload) return
                      const name = editName.trim()
                      if (!name) {
                        setEditError('Name is required')
                        return
                      }
                      setEditSaving(true)
                      setEditError(null)
                      try {
                        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                        const csrf = getCsrfToken()
                        if (csrf) headers['x-csrf-token'] = csrf
                        const res = await fetch(`/api/uploads/${editUpload.id}`, {
                          method: 'PATCH',
                          credentials: 'same-origin',
                          headers,
                          body: JSON.stringify({ name, description: editDescription }),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to save')
                        setUploads((prev) =>
                          prev.map((u) =>
                            u.id === editUpload.id
                              ? { ...u, modified_filename: name, description: editDescription }
                              : u
                          )
                        )
                        setEditUpload(null)
                      } catch (err: any) {
                        setEditError(err?.message || 'Failed to save changes')
                      } finally {
                        setEditSaving(false)
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(10,132,255,0.55)',
                      background: '#0a84ff',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: editSaving ? 'default' : 'pointer',
                      opacity: editSaving ? 0.7 : 1,
                    }}
                  >
                    {editSaving ? 'Saving…' : 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default UploadsPage
