import React, { useCallback, useEffect, useMemo, useState } from 'react'
import CompactAudioPlayer from '../components/CompactAudioPlayer'

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
  kind?: 'video' | 'logo' | 'audio' | string
  created_at: string
  uploaded_at: string | null
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
    return raw === 'logo' ? 'logo' : raw === 'audio' ? 'audio' : 'video'
  }, [])

  const [me, setMe] = useState<MeResponse | null>(null)
  const [uploads, setUploads] = useState<UploadListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Record<number, boolean>>({})
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const loadUploads = useCallback(
    async (userId: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          limit: '100',
          user_id: String(userId),
          include_publications: '1',
          kind,
        })
        const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('failed_to_fetch_uploads')
        const data = (await res.json()) as UploadListItem[]
        setUploads(Array.isArray(data) ? data : [])
      } catch (err: any) {
        setError(err?.message ?? 'Failed to load uploads')
      } finally {
        setLoading(false)
      }
    },
    [kind]
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
      const logoSrc = kind === 'logo' ? `/api/uploads/${encodeURIComponent(String(upload.id))}/file` : null
      const audioSrc = kind === 'audio' ? `/api/uploads/${encodeURIComponent(String(upload.id))}/file` : null
      const image =
        kind === 'logo' ? (
          <img
            src={logoSrc as string}
            alt="logo"
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
          : kind === 'logo'
            ? logoSrc || '#'
            : kind === 'audio'
              ? audioSrc || '#'
              : '#'
      const isDeleting = !!deleting[upload.id]

      if (kind === 'audio') {
        return (
          <div
            key={upload.id}
            style={{
              borderRadius: 16,
              border: '1px solid rgba(212,175,55,0.45)',
              background: 'rgba(255,255,255,0.03)',
              padding: '14px 12px',
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ fontWeight: 800, color: '#d4af37', lineHeight: 1.2 }}>
                  {displayName}
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    if (isDeleting) return
                    const ok = window.confirm('Delete this audio? This cannot be undone.')
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
                    flexShrink: 0,
                  }}
                >
                  {isDeleting ? 'Deleting…' : 'Delete'}
                </button>
              </div>
              {description && (
                <div style={{ color: '#bbb', whiteSpace: 'pre-wrap', lineHeight: 1.35 }}>
                  {description}
                </div>
              )}
              {metaLine && (
                <div style={{ color: '#888', fontSize: 13, lineHeight: 1.35 }}>
                  {metaLine}
                </div>
              )}
              <div style={{ marginTop: 6 }}>
                <CompactAudioPlayer src={audioSrc as string} />
              </div>
            </div>
          </div>
        )
      }

      if (kind === 'video') {
        const href = productionHref
        return (
          <div
            key={upload.id}
            style={{
              borderRadius: 16,
              border: '1px solid #161616',
              background: 'rgba(255,255,255,0.03)',
              overflow: 'hidden',
            }}
          >
            <a href={href} style={{ display: 'block', textDecoration: 'none' }}>
              {poster ? (
                <img
                  src={poster}
                  alt="poster"
                  style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover', display: 'block', background: '#111' }}
                />
              ) : (
                <div style={{ width: '100%', aspectRatio: '16 / 9', background: '#111' }} />
              )}
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
              {publicationLines.length ? (
                <div style={{ marginTop: 8, display: 'grid', gap: 4, fontSize: 13 }}>
                  {publicationLines}
                </div>
              ) : null}
              <div style={{ marginTop: 10 }}>
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
            {kind === 'logo' ? (
              <div style={{ marginTop: 6 }}>
                <button
                  type="button"
                  onClick={async (e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    if (isDeleting) return
                    const ok = window.confirm('Delete this logo? This cannot be undone.')
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
            ) : null}
            {kind === 'video' && publicationLines.length > 0 && publicationLines}
          </div>
        </div>
      )
    })
  }, [uploads, renderPublicationLines, kind, deleting])

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
            { label: 'Audio', kind: 'audio' },
          ].map((t) => {
            const active = kind === t.kind
            const href = t.kind === 'video' ? '/uploads' : `/uploads?kind=${encodeURIComponent(t.kind)}`
            return (
              <a
                key={t.kind}
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
              {kind === 'video' ? 'My Videos' : kind === 'logo' ? 'My Logos' : 'My Audio'}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>
              {kind === 'video'
                ? 'Upload new videos and manage where they’re published.'
                : kind === 'logo'
                  ? 'Upload logos to use as watermarks in future productions.'
                  : 'Upload audio to mix into future productions. .mp3 and .wav files only.'}
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <a
              href={kind === 'video' ? '/uploads/new' : `/uploads/new?kind=${encodeURIComponent(kind)}`}
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
                : 'No audio yet. Upload audio to mix into future productions.'}
          </div>
        ) : (
          kind === 'audio' ? (
            <div style={{ display: 'grid', gap: 12 }}>
              {uploadCards}
            </div>
          ) : kind === 'video' ? (
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
      </div>
    </div>
  )
}

export default UploadsPage
