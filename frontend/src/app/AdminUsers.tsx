import React, { useCallback, useEffect, useMemo, useState } from 'react'

type UserRow = {
  id: number
  email: string
  displayName: string | null
  createdAt: string
  updatedAt: string | null
  deletedAt: string | null
}

export default function AdminUsersPage() {
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rows, setRows] = useState<UserRow[]>([])

  const load = useCallback(async (q: string) => {
    setLoading(true); setError(null)
    try {
      const params = new URLSearchParams(); if (q) params.set('search', q)
      const res = await fetch(`/api/admin/users?${params.toString()}`, { credentials: 'same-origin' })
      if (!res.ok) throw new Error('failed_to_fetch_users')
      const data = await res.json()
      setRows(Array.isArray(data?.users) ? data.users : [])
    } catch (e: any) {
      setError('Failed to load users')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load('') }, [load])

  const onSearch = () => load(search.trim())

  const header = useMemo(() => (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
      <input
        type="text"
        placeholder="Search email or name"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}
      />
      <button onClick={onSearch} style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: '#1976d2', color: '#fff' }}>Search</button>
      <a href="/admin/users/new" style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: '#fff', textDecoration: 'none' }}>Add User (legacy)</a>
    </div>
  ), [search])

  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Admin • Users (SPA beta)</h1>
      {header}
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      <div style={{ overflowX: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>ID</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Display Name</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Email</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Created</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Deleted</th>
              <th style={{ textAlign: 'left', padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && !loading ? (
              <tr><td colSpan={6} style={{ padding: '12px 10px', opacity: 0.8 }}>No users.</td></tr>
            ) : rows.map((u) => (
              <tr key={u.id}>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{u.id}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{u.displayName || ''}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{u.email}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{u.createdAt || ''}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>{u.deletedAt || ''}</td>
                <td style={{ padding: '8px 10px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <a href={`/adminx/users/${u.id}`} style={{ color: '#9cf', textDecoration: 'none', marginRight: 10 }}>Open (SPA)</a>
                  <a href={`/admin/users/${u.id}`} style={{ color: '#9cf', textDecoration: 'none' }}>Legacy</a>
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
