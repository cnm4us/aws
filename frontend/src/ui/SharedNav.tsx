import React from 'react'

type DrawerMode = 'nav' | 'spaces'

type NavLink = { label: string; href: string; enabled?: boolean }
type UpcomingLink = { label: string; note?: string }

export default function SharedNav(props: {
  drawerOpen: boolean
  drawerMode: DrawerMode
  openDrawer: (mode: DrawerMode) => void
  closeDrawer: () => void
  currentFeedLabel: string
  isAuthed: boolean
  mineOnly: boolean
  onChangeMineOnly: (checked: boolean) => void
  navLinks: NavLink[]
  upcomingLinks: UpcomingLink[]
  renderSpacesPanel: () => JSX.Element
  showMineOnlyToggle?: boolean
  onPrefetch?: (href: string) => void
}) {
  const {
    drawerOpen,
    drawerMode,
    openDrawer,
    closeDrawer,
    currentFeedLabel,
    isAuthed,
    mineOnly,
    onChangeMineOnly,
    navLinks,
    upcomingLinks,
    renderSpacesPanel,
    showMineOnlyToggle = true,
    onPrefetch,
  } = props

  return (
    <>
      <div
        onClick={(e) => {
          e.stopPropagation()
          if (drawerOpen) closeDrawer()
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.35)',
          opacity: drawerOpen ? 1 : 0,
          transition: 'opacity 200ms ease',
          zIndex: 1000,
          pointerEvents: drawerOpen ? 'auto' : 'none',
        }}
      />

      <button
        aria-label={drawerOpen && drawerMode === 'nav' ? 'Close menu' : 'Open menu'}
        onClick={(e) => {
          e.stopPropagation()
          drawerOpen && drawerMode === 'nav' ? closeDrawer() : openDrawer('nav')
        }}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          left: 8,
          zIndex: 1002,
          background: 'transparent',
          border: 'none',
          padding: 8,
          opacity: 0.9,
          touchAction: 'manipulation' as any,
        }}
      >
        {drawerOpen && drawerMode === 'nav' ? (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
      </button>

      <button
        aria-label={drawerOpen && drawerMode === 'spaces' ? 'Close space switcher' : 'Open space switcher'}
        onClick={(e) => {
          e.stopPropagation()
          drawerOpen && drawerMode === 'spaces' ? closeDrawer() : openDrawer('spaces')
        }}
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          right: 8,
          zIndex: 1002,
          background: 'transparent',
          border: 'none',
          padding: 8,
          opacity: 0.9,
          touchAction: 'manipulation' as any,
        }}
      >
        {drawerOpen && drawerMode === 'spaces' ? (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <rect x="4" y="4" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
            <rect x="14" y="4" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
            <rect x="4" y="14" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
            <rect x="14" y="14" width="6" height="6" stroke="#fff" strokeOpacity={0.6} strokeWidth={1.8} fill="none" />
          </svg>
        )}
      </button>

      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: '78vw',
          maxWidth: 340,
          background: 'rgba(0,0,0,0.8)',
          color: '#fff',
          zIndex: 1001,
          transform: drawerOpen ? 'translate3d(0,0,0)' : 'translate3d(-100%,0,0)',
          transition: 'transform 260ms cubic-bezier(0.25,1,0.5,1)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 56px)',
          paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 16px)',
          paddingLeft: 12,
          paddingRight: 12,
          boxShadow: drawerOpen ? '2px 0 12px rgba(0,0,0,0.5)' : 'none',
          pointerEvents: drawerOpen ? 'auto' : 'none',
          WebkitBackdropFilter: drawerOpen ? 'saturate(120%) blur(6px)' : undefined,
          backdropFilter: drawerOpen ? 'saturate(120%) blur(6px)' : undefined,
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
        onTouchEnd={(e) => e.stopPropagation()}
      >
        {drawerMode === 'nav' ? (
          <>
            <a
              href={isAuthed ? '/logout' : '/login'}
              style={{
                display: 'inline-block',
                textDecoration: 'none',
                textAlign: 'center' as const,
                color: '#fff',
                background: isAuthed ? '#d32f2f' : '#2e7d32',
                padding: '12px 20px',
                borderRadius: 10,
                fontWeight: 600,
                fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
                boxShadow: '0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)',
                border: '1px solid rgba(255,255,255,0.15)',
                marginBottom: 14,
              }}
            >
              {isAuthed ? 'LOGOUT' : 'LOGIN'}
            </a>
            {isAuthed && showMineOnlyToggle && (
              <div style={{ marginTop: 10, marginBottom: 16 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                  <input
                    type="checkbox"
                    checked={mineOnly}
                    onChange={(e) => onChangeMineOnly(e.target.checked)}
                    style={{ transform: 'scale(1.2)' }}
                  />
                  Show only my videos
                </label>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onMouseEnter={() => onPrefetch && onPrefetch(link.href)}
                  onFocus={() => onPrefetch && onPrefetch(link.href)}
                  style={{
                    color: '#fff',
                    textDecoration: 'none',
                    fontSize: 16,
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.04)',
                  }}
                >
                  {link.label}
                </a>
              ))}
              {upcomingLinks.map((item) => (
                <div
                  key={item.label}
                  style={{
                    fontSize: 15,
                    color: 'rgba(255,255,255,0.6)',
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px dashed rgba(255,255,255,0.2)',
                    background: 'rgba(255,255,255,0.02)',
                  }}
                >
                  {item.label}
                  {item.note ? (
                    <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.7 }}>({item.note})</span>
                  ) : null}
                </div>
              ))}
            </div>
          </>
        ) : (
          renderSpacesPanel()
        )}
      </div>

      <div
        style={{
          position: 'fixed',
          top: 'calc(env(safe-area-inset-top, 0px) + 10px)',
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#fff',
          zIndex: 1001,
          fontSize: 14,
          padding: '6px 12px',
          borderRadius: 999,
          background: 'rgba(0,0,0,0.4)',
          border: '1px solid rgba(255,255,255,0.2)',
        }}
      >
        {currentFeedLabel}
      </div>
    </>
  )
}
