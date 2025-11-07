import React, { useEffect, useMemo, useState } from 'react'

type Member = { userId: number; email: string | null; displayName: string | null; roles: string[] }
type Suspension = { id: number; targetType: string | null; targetId: number | null; kind: string; degree: number; startsAt: string | null; endsAt: string | null; reason: string | null }

function parseSpaceId(): number | null {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  const m = p.match(/\/spaces\/(\d+)\//) || p.match(/\/spaces\/(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function SpaceModerationPage() {
  const spaceId = useMemo(parseSpaceId, [])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeFor, setActiveFor] = useState<Record<number, Suspension[]>>({})
  const [busy, setBusy] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!spaceId) { setError('Bad space id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/spaces/${spaceId}/members`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = await res.json()
        if (canceled) return
        setMembers(Array.isArray(data?.members) ? data.members : [])
      } catch (e) {
        if (!canceled) setError('Failed to load members')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [spaceId])

  async function loadActive(userId: number) {
    if (!spaceId) return
    const key = `active:${userId}`
    if (busy[key]) return
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const res = await fetch(`/api/admin/users/${userId}/moderation`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('fetch_failed')
      const data = await res.json()
      const list: Suspension[] = Array.isArray(data?.activeSuspensions) ? data.activeSuspensions : []
      const filtered = list.filter((s) => String(s.targetType || '') === 'space' && Number(s.targetId || 0) === spaceId)
      setActiveFor((prev) => ({ ...prev, [userId]: filtered }))
    } catch (e) {
      setActiveFor((prev) => ({ ...prev, [userId]: [] }))
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n })
    }
  }

  async function suspend(userId: number, degree: 1|2|3) {
    if (!spaceId) return
    const key = `s:${userId}:${degree}`
    if (busy[key]) return
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/admin/users/${userId}/suspensions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin',
        body: JSON.stringify({ scope: 'space', spaceId, degree })
      })
      if (!res.ok) throw new Error('suspend_failed')
      await loadActive(userId)
    } catch (e) {
      // no-op toast stub
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n })
    }
  }

  async function revoke(userId: number, sid: number) {
    if (!spaceId) return
    const key = `r:${userId}:${sid}`
    if (busy[key]) return
    setBusy((b) => ({ ...b, [key]: true }))
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/admin/users/${userId}/suspensions/${sid}`, {
        method: 'DELETE',
        headers: { ...(csrf ? { 'x-csrf-token': csrf } : {}) },
        credentials: 'same-origin'
      })
      if (!res.ok) throw new Error('revoke_failed')
      await loadActive(userId)
    } catch (e) {
      // no-op toast stub
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[key]; return n })
    }
  }

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Space Moderation (SPA)</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>User ID</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Email</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Roles</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!members.length && !loading ? (
              <tr><td colSpan={5} style={{ padding: '12px 10px', opacity: 0.8 }}>No members.</td></tr>
            ) : members.map((m) => {
              const list = activeFor[m.userId] || []
              const aKey = `active:${m.userId}`
              return (
                <React.Fragment key={m.userId}>
                  <tr>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.userId}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.displayName || ''}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.email || ''}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{m.roles.join(', ')}</td>
                    <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button onClick={() => suspend(m.userId, 1)} disabled={busy[`s:${m.userId}:1`]} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#444', color: '#fff' }}>Suspend 1d</button>
                        <button onClick={() => suspend(m.userId, 2)} disabled={busy[`s:${m.userId}:2`]} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#444', color: '#fff' }}>7d</button>
                        <button onClick={() => suspend(m.userId, 3)} disabled={busy[`s:${m.userId}:3`]} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#444', color: '#fff' }}>30d</button>
                        <button onClick={() => loadActive(m.userId)} disabled={busy[aKey]} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#2e7d32', color: '#fff' }}>Active</button>
                      </div>
                    </td>
                  </tr>
                  {Array.isArray(list) && list.length > 0 && (
                    <tr>
                      <td colSpan={5} style={{ padding: '8px 10px', background: 'rgba(255,255,255,0.02)' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {list.map((susp) => (
                            <div key={susp.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8, padding: '6px 8px' }}>
                              <div>
                                <div style={{ fontSize: 14 }}>Posting suspension • degree {susp.degree} • until {susp.endsAt || '(unknown)'}</div>
                                {susp.reason && <div style={{ opacity: 0.8, fontSize: 12 }}>Reason: {susp.reason}</div>}
                              </div>
                              <button onClick={() => revoke(m.userId, susp.id)} disabled={busy[`r:${m.userId}:${susp.id}`]} style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#b71c1c', color: '#fff' }}>Revoke</button>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
      {loading ? <div style={{ marginTop: 10, opacity: 0.8 }}>Loading…</div> : null}
    </div>
  )
}

