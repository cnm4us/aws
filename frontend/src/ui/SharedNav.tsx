import React, { useEffect, useState } from 'react'
import ContextDrawer from '../menu/ContextDrawer'
import ChannelSwitcher from '../menu/contexts/ChannelSwitcher'
import MyAssets from '../menu/contexts/MyAssets'
import ContextPicker, { type ContextId } from '../menu/ContextPicker'
// useEffect already imported above

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
  // New optional hooks for Channel Switcher when running on Feed
  activeSpaceId?: number | null
  isGlobalActive?: boolean
  onSelectGlobal?: () => void
  onSelectSpace?: (spaceId: number) => void
}) {
  const {
    // legacy props retained for compatibility with callers; not used in universal drawer mode
    drawerOpen: _drawerOpen,
    drawerMode: _drawerMode,
    openDrawer: _openDrawer,
    closeDrawer: _closeDrawer,
    currentFeedLabel,
    isAuthed,
    mineOnly,
    onChangeMineOnly,
    navLinks,
    upcomingLinks,
    renderSpacesPanel,
    showMineOnlyToggle = true,
    onPrefetch,
    activeSpaceId = null,
    isGlobalActive = false,
    onSelectGlobal,
    onSelectSpace,
  } = props

  // New: single universal menu state
  const [menuOpen, setMenuOpen] = useState(false)
  const [activeContext, setActiveContext] = useState<ContextId>(() => {
    try {
      const v = localStorage.getItem('menu:context') as ContextId | null
      if (v === 'channel' || v === 'assets' || v === 'space-admin' || v === 'settings' || v === 'messages') return v
    } catch {}
    return 'channel'
  })
  const [pickerOpen, setPickerOpen] = useState(false)

  // No edge-swipe opener; open via hamburger, close via overlay or swipe-right on drawer.

  useEffect(() => {
    try { localStorage.setItem('menu:context', activeContext) } catch {}
  }, [activeContext])

  return (
    <>
      {/* Left hamburger removed in favor of universal menu */}

      <button
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((v) => !v)
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
        {menuOpen ? (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 5 L19 19 M19 5 L5 19" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        ) : (
          <svg width={28} height={28} viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="#fff" strokeOpacity={0.6} strokeWidth={2} strokeLinecap="round" />
          </svg>
        )}
      </button>
      {/* New: universal right-side drawer */}
      <ContextDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        isAuthed={isAuthed}
        onMoreClick={() => {
          setPickerOpen((v) => !v)
        }}
        title={pickerOpen ? 'Menu Selector' : (activeContext === 'assets' ? 'My Assets' : activeContext === 'channel' ? 'Channel Changer' : undefined)}
      >
        {pickerOpen ? (
          <ContextPicker
            active={activeContext}
            onSelect={(id) => {
              setActiveContext(id)
              setPickerOpen(false)
            }}
          />
        ) : activeContext === 'channel' ? (
          <ChannelSwitcher
            open={menuOpen}
            isAuthed={isAuthed}
            activeSpaceId={activeSpaceId}
            isGlobalActive={isGlobalActive}
            onSelectGlobal={onSelectGlobal ? () => { onSelectGlobal(); setMenuOpen(false) } : undefined}
            onSelectSpace={onSelectSpace ? (sid) => { onSelectSpace(sid); setMenuOpen(false) } : undefined}
          />
        ) : activeContext === 'assets' ? (
          <MyAssets onNavigate={() => setMenuOpen(false)} />
        ) : (
          <div style={{ color: '#fff', fontSize: 14, opacity: 0.8 }}>Coming soon…</div>
        )}
      </ContextDrawer>

      {/* No edge-swipe opener */}

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
