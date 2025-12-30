import React, { useCallback, useEffect, useRef, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
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

function extLower(name: string): string {
  const base = String(name || '')
  const m = base.match(/(\.[^.]+)$/)
  return (m ? m[1] : '').toLowerCase()
}

function isAllowedFile(kind: 'video' | 'logo' | 'audio', file: File): boolean {
  const ct = String(file.type || '').toLowerCase()
  const ext = extLower(file.name)
  if (kind === 'video') {
    if (ct.startsWith('video/')) return true
    return ['.mp4', '.webm', '.mov'].includes(ext)
  }
  if (kind === 'logo') {
    if (ct.startsWith('image/')) return true
    return ['.png', '.jpg', '.jpeg', '.svg'].includes(ext)
  }
  if (kind === 'audio') {
    if (ct.startsWith('audio/')) return true
    return ['.mp3', '.wav', '.aac', '.m4a', '.mp4', '.ogg', '.opus'].includes(ext)
  }
  return false
}

function acceptForKind(kind: 'video' | 'logo' | 'audio'): string {
  if (kind === 'logo') return 'image/png,image/jpeg,image/svg+xml'
  if (kind === 'audio') return 'audio/*'
  return 'video/*'
}

const UploadNewPage: React.FC = () => {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [modifiedName, setModifiedName] = useState('')
  const [description, setDescription] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [uploadMessage, setUploadMessage] = useState<string | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const kind = (() => {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('kind') || '').toLowerCase()
    return raw === 'logo' ? 'logo' : raw === 'audio' ? 'audio' : 'video'
  })()

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const user = await ensureLoggedIn()
      if (cancelled) return
      setMe(user)
      if (!user) {
        setUploadError(kind === 'video' ? 'Please sign in to upload videos.' : kind === 'logo' ? 'Please sign in to upload logos.' : 'Please sign in to upload audio.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleFileChoose = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleFileSelected = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files && event.target.files[0]
    if (!selected) return
    if (!isAllowedFile(kind, selected)) {
      setUploadError(
        kind === 'video'
          ? 'Unsupported video type. Use MP4, MOV, or WebM.'
          : kind === 'logo'
            ? 'Unsupported logo type. Use PNG, JPG, or SVG.'
            : 'Unsupported audio type. Use MP3, WAV, AAC, or M4A.'
      )
      setUploadMessage(null)
      setUploadProgress(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    setFile(selected)
    setUploadMessage(null)
    setUploadError(null)
    setUploadProgress(null)
    setModifiedName((prev) => (prev.trim().length ? prev : selected.name))
  }, [])

  const resetForm = useCallback(() => {
    setFile(null)
    setUploadProgress(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()
      if (!file) {
        setUploadError('Choose a file to upload.')
        return
      }
      if (!me?.userId) {
        setUploadError(kind === 'video' ? 'Please sign in to upload videos.' : kind === 'logo' ? 'Please sign in to upload logos.' : 'Please sign in to upload audio.')
        return
      }

      const trimmedName = modifiedName.trim() || file.name
      const trimmedDescription = description.trim()
      setUploading(true)
      setUploadError(null)
      setUploadMessage(null)
      setUploadProgress(0)

      try {
        const meta = kind === 'video' ? await probeVideo(file) : { width: null, height: null, durationSeconds: null }
        const body = {
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          modifiedFilename: trimmedName,
          description: trimmedDescription || undefined,
          kind,
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
        if (!signRes.ok) {
          const data = await signRes.json().catch(() => ({}))
          throw new Error(data?.detail || data?.error || 'Failed to prepare upload')
        }
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

        const completeHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrfToken = getCsrfToken()
        if (csrfToken) completeHeaders['x-csrf-token'] = csrfToken
        await fetch('/api/mark-complete', {
          method: 'POST',
          credentials: 'same-origin',
          headers: completeHeaders,
          body: JSON.stringify({ id, sizeBytes: file.size, etag }),
        })

        setUploadMessage(kind === 'video' ? 'Upload complete! The file will appear in your videos once processing finishes.' : 'Upload complete! The file will appear in your uploads shortly.')
        setUploadProgress(100)
        setModifiedName('')
        setDescription('')
        resetForm()
      } catch (err: any) {
        console.error('upload failed', err)
        setUploadError(err?.message || 'Upload failed. Please try again.')
      } finally {
        setUploading(false)
      }
    },
    [file, me, modifiedName, description, resetForm]
  )

  if (me === null) {
    return (
      <div style={{ color: '#fff', padding: 24, fontFamily: 'system-ui, sans-serif', minHeight: '100vh', background: '#050505' }}>
        <h2>{kind === 'video' ? 'Upload Video' : kind === 'logo' ? 'Upload Logo' : 'Upload Audio'}</h2>
        <p>Checking your session…</p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 80px' }}>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>{kind === 'video' ? 'Upload Video' : kind === 'logo' ? 'Upload Logo' : 'Upload Audio'}</h1>
            <p style={{ margin: '4px 0 0 0', color: '#a0a0a0' }}>Choose a file, add a friendly title, and describe it for your team.</p>
          </div>
          <a
            href={kind === 'video' ? '/uploads' : `/uploads?kind=${encodeURIComponent(kind)}`}
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
            Back to Uploads
          </a>
        </header>

        <form
          onSubmit={handleSubmit}
          style={{
            background: '#0c0c0c',
            borderRadius: 16,
            padding: 24,
            border: '1px solid #161616',
            boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                {kind === 'video' ? 'Select Video File' : kind === 'logo' ? 'Select Logo File' : 'Select Audio File'}
              </label>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <button
                  type="button"
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
                  {file ? 'Choose Another File' : 'Choose File'}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={acceptForKind(kind)}
                  style={{ display: 'none' }}
                  onChange={handleFileSelected}
                />
                {file && (
                  <div style={{ color: '#bbb', wordBreak: 'break-all' }}>
                    {file.name} • {(file.size / (1024 * 1024)).toFixed(2)} MB
                  </div>
                )}
              </div>
            </div>

            <div>
              <label htmlFor="modifiedFilename" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                Display Name
              </label>
              <input
                id="modifiedFilename"
                type="text"
                value={modifiedName}
                onChange={(event) => setModifiedName(event.target.value)}
                placeholder="Enter a human-friendly title"
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 10,
                  border: '1px solid #1f1f1f',
                  background: '#050505',
                  color: '#fff',
                  fontSize: 16,
                }}
                disabled={uploading}
              />
            </div>

            <div>
              <label htmlFor="description" style={{ display: 'block', fontWeight: 600, marginBottom: 8 }}>
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Share context about the video…"
                rows={5}
                style={{
                  width: '100%',
                  padding: '12px',
                  borderRadius: 10,
                  border: '1px solid #1f1f1f',
                  background: '#050505',
                  color: '#fff',
                  fontSize: 16,
                  resize: 'vertical',
                  minHeight: 120,
                }}
                disabled={uploading}
              />
            </div>

            <div>
              <button
                type="submit"
                style={{
                  background: '#0a84ff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 10,
                  padding: '12px 24px',
                  fontWeight: 700,
                  cursor: uploading ? 'not-allowed' : 'pointer',
                  opacity: uploading ? 0.7 : 1,
                  boxShadow: '0 10px 28px rgba(10,132,255,0.35)',
                }}
                disabled={uploading || !file}
              >
                {uploading ? 'Uploading…' : kind === 'video' ? 'Upload New Video' : kind === 'logo' ? 'Upload New Logo' : 'Upload New Audio'}
              </button>
            </div>
          </div>
        </form>

        {(uploadError || uploadMessage || uploadProgress != null) && (
          <div
            style={{
              padding: '16px',
              borderRadius: 12,
              marginTop: 24,
              background: '#111',
              border: '1px solid #222',
            }}
          >
            {uploadError && <div style={{ color: '#ff6b6b', marginBottom: uploadMessage ? 8 : 0 }}>{uploadError}</div>}
            {uploadMessage && <div style={{ color: '#70ff9d' }}>{uploadMessage}</div>}
            {uploadProgress != null && (
              <div style={{ marginTop: 12 }}>
                <div style={{ height: 6, background: '#1f1f1f', borderRadius: 999 }}>
                  <div
                    style={{
                      width: `${uploadProgress}%`,
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
      </div>
    </div>
  )
}

export default UploadNewPage
