import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import HLSVideo from '../components/HLSVideo'

type PublicationSummary = {
  id: number
  spaceId: number
  spaceName: string
  spaceType: string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
  hasStory?: boolean
  storyPreview?: string | null
}

type UploadDetail = {
  id: number
  original_filename: string
  modified_filename?: string | null
  description?: string | null
  status: string
  size_bytes: number | null
  width: number | null
  height: number | null
  created_at: string
  uploaded_at: string | null
  poster_portrait_cdn?: string
  poster_landscape_cdn?: string
  poster_cdn?: string
  poster_portrait_s3?: string
  poster_landscape_s3?: string
  poster_s3?: string
  cdn_master?: string | null
  s3_master?: string | null
  publications?: PublicationSummary[]
}

type PublishSpace = {
  id: number
  name: string
  slug: string
  type: string
}

type PublishOptionsResponse = {
  uploadId: number
  spaces: PublishSpace[]
}

function parseUploadId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const idParam = params.get('id')
  if (!idParam) return null
  const num = Number(idParam)
  return Number.isFinite(num) ? num : null
}

function parseProductionId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const idParam = params.get('production')
  if (!idParam) return null
  const num = Number(idParam)
  return Number.isFinite(num) ? num : null
}

function parseFromHref(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('from')
    if (!raw) return null
    const s = String(raw)
    if (!s.startsWith('/')) return null
    if (s.startsWith('//')) return null
    return s
  } catch {
    return null
  }
}

function pickPoster(upload: UploadDetail): string | undefined {
  return (
    upload.poster_portrait_cdn ||
    upload.poster_landscape_cdn ||
    upload.poster_cdn ||
    upload.poster_portrait_s3 ||
    upload.poster_landscape_s3 ||
    upload.poster_s3
  )
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

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const PublishPage: React.FC = () => {
  const uploadId = useMemo(() => parseUploadId(), [])
  const productionId = useMemo(() => parseProductionId(), [])
  const fromHref = useMemo(() => parseFromHref(), [])
  const [upload, setUpload] = useState<UploadDetail | null>(null)
  const [productionName, setProductionName] = useState<string | null>(null)
  const [options, setOptions] = useState<PublishSpace[]>([])
  const [selectedSpaces, setSelectedSpaces] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [storySavingMap, setStorySavingMap] = useState<Record<number, boolean>>({})
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (!previewOpen) return

    const body = document.body
    const prev = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    }
    const scrollY = window.scrollY || 0

    body.style.overflow = 'hidden'
    body.style.position = 'fixed'
    body.style.top = `-${scrollY}px`
    body.style.width = '100%'

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        try { previewVideoRef.current?.pause() } catch {}
        setPreviewOpen(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      body.style.overflow = prev.overflow
      body.style.position = prev.position
      body.style.top = prev.top
      body.style.width = prev.width
      try { window.scrollTo(0, scrollY) } catch {}
    }
  }, [previewOpen])


  useEffect(() => {
    let cancelled = false
    if (!uploadId && !productionId) {
      setError('Missing upload or production id.')
      setLoading(false)
      return
    }
    const run = async () => {
      setLoading(true)
      setError(null)
      setProductionName(null)
      try {
        let uploadJson: UploadDetail | null = null
        let pubs: PublicationSummary[] = []
        if (productionId) {
          // Load production, then list its publications, and options from its upload
          const prodRes = await fetch(`/api/productions/${productionId}`, { credentials: 'same-origin' })
          const prodJson = await prodRes.json().catch(() => ({}))
          if (!prodRes.ok) throw new Error(prodJson?.error || 'Failed to load production')
          const prodName = String(prodJson?.production?.name || '').trim()
          if (!cancelled) setProductionName(prodName.length ? prodName : null)
          const up = (prodJson?.production?.upload || null) as any
          if (!up) throw new Error('Production missing upload context')
          uploadJson = {
            id: Number(up.id),
            original_filename: String(up.original_filename || ''),
            modified_filename: up.modified_filename || null,
            description: up.description || null,
            status: String(up.status || ''),
            size_bytes: up.size_bytes ?? null,
            width: up.width ?? null,
            height: up.height ?? null,
            created_at: up.created_at || '',
            uploaded_at: null,
            // Prefer production-specific posters injected by the backend for this production
            poster_portrait_cdn: up.poster_portrait_cdn || up.poster_cdn || undefined,
            poster_landscape_cdn: up.poster_landscape_cdn || undefined,
            poster_cdn: up.poster_cdn || undefined,
            poster_portrait_s3: up.poster_portrait_s3 || up.poster_s3 || undefined,
            poster_landscape_s3: up.poster_landscape_s3 || undefined,
            poster_s3: up.poster_s3 || undefined,
            cdn_master: up.cdn_master || null,
            s3_master: up.s3_master || null,
            publications: [],
          }
          const pubsRes = await fetch(`/api/productions/${productionId}/publications`, { credentials: 'same-origin' })
          const pubsJson = await pubsRes.json().catch(() => ({}))
          if (!pubsRes.ok) throw new Error(pubsJson?.error || 'Failed to load publications')
          pubs = Array.isArray(pubsJson?.publications) ? pubsJson.publications : []
          // Ensure the publish page has the per-space publication list (for Stories, etc)
          uploadJson.publications = pubs
        } else {
          const uploadRes = await fetch(`/api/uploads/${uploadId}?include_publications=1`, { credentials: 'same-origin' })
          if (!uploadRes.ok) throw new Error('Failed to load upload')
          uploadJson = (await uploadRes.json()) as UploadDetail
          pubs = Array.isArray(uploadJson?.publications) ? uploadJson.publications : []
          if (!cancelled) setProductionName(null)
        }
        const optionsRes = await fetch(`/api/uploads/${uploadJson!.id}/publish-options`, { credentials: 'same-origin' })
        if (!optionsRes.ok) throw new Error('Failed to load publish options')
        const optionsJson = (await optionsRes.json()) as PublishOptionsResponse
        if (cancelled) return
        setUpload(uploadJson)
        setOptions(optionsJson.spaces || [])
        const published = pubs
          .filter((p) => p.status !== 'unpublished' && p.status !== 'rejected')
          .reduce<Record<number, boolean>>((acc, p) => {
            acc[p.spaceId] = true
            return acc
          }, {})
        setSelectedSpaces(published)
      } catch (err: any) {
        if (cancelled) return
        setError(err?.message || 'Failed to load publish data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [uploadId, productionId])

  const toggleSpace = useCallback((spaceId: number) => {
    setSelectedSpaces((prev) => ({ ...prev, [spaceId]: !prev[spaceId] }))
  }, [])

  const refreshUpload = useCallback(async () => {
    setSaving(true)
    try {
      if (productionId) {
        const pubsRes = await fetch(`/api/productions/${productionId}/publications`, { credentials: 'same-origin' })
        if (!pubsRes.ok) throw new Error('Failed to refresh publications')
        const pubsJson = await pubsRes.json()
        const pubList: PublicationSummary[] = Array.isArray(pubsJson?.publications) ? pubsJson.publications : []
        setUpload((prev) => (prev ? { ...prev, publications: pubList } : prev))
        const published = pubList
          .filter((p) => p.status !== 'unpublished' && p.status !== 'rejected')
          .reduce<Record<number, boolean>>((acc, p) => {
            acc[p.spaceId] = true
            return acc
          }, {})
        setSelectedSpaces(published)
      } else if (uploadId) {
        const res = await fetch(`/api/uploads/${uploadId}?include_publications=1`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('Failed to refresh upload')
        const json = await res.json()
        setUpload(json)
        const pubs: PublicationSummary[] = Array.isArray(json?.publications) ? json.publications : []
        const published = pubs
          .filter((p) => p.status !== 'unpublished' && p.status !== 'rejected')
          .reduce<Record<number, boolean>>((acc, p) => {
            acc[p.spaceId] = true
            return acc
          }, {})
        setSelectedSpaces(published)
      }
    } catch (err) {
      console.error('refresh upload failed', err)
    } finally {
      setSaving(false)
    }
  }, [uploadId, productionId])

  const selectedSpaceIds = useMemo(
    () =>
      Object.entries(selectedSpaces)
        .filter(([_, checked]) => checked)
        .map(([spaceId]) => Number(spaceId)),
    [selectedSpaces],
  )

  const handlePublish = useCallback(async () => {
    if (!uploadId && !productionId) return
    const spaces = selectedSpaceIds
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      if (productionId) {
        // Load current publications for this production so we can compute diffs
        const pubsRes = await fetch(`/api/productions/${productionId}/publications`, { credentials: 'same-origin' })
        const pubsJson = await pubsRes.json().catch(() => ({}))
        const pubs: Array<PublicationSummary & { id?: number }> = Array.isArray(pubsJson?.publications)
          ? pubsJson.publications
          : []
        const currentActive = pubs.filter((p) => p.status !== 'unpublished' && p.status !== 'rejected')
        const currentSet = new Set(currentActive.map((p) => Number(p.spaceId)))
        const desiredSet = new Set(spaces)

        const toPublish: number[] = []
        const toUnpublish: Array<{ spaceId: number; publicationId: number }> = []

        for (const sid of desiredSet) {
          if (!currentSet.has(sid)) {
            toPublish.push(sid)
          }
        }
        for (const pub of currentActive) {
          const sid = Number(pub.spaceId)
          if (!desiredSet.has(sid) && pub.id) {
            toUnpublish.push({ spaceId: sid, publicationId: Number(pub.id) })
          }
        }

        if (!toPublish.length && !toUnpublish.length) {
          setSaveMessage('No changes to publish.')
          return
        }

        for (const sid of toPublish) {
          const res = await fetch(`/api/productions/${productionId}/publications`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ spaceId: sid }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error || 'Publish failed')
          }
        }

        for (const item of toUnpublish) {
          const res = await fetch(`/api/publications/${item.publicationId}/unpublish`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({}),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error || 'Unpublish failed')
          }
        }
      } else if (uploadId) {
        const pubs: PublicationSummary[] = Array.isArray(upload?.publications) ? upload.publications! : []
        const currentActiveSpaceIds = pubs
          .filter((p) => p.status !== 'unpublished' && p.status !== 'rejected')
          .map((p) => p.spaceId)
        const currentSet = new Set(currentActiveSpaceIds)
        const desiredSet = new Set(spaces)

        const toPublish: number[] = []
        const toUnpublish: number[] = []

        for (const sid of desiredSet) {
          if (!currentSet.has(sid)) {
            toPublish.push(sid)
          }
        }

        for (const sid of currentSet) {
          if (!desiredSet.has(sid)) {
            toUnpublish.push(sid)
          }
        }

        if (!toPublish.length && !toUnpublish.length) {
          setSaveMessage('No changes to publish.')
          return
        }

        if (toPublish.length) {
          const res = await fetch(`/api/uploads/${uploadId}/publish`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ spaces: toPublish }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error || 'Publish failed')
          }
        }

        if (toUnpublish.length) {
          const res = await fetch(`/api/uploads/${uploadId}/unpublish`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ spaces: toUnpublish }),
          })
          if (!res.ok) {
            const data = await res.json().catch(() => ({}))
            throw new Error(data?.error || 'Unpublish failed')
          }
        }
      }
      setSaveMessage('Publish settings updated.')
      await refreshUpload()
    } catch (err: any) {
      setSaveError(err?.message || 'Publish failed')
    } finally {
      setSaving(false)
    }
  }, [uploadId, productionId, selectedSpaceIds, refreshUpload, upload])

  if (!uploadId && !productionId) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#fff', background: '#050505', minHeight: '100vh' }}>
        <h1>Publish</h1>
        <p>No upload or production selected. Return to <a href="/uploads" style={{ color: '#0a84ff' }}>Uploads</a>.</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#fff', background: '#050505', minHeight: '100vh' }}>
        <h1>Publish</h1>
        <p>Loading…</p>
      </div>
    )
  }

  if (error || !upload) {
    return (
      <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#fff', background: '#050505', minHeight: '100vh' }}>
        <h1>Publish</h1>
        <p style={{ color: '#ff6b6b' }}>{error || 'Upload not found.'}</p>
        <p><a href="/uploads" style={{ color: '#0a84ff' }}>Back to uploads</a></p>
      </div>
    )
  }

  const poster = pickPoster(upload)
  const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
  const master = String(upload.cdn_master || upload.s3_master || '').trim()
  const title = productionId ? (productionName || displayName) : displayName

  const backHref = fromHref || (productionId ? `/productions?upload=${encodeURIComponent(String(upload.id))}` : '/uploads')
  const currentHref = `${window.location.pathname}${window.location.search}`

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <header style={{ marginBottom: 24 }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 4px', fontSize: 28 }}>{title}</h1>
          {productionId && productionName ? (
            <div style={{ color: '#888', marginTop: 2 }}>
              Asset: {displayName}
            </div>
          ) : null}
          {upload.description && (
            <div style={{ color: '#bbb', whiteSpace: 'pre-wrap', margin: '4px 0 8px 0' }}>
              {upload.description}
            </div>
          )}
          <div style={{ color: '#888' }}>
            {upload.status} • {formatBytes(upload.size_bytes)} • {upload.width || 0}×{upload.height || 0} • Uploaded {formatDate(upload.created_at)}
          </div>
        </header>

        {saveMessage && (
          <div style={{ margin: '0 0 16px 0', padding: '10px 14px', borderRadius: 12, background: '#102a12', color: '#a6ffb2' }}>{saveMessage}</div>
        )}
        {saveError && (
          <div style={{ margin: '0 0 16px 0', padding: '10px 14px', borderRadius: 12, background: '#2a1010', color: '#ff9b9b' }}>{saveError}</div>
        )}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            {master ? (
              <div
                style={
                  previewOpen
                    ? {
                        position: 'fixed',
                        inset: 0,
                        zIndex: 10000,
                        background: '#000',
                        display: 'grid',
                        placeItems: 'stretch',
                      }
                    : {
                        width: 280,
                        borderRadius: 12,
                        overflow: 'hidden',
                        background: '#000',
                      }
                }
              >
                <HLSVideo
                  src={master}
                  controls
                  autoPlay={false}
                  muted={false}
                  playsInline
                  onReady={(v) => {
                    previewVideoRef.current = v
                  }}
                  onPlay={() => {
                    setPreviewOpen(true)
                  }}
                  style={{
                    width: '100%',
                    height: previewOpen ? '100%' : 'auto',
                    display: 'block',
                    background: '#000',
                    objectFit: 'contain',
                  }}
                />
                {previewOpen ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      try { previewVideoRef.current?.pause() } catch {}
                      setPreviewOpen(false)
                    }}
                    style={{
                      position: 'fixed',
                      // iOS Safari's top chrome can overlap fixed elements; keep this below it.
                      top: 'max(72px, calc(env(safe-area-inset-top, 0px) + 12px))',
                      right: 'max(12px, env(safe-area-inset-right, 0px))',
                      zIndex: 10020,
                      background: 'rgba(255,255,255,0.08)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.22)',
                      borderRadius: 999,
                      width: 42,
                      height: 42,
                      fontSize: 18,
                      lineHeight: '42px',
                      cursor: 'pointer',
                    }}
                    aria-label="Close"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ) : poster ? (
              <img src={poster} alt="poster" style={{ width: 280, borderRadius: 12, background: '#111', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 280, height: 158, borderRadius: 12, background: '#222' }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <section>
              <h2 style={{ fontSize: 18, marginBottom: 12 }}>Publish To</h2>
              <div style={{ marginTop: 8, paddingLeft: 12, borderLeft: '2px solid #222' }}>
                {options.length === 0 ? (
                  <p style={{ color: '#888' }}>No publishable spaces available.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {(() => {
                      const personal = options.filter((s) => s.type === 'personal')
                      const globalSpace = options.find((s) => s.slug === 'global' || s.slug === 'global-feed') || null
                      const globalId = globalSpace?.id ?? null
                      const groups = options.filter((s) => s.type === 'group' && s.id !== globalId)
                      const channels = options.filter((s) => s.type === 'channel' && s.id !== globalId)

                      const rows: JSX.Element[] = []

                      if (personal.length) {
                        const p = personal[0]
                        rows.push(
                          <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!selectedSpaces[p.id]}
                              onChange={() => toggleSpace(p.id)}
                            />
                            <span>Personal</span>
                          </label>,
                        )
                      }

                      if (globalSpace) {
                        rows.push(
                          <label key={globalSpace.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input
                              type="checkbox"
                              checked={!!selectedSpaces[globalSpace.id]}
                              onChange={() => toggleSpace(globalSpace.id)}
                            />
                            <span>Global Feed</span>
                          </label>,
                        )
                      }

                      if (groups.length) {
                        rows.push(
                          <div
                            key="groups-header"
                            style={{
                              marginTop: 10,
                              fontSize: 13,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              opacity: 0.7,
                            }}
                          >
                            Groups
                          </div>,
                        )
                        groups.forEach((space) => {
                          rows.push(
                            <label key={space.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={!!selectedSpaces[space.id]}
                                onChange={() => toggleSpace(space.id)}
                              />
                              <span>{space.name}</span>
                            </label>,
                          )
                        })
                      }

                      if (channels.length) {
                        rows.push(
                          <div
                            key="channels-header"
                            style={{
                              marginTop: 10,
                              fontSize: 13,
                              fontWeight: 600,
                              textTransform: 'uppercase',
                              opacity: 0.7,
                            }}
                          >
                            Channels
                          </div>,
                        )
                        channels.forEach((space) => {
                          rows.push(
                            <label key={space.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <input
                                type="checkbox"
                                checked={!!selectedSpaces[space.id]}
                                onChange={() => toggleSpace(space.id)}
                              />
                              <span>{space.name}</span>
                            </label>,
                          )
                        })
                      }

                      return rows
                    })()}
                  </div>
                )}
              </div>
              <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={() => handlePublish()}
                  disabled={saving}
                  style={{
                    background: '#0a84ff',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 10,
                    padding: '10px 18px',
                    fontWeight: 600,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            </section>

            {productionId ? (
              <section style={{ marginTop: 28 }}>
                <h2 style={{ fontSize: 18, marginBottom: 10 }}>Story</h2>
                <div style={{ color: '#888', fontSize: 13, marginBottom: 10 }}>Stories are per space.</div>
                {Array.isArray(upload.publications) && upload.publications.length ? (
                  <div style={{ display: 'grid', gap: 10 }}>
                    {upload.publications.map((p) => {
                      const preview = typeof p.storyPreview === 'string' ? p.storyPreview.trim() : ''
                      const hasStory = Boolean(p.hasStory)
                      const canEdit = !!p.id
                      return (
                        <div
                          key={p.id || `${p.spaceId}-${p.status}`}
                          style={{
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 12,
                            padding: 12,
                            background: 'rgba(255,255,255,0.03)',
                            display: 'grid',
                            gap: 6,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' }}>
                            <div style={{ fontWeight: 700 }}>{p.spaceName}</div>
                            <div style={{ fontSize: 12, color: '#888' }}>{p.status}</div>
                          </div>
                          <div style={{ color: hasStory ? '#ddd' : '#888', whiteSpace: 'pre-wrap' }}>
                            {hasStory ? (preview || '…') : 'None'}
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                            {canEdit ? (
                              <a
                                href={`/publish/story?publication=${encodeURIComponent(String(p.id))}&from=${encodeURIComponent(currentHref)}`}
                                style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 600 }}
                              >
                                Edit
                              </a>
                            ) : null}
                            <button
                              disabled={!canEdit || storySavingMap[p.id]}
                              onClick={async () => {
                                if (!canEdit) return
                                const pubId = Number(p.id)
                                setStorySavingMap((m) => ({ ...m, [pubId]: true }))
                                try {
                                  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                                  const csrf = getCsrfToken()
                                  if (csrf) headers['x-csrf-token'] = csrf
                                  const res = await fetch(`/api/publications/${pubId}/story`, {
                                    method: 'PATCH',
                                    credentials: 'same-origin',
                                    headers,
                                    body: JSON.stringify({ storyText: null }),
                                  })
                                  if (!res.ok) throw new Error('Failed to clear story')
                                  await refreshUpload()
                                } catch (err) {
                                  console.error('clear story failed', err)
                                } finally {
                                  setStorySavingMap((m) => ({ ...m, [pubId]: false }))
                                }
                              }}
                              style={{
                                background: 'transparent',
                                color: '#fff',
                                border: '1px solid rgba(255,255,255,0.25)',
                                borderRadius: 10,
                                padding: '6px 10px',
                                fontWeight: 600,
                                cursor: storySavingMap[p.id] ? 'default' : 'pointer',
                                opacity: storySavingMap[p.id] ? 0.6 : 1,
                              }}
                            >
                              {storySavingMap[p.id] ? 'Clearing…' : 'Clear'}
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ color: '#888' }}>Publish to a space to add a story.</div>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}

export default PublishPage
