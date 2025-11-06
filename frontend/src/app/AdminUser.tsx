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
type RoleCatalogItem = { id: number; name: string; scope: string | null; spaceType: string | null }
type RolesCatalogResponse = { roles: RoleCatalogItem[] }

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

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
  // Profile edit fields
  const [pEmail, setPEmail] = useState('')
  const [pDisplayName, setPDisplayName] = useState('')
  const [pPhone, setPPhone] = useState('')
  const [pOrgId, setPOrgId] = useState<string>('')
  const [pVerificationLevel, setPVerificationLevel] = useState<string>('0')
  const [pKycStatus, setPKycStatus] = useState<string>('none')
  const [pPassword, setPPassword] = useState('')
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSaved, setProfileSaved] = useState<string | null>(null)
  const [siteRoles, setSiteRoles] = useState<string[]>([])
  const [spaces, setSpaces] = useState<SpaceRole[]>([])
  const [roleCatalog, setRoleCatalog] = useState<RoleCatalogItem[]>([])
  const siteRoleNames = useMemo(() => roleCatalog
    .filter((r) => (r.scope === 'site') || /^site_/i.test(String(r.name)))
    .map((r) => String(r.name)), [roleCatalog])
  const [selectedRoles, setSelectedRoles] = useState<string[]>([])
  const [rolesSaving, setRolesSaving] = useState(false)
  const [rolesSaved, setRolesSaved] = useState<string | null>(null)
  const rolesDirty = useMemo(() => {
    const a = new Set(siteRoles)
    const b = new Set(selectedRoles)
    if (a.size !== b.size) return true
    for (const r of a) if (!b.has(r)) return true
    return false
  }, [siteRoles, selectedRoles])

  type CapTri = boolean | null
  const [capGroup, setCapGroup] = useState<CapTri>(null)
  const [capChannel, setCapChannel] = useState<CapTri>(null)
  const [capSaving, setCapSaving] = useState(false)
  const [capSaved, setCapSaved] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!userId) { setError('Bad user id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const [uRes, rRes, sRes, rcRes, capsRes] = await Promise.all([
          fetch(`/api/admin/users/${userId}`, { credentials: 'same-origin' }),
          fetch(`/api/admin/users/${userId}/roles`, { credentials: 'same-origin' }),
          fetch(`/api/admin/users/${userId}/spaces`, { credentials: 'same-origin' }),
          fetch(`/api/admin/roles`, { credentials: 'same-origin' }),
          fetch(`/api/admin/users/${userId}/capabilities`, { credentials: 'same-origin' }),
        ])
        if (!uRes.ok) throw new Error('user')
        const u = (await uRes.json()) as UserDetail
        const roles = rRes.ok ? ((await rRes.json()) as RolesResponse).roles || [] : []
        const s = sRes.ok ? ((await sRes.json()) as SpacesResponse).spaces || [] : []
        const rc = rcRes.ok ? ((await rcRes.json()) as RolesCatalogResponse).roles || [] : []
        const caps = capsRes.ok ? (await capsRes.json()) as any : null
        if (canceled) return
        setDetail(u)
        // Seed profile form
        setPEmail(u.email || '')
        setPDisplayName(u.displayName || '')
        setPPhone(u.phoneNumber || '')
        setPOrgId(u.orgId == null ? '' : String(u.orgId))
        setPVerificationLevel(u.verificationLevel == null ? '0' : String(u.verificationLevel))
        setPKycStatus(u.kycStatus || 'none')
        setSiteRoles(roles)
        setSpaces(s)
        setRoleCatalog(rc)
        setSelectedRoles(roles)
        if (caps && caps.overrides) {
          setCapGroup(caps.overrides.canCreateGroup ?? null)
          setCapChannel(caps.overrides.canCreateChannel ?? null)
        } else {
          setCapGroup(null); setCapChannel(null)
        }
      } catch (e) {
        if (!canceled) setError('Failed to load user')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [userId])

  async function saveRoles() {
    if (!userId || rolesSaving) return
    setRolesSaving(true); setRolesSaved(null)
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/admin/users/${userId}/roles`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ roles: selectedRoles })
      })
      if (!res.ok) throw new Error('save_roles_failed')
      setSiteRoles(selectedRoles)
      setRolesSaved('Saved')
      setTimeout(() => setRolesSaved(null), 1200)
    } catch (e) {
      setRolesSaved('Failed')
    } finally { setRolesSaving(false) }
  }

  async function saveCapabilities() {
    if (!userId || capSaving) return
    setCapSaving(true); setCapSaved(null)
    try {
      const csrf = getCsrfToken()
      const body: any = {}
      body.canCreateGroup = capGroup
      body.canCreateChannel = capChannel
      const res = await fetch(`/api/admin/users/${userId}/capabilities`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error('save_caps_failed')
      setCapSaved('Saved')
      setTimeout(() => setCapSaved(null), 1200)
    } catch (e) {
      setCapSaved('Failed')
    } finally { setCapSaving(false) }
  }

  const profileDirty = useMemo(() => {
    if (!detail) return false
    const eq = (a: any, b: any) => String(a ?? '') === String(b ?? '')
    if (!eq(pEmail, detail.email)) return true
    if (!eq(pDisplayName, detail.displayName)) return true
    if (!eq(pPhone, detail.phoneNumber)) return true
    if (!eq(pOrgId, detail.orgId == null ? '' : String(detail.orgId))) return true
    if (!eq(pVerificationLevel, detail.verificationLevel == null ? '0' : String(detail.verificationLevel))) return true
    if (!eq(pKycStatus, detail.kycStatus || 'none')) return true
    if (pPassword && pPassword.length > 0) return true
    return false
  }, [detail, pEmail, pDisplayName, pPhone, pOrgId, pVerificationLevel, pKycStatus, pPassword])

  async function saveProfile() {
    if (!detail || !userId || profileSaving) return
    setProfileSaving(true); setProfileSaved(null)
    try {
      const body: any = {}
      if (pEmail !== detail.email) body.email = pEmail
      if (pDisplayName !== (detail.displayName || '')) body.displayName = pDisplayName
      if (pPhone !== (detail.phoneNumber || '')) body.phoneNumber = pPhone || null
      if ((detail.orgId == null ? '' : String(detail.orgId)) !== pOrgId) body.orgId = pOrgId === '' ? null : Number(pOrgId)
      if ((detail.verificationLevel == null ? '0' : String(detail.verificationLevel)) !== pVerificationLevel) body.verificationLevel = Number(pVerificationLevel)
      if ((detail.kycStatus || 'none') !== pKycStatus) body.kycStatus = pKycStatus
      if (pPassword) body.password = pPassword
      const csrf = getCsrfToken()
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error('save_profile_failed')
      setProfileSaved('Saved')
      setTimeout(() => setProfileSaved(null), 1200)
      // Update local baseline (avoid reloading for now)
      setDetail({ ...detail, email: body.email ?? detail.email, displayName: body.displayName ?? detail.displayName, phoneNumber: body.phoneNumber ?? detail.phoneNumber, orgId: (body.hasOwnProperty('orgId') ? body.orgId : detail.orgId), verificationLevel: (body.hasOwnProperty('verificationLevel') ? body.verificationLevel : detail.verificationLevel), kycStatus: body.kycStatus ?? detail.kycStatus })
      if (pPassword) setPPassword('')
    } catch (e) {
      setProfileSaved('Failed')
    } finally { setProfileSaving(false) }
  }

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
            <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>Profile</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button onClick={saveProfile} disabled={!profileDirty || profileSaving} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: profileDirty ? '#1976d2' : 'rgba(255,255,255,0.08)', color: '#fff' }}>{profileSaving ? 'Saving…' : 'Save'}</button>
                {profileSaved && <span style={{ fontSize: 12, opacity: 0.8 }}>{profileSaved}</span>}
              </div>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Email</span>
                <input value={pEmail} onChange={(e) => setPEmail(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Display Name</span>
                <input value={pDisplayName} onChange={(e) => setPDisplayName(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Phone</span>
                <input value={pPhone} onChange={(e) => setPPhone(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Org ID</span>
                <input value={pOrgId} onChange={(e) => setPOrgId(e.target.value.replace(/[^0-9-]/g, ''))} placeholder="(optional)" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
              </label>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Password</span>
                <input type="password" value={pPassword} onChange={(e) => setPPassword(e.target.value)} placeholder="(leave blank to keep)" style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
              </label>
            </div>
          </div>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Verification</div>
            <div>Email Verified: {detail.emailVerifiedAt ? 'Yes' : 'No'}</div>
            <div>Phone Verified: {detail.phoneVerifiedAt ? 'Yes' : 'No'}</div>
            <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <span>Level</span>
              <input value={pVerificationLevel} onChange={(e) => setPVerificationLevel(e.target.value.replace(/[^0-9-]/g, ''))} style={{ width: 120, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
            </label>
            <label style={{ display: 'grid', gap: 6, marginTop: 8 }}>
              <span>KYC</span>
              <select value={pKycStatus} onChange={(e) => setPKycStatus(e.target.value)} style={{ width: 200, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}>
                <option value="none">none</option>
                <option value="pending">pending</option>
                <option value="verified">verified</option>
                <option value="rejected">rejected</option>
              </select>
            </label>
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
          <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Site Roles</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button disabled={!rolesDirty || rolesSaving} onClick={saveRoles} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: rolesDirty ? '#1976d2' : 'rgba(255,255,255,0.08)', color: '#fff' }}>{rolesSaving ? 'Saving…' : 'Save'}</button>
              {rolesSaved && <span style={{ fontSize: 12, opacity: 0.8 }}>{rolesSaved}</span>}
            </div>
          </div>
          {!siteRoleNames.length ? (
            <div style={{ opacity: 0.8 }}>No site roles available.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
              {siteRoleNames.map((name) => {
                const checked = selectedRoles.includes(name)
                return (
                  <label key={name} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 8px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, background: 'rgba(255,255,255,0.03)' }}>
                    <input type="checkbox" checked={checked} onChange={(e) => {
                      const on = e.target.checked
                      setSelectedRoles((prev) => on ? Array.from(new Set([...prev, name])) : prev.filter((r) => r !== name))
                    }} />
                    <span>{name}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
        <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
          <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>Spaces & Roles</span>
          </div>
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
      <div style={{ marginTop: 16, border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
        <div style={{ fontWeight: 600, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span>Capabilities (overrides)</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={saveCapabilities} disabled={capSaving} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#1976d2', color: '#fff' }}>{capSaving ? 'Saving…' : 'Save'}</button>
            {capSaved && <span style={{ fontSize: 12, opacity: 0.8 }}>{capSaved}</span>}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <label style={{ display: 'block', marginBottom: 6 }}>Can Create Group</label>
            <select value={capGroup === null ? 'default' : (capGroup ? 'yes' : 'no')} onChange={(e) => {
              const v = e.target.value
              setCapGroup(v === 'default' ? null : v === 'yes')
            }} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}>
              <option value="default">Default (site setting)</option>
              <option value="yes">Allow</option>
              <option value="no">Deny</option>
            </select>
          </div>
          <div>
            <label style={{ display: 'block', marginBottom: 6 }}>Can Create Channel</label>
            <select value={capChannel === null ? 'default' : (capChannel ? 'yes' : 'no')} onChange={(e) => {
              const v = e.target.value
              setCapChannel(v === 'default' ? null : v === 'yes')
            }} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}>
              <option value="default">Default (site setting)</option>
              <option value="yes">Allow</option>
              <option value="no">Deny</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  )
}
