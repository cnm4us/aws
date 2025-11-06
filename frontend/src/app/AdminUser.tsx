import React, { useEffect, useMemo, useState } from 'react'

type UserDetail = {
  id: number
  email: string
  displayName: string | null
  orgId: number | null
  emailVerifiedAt: string | null
  phoneNumber: string | null
  phoneVerifiedAt: string | null
  verificationLevel: number
  kycStatus: string | null
  canCreateGroup: boolean | null
  canCreateChannel: boolean | null
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
}

type RolesResponse = { roles: string[] }
type SpaceRole = { id: number; type: string; name: string; slug: string; roles: string[] }
type SpacesResponse = { spaces: SpaceRole[] }

function parseUserIdFromPath(): number | null {
  try {
    const m = window.location.pathname.match(/\/adminx\/users\/(\d+)/)
    if (!m) return null
    const n = Number(m[1])
    return Number.isFinite(n) && n > 0 ? n : null
  } catch { return null }
}

export default function AdminUserPage() {
  const userId = useMemo(parseUserIdFromPath, [])
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [siteRoles, setSiteRoles] = useState<string[]>([])
  const [spaces, setSpaces] = useState<SpaceRole[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!userId) { setError('Bad user id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const [uRes, rRes, sRes] = await Promise.all([
          fetch(`/api/admin/users/${userId}`, { credentials: 'same-origin' }),
          fetch(`/api/admin/users/${userId}/roles`, { credentials: 'same-origin' }),
          fetch(`/api/admin/users/${userId}/spaces`, { credentials: 'same-origin' }),
        ])
        if (!uRes.ok) throw new Error('user')
        const u = (await uRes.json()) as UserDetail
        const roles = rRes.ok ? ((await rRes.json()) as RolesResponse).roles || [] : []
        const s = sRes.ok ? ((await sRes.json()) as SpacesResponse).spaces || [] : []
        if (canceled) return
        setDetail(u)
        setSiteRoles(roles)
        setSpaces(s)
      } catch (e) {
        if (!canceled) setError('Failed to load user')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [userId])

  if (!userId) {
    return <div style={{ padding: 16, color: '#fff' }}>Invalid user id.</div>
  }

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Admin • User #{userId} (SPA beta)</h1>
      <div style={{ marginBottom: 12 }}>
        <a href="/admin/users" style={{ color: '#9cf', marginRight: 12, textDecoration: 'none' }}>Back to Users (legacy)</a>
        <a href={`/admin/users/${userId}`} style={{ color: '#9cf', textDecoration: 'none' }}>Open in legacy</a>
      </div>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      {loading && !detail ? <div>Loading…</div> : null}
      {detail && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Profile</div>
            <div>Email: {detail.email}</div>
            <div>Display Name: {detail.displayName || ''}</div>
            <div>Phone: {detail.phoneNumber || ''}</div>
            <div>Org ID: {detail.orgId ?? ''}</div>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Verification</div>
            <div>Email Verified: {detail.emailVerifiedAt ? 'Yes' : 'No'}</div>
            <div>Phone Verified: {detail.phoneVerifiedAt ? 'Yes' : 'No'}</div>
            <div>Level: {detail.verificationLevel ?? 0}</div>
            <div>KYC: {detail.kycStatus ?? 'none'}</div>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Capabilities</div>
            <div>Can Create Group: {detail.canCreateGroup == null ? 'default' : (detail.canCreateGroup ? 'yes' : 'no')}</div>
            <div>Can Create Channel: {detail.canCreateChannel == null ? 'default' : (detail.canCreateChannel ? 'yes' : 'no')}</div>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Meta</div>
            <div>Created: {detail.createdAt}</div>
            <div>Updated: {detail.updatedAt || ''}</div>
            <div>Deleted: {detail.deletedAt || ''}</div>
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Site Roles</div>
          {!siteRoles.length ? (
            <div style={{ opacity: 0.8 }}>No site roles.</div>
          ) : (
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {siteRoles.map((r) => (<li key={r}>{r}</li>))}
            </ul>
          )}
        </div>
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Spaces & Roles</div>
          {!spaces.length ? (
            <div style={{ opacity: 0.8 }}>No space roles.</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {spaces.map((sp) => (
                <div key={sp.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '8px 10px' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>{sp.name} <span style={{ opacity: 0.7, fontWeight: 400 }}>({sp.type})</span></div>
                    <div style={{ opacity: 0.8, fontSize: 13 }}>slug: {sp.slug}</div>
                  </div>
                  <div style={{ whiteSpace: 'nowrap', fontSize: 13, opacity: 0.9 }}>{sp.roles.join(', ')}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

