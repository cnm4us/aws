import React, { useCallback, useEffect, useMemo, useState } from 'react'

type ProductionRow = {
  id: number
  upload_id: number
  user_id: number
  status: string
  config: any
  output_prefix: string | null
  mediaconvert_job_id: string | null
  error_message: string | null
  created_at: string
  started_at: string | null
  completed_at: string | null
  upload?: {
    id: number
    original_filename: string
    modified_filename: string
    description: string | null
    status: string
    size_bytes: number | null
    width: number | null
    height: number | null
    created_at: string
  }
}

type ProductionsResponse = {
  productions: ProductionRow[]
}

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type UploadSummary = {
  id: number
  original_filename: string
  modified_filename?: string | null
  description?: string | null
  status: string
  size_bytes: number | null
  width: number | null
  height: number | null
  created_at: string
  poster_portrait_cdn?: string
  poster_cdn?: string
  poster_portrait_s3?: string
  poster_s3?: string
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

async function fetchMe(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('not authed')
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

function pickPoster(upload?: UploadSummary | null): string | undefined {
  if (!upload) return undefined
  return (
    upload.poster_portrait_cdn ||
    upload.poster_cdn ||
    upload.poster_portrait_s3 ||
    upload.poster_s3
  )
}

const ProductionsPage: React.FC = () => {
  const paramsInit = new URLSearchParams(window.location.search)
  const initialProductionId = (() => {
    const raw = paramsInit.get('id')
    if (!raw) return null
    const num = Number(raw)
    return Number.isFinite(num) && num > 0 ? num : null
  })()
  const initialUploadId = (() => {
    const raw = paramsInit.get('upload')
    if (!raw) return null
    const num = Number(raw)
    return Number.isFinite(num) && num > 0 ? num : null
  })()

  const [me, setMe] = useState<MeResponse | null>(null)
  const [productions, setProductions] = useState<ProductionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(initialProductionId)
  const [selectedProduction, setSelectedProduction] = useState<ProductionRow | null>(null)
  const [selectedLoading, setSelectedLoading] = useState(false)
  const [selectedError, setSelectedError] = useState<string | null>(null)
  const [uploadContextId, setUploadContextId] = useState<number | null>(initialUploadId)
  const [uploadDetail, setUploadDetail] = useState<UploadSummary | null>(null)
  const [uploadDetailLoading, setUploadDetailLoading] = useState(false)
  const [uploadDetailError, setUploadDetailError] = useState<string | null>(null)
  const [creatingProduction, setCreatingProduction] = useState(false)
  const [createProductionError, setCreateProductionError] = useState<string | null>(null)

  const loadProductions = useCallback(async (userId: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ user_id: String(userId) })
      const res = await fetch(`/api/productions?${params.toString()}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('failed_to_fetch_productions')
      const data = (await res.json()) as ProductionsResponse
      setProductions(Array.isArray(data.productions) ? data.productions : [])
    } catch (err: any) {
      setError(err?.message || 'Failed to load productions')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const current = await fetchMe()
      if (cancelled) return
      setMe(current)
      if (current?.userId) {
        await loadProductions(current.userId)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadProductions])

  useEffect(() => {
    const syncFromLocation = () => {
      const params = new URLSearchParams(window.location.search)
      const rawId = params.get('id')
      const rawUpload = params.get('upload')
      const parsedId = rawId ? Number(rawId) : null
      const parsedUpload = rawUpload ? Number(rawUpload) : null
      setSelectedId(parsedId && Number.isFinite(parsedId) && parsedId > 0 ? parsedId : null)
      setUploadContextId(parsedUpload && Number.isFinite(parsedUpload) && parsedUpload > 0 ? parsedUpload : null)
    }
    syncFromLocation()
    window.addEventListener('popstate', syncFromLocation)
    return () => window.removeEventListener('popstate', syncFromLocation)
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setSelectedProduction(null)
      setSelectedError(null)
      setSelectedLoading(false)
      return
    }
    let cancelled = false
    const run = async () => {
      setSelectedLoading(true)
      setSelectedError(null)
      try {
        const res = await fetch(`/api/productions/${selectedId}`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load production')
        }
        if (cancelled) return
        setSelectedProduction(data?.production || null)
      } catch (err: any) {
        if (cancelled) return
        setSelectedError(err?.message || 'Failed to load production')
        setSelectedProduction(null)
      } finally {
        if (!cancelled) setSelectedLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [selectedId])

  useEffect(() => {
    if (!uploadContextId) {
      setUploadDetail(null)
      setUploadDetailError(null)
      setUploadDetailLoading(false)
      return
    }
    let cancelled = false
    const run = async () => {
      setUploadDetailLoading(true)
      setUploadDetailError(null)
      try {
        const res = await fetch(`/api/uploads/${uploadContextId}?include_publications=1`, { credentials: 'same-origin' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          throw new Error(data?.error || 'Failed to load upload')
        }
        if (cancelled) return
        setUploadDetail(data as UploadSummary)
      } catch (err: any) {
        if (cancelled) return
        setUploadDetailError(err?.message || 'Failed to load upload')
        setUploadDetail(null)
      } finally {
        if (!cancelled) setUploadDetailLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [uploadContextId])

  const rows = useMemo(() => {
    return productions.map((prod) => {
      const upload = prod.upload
      const detailHref = `/productions?id=${prod.id}`
      const publishHref = `/publish?production=${prod.id}`
      const displayName = upload ? (upload.modified_filename || upload.original_filename || `Upload ${upload.id}`) : `Upload ${prod.upload_id}`
      return (
        <tr key={prod.id}>
          <td style={{ padding: 12 }}>{prod.id}</td>
          <td style={{ padding: 12 }}>
            <a href={detailHref} style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 600 }}>
              Production #{prod.id}
            </a>
            {upload ? (
              <div style={{ color: '#777', marginTop: 4 }}>
                Source:{' '}
                <a href={publishHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
                  {displayName}
                </a>
                <div style={{ marginTop: 2 }}>
                  {upload.status} • {formatBytes(upload.size_bytes)} • {upload.width || 0}×{upload.height || 0}
                </div>
              </div>
            ) : (
              <div style={{ color: '#777', marginTop: 4 }}>Upload {prod.upload_id}</div>
            )}
          </td>
          <td style={{ padding: 12 }}>{prod.status}</td>
          <td style={{ padding: 12 }}>{formatDate(prod.created_at)}</td>
          <td style={{ padding: 12 }}>{prod.completed_at ? formatDate(prod.completed_at) : '—'}</td>
          <td style={{ padding: 12 }}>{prod.mediaconvert_job_id || '—'}</td>
        </tr>
      )
    })
  }, [productions])

  const productionsForUpload = useMemo(() => {
    if (!uploadContextId) return []
    return productions.filter((prod) => prod.upload_id === uploadContextId)
  }, [productions, uploadContextId])

  const handleCreateProductionForUpload = useCallback(async () => {
    if (!uploadContextId) return
    setCreatingProduction(true)
    setCreateProductionError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch('/api/productions', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ uploadId: uploadContextId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to start production')
      }
      const production = data?.production as ProductionRow | undefined
      if (production) {
        setProductions((prev) => [production, ...prev.filter((p) => p.id !== production.id)])
      } else if (me?.userId) {
        await loadProductions(me.userId)
      }
      const newId = production?.id
      if (newId) {
        window.history.replaceState(null, '', `/productions?id=${newId}`)
        setSelectedId(newId)
        setSelectedProduction(production || null)
        setUploadContextId(null)
      }
    } catch (err: any) {
      setCreateProductionError(err?.message || 'Failed to start production')
    } finally {
      setCreatingProduction(false)
    }
  }, [uploadContextId, me?.userId, loadProductions])

  if (me === null) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <h1>Productions</h1>
        <p>Please <a href="/login" style={{ color: '#0a84ff' }}>sign in</a> to view your productions.</p>
      </div>
    )
  }

  if (uploadContextId && !selectedId) {
    if (uploadDetailLoading) {
      return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to uploads</a>
          <p style={{ marginTop: 24 }}>Loading upload…</p>
        </div>
      )
    }
    if (uploadDetailError) {
      return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to uploads</a>
          <p style={{ marginTop: 24, color: '#ff9b9b' }}>{uploadDetailError}</p>
        </div>
      )
    }
    const upload = uploadDetail
    const poster = pickPoster(upload)
    const displayName = upload ? (upload.modified_filename || upload.original_filename || `Upload ${upload.id}`) : null

    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 1000, margin: '0 auto', padding: '24px 16px 80px' }}>
          <header style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
            <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to uploads</a>
            <div>
              <h1 style={{ margin: 0, fontSize: 28 }}>Produce Video</h1>
              {upload && (
                <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>
                  {displayName} • {upload.status}
                </p>
              )}
            </div>
          </header>

          {createProductionError && (
            <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 12, background: '#2a1010', color: '#ff9b9b' }}>{createProductionError}</div>
          )}

          <section style={{ display: 'flex', gap: 24, flexWrap: 'wrap', marginBottom: 24 }}>
            <div>
              {poster ? (
                <img src={poster} alt="poster" style={{ width: 320, borderRadius: 12, background: '#111', objectFit: 'cover' }} />
              ) : (
                <div style={{ width: 320, height: 180, borderRadius: 12, background: '#222' }} />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 280 }}>
              <div style={{ marginBottom: 16, color: '#bbb' }}>
                <div>Size: {formatBytes(upload?.size_bytes ?? null)}</div>
                <div>Resolution: {(upload?.width || 0)}×{upload?.height || 0}</div>
                <div>Uploaded: {formatDate(upload?.created_at || null)}</div>
              </div>
              <button
                onClick={handleCreateProductionForUpload}
                disabled={creatingProduction}
                style={{
                  background: '#0a84ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '10px 18px',
                  fontWeight: 600,
                  cursor: creatingProduction ? 'default' : 'pointer',
                  opacity: creatingProduction ? 0.7 : 1,
                }}
              >
                {creatingProduction ? 'Starting…' : 'Create Production'}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ fontSize: 18, marginBottom: 12 }}>Existing Productions</h2>
            {productionsForUpload.length === 0 ? (
              <div style={{ color: '#777' }}>No productions yet for this upload.</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
                  <thead>
                    <tr style={{ textAlign: 'left', color: '#aaa' }}>
                      <th style={{ padding: 12 }}>ID</th>
                      <th style={{ padding: 12 }}>Status</th>
                      <th style={{ padding: 12 }}>Created</th>
                      <th style={{ padding: 12 }}>Job ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {productionsForUpload.map((prod) => (
                      <tr key={prod.id}>
                        <td style={{ padding: 12 }}><a href={`/productions?id=${prod.id}`} style={{ color: '#0a84ff', textDecoration: 'none' }}>Production #{prod.id}</a></td>
                        <td style={{ padding: 12 }}>{prod.status}</td>
                        <td style={{ padding: 12 }}>{formatDate(prod.created_at)}</td>
                        <td style={{ padding: 12 }}>{prod.mediaconvert_job_id || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </div>
    )
  }

  if (selectedId) {
    if (selectedLoading) {
      return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          <a href="/productions" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to productions</a>
          <p style={{ marginTop: 24 }}>Loading production…</p>
        </div>
      )
    }
    if (selectedError) {
      return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          <a href="/productions" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to productions</a>
          <p style={{ marginTop: 24, color: '#ff9b9b' }}>{selectedError}</p>
        </div>
      )
    }
    if (!selectedProduction) {
      return (
        <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
          <a href="/productions" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to productions</a>
          <p style={{ marginTop: 24 }}>Production not found.</p>
        </div>
      )
    }

    const upload = selectedProduction.upload
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px 16px 80px' }}>
          <header style={{ marginBottom: 24 }}>
            <a href="/productions" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to productions</a>
            <h1 style={{ margin: '12px 0 4px', fontSize: 28 }}>Production #{selectedProduction.id}</h1>
            <div style={{ color: '#888' }}>Status: {selectedProduction.status}</div>
          </header>

          <section style={{ marginBottom: 24, padding: 16, borderRadius: 12, background: '#0e0e0e', border: '1px solid #1f1f1f' }}>
            <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Job</h2>
            <div style={{ color: '#bbb' }}>MediaConvert Job ID: {selectedProduction.mediaconvert_job_id || '—'}</div>
            <div style={{ color: '#bbb' }}>Created: {formatDate(selectedProduction.created_at)}</div>
            <div style={{ color: '#bbb' }}>Started: {formatDate(selectedProduction.started_at)}</div>
            <div style={{ color: '#bbb' }}>Completed: {formatDate(selectedProduction.completed_at)}</div>
            <div style={{ marginTop: 12 }}>
              {upload ? (
                <a href={`/publish?production=${selectedProduction.id}`} style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 600 }}>Open publish page</a>
              ) : (
                <span style={{ color: '#777' }}>Source upload #{selectedProduction.upload_id}</span>
              )}
            </div>
          </section>

          {selectedProduction.config && (
            <section style={{ marginBottom: 24 }}>
              <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Production Settings</h2>
              <pre style={{ background: '#0f0f0f', border: '1px solid #1f1f1f', borderRadius: 12, padding: 16, color: '#a0ffa5', overflowX: 'auto' }}>
                {JSON.stringify(selectedProduction.config, null, 2)}
              </pre>
            </section>
          )}

          {selectedProduction.error_message && (
            <section style={{ marginBottom: 24, color: '#ff9b9b' }}>
              <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>Error</h2>
              <p>{selectedProduction.error_message}</p>
            </section>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 80px' }}>
        <header style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          <a href="/uploads" style={{ color: '#0a84ff', textDecoration: 'none' }}>← Back to uploads</a>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Productions</h1>
            <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>
              Finished renditions of your uploads. Start here before publishing to spaces.
            </p>
          </div>
        </header>

        {loading ? (
          <div style={{ color: '#888' }}>Loading productions…</div>
        ) : error ? (
          <div style={{ color: '#ff9b9b' }}>{error}</div>
        ) : productions.length === 0 ? (
          <div style={{ color: '#bbb' }}>No productions yet. Select an upload to start a new production.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: '#aaa' }}>
                  <th style={{ padding: 12 }}>ID</th>
                  <th style={{ padding: 12 }}>Source Upload</th>
                  <th style={{ padding: 12 }}>Status</th>
                  <th style={{ padding: 12 }}>Created</th>
                  <th style={{ padding: 12 }}>Completed</th>
                  <th style={{ padding: 12 }}>Job ID</th>
                </tr>
              </thead>
              <tbody>{rows}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default ProductionsPage
