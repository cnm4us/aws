import React, { useCallback, useEffect, useMemo, useState } from 'react'

type PublicationSummary = {
  spaceId: number
  spaceName: string
  spaceType: 'personal' | 'group' | 'channel' | string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
}

type UploadListItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description: string | null
  size_bytes: number | null
  width: number | null
  height: number | null
  status: string
  kind?: 'video' | 'logo' | 'image' | string
  image_role?: string | null
  created_at: string
  uploaded_at: string | null
  source_deleted_at?: string | null
  poster_portrait_cdn?: string
  poster_landscape_cdn?: string
  poster_cdn?: string
  poster_portrait_s3?: string
  poster_landscape_s3?: string
  poster_s3?: string
  publications?: PublicationSummary[]
}

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type SpaceBuckets = {
  personal: PublicationSummary[]
  groups: PublicationSummary[]
  channels: PublicationSummary[]
  other: PublicationSummary[]
}

function formatBytes(bytes: number | null): string {
  if (!bytes && bytes !== 0) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
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

function partitionPublications(list: PublicationSummary[] | undefined): SpaceBuckets {
  const buckets: SpaceBuckets = { personal: [], groups: [], channels: [], other: [] }
  if (!Array.isArray(list)) return buckets
  for (const item of list) {
    const status = item.status
    if (status === 'unpublished' || status === 'rejected') continue
    const type = item.spaceType
    if (type === 'personal') buckets.personal.push(item)
    else if (type === 'group') buckets.groups.push(item)
    else if (type === 'channel') buckets.channels.push(item)
    else buckets.other.push(item)
  }
  return buckets
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
  const [deleting, setDeleting] = useState<Record<number, boolean>>({})
  const [deletingSource, setDeletingSource] = useState<Record<number, boolean>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)
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
	          limit: '100',
	          user_id: String(userId),
	          include_publications: kind === 'video' ? '1' : '0',
	          kind,
	        })
	        if (kind === 'image' && imageRole) params.set('image_role', imageRole)
	        const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
	        if (!res.ok) throw new Error('failed_to_fetch_uploads')
	        const data = (await res.json()) as UploadListItem[]
        const items = Array.isArray(data) ? data : []
        // Hide uploads whose source file was deleted (keeps DB rows + publications intact, but removes them from the "Uploads" view).
        setUploads(kind === 'video' ? items.filter((u) => !u.source_deleted_at) : items)
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

  const renderPublicationLines = useCallback((upload: UploadListItem) => {
    const buckets = partitionPublications(upload.publications)
    const nodes: React.ReactNode[] = []
    if (buckets.personal.length) {
      nodes.push(
        <div key="personal" style={{ color: '#888' }}>
          Personal Space
        </div>
      )
    }
    if (buckets.groups.length) {
      const names = buckets.groups.map((p) => p.spaceName || `Group ${p.spaceId}`)
      nodes.push(
        <div key="groups" style={{ color: '#888' }}>
          Groups: {names.join(', ')}
        </div>
      )
    }
    if (buckets.channels.length) {
      const names = buckets.channels.map((p) => p.spaceName || `Channel ${p.spaceId}`)
      nodes.push(
        <div key="channels" style={{ color: '#888' }}>
          Channels: {names.join(', ')}
        </div>
      )
    }
    if (buckets.other.length) {
      const names = buckets.other.map((p) => p.spaceName || `Space ${p.spaceId}`)
      nodes.push(
        <div key="other" style={{ color: '#888' }}>
          {names.join(', ')}
        </div>
      )
    }
    return nodes
  }, [])

	const uploadCards = useMemo(() => {
	    return uploads.map((upload) => {
	      const poster = pickPoster(upload)
	      const logoSrc = (kind === 'logo' || kind === 'image') ? `/api/uploads/${encodeURIComponent(String(upload.id))}/file` : null
	      const image =
	        kind === 'logo' || kind === 'image' ? (
	          <img
	            src={logoSrc as string}
            alt={kind === 'image' ? 'image' : 'logo'}
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, background: '#111' }}
          />
        ) : poster ? (
          <img
            src={poster}
            alt="poster"
            style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, background: '#111' }}
          />
        ) : (
          <div style={{ width: 96, height: 96, borderRadius: 8, background: '#1c1c1c' }} />
        )

      const productionHref = `/productions?upload=${encodeURIComponent(String(upload.id))}`
      const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
      const description = upload.description && upload.description.trim().length > 0 ? upload.description.trim() : null
      const date = formatDate(upload.created_at)
      const size = formatBytes(upload.size_bytes)
      const dimensions = upload.width && upload.height ? `${upload.width}×${upload.height}` : null
      const metaPieces = [date, size, dimensions].filter((value) => value && value.length)
      const metaLine = metaPieces.join(' / ')
	      const publicationLines = renderPublicationLines(upload)
	      const detailHref =
	        kind === 'video'
	          ? productionHref
	          : kind === 'logo' || kind === 'image'
	            ? logoSrc || '#'
	            : '#'
	      const isDeleting = !!deleting[upload.id]

	      if (kind === 'video') {
	        const href = productionHref
	        const sourceDeleted = !!upload.source_deleted_at
        const isDeletingSource = !!deletingSource[upload.id]
        const thumbHeightPx = 160
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
            <a href={href} style={{ display: 'block', textDecoration: 'none' }}>
              <VideoThumb
                uploadId={upload.id}
                fallbackSrc={poster}
                alt="poster"
                style={{ width: '100%', height: thumbHeightPx, objectFit: 'cover', display: 'block', background: '#111' }}
              />
            </a>
            <div style={{ padding: '12px 12px 14px' }}>
              <a
                href={href}
                style={{
                  color: '#fff',
                  fontWeight: 750,
                  textDecoration: 'none',
                  lineHeight: 1.25,
                  display: 'block',
                }}
              >
                {displayName}
              </a>
              {description && (
                <div style={{ marginTop: 6, color: '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                  {description}
                </div>
              )}
              {metaLine && (
                <div style={{ marginTop: 6, color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                  {metaLine}
                </div>
              )}
              {sourceDeleted ? (
                <div style={{ marginTop: 8, color: '#ff9b9b', fontSize: 13, lineHeight: 1.35 }}>
                  Source deleted (existing productions/publications still work).
                </div>
              ) : null}
              {publicationLines.length ? (
                <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                  {publicationLines}
                </div>
              ) : null}
              <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href={href}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: 'rgba(10,132,255,0.12)',
                    color: '#fff',
                    textDecoration: 'none',
                    fontWeight: 700,
                  }}
                >
                  View Productions
                </a>
                <button
                  type="button"
                  onClick={async () => {
                    if (sourceDeleted || isDeletingSource) return
                    const ok = window.confirm(
                      'Delete source video file?\n\nExisting productions and published videos will keep working, but you will NOT be able to create new productions from this upload.'
                    )
                    if (!ok) return
                    setDeleteError(null)
                    setDeletingSource((prev) => ({ ...prev, [upload.id]: true }))
                    try {
                      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                      const csrf = getCsrfToken()
                      if (csrf) headers['x-csrf-token'] = csrf
                      const res = await fetch(`/api/uploads/${upload.id}/delete-source`, {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers,
                        body: '{}',
                      })
                      const data = await res.json().catch(() => ({}))
                      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to delete source')
                      // Redirect to productions for this upload (so the user can still manage productions after the source is gone).
                      window.location.href = productionHref
                    } catch (err: any) {
                      setDeleteError(err?.message || 'Failed to delete source')
                    } finally {
                      setDeletingSource((prev) => {
                        const next = { ...prev }
                        delete next[upload.id]
                        return next
                      })
                    }
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: sourceDeleted ? '1px solid rgba(255,255,255,0.18)' : '1px solid rgba(255,155,155,0.35)',
                    background: sourceDeleted ? 'rgba(255,255,255,0.04)' : 'rgba(255,155,155,0.08)',
                    color: '#fff',
                    fontWeight: 700,
                    cursor: sourceDeleted || isDeletingSource ? 'default' : 'pointer',
                    opacity: sourceDeleted || isDeletingSource ? 0.6 : 1,
                  }}
                  disabled={sourceDeleted || isDeletingSource}
                >
                  {sourceDeleted ? 'Source Deleted' : isDeletingSource ? 'Deleting…' : 'Delete Source'}
                </button>
              </div>
            </div>
          </div>
        )
      }

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
          <div style={{ flex: '0 0 auto' }}>{image}</div>
          <div
            style={{
              flex: '1 1 240px',
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
              wordBreak: 'break-word',
            }}
          >
            <a
              href={detailHref}
              style={{ color: '#0a84ff', fontWeight: 600, textDecoration: 'none', lineHeight: 1.3 }}
            >
              {displayName}
            </a>
            {description && (
              <div style={{ color: '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                {description}
              </div>
            )}
            {metaLine && (
              <div style={{ color: '#666', lineHeight: 1.35 }}>
                {metaLine}
              </div>
            )}
            {kind === 'logo' || kind === 'image' ? (
              <div style={{ marginTop: 6 }}>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
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
            ) : null}
            {kind === 'video' && publicationLines.length > 0 && publicationLines}
          </div>
        </div>
      )
    })
  }, [uploads, renderPublicationLines, kind, deleting, deletingSource])

  if (me === null) {
    return (
      <div style={{ color: '#fff', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h2>Uploads</h2>
        <p>
          Please <a href="/login" style={{ color: '#0a84ff' }}>sign in</a> to view and publish your videos.
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
		        <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 80px' }}>
		        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
		          {[
		            { label: 'Videos', kind: 'video' },
		            { label: 'Logos', kind: 'logo' },
		            { label: 'Title Pages', kind: 'image', image_role: 'title_page' },
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

        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
		            <h1 style={{ margin: 0, fontSize: 28 }}>
		              {kind === 'video' ? 'My Videos' : kind === 'logo' ? 'My Logos' : 'My Title Pages'}
		            </h1>
	            <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>
		              {kind === 'video'
		                ? 'Upload new videos and manage where they’re published.'
		                : kind === 'logo'
		                  ? 'Upload logos to use as watermarks in future productions.'
		                  : 'Upload title page images to use as posters and optional intro holds.'}
		            </p>
		          </div>
		          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
	            <a
	              href={
	                kind === 'video'
	                  ? '/uploads/new'
	                  : kind === 'image'
	                    ? `/uploads/new?kind=image&imageRole=${encodeURIComponent(imageRole || 'title_page')}`
	                    : `/uploads/new?kind=${encodeURIComponent(kind)}`
	              }
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
                background: '#0a84ff',
                boxShadow: '0 6px 16px rgba(10,132,255,0.35)',
              }}
            >
              Upload
            </a>
            {kind === 'video' ? (
              <a
                href="/productions"
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
                View Productions
              </a>
            ) : null}
          </div>
        </header>

        {loading ? (
          <div style={{ color: '#888', padding: '12px 0' }}>Loading uploads…</div>
        ) : error ? (
          <div style={{ color: '#ff6b6b', padding: '12px 0' }}>{error}</div>
        ) : deleteError ? (
          <div style={{ color: '#ff9b9b', padding: '12px 0' }}>{deleteError}</div>
	        ) : uploads.length === 0 ? (
	          <div style={{ color: '#bbb', padding: '12px 0' }}>
	            {kind === 'video'
	              ? 'No videos yet. Get started by uploading your first video.'
	              : kind === 'logo'
	                ? 'No logos yet. Upload a logo to use as a watermark in future productions.'
	                : 'No title pages yet. Upload an image to use as a title page in productions.'}
	          </div>
	        ) : (
	          kind === 'video' ? (
	            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
	              {uploadCards}
	            </div>
          ) : (
            <div
              style={{
                background: '#080808',
                borderRadius: 16,
                border: '1px solid #161616',
                overflow: 'hidden',
              }}
            >
              {uploadCards}
            </div>
          )
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
                    rows={6}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                      resize: 'vertical',
                      lineHeight: 1.4,
                    }}
                    maxLength={2000}
                  />
                </label>

                {editError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{editError}</div> : null}

                <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setEditUpload(null)}
                    disabled={editSaving}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: '#0c0c0c',
                      color: '#fff',
                      fontWeight: 700,
                      cursor: editSaving ? 'default' : 'pointer',
                      opacity: editSaving ? 0.6 : 1,
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!editUpload || editSaving) return
                      setEditSaving(true)
                      setEditError(null)
                      try {
                        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                        const csrf = getCsrfToken()
                        if (csrf) headers['x-csrf-token'] = csrf
                        const payload = {
                          modified_filename: editName.trim().length ? editName.trim() : null,
                          description: editDescription.trim().length ? editDescription.trim() : null,
                        }
                        const res = await fetch(`/api/uploads/${editUpload.id}`, {
                          method: 'PATCH',
                          credentials: 'same-origin',
                          headers,
                          body: JSON.stringify(payload),
                        })
                        const data = await res.json().catch(() => ({}))
                        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to save')
                        setUploads((prev) => prev.map((u) => (u.id === editUpload.id ? (data as UploadListItem) : u)))
                        setEditUpload(null)
                      } catch (err: any) {
                        setEditError(err?.message || 'Failed to save')
                      } finally {
                        setEditSaving(false)
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(10,132,255,0.85)',
                      background: 'rgba(10,132,255,0.30)',
                      color: '#fff',
                      fontWeight: 800,
                      cursor: editSaving ? 'default' : 'pointer',
                      opacity: editSaving ? 0.6 : 1,
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
