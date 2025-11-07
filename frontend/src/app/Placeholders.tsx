import React from 'react'

export function AdminPlaceholder() {
  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Admin (SPA) — Coming soon</h1>
      <div>Path: {typeof window !== 'undefined' ? window.location.pathname : ''}</div>
      <div style={{ marginTop: 12 }}>
        <a href="/adminx/users" style={{ color: '#9cf', marginRight: 12, textDecoration: 'none' }}>Users (SPA)</a>
        <a href="/adminx/settings" style={{ color: '#9cf', textDecoration: 'none' }}>Site Settings (SPA)</a>
      </div>
    </div>
  )
}

export function SpaceAdminPlaceholder() {
  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <h1 style={{ fontSize: 20, margin: '6px 0 12px 0' }}>Space Admin (SPA) — Coming soon</h1>
      <div>Path: {typeof window !== 'undefined' ? window.location.pathname : ''}</div>
      <div style={{ marginTop: 12 }}>
        <a href="/" style={{ color: '#9cf', textDecoration: 'none' }}>Back to Feed</a>
      </div>
    </div>
  )
}

