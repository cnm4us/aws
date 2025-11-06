import React from 'react'

const shimmer = {
  background: 'linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.14), rgba(255,255,255,0.06))',
  backgroundSize: '200% 100%',
  animation: 'sk 1.2s ease-in-out infinite',
}

function Rule() {
  return (
    <style>{`
      @keyframes sk { 0%{ background-position: 200% 0 } 100%{ background-position: -200% 0 } }
    `}</style>
  )
}

export function UploadsSkeleton() {
  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Rule />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
        <div style={{ height: 36, width: 220, borderRadius: 8, ...shimmer }} />
        <div style={{ height: 36, width: 100, borderRadius: 8, ...shimmer }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, padding: 10, background: 'rgba(255,255,255,0.02)' }}>
            <div style={{ height: 120, borderRadius: 8, marginBottom: 10, ...shimmer }} />
            <div style={{ height: 12, width: '70%', borderRadius: 4, marginBottom: 6, background: 'rgba(255,255,255,0.1)' }} />
            <div style={{ height: 10, width: '40%', borderRadius: 4, background: 'rgba(255,255,255,0.08)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function UploadNewSkeleton() {
  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Rule />
      <div style={{ height: 28, width: 180, borderRadius: 6, marginBottom: 12, ...shimmer }} />
      <div style={{ height: 180, borderRadius: 12, marginBottom: 16, ...shimmer }} />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ height: 40, borderRadius: 8, ...shimmer }} />
        <div style={{ height: 40, borderRadius: 8, ...shimmer }} />
        <div style={{ height: 40, borderRadius: 8, gridColumn: '1 / span 2', ...shimmer }} />
      </div>
    </div>
  )
}

export function ProductionsSkeleton() {
  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Rule />
      <div style={{ height: 32, width: 220, borderRadius: 8, marginBottom: 12, ...shimmer }} />
      <div style={{ border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10 }}>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 12, padding: 12, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
            <div style={{ height: 16, borderRadius: 6, ...shimmer }} />
            <div style={{ height: 16, borderRadius: 6, ...shimmer }} />
            <div style={{ height: 16, borderRadius: 6, ...shimmer }} />
          </div>
        ))}
      </div>
    </div>
  )
}

export function PublishSkeleton() {
  return (
    <div style={{ padding: 16, color: '#fff' }}>
      <Rule />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 420px) 1fr', gap: 16 }}>
        <div>
          <div style={{ height: 220, borderRadius: 10, marginBottom: 12, ...shimmer }} />
          <div style={{ height: 12, width: '70%', borderRadius: 4, background: 'rgba(255,255,255,0.1)', marginBottom: 6 }} />
          <div style={{ height: 10, width: '40%', borderRadius: 4, background: 'rgba(255,255,255,0.08)' }} />
        </div>
        <div>
          <div style={{ height: 36, width: 200, borderRadius: 8, marginBottom: 10, ...shimmer }} />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} style={{ height: 36, borderRadius: 8, marginBottom: 8, ...shimmer }} />
          ))}
        </div>
      </div>
    </div>
  )
}

