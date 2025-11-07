import React, { useEffect, useMemo, useState } from 'react'

type SpaceRow = { id: number; type: 'group'|'channel'|'personal'; name: string; slug: string; ownerUserId: number | null; ownerDisplayName: string | null }

function parseKindFromPath(): 'group' | 'channel' {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  if (p.startsWith('/admin/channels')) return 'channel'
  return 'group'
}

export default function AdminSpacesPage() {
  const kind = useMemo(parseKindFromPath, [])
  const [rows, setRows] = useState<SpaceRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/admin/spaces?type=${kind}`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = await res.json()
        const list = Array.isArray(data?.spaces) ? data.spaces : data
        if (canceled) return
        setRows(Array.isArray(list) ? list : [])
      } catch (e) {
        if (!canceled) setError('Failed to load spaces')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = false }
  }, [kind])

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Admin • {kind === 'group' ? 'Groups' : 'Channels'} (SPA)</h1>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>ID</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Name</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Slug</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Owner</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !loading ? (
              <tr><td colSpan={5} style={{ padding: '12px 10px', opacity: 0.8 }}>No spaces.</td></tr>
            ) : rows.map((s) => (
              <tr key={s.id}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{s.id}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{s.name}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{s.slug}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{s.ownerDisplayName || ''}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {kind === 'group' ? (
                    <>
                      <a href={`/admin/groups/${s.id}`} style={{ color: '#9cf', textDecoration: 'none', marginRight: 10 }}>Details</a>
                      <a href={`/spaces/${s.id}/admin`} style={{ color: '#9cf', textDecoration: 'none' }}>Members</a>
                    </>
                  ) : (
                    <>
                      <a href={`/admin/channels/${s.id}`} style={{ color: '#9cf', textDecoration: 'none', marginRight: 10 }}>Details</a>
                      <a href={`/spaces/${s.id}/admin`} style={{ color: '#9cf', textDecoration: 'none' }}>Members</a>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? <div style={{ marginTop: 10, opacity: 0.8 }}>Loading…</div> : null}
    </div>
  )
}
