import React, { useEffect, useRef } from 'react'
import styles from '../styles/drawer.module.css'

export default function ContextDrawer(props: {
  open: boolean
  onClose: () => void
  isAuthed: boolean
  children?: React.ReactNode
  onMoreClick?: () => void
  title?: string
  enableGestures?: boolean
}) {
  const { open, onClose, isAuthed, children, onMoreClick, title, enableGestures = true } = props
  const drawerRef = useRef<HTMLDivElement | null>(null)
  const swipeStart = useRef<{ x: number; y: number; active: boolean } | null>(null)

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
        className={`${styles.backdrop} ${open ? styles.backdropOpen : ''}`}
      />
      <div
        role="dialog"
        aria-modal="true"
        ref={drawerRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          if (!enableGestures) return
          if (!open) return
          if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return
          swipeStart.current = { x: e.clientX, y: e.clientY, active: true }
        }}
        onPointerMove={(e) => {
          if (!enableGestures) return
          const s = swipeStart.current
          if (!s || !s.active) return
          const dx = e.clientX - s.x
          const dy = e.clientY - s.y
          if (dx > 40 && Math.abs(dx) > Math.abs(dy)) {
            swipeStart.current = null
            try { onClose() } catch {}
          }
        }}
        onPointerUp={(e) => { swipeStart.current = null; e.preventDefault() }}
        onPointerCancel={(e) => { swipeStart.current = null; e.preventDefault() }}
        className={`${styles.panel} ${open ? styles.panelOpen : ''}`}
      >
        {/* Header */}
        <div className={styles.headerRow}>
          <a
            href={isAuthed ? '/logout' : '/login'}
            className={`btn ${isAuthed ? 'btn--danger' : 'btn--success'}`}
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
            className={`btn btn--outline`}
          >
            <svg width={22} height={22} viewBox="0 0 24 24" aria-hidden="true">
              <rect x="3.5" y="3.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
              <rect x="13.5" y="3.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
              <rect x="3.5" y="13.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
              <rect x="13.5" y="13.5" width="7" height="7" stroke="#fff" strokeOpacity={0.8} strokeWidth={1.6} fill="none" />
            </svg>
          </button>
        </div>

        {title ? (<div className={styles.title}>{title}</div>) : null}

        {/* Body */}
        <div className={styles.body}>
          {children}
        </div>
      </div>
    </>
  )
}
