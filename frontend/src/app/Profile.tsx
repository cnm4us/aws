import React, { useEffect, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type ProfileResponse = {
  profile: {
    id: number
    user_id: number
    display_name: string
    avatar_url: string | null
    bio: string | null
    is_public: boolean
    show_bio: boolean
    created_at: string
    updated_at: string
    slug?: string | null
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

export default function Profile() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [bio, setBio] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [showBio, setShowBio] = useState(true)

  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  const [slug, setSlug] = useState('')
  const [slugSaving, setSlugSaving] = useState(false)
  const [slugMessage, setSlugMessage] = useState<string | null>(null)
  const [slugError, setSlugError] = useState<string | null>(null)

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
          setError('You must be logged in to edit your profile.')
          setLoading(false)
          return
        }

        let profileData: ProfileResponse | null = null
        if (profRes.ok) {
          profileData = (await profRes.json()) as ProfileResponse
        }

        const profile = profileData?.profile || null
        if (profile) {
          setDisplayName(profile.display_name || '')
          setAvatarUrl(profile.avatar_url || '')
          setBio(profile.bio || '')
          setIsPublic(Boolean(profile.is_public))
          setShowBio(Boolean(profile.show_bio))
          setSlug((profile.slug || '').trim())
        } else {
          const fallbackName =
            (meData.displayName && meData.displayName.trim()) ||
            (meData.email ? meData.email.split('@')[0] : '') ||
            ''
          setDisplayName(fallbackName)
          setAvatarUrl('')
          setBio('')
          setIsPublic(true)
          setShowBio(true)
        }

        setLoading(false)
      } catch (e: any) {
        if (canceled) return
        setError('Failed to load profile.')
        setLoading(false)
      }
    }
    void load()
    return () => {
      canceled = true
    }
  }, [])

  async function save() {
    if (!me || !me.userId) {
      setError('You must be logged in to edit your profile.')
      return
    }
    const trimmedName = String(displayName || '').trim()
    if (!trimmedName) {
      setError('Display name is required.')
      return
    }
    setSaving(true)
    setSavedMessage(null)
    setError(null)
    try {
      const csrf = getCsrfToken()
      const res = await fetch('/api/profile/me', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify({
          displayName: trimmedName,
          avatarUrl: avatarUrl || null,
          bio: bio || null,
          isPublic,
          showBio,
        }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        if (data && data.error === 'display_name_required') {
          setError('Display name is required.')
        } else {
          setError('Failed to save profile.')
        }
        return
      }
      setSavedMessage('Profile saved.')
      setTimeout(() => setSavedMessage(null), 1500)
    } catch {
      setError('Failed to save profile.')
    } finally {
      setSaving(false)
    }
  }

  async function saveSlug() {
    if (!me || !me.userId) {
      setSlugError('You must be logged in to edit your profile.')
      return
    }
    const trimmed = String(slug || '').trim()
    if (!trimmed) {
      setSlugError('Profile handle is required.')
      return
    }
    setSlugSaving(true)
    setSlugMessage(null)
    setSlugError(null)
    try {
      const csrf = getCsrfToken()
      const res = await fetch('/api/profile/slug', {
        method: 'PUT',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          ...(csrf ? { 'x-csrf-token': csrf } : {}),
        },
        body: JSON.stringify({ slug: trimmed }),
      })
      const data = await res.json().catch(() => ({} as any))
      if (!res.ok) {
        const code = data && data.error ? String(data.error) : ''
        if (code === 'slug_too_short') {
          setSlugError('Profile handle is too short (min 3 characters).')
        } else if (code === 'slug_reserved') {
          setSlugError('That profile handle is reserved and cannot be used.')
        } else if (code === 'slug_taken') {
          setSlugError('That profile handle is already taken.')
        } else if (code === 'bad_slug_format') {
          setSlugError("Use only a–z, 0–9, '-' (start with a letter, 3–32 characters).")
        } else {
          setSlugError('Failed to update profile handle.')
        }
        return
      }
      setSlugMessage('Profile handle saved.')
      setTimeout(() => setSlugMessage(null), 1500)
    } catch {
      setSlugError('Failed to update profile handle.')
    } finally {
      setSlugSaving(false)
    }
  }

  if (loading && !me) {
    return <div style={{ padding: 20, color: '#fff' }}>Loading…</div>
  }

  if (error && !me?.userId) {
    return (
      <div style={{ padding: 20, color: '#fff' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Profile</h1>
        <p style={{ marginBottom: 10 }}>{error}</p>
        <a href="/login" style={{ color: '#9cf' }}>Go to login</a>
      </div>
    )
  }

  return (
    <div style={{ padding: 20, color: '#fff', maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>Profile</h1>
      <p style={{ fontSize: 14, opacity: 0.8, marginBottom: 16 }}>
        Public Profile — changes you make here are visible to other users and are intended to be durable.
      </p>
      <div
        style={{
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: 16,
          background: 'rgba(255,255,255,0.03)',
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 }}
        >
          <div style={{ fontWeight: 600 }}>Profile Details</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              onClick={save}
              disabled={saving}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.3)',
                background: saving ? 'rgba(255,255,255,0.1)' : '#1976d2',
                color: '#fff',
                fontSize: 13,
                cursor: saving ? 'default' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {savedMessage && (
              <span style={{ fontSize: 12, opacity: 0.85 }}>
                {savedMessage}
              </span>
            )}
          </div>
        </div>

        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 14 }}>
          Changes to your profile are public and persistent. Make sure what you share here is how you want to be seen.
        </p>

        {error && (
          <div style={{ marginBottom: 10, color: '#ffb3b3', fontSize: 13 }}>{error}</div>
        )}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 16,
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: '50%',
              overflow: 'hidden',
              border: '1px solid rgba(255,255,255,0.25)',
              background: 'rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt="Current avatar"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 28, opacity: 0.35 }}>?</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>Avatar</div>
            <a href="/profile/avatar" style={{ fontSize: 13, color: '#9cf' }}>
              Edit avatar
            </a>
          </div>
        </div>

        <div style={{ display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13 }}>Display name</span>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="How you appear to others"
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(0,0,0,0.45)',
                color: '#fff',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13 }}>Avatar URL</span>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://example.com/avatar.jpg (optional)"
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(0,0,0,0.45)',
                color: '#fff',
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 13 }}>Bio</span>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={4}
              placeholder="Short description of who you are and what you publish."
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.25)',
                background: 'rgba(0,0,0,0.45)',
                color: '#fff',
                resize: 'vertical',
              }}
            />
          </label>

          <div
            style={{
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.2)',
              padding: 10,
              background: 'rgba(255,255,255,0.02)',
              display: 'grid',
              gap: 8,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <label style={{ display: 'grid', gap: 4, flex: 1 }}>
                <span style={{ fontSize: 13 }}>Profile handle</span>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="your-name"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.25)',
                    background: 'rgba(0,0,0,0.45)',
                    color: '#fff',
                  }}
                />
              </label>
              <button
                type="button"
                onClick={saveSlug}
                disabled={slugSaving}
                style={{
                  alignSelf: 'flex-end',
                  padding: '6px 12px',
                  borderRadius: 999,
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: slugSaving ? 'rgba(255,255,255,0.1)' : '#1976d2',
                  color: '#fff',
                  fontSize: 13,
                  cursor: slugSaving ? 'default' : 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {slugSaving ? 'Saving…' : 'Save handle'}
              </button>
            </div>
            <div style={{ fontSize: 12, opacity: 0.75 }}>
              Public URL:{' '}
              <span style={{ fontFamily: 'monospace' }}>
                /users/{slug || '<handle>'}
              </span>
            </div>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              Use only lowercase letters, numbers, and <code>-</code>. Must start with a letter and be 3–32 characters. Some words are reserved.
            </div>
            {slugError && (
              <div style={{ marginTop: 4, color: '#ffb3b3', fontSize: 12 }}>{slugError}</div>
            )}
            {slugMessage && !slugError && (
              <div style={{ marginTop: 4, color: '#b3ffd2', fontSize: 12 }}>{slugMessage}</div>
            )}
          </div>

          <div style={{ display: 'grid', gap: 8, marginTop: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={isPublic}
                onChange={(e) => setIsPublic(e.target.checked)}
              />
              <span>Profile is public</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={showBio}
                onChange={(e) => setShowBio(e.target.checked)}
              />
              <span>Show bio on public profile</span>
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
