import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

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
  size_bytes: number | null
  width: number | null
  height: number | null
  status: string
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

async function probeVideo(file: File): Promise<{ width: number | null; height: number | null; durationSeconds: number | null }> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file)
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.src = url
      video.onloadedmetadata = () => {
        const meta = {
          width: video.videoWidth || null,
          height: video.videoHeight || null,
          durationSeconds: video.duration ? Math.round(video.duration) : null,
        }
        URL.revokeObjectURL(url)
        resolve(meta)
      }
      video.onerror = () => {
        URL.revokeObjectURL(url)
        resolve({ width: null, height: null, durationSeconds: null })
      }
    } catch {
      resolve({ width: null, height: null, durationSeconds: null })
    }
  })
}

function getCsrfToken(): string | null {
  const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

const UploadsPage: React.FC = () => {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [uploads, setUploads] = useState<UploadListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const loadUploads = useCallback(
    async (userId: number) => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({
          limit: '100',
          user_id: String(userId),
          include_publications: '1',
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
    []
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

  const handleRefresh = useCallback(async () => {
    if (me?.userId) {
      await loadUploads(me.userId)
    }
  }, [me, loadUploads])

  const handleFileChoose = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files && event.target.files[0]
      if (!file) return
      if (!me || !me.userId) {
        setUploadError('Please sign in to upload videos.')
        return
      }
      setUploadError(null)
      setUploadMessage(null)
      setUploadProgress(0)
      setUploading(true)

      try {
        const meta = await probeVideo(file)
        const body = {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          ...meta,
        }
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf

        const signRes = await fetch('/api/sign-upload', {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify(body),
        })
        if (!signRes.ok) throw new Error('Failed to sign upload')
        const signJson = await signRes.json()
        const { id, post } = signJson

        const etag = await new Promise<string | null>((resolve, reject) => {
          const formData = new FormData()
          Object.entries(post.fields || {}).forEach(([key, value]) => {
            formData.append(key, value as string)
          })
          formData.append('file', file)

          const xhr = new XMLHttpRequest()
          xhr.open('POST', post.url, true)
          xhr.responseType = 'document'
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              const pct = Math.round((e.loaded / e.total) * 100)
              setUploadProgress(pct)
            }
          })
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              try {
                const doc = xhr.responseXML
                const tag = doc?.getElementsByTagName('ETag')[0]
                if (tag && tag.textContent) {
                  resolve(tag.textContent.replace(/^"|"$/g, ''))
                  return
                }
              } catch {}
              resolve(null)
            } else {
              reject(new Error(`S3 upload failed (${xhr.status})`))
            }
          }
          xhr.onerror = () => reject(new Error('Network error uploading to S3'))
          xhr.send(formData)
        })

        await completeUpload(id, file.size, etag)
        setUploadMessage('Upload complete! Video will appear once processing finishes.')
        setUploadProgress(100)
        await handleRefresh()
      } catch (err: any) {
        console.error('upload failed', err)
        setUploadError(err?.message || 'Upload failed')
      } finally {
        setUploading(false)
        if (fileInputRef.current) {
          fileInputRef.current.value = ''
        }
      }
    },
    [me, handleRefresh]
  )

  const completeUpload = async (id: number, sizeBytes: number, etag: string | null) => {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    const csrf = getCsrfToken()
    if (csrf) headers['x-csrf-token'] = csrf
    await fetch('/api/mark-complete', {
      method: 'POST',
      credentials: 'same-origin',
      headers,
      body: JSON.stringify({ id, sizeBytes, etag }),
    })
  }

  const renderPublishedTo = useCallback((upload: UploadListItem) => {
    const buckets = partitionPublications(upload.publications)
    const lines: string[] = []
    if (buckets.personal.length) lines.push('Personal Space')
    if (buckets.channels.length) {
      const names = buckets.channels.map((p) => p.spaceName || `Channel ${p.spaceId}`)
      lines.push(`Channels: ${names.join(', ')}`)
    }
    if (buckets.groups.length) {
      const names = buckets.groups.map((p) => p.spaceName || `Group ${p.spaceId}`)
      lines.push(`Groups: ${names.join(', ')}`)
    }
    if (buckets.other.length) {
      const names = buckets.other.map((p) => p.spaceName || `Space ${p.spaceId}`)
      lines.push(names.join(', '))
    }
    if (!lines.length) return <span style={{ color: '#888' }}>—</span>
    return lines.map((line, idx) => (
      <div key={idx}>{line}</div>
    ))
  }, [])

const tableRows = useMemo(() => {
    return uploads.map((upload) => {
      const poster = pickPoster(upload)
      const image = poster ? (
        <img
          src={poster}
          alt="poster"
          style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 8, background: '#111' }}
        />
      ) : (
        <div style={{ width: 96, height: 96, borderRadius: 8, background: '#1c1c1c' }} />
      )

      const productionHref = `/productions?upload=${encodeURIComponent(String(upload.id))}`
      const titleHref = `/publish?id=${encodeURIComponent(String(upload.id))}`
      const displayName = upload.original_filename || `Upload ${upload.id}`

      return (
        <tr key={upload.id}>
          <td style={{ padding: '12px', width: 110 }}>{image}</td>
          <td style={{ padding: '12px', verticalAlign: 'top' }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <a
                href={productionHref}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '6px 12px',
                  borderRadius: 8,
                  border: '1px solid rgba(255,255,255,0.2)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontWeight: 600,
                  background: 'rgba(255,255,255,0.05)',
                }}
              >
                Open Production
              </a>
            </div>
            <div style={{ marginTop: 12 }}>
              <a href={titleHref} style={{ color: '#0a84ff', fontWeight: 600, textDecoration: 'none' }}>{displayName}</a>
              <div style={{ color: '#666', marginTop: 4 }}>{formatBytes(upload.size_bytes)}</div>
              <div style={{ color: '#666' }}>{upload.width || 0}×{upload.height || 0}</div>
              <div style={{ color: '#666' }}>{formatDate(upload.created_at)}</div>
            </div>
          </td>
          <td style={{ padding: '12px', verticalAlign: 'top' }}>
            {renderPublishedTo(upload)}
          </td>
        </tr>
      )
    })
  }, [uploads, renderPublishedTo])

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
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>My Uploads</h1>
            <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>Upload new videos and manage where they’re published.</p>
          </div>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button
              onClick={handleFileChoose}
              style={{
                background: '#0a84ff',
                color: '#fff',
                border: 'none',
                borderRadius: 10,
                padding: '10px 18px',
                fontWeight: 600,
                cursor: 'pointer',
                boxShadow: '0 6px 16px rgba(10,132,255,0.35)',
              }}
              disabled={uploading}
            >
              {uploading ? 'Uploading…' : 'Upload New Video'}
            </button>
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
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              style={{ display: 'none' }}
              onChange={handleFileSelected}
            />
          </div>
        </header>

        {(uploadError || uploadMessage || uploading) && (
          <div style={{
            padding: '12px 16px',
            borderRadius: 12,
            marginBottom: 20,
            background: '#111',
            border: '1px solid #222',
          }}>
            {uploadError && <div style={{ color: '#ff6b6b' }}>{uploadError}</div>}
            {uploadMessage && <div style={{ color: '#70ff9d' }}>{uploadMessage}</div>}
            {uploading && (
              <div style={{ marginTop: 8 }}>
                <div style={{ height: 6, background: '#1f1f1f', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${uploadProgress ?? 0}%`,
                      transition: 'width 120ms linear',
                      height: '100%',
                      background: '#0a84ff',
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div style={{ color: '#888', padding: '12px 0' }}>Loading uploads…</div>
        ) : error ? (
          <div style={{ color: '#ff6b6b', padding: '12px 0' }}>{error}</div>
        ) : uploads.length === 0 ? (
          <div style={{ color: '#bbb', padding: '12px 0' }}>No uploads yet. Get started by uploading your first video.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', padding: '12px', color: '#aaa', fontWeight: 600 }}>Video</th>
                  <th style={{ textAlign: 'left', padding: '12px', color: '#aaa', fontWeight: 600 }}>Details</th>
                  <th style={{ textAlign: 'left', padding: '12px', color: '#aaa', fontWeight: 600 }}>Published To</th>
                </tr>
              </thead>
              <tbody>{tableRows}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default UploadsPage
