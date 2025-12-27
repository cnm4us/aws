import React, { useEffect, useMemo, useState } from 'react'

type SpaceDetail = {
  id: number
  type: 'group' | 'channel' | 'personal'
  ownerUserId: number | null
  name: string
  slug: string
  settings: any
  cultureIds?: number[]
}

type MembersResp = { spaceId: number; members: Array<{ userId: number; email: string | null; displayName: string | null; roles: string[] }> }

type SiteFlags = { requireGroupReview: boolean; requireChannelReview: boolean; siteEnforced: boolean }
type SettingsResponse = { id: number; name: string | null; type: 'personal'|'group'|'channel'; settings: any; site: SiteFlags }

type Culture = { id: number; name: string; description: string | null; categoryCount: number }
type CulturesResponse = { cultures: Culture[] }

function parsePath(): { kind: 'group'|'channel', id: number } | null {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  const m = p.match(/^\/admin\/(groups|channels)\/(\d+)/)
  if (!m) return null
  const id = Number(m[2])
  if (!Number.isFinite(id) || id <= 0) return null
  return { kind: (m[1] === 'groups' ? 'group' : 'channel'), id }
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function AdminSpaceDetailPage() {
  const parsed = useMemo(parsePath, [])
  const [detail, setDetail] = useState<SpaceDetail | null>(null)
  const [settings, setSettings] = useState<SettingsResponse | null>(null)
  const [members, setMembers] = useState<MembersResp | null>(null)
  const [cultures, setCultures] = useState<Culture[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function normalizeCultureIds(ids: number[]): number[] {
    return Array.from(new Set((Array.isArray(ids) ? ids : []).map((id) => Number(id))))
      .filter((id) => Number.isFinite(id) && id > 0)
      .sort((a, b) => a - b)
  }

  // Form state
  const [name, setName] = useState('')
  const [requireReview, setRequireReview] = useState(false)
  const [commentsPolicy, setCommentsPolicy] = useState<'inherit'|'on'|'off'>('inherit')
  const [cultureIds, setCultureIds] = useState<number[]>([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<string | null>(null)

  // Add member state
  const [newUserId, setNewUserId] = useState('')
  const [roleAdmin, setRoleAdmin] = useState(false)
  const [roleMember, setRoleMember] = useState(false)
  const [roleModerator, setRoleModerator] = useState(false)
  const [rolePoster, setRolePoster] = useState(false)
  const [roleSubscriber, setRoleSubscriber] = useState(false)
  const [addBusy, setAddBusy] = useState(false)

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!parsed) { setError('Bad id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const [dRes, sRes, mRes, cRes] = await Promise.all([
          fetch(`/api/admin/spaces/${parsed.id}`, { credentials: 'same-origin' }),
          fetch(`/api/spaces/${parsed.id}/settings`, { credentials: 'same-origin' }),
          fetch(`/api/admin/spaces/${parsed.id}/members`, { credentials: 'same-origin' }),
          fetch(`/api/admin/cultures`, { credentials: 'same-origin' }),
        ])
        if (!dRes.ok || !sRes.ok || !mRes.ok || !cRes.ok) throw new Error('fetch_failed')
        const dJson = (await dRes.json()) as SpaceDetail
        const sJson = (await sRes.json()) as SettingsResponse
        const mJson = (await mRes.json()) as MembersResp
        const cJson = (await cRes.json()) as CulturesResponse
        if (canceled) return
        setDetail(dJson)
        setSettings(sJson)
        setMembers(mJson)
        setCultures(Array.isArray(cJson?.cultures) ? cJson.cultures : [])
        setName(dJson.name || '')
        const setts = sJson.settings || {}
        const c = typeof setts.comments === 'string' ? setts.comments.toLowerCase() : 'inherit'
        setCommentsPolicy(c === 'on' || c === 'off' ? c : 'inherit')
        const rr = !!(setts.publishing && typeof setts.publishing === 'object' && setts.publishing.requireApproval === true)
        setRequireReview(rr)
        setCultureIds(normalizeCultureIds(Array.isArray(dJson.cultureIds) ? dJson.cultureIds : []))
      } catch (e) {
        if (!canceled) setError('Failed to load')
      } finally { if (!canceled) setLoading(false) }
    }
    load()
    return () => { canceled = true }
  }, [parsed?.id])

  const effectiveReview = useMemo(() => {
    if (!settings) return 'Unknown'
    const enforced = settings.site?.siteEnforced
    const rr = requireReview || enforced
    return rr ? 'Required' : 'Not required'
  }, [settings, requireReview])

  async function save() {
    if (!parsed || saving) return
    setSaving(true); setSaved(null)
    try {
      const csrf = getCsrfToken()
      const body: any = {}
      if (detail && name !== detail.name) body.name = name
      body.commentsPolicy = commentsPolicy
      if (!settings?.site?.siteEnforced) body.requireReview = requireReview
      if (detail) {
        const existingIds = Array.isArray(detail.cultureIds) ? detail.cultureIds : []
        const existing = new Set(existingIds.map((id) => Number(id)))
        const next = normalizeCultureIds(cultureIds)
        const changed = next.length !== existing.size || next.some((id) => !existing.has(id))
        if (changed) body.cultureIds = next
      }
      const res = await fetch(`/api/admin/spaces/${parsed.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify(body)
      })
      if (!res.ok) throw new Error('save_failed')
      setDetail((d) => {
        if (!d) return d
        return { ...d, name, cultureIds: normalizeCultureIds(cultureIds) }
      })
      setSaved('Saved')
      setTimeout(() => setSaved(null), 1200)
    } catch (e) {
      setSaved('Failed')
    } finally { setSaving(false) }
  }

  async function addMember() {
    if (!parsed || addBusy) return
    const uid = Number(newUserId)
    if (!Number.isFinite(uid) || uid <= 0) return
    const roles: string[] = []
    if (roleAdmin) roles.push('space_admin')
    if (roleMember) roles.push('space_member')
    if (roleModerator) roles.push('space_moderator')
    if (rolePoster) roles.push('space_poster')
    if (roleSubscriber) roles.push('space_subscriber')
    setAddBusy(true)
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/admin/spaces/${parsed.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ userId: uid, roles })
      })
      if (!res.ok) throw new Error('add_failed')
      setNewUserId('')
      setRoleAdmin(false); setRoleMember(false); setRoleModerator(false); setRolePoster(false); setRoleSubscriber(false)
      await reloadMembers()
    } catch (e) {
      // no-op
    } finally { setAddBusy(false) }
  }

  async function removeMember(userId: number) {
    if (!parsed) return
    const csrf = getCsrfToken()
    try {
      await fetch(`/api/admin/spaces/${parsed.id}/members/${userId}`, {
        method: 'DELETE', headers: { ...(csrf ? { 'x-csrf-token': csrf } : {}) }, credentials: 'same-origin'
      })
      await reloadMembers()
    } catch {}
  }

  async function reloadMembers() {
    if (!parsed) return
    try {
      const res = await fetch(`/api/admin/spaces/${parsed.id}/members`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('fetch_failed')
      const data = await res.json()
      setMembers(data)
    } catch {}
  }

  async function deleteSpace() {
    if (!parsed) return
    const csrf = getCsrfToken()
    try {
      const res = await fetch(`/api/spaces/${parsed.id}`, { method: 'DELETE', headers: { ...(csrf ? { 'x-csrf-token': csrf } : {}) }, credentials: 'same-origin' })
      if (!res.ok) throw new Error('delete_failed')
      window.location.href = parsed.kind === 'group' ? '/admin/groups' : '/admin/channels'
    } catch {}
  }

  const backHref = parsed?.kind === 'group' ? '/admin/groups' : '/admin/channels'

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>{parsed?.kind === 'group' ? 'Group' : 'Channel'} #{detail?.id}</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      {loading ? (
        <div>Loading…</div>
      ) : (
        <>
          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Settings</div>
            <div style={{ display: 'grid', gap: 10, maxWidth: 560 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Name</span>
                <input value={name} onChange={(e) => setName(e.target.value)} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }} />
              </label>
              <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <input type="checkbox" checked={requireReview} onChange={(e) => setRequireReview(e.target.checked)} disabled={!!settings?.site?.siteEnforced} />
                Require Review/Approval
              </label>
              <div style={{ fontSize: 13, opacity: 0.85, padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
                Effective Review: {effectiveReview}
              </div>
              <label style={{ display: 'grid', gap: 6 }}>
                <span>Comments Policy</span>
                <select value={commentsPolicy} onChange={(e) => setCommentsPolicy(e.target.value as any)} style={{ width: 200, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}>
                  <option value="inherit">Inherit</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              </label>
              <div style={{ display: 'grid', gap: 6 }}>
                <span>Cultures</span>
                {cultures.length ? (
                  <div style={{ display: 'grid', gap: 6 }}>
                    {cultures.map((c) => {
                      const checked = cultureIds.includes(c.id)
                      return (
                        <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.02)' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const next = e.target.checked ? [...cultureIds, c.id] : cultureIds.filter((id) => id !== c.id)
                              setCultureIds(normalizeCultureIds(next))
                            }}
                          />
                          <span>
                            <span style={{ fontWeight: 600 }}>{c.name}</span>
                            <span style={{ fontSize: 12, opacity: 0.8, marginLeft: 8 }}>{c.categoryCount} categories</span>
                            {c.description ? <div style={{ fontSize: 12, opacity: 0.8, marginTop: 2 }}>{c.description}</div> : null}
                          </span>
                        </label>
                      )
                    })}
                  </div>
                ) : (
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    No cultures yet. <a href="/admin/cultures" style={{ color: '#9cf' }}>Create one</a>.
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                <button onClick={save} disabled={saving} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#1976d2', color: '#fff' }}>{saving ? 'Saving…' : 'Save Settings'}</button>
                <a href={backHref} style={{ color: '#9cf', textDecoration: 'none', display: 'inline-block', padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)' }}>Back</a>
                {saved && <span style={{ alignSelf: 'center', fontSize: 12, opacity: 0.8 }}>{saved}</span>}
              </div>
            </div>
          </div>

          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)', marginBottom: 16 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Members</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <input placeholder="User ID" value={newUserId} onChange={(e) => setNewUserId(e.target.value.replace(/[^0-9-]/g, ''))} style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff', width: 160 }} />
              <label><input type="checkbox" checked={roleAdmin} onChange={(e) => setRoleAdmin(e.target.checked)} /> space_admin</label>
              <label><input type="checkbox" checked={roleMember} onChange={(e) => setRoleMember(e.target.checked)} /> space_member</label>
              <label><input type="checkbox" checked={roleModerator} onChange={(e) => setRoleModerator(e.target.checked)} /> space_moderator</label>
              <label><input type="checkbox" checked={rolePoster} onChange={(e) => setRolePoster(e.target.checked)} /> space_poster</label>
              <label><input type="checkbox" checked={roleSubscriber} onChange={(e) => setRoleSubscriber(e.target.checked)} /> space_subscriber</label>
              <button onClick={addMember} disabled={addBusy} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#2e7d32', color: '#fff' }}>{addBusy ? 'Adding…' : 'Add Member'}</button>
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>User ID</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Display Name</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Email</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Roles</th>
                    <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.isArray(members?.members) && members!.members.length ? (
                    members!.members.map((m) => (
                      <tr key={m.userId}>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.userId}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.displayName || ''}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.email || ''}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{(m.roles || []).join(', ')}</td>
                        <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                          <button onClick={() => removeMember(m.userId)} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#b71c1c', color: '#fff' }}>Remove</button>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={5} style={{ padding: '12px 10px', opacity: 0.8 }}>No members.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 12, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Delete {parsed?.kind === 'group' ? 'Group' : 'Channel'}</div>
            <div style={{ marginBottom: 10 }}>All members must be removed before deletion.</div>
            <button onClick={deleteSpace} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#b71c1c', color: '#fff' }}>Delete {parsed?.kind === 'group' ? 'Group' : 'Channel'}</button>
          </div>
        </>
      )}
    </div>
  )
}
