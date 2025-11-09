import React, { useEffect, useRef } from 'react'

export default function ContextDrawer(props: {
  open: boolean
  onClose: () => void
  isAuthed: boolean
  children?: React.ReactNode
  onMoreClick?: () => void
  title?: string
}) {
  const { open, onClose, isAuthed, children, onMoreClick, title } = props
  const drawerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    const el = drawerRef.current
    if (!el) return
    try { el.focus() } catch {}
  }, [open])

  return (
    <>
      <div
        onClick={(e) => {
          e.stopPropagation()
          if (open) onClose()
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          opacity: open ? 1 : 0,
          transition: 'opacity 200ms ease',
          zIndex: 1100,
          pointerEvents: open ? 'auto' : 'none',
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        ref={drawerRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '86vw',
          maxWidth: 380,
          background: 'rgba(0,0,0,0.86)',
          color: '#fff',
          zIndex: 1101,
          transform: open ? 'translate3d(0,0,0)' : 'translate3d(100%,0,0)',
          transition: 'transform 260ms cubic-bezier(0.25,1,0.5,1)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 12px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
          paddingLeft: 12,
          paddingRight: 12,
          boxShadow: open ? '-2px 0 12px rgba(0,0,0,0.5)' : 'none',
          pointerEvents: open ? 'auto' : 'none',
          WebkitBackdropFilter: open ? 'saturate(120%) blur(6px)' : undefined,
          backdropFilter: open ? 'saturate(120%) blur(6px)' : undefined,
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <a
            href={isAuthed ? '/logout' : '/login'}
            style={{
              textDecoration: 'none',
              color: '#fff',
              background: isAuthed ? '#d32f2f' : '#2e7d32',
              padding: '10px 16px',
              borderRadius: 10,
              fontWeight: 600,
              fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
              boxShadow: '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            {isAuthed ? 'LOGOUT' : 'LOGIN'}
          </a>
          <button
            aria-label="Menu selector"
            title="Menu selector"
            onClick={(e) => {
              e.stopPropagation()
              if (onMoreClick) onMoreClick()
            }}
            style={{
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.25)',
              borderRadius: 10,
              padding: '8px 10px',
              color: '#fff',
            }}
          >
            <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
              <rect x="13.5" y="3.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
              <rect x="3.5" y="13.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
              <rect x="13.5" y="13.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
            </svg>
          </button>
        </div>

        {title ? (
          <div
            style={{
              textAlign: 'center',
              color: '#fff',
              opacity: 0.9,
              fontWeight: 600,
              fontSize: 16,
              letterSpacing: 1,
              textTransform: 'uppercase',
              paddingTop: 4,
              paddingBottom: 8,
              fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
            }}
          >
            {title}
          </div>
        ) : null}

        {/* Body */}
        <div style={{ paddingTop: 4 }}>
          {children}
        </div>
      </div>
    </>
  )
}
