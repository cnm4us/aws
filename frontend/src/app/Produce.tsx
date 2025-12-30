import React, { useEffect, useMemo, useState } from 'react'

type UploadDetail = {
  id: number
  original_filename: string
  modified_filename?: string | null
  description?: string | null
  status: string
  size_bytes?: number | null
  width?: number | null
  height?: number | null
  created_at?: string | null
  poster_portrait_cdn?: string | null
  poster_landscape_cdn?: string | null
  poster_cdn?: string | null
  poster_portrait_s3?: string | null
  poster_landscape_s3?: string | null
  poster_s3?: string | null
}

function parseUploadId(): number | null {
  const params = new URLSearchParams(window.location.search)
  const raw = params.get('upload')
  if (!raw) return null
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
}

function pickPoster(upload: UploadDetail): string | null {
  return (
    upload.poster_portrait_cdn ||
    upload.poster_landscape_cdn ||
    upload.poster_cdn ||
    upload.poster_portrait_s3 ||
    upload.poster_landscape_s3 ||
    upload.poster_s3 ||
    null
  )
}

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

export default function ProducePage() {
  const uploadId = useMemo(() => parseUploadId(), [])
  const [upload, setUpload] = useState<UploadDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [productionName, setProductionName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!uploadId) {
      setError('Missing upload id.')
      setLoading(false)
      return
    }
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(`/api/uploads/${uploadId}`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to load upload')
        if (!cancelled) setUpload(data)
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load upload')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [uploadId])

  const backHref = uploadId ? `/productions?upload=${encodeURIComponent(String(uploadId))}` : '/productions'

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 0', fontSize: 28 }}>Build Production</h1>
          <p style={{ marginTop: 16, color: '#bbb' }}>Loading…</p>
        </div>
      </div>
    )
  }

  if (error || !upload) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
          <h1 style={{ margin: '12px 0 0', fontSize: 28 }}>Build Production</h1>
          <p style={{ marginTop: 16, color: '#ff9b9b' }}>{error || 'Upload not found.'}</p>
        </div>
      </div>
    )
  }

  const displayName = upload.modified_filename || upload.original_filename || `Upload ${upload.id}`
  const poster = pickPoster(upload)

  const onProduce = async () => {
    if (!uploadId) return
    if (creating) return
    setCreating(true)
    setCreateError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf

      const body: any = {
        uploadId,
        config: {
          musicUploadId: null,
          logoUploadId: null,
        },
      }
      const trimmedName = productionName.trim()
      if (trimmedName) body.name = trimmedName

      const res = await fetch('/api/productions', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to create production')
      const id = Number(data?.production?.id)
      if (!Number.isFinite(id) || id <= 0) throw new Error('Missing production id')
      window.location.href = `/productions?id=${encodeURIComponent(String(id))}`
    } catch (e: any) {
      setCreateError(e?.message || 'Failed to create production')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back</a>
        <header style={{ margin: '12px 0 18px' }}>
          <h1 style={{ margin: '0 0 6px', fontSize: 28 }}>Build Production</h1>
          <div style={{ color: '#bbb' }}>{displayName}</div>
        </header>

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <div>
            {poster ? (
              <img src={poster} alt="poster" style={{ width: 280, borderRadius: 12, background: '#111', objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 280, height: 158, borderRadius: 12, background: '#222' }} />
            )}
            <div style={{ marginTop: 10, color: '#888', fontSize: 13 }}>
              {upload.status}
              {upload.size_bytes != null ? ` • ${formatBytes(upload.size_bytes)}` : ''}
              {upload.width && upload.height ? ` • ${upload.width}×${upload.height}` : ''}
            </div>
          </div>

          <div style={{ flex: 1, minWidth: 260 }}>
            <section style={{ padding: 14, borderRadius: 12, background: '#0e0e0e', border: '1px solid #1f1f1f' }}>
              <div style={{ fontSize: 13, fontWeight: 650, textTransform: 'uppercase', letterSpacing: 1, opacity: 0.8, marginBottom: 10 }}>
                Optional Enhancements
              </div>

              <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                <div style={{ color: '#bbb' }}>Production Name (optional)</div>
                <input
                  value={productionName}
                  onChange={(e) => setProductionName(e.target.value)}
                  placeholder="Name this production"
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid #2a2a2a',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                <div style={{ color: '#bbb' }}>Music</div>
                <select disabled style={{ padding: '10px 12px', borderRadius: 10, background: '#111', border: '1px solid #2a2a2a', color: '#777' }}>
                  <option>Coming soon</option>
                </select>
              </label>

              <label style={{ display: 'grid', gap: 6, marginBottom: 0 }}>
                <div style={{ color: '#bbb' }}>Logo</div>
                <select disabled style={{ padding: '10px 12px', borderRadius: 10, background: '#111', border: '1px solid #2a2a2a', color: '#777' }}>
                  <option>Coming soon</option>
                </select>
              </label>
            </section>

            <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                onClick={onProduce}
                disabled={creating}
                style={{
                  background: '#0a84ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 18px',
                  fontWeight: 700,
                  opacity: creating ? 0.7 : 1,
                  cursor: creating ? 'default' : 'pointer',
                }}
              >
                {creating ? 'Starting…' : 'Produce'}
              </button>
              {createError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{createError}</div> : <div style={{ color: '#888', fontSize: 13 }}>Uses video-only for now; music/logo coming soon.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
