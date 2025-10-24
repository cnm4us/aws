import React, { useCallback, useEffect, useMemo, useState } from 'react'

type PublicationSummary = {
  spaceId: number
  spaceName: string
  spaceType: string
  status: string
  publishedAt: string | null
  unpublishedAt: string | null
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
  const [upload, setUpload] = useState<UploadDetail | null>(null)
  const [options, setOptions] = useState<PublishSpace[]>([])
  const [selection, setSelection] = useState<'all' | 'custom'>('custom')
  const [selectedSpaces, setSelectedSpaces] = useState<Record<number, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)


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
      try {
        let uploadJson: UploadDetail | null = null
        let pubs: PublicationSummary[] = []
        if (productionId) {
          // Load production, then list its publications, and options from its upload
          const prodRes = await fetch(`/api/productions/${productionId}`, { credentials: 'same-origin' })
          const prodJson = await prodRes.json().catch(() => ({}))
          if (!prodRes.ok) throw new Error(prodJson?.error || 'Failed to load production')
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
            publications: [],
          }
          const pubsRes = await fetch(`/api/productions/${productionId}/publications`, { credentials: 'same-origin' })
          const pubsJson = await pubsRes.json().catch(() => ({}))
          if (!pubsRes.ok) throw new Error(pubsJson?.error || 'Failed to load publications')
          pubs = Array.isArray(pubsJson?.publications) ? pubsJson.publications : []
        } else {
          const uploadRes = await fetch(`/api/uploads/${uploadId}?include_publications=1`, { credentials: 'same-origin' })
          if (!uploadRes.ok) throw new Error('Failed to load upload')
          uploadJson = (await uploadRes.json()) as UploadDetail
          pubs = Array.isArray(uploadJson?.publications) ? uploadJson.publications : []
        }
        const optionsRes = await fetch(`/api/uploads/${uploadJson!.id}/publish-options`, { credentials: 'same-origin' })
        if (!optionsRes.ok) throw new Error('Failed to load publish options')
        const optionsJson = (await optionsRes.json()) as PublishOptionsResponse
        if (cancelled) return
        setUpload(uploadJson)
        setOptions(optionsJson.spaces || [])
        const published = pubs
          .filter((p) => p.status === 'published' || p.status === 'approved')
          .reduce<Record<number, boolean>>((acc, p) => {
            acc[p.spaceId] = true
            return acc
          }, {})
        setSelectedSpaces(published)
        setSelection(Object.keys(published).length > 0 ? 'custom' : 'all')
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
    setSelection('custom')
  }, [])

  const refreshUpload = useCallback(async () => {
    setSaving(true)
    try {
      if (productionId) {
        const pubsRes = await fetch(`/api/productions/${productionId}/publications`, { credentials: 'same-origin' })
        if (!pubsRes.ok) throw new Error('Failed to refresh publications')
        const pubsJson = await pubsRes.json()
        const pubList: PublicationSummary[] = Array.isArray(pubsJson?.publications) ? pubsJson.publications : []
        setUpload((prev) => prev ? { ...prev, publications: pubList } : prev)
      } else if (uploadId) {
        const res = await fetch(`/api/uploads/${uploadId}?include_publications=1`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('Failed to refresh upload')
        const json = await res.json()
        setUpload(json)
      }
    } catch (err) {
      console.error('refresh upload failed', err)
    } finally {
      setSaving(false)
    }
  }, [uploadId, productionId])

  const selectedSpaceIds = useMemo(() => {
    if (selection === 'all') {
      return options.map((s) => s.id)
    }
    return Object.entries(selectedSpaces)
      .filter(([_, checked]) => checked)
      .map(([spaceId]) => Number(spaceId))
  }, [selection, options, selectedSpaces])

  const handlePublish = useCallback(async () => {
    if (!uploadId && !productionId) return
    const spaces = selectedSpaceIds
    if (!spaces.length) {
      setSaveError('Select at least one space')
      return
    }
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      if (productionId) {
        // Publish this production to each selected space
        for (const sid of spaces) {
          await fetch(`/api/productions/${productionId}/publications`, {
            method: 'POST',
            credentials: 'same-origin',
            headers,
            body: JSON.stringify({ spaceId: sid }),
          })
        }
      } else if (uploadId) {
        const res = await fetch(`/api/uploads/${uploadId}/publish`, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ spaces }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || 'Publish failed')
        }
      }
      setSaveMessage('Publish request sent.')
      await refreshUpload()
    } catch (err: any) {
      setSaveError(err?.message || 'Publish failed')
    } finally {
      setSaving(false)
    }
  }, [uploadId, productionId, selectedSpaceIds, refreshUpload])

  const handleUnpublish = useCallback(async () => {
    if (!uploadId && !productionId) return
    const spaces = selectedSpaceIds
    if (!spaces.length) {
      setSaveError('Select at least one space')
      return
    }
    setSaving(true)
    setSaveMessage(null)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      if (productionId) {
        // Fetch current publications for this production and unpublish those in selected spaces
        const pubsRes = await fetch(`/api/productions/${productionId}/publications`, { credentials: 'same-origin' })
        const pubsJson = await pubsRes.json().catch(() => ({}))
        const pubs: Array<PublicationSummary & { id?: number }> = Array.isArray(pubsJson?.publications) ? pubsJson.publications : []
        for (const sid of spaces) {
          const match = pubs.find((p) => Number(p.spaceId) === sid)
          if (match && match.id) {
            await fetch(`/api/publications/${Number(match.id)}/unpublish`, {
              method: 'POST',
              credentials: 'same-origin',
              headers,
              body: JSON.stringify({}),
            })
          }
        }
      } else if (uploadId) {
        const res = await fetch(`/api/uploads/${uploadId}/unpublish`, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ spaces }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          throw new Error(data?.error || 'Unpublish failed')
        }
      }
      setSaveMessage('Unpublish request sent.')
      await refreshUpload()
    } catch (err: any) {
      setSaveError(err?.message || 'Unpublish failed')
    } finally {
      setSaving(false)
    }
  }, [uploadId, productionId, selectedSpaceIds, refreshUpload])

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

  const backHref = productionId ? `/productions?id=${productionId}` : '/uploads'

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <header style={{ marginBottom: 24 }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 4px', fontSize: 28 }}>{displayName}</h1>
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
            {poster ? (
              <img src={poster} alt="poster" style={{ width: 280, borderRadius: 12, background: '#111', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 280, height: 158, borderRadius: 12, background: '#222' }} />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, marginBottom: 12 }}>Published To</h2>
              {(upload.publications || []).length === 0 ? (
                <p style={{ color: '#888' }}>This video has not been published yet.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {(upload.publications || []).map((pub, idx) => (
                    <li key={`${pub.spaceId}-${idx}`} style={{ marginBottom: 6 }}>
                      <span style={{ fontWeight: 600 }}>{pub.spaceName || `Space ${pub.spaceId}`}</span>
                      <span style={{ color: '#888', marginLeft: 6 }}>({pub.spaceType})</span>
                      <span style={{ color: '#aaa', marginLeft: 10 }}>{pub.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 style={{ fontSize: 18, marginBottom: 12 }}>Publish To</h2>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="publishTarget"
                    value="all"
                    checked={selection === 'all'}
                    onChange={() => setSelection('all')}
                  />
                  <span>All eligible spaces</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    type="radio"
                    name="publishTarget"
                    value="custom"
                    checked={selection === 'custom'}
                    onChange={() => setSelection('custom')}
                  />
                  <span>Select spaces individually</span>
                </label>
              </div>
              {selection === 'custom' && (
                <div style={{ marginTop: 16, paddingLeft: 12, borderLeft: '2px solid #222' }}>
                  {options.length === 0 ? (
                    <p style={{ color: '#888' }}>No publishable spaces available.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {options.map((space) => (
                        <label key={space.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <input
                            type="checkbox"
                            checked={!!selectedSpaces[space.id]}
                            onChange={() => toggleSpace(space.id)}
                          />
                          <span>
                            {space.name}
                            <span style={{ color: '#888', marginLeft: 8 }}>({space.type})</span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginTop: 24, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <button
                  onClick={() => handlePublish()}
                  disabled={saving || selectedSpaceIds.length === 0}
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
                  {saving ? 'Publishing…' : 'Publish Selection'}
                </button>
                <button
                  onClick={() => handleUnpublish()}
                  disabled={saving || selectedSpaceIds.length === 0}
                  style={{
                    background: 'transparent',
                    color: '#ff9b9b',
                    border: '1px solid rgba(255,155,155,0.6)',
                    borderRadius: 10,
                    padding: '10px 18px',
                    fontWeight: 600,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  Unpublish Selection
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}

export default PublishPage
