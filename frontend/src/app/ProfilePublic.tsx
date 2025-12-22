import React, { useEffect, useState } from 'react'

type ProfilePayload = {
  userId: number
  displayName: string
  avatarUrl: string | null
  bio: string | null
  memberSince: string
  slug: string | null
}

type ProfileResponse = {
  profile: ProfilePayload | null
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return null
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short' })
  } catch {
    return null
  }
}

export default function ProfilePublic() {
  const [profile, setProfile] = useState<ProfilePayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      setLoading(true)
      setError(null)
      try {
        const path = window.location.pathname || '/'
        const segments = path.replace(/\/+$/, '').split('/')
        const slugOrId = segments[segments.length - 1] || ''
        if (!slugOrId) {
          setError('Profile not found.')
          setLoading(false)
          return
        }

        let userId: number | null = null

        if (/^\d+$/.test(slugOrId)) {
          userId = Number(slugOrId)
        } else {
          const res = await fetch(`/api/users/slug/${encodeURIComponent(slugOrId)}`, {
            credentials: 'same-origin',
          })
          const data = await res.json().catch(() => ({} as any))
          if (!res.ok) {
            if (res.status === 404) {
              setError('Profile not found.')
              setLoading(false)
              return
            }
            const code = data && data.error ? String(data.error) : 'failed_to_resolve_slug'
            setError(code === 'slug_reserved' || code === 'bad_slug_format' || code === 'slug_too_short' ? 'Profile not found.' : 'Failed to load profile.')
            setLoading(false)
            return
          }
          userId = Number(data.userId)
        }

        if (!Number.isFinite(userId) || !userId || userId <= 0) {
          setError('Profile not found.')
          setLoading(false)
          return
        }

        const res = await fetch(`/api/profile/${userId}`, { credentials: 'same-origin' })
        const data = (await res.json()) as ProfileResponse
        if (!res.ok || !data.profile) {
          setError(res.status === 404 ? 'Profile not found.' : 'Failed to load profile.')
          setLoading(false)
          return
        }
        if (canceled) return
        setProfile(data.profile)
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
    }
  }, [])

  if (loading) {
    return <div style={{ padding: 20, color: '#fff' }}>Loading…</div>
  }

  if (error || !profile) {
    return (
      <div style={{ padding: 20, color: '#fff' }}>
        <h1 style={{ fontSize: 22, marginBottom: 12 }}>Profile</h1>
        <p style={{ marginBottom: 8 }}>{error || 'Profile not found.'}</p>
      </div>
    )
  }

  const memberSince = formatDate(profile.memberSince)

  return (
    <div style={{ padding: 20, color: '#fff', maxWidth: 640 }}>
      <h1 style={{ fontSize: 22, marginBottom: 8 }}>{profile.displayName || 'Profile'}</h1>
      {profile.slug && (
        <p style={{ fontSize: 13, opacity: 0.75, marginBottom: 4 }}>
          <span style={{ fontFamily: 'monospace' }}>/users/{profile.slug}</span>
        </p>
      )}
      {memberSince && (
        <p style={{ fontSize: 13, opacity: 0.7, marginBottom: 16 }}>
          Member since {memberSince}
        </p>
      )}
      <div
        style={{
          borderRadius: 10,
          border: '1px solid rgba(255,255,255,0.15)',
          padding: 16,
          background: 'rgba(255,255,255,0.03)',
          display: 'grid',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
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
            {profile.avatarUrl ? (
              <img
                src={profile.avatarUrl}
                alt={profile.displayName || 'Avatar'}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              <span style={{ fontSize: 28, opacity: 0.35 }}>?</span>
            )}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
              {profile.displayName || 'Profile'}
            </div>
            {profile.bio && (
              <p style={{ fontSize: 13, opacity: 0.85, whiteSpace: 'pre-wrap' }}>
                {profile.bio}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

