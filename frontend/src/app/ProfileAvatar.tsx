import React, { useEffect, useState, useRef } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type ProfileResponse = {
  profile: {
    avatar_url: string | null
  } | null
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch {
    return null
  }
}

export default function ProfileAvatar() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [currentAvatar, setCurrentAvatar] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const cameraInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const [meRes, profRes] = await Promise.all([
          fetch('/api/me', { credentials: 'same-origin' }),
          fetch('/api/profile/me', { credentials: 'same-origin' }),
        ])
        if (!meRes.ok) throw new Error('me_failed')
        const meData = (await meRes.json()) as MeResponse
        if (canceled) return
        setMe(meData)
        if (!meData.userId) {
          setError('You must be logged in to edit your avatar.')
          setLoading(false)
          return
        }
        if (profRes.ok) {
          const profData = (await profRes.json()) as ProfileResponse
          const url = profData?.profile?.avatar_url || null
          setCurrentAvatar(url)
        }
        setLoading(false)
      } catch {
        if (canceled) return
        setError('Failed to load profile.')
        setLoading(false)
      }
    }
    void load()
    return () => {
      canceled = true
      if (previewUrl) {
        try { URL.revokeObjectURL(previewUrl) } catch {}
      }
    }
  }, [previewUrl])

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files && e.target.files[0]
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setError('Please choose an image file.')
      return
    }
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl) } catch {}
    }
    setFile(f)
    setError(null)
    setMessage(null)
    setUploadProgress(null)
    const url = URL.createObjectURL(f)
    setPreviewUrl(url)
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault()
    if (!me || !me.userId) {
      setError('You must be logged in to edit your avatar.')
      return
    }
    if (!file) {
      setError('Choose an image to upload.')
      return
    }
    setUploading(true)
    setError(null)
    setMessage(null)
    setUploadProgress(0)
    try {
      const csrf = getCsrfToken()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      if (csrf) headers['x-csrf-token'] = csrf

      const signRes = await fetch('/api/profile/avatar/sign', {
        method: 'POST',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type || 'image/jpeg',
          sizeBytes: file.size,
        }),
      })
      if (!signRes.ok) throw new Error('Failed to prepare avatar upload')
      const signJson = await signRes.json()
      const { key, post } = signJson
      if (!post || !post.url || !post.fields) throw new Error('Invalid avatar upload data')

      await new Promise<void>((resolve, reject) => {
        const formData = new FormData()
        Object.entries(post.fields || {}).forEach(([k, v]) => {
          formData.append(k, v as string)
        })
        formData.append('file', file)

        const xhr = new XMLHttpRequest()
        xhr.open('POST', post.url, true)
        xhr.upload.addEventListener('progress', (ev) => {
          if (ev.lengthComputable) {
            const pct = Math.round((ev.loaded / ev.total) * 100)
            setUploadProgress(pct)
          }
        })
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve()
          } else {
            reject(new Error(`Avatar upload failed (${xhr.status})`))
          }
        }
        xhr.onerror = () => reject(new Error('Network error uploading avatar'))
        xhr.send(formData)
      })

      const completeHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf2 = getCsrfToken()
      if (csrf2) completeHeaders['x-csrf-token'] = csrf2
      const completeRes = await fetch('/api/profile/avatar/complete', {
        method: 'POST',
        credentials: 'same-origin',
        headers: completeHeaders,
        body: JSON.stringify({ key }),
      })
      const completeJson = await completeRes.json().catch(() => ({} as any))
      if (!completeRes.ok) {
        const errCode = completeJson?.error || 'failed_to_complete_avatar'
        throw new Error(errCode)
      }
      const newUrl = completeJson?.url || null
      if (newUrl && typeof newUrl === 'string') {
        setCurrentAvatar(newUrl)
      }
      setMessage('Avatar updated.')
      setUploadProgress(100)
    } catch (err: any) {
      setError(err?.message || 'Failed to update avatar.')
    } finally {
      setUploading(false)
    }
  }

  if (loading && !me) {
    return <div style={{ padding: 20, color: '#fff' }}>Loading…</div>
  }

  if (error && !me?.userId) {
    return (
      <div style={{ padding: 20, color: '#fff' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Edit Avatar</h1>
        <p style={{ marginBottom: 10 }}>{error}</p>
        <a href="/login" style={{ color: '#9cf' }}>Go to login</a>
      </div>
    )
  }

  return (
    <div style={{ padding: 20, color: '#fff', maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Edit Avatar</h1>
      <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 16 }}>
        Choose an image to use as your public avatar. Avatars are visible to other users and may appear next to your name in the future.
      </p>

      <form onSubmit={onSave} style={{ borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', padding: 16, background: 'rgba(255,255,255,0.03)' }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', marginBottom: 16 }}>
          <div style={{ width: 96, height: 96, borderRadius: '50%', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.25)', background: 'rgba(255,255,255,0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {previewUrl ? (
              <img src={previewUrl} alt="Selected avatar preview" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : currentAvatar ? (
              <img src={currentAvatar} alt="Current avatar" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : (
              <span style={{ fontSize: 32, opacity: 0.35 }}>?</span>
            )}
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', marginBottom: 8, fontSize: 13 }}>Select image</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: '#1976d2',
                  color: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Choose from device
              </button>
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                style={{
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'rgba(255,255,255,0.1)',
                  color: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Use camera
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={onFileChange}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="user"
              style={{ display: 'none' }}
              onChange={onFileChange}
            />
            <p style={{ fontSize: 12, opacity: 0.7 }}>
              Recommended: square image, at least 256×256. Maximum ~5 MB. Camera capture may be available on mobile devices.
            </p>
          </div>
        </div>

        {error && (
          <div style={{ marginBottom: 10, color: '#ffb3b3', fontSize: 13 }}>
            {error}
          </div>
        )}
        {uploadProgress != null && (
          <div style={{ marginBottom: 10, fontSize: 12, opacity: 0.85 }}>
            Uploading… {uploadProgress}%
          </div>
        )}
        {message && (
          <div style={{ marginBottom: 10, fontSize: 12, color: '#9cf' }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 4 }}>
          <button
            type="submit"
            disabled={uploading || !file}
            style={{
              padding: '8px 16px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.3)',
              background: uploading ? 'rgba(255,255,255,0.1)' : '#1976d2',
              color: '#fff',
              fontSize: 14,
              cursor: uploading || !file ? 'default' : 'pointer',
            }}
          >
            {uploading ? 'Saving…' : 'Use this avatar'}
          </button>
          <a href="/profile" style={{ fontSize: 13, color: '#9cf' }}>
            Back to Profile
          </a>
        </div>
      </form>
    </div>
  )
}
