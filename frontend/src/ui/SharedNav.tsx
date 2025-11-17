import React, { useEffect, useState } from 'react'
import ContextDrawer from '../menu/ContextDrawer'
import ChannelSwitcher from '../menu/contexts/ChannelSwitcher'
import MyAssets from '../menu/contexts/MyAssets'
import AdminMenu from '../menu/contexts/AdminMenu'
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
  // Admin gating
  isSiteAdmin?: boolean
  authLoaded?: boolean
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
  const isSiteAdmin = props.isSiteAdmin === true
  const authLoaded = props.authLoaded === true

  // Normalize context when admin not allowed
  useEffect(() => {
    if (!authLoaded) return
    if (!isSiteAdmin && activeContext === 'space-admin') setActiveContext('channel')
  }, [authLoaded, isSiteAdmin, activeContext])

  // No edge-swipe opener; open via hamburger, close via overlay or swipe-right on drawer.

  // Ensure opening the drawer shows the last selected context (not the picker)
  useEffect(() => {
    if (menuOpen) setPickerOpen(false)
  }, [menuOpen])

  useEffect(() => {
    try { localStorage.setItem('menu:context', activeContext) } catch {}
  }, [activeContext])

  return (
    <>
      {/* Header bar with centered title and in-bar hamburger */}
      {/* New: universal right-side drawer */}
      <ContextDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        isAuthed={isAuthed}
        onMoreClick={() => {
          setPickerOpen((v) => !v)
        }}
        title={pickerOpen ? 'Menu Selector' : (activeContext === 'assets' ? 'My Assets' : activeContext === 'channel' ? 'Channel Changer' : activeContext === 'space-admin' ? 'Admin' : undefined)}
      >
        {pickerOpen ? (
          <ContextPicker
            active={activeContext}
            onSelect={(id) => {
              setActiveContext(id)
              setPickerOpen(false)
            }}
            showAdmin={isSiteAdmin}
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
        ) : activeContext === 'space-admin' ? (
          <AdminMenu onNavigate={() => setMenuOpen(false)} />
        ) : (
          <div style={{ color: '#fff', fontSize: 14, opacity: 0.8 }}>Coming soon…</div>
        )}
      </ContextDrawer>

      {/* No edge-swipe opener */}

      <div
        style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 1001 }}
      >
        {/* Safe-area band (solid black) */}
        <div style={{ height: 'env(safe-area-inset-top, 0px)', background: '#000' }} />
        {/* Header bar (semi-opaque) */}
        <div
          style={{
            height: 'calc(var(--header-h, 44px) - env(safe-area-inset-top, 0px))',
            background: 'rgba(0,0,0,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            color: '#fff',
            fontSize: 14,
            paddingLeft: 8,
            paddingRight: 8,
          }}
        >
          <div style={{ pointerEvents: 'none', textTransform: 'uppercase', opacity: 0.35, fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', fontSize: 16, fontWeight: 700 }}>{currentFeedLabel}</div>
          <div style={{ position: 'absolute', right: 8, top: 0, bottom: 0, display: 'flex', alignItems: 'center' }}>
            <button
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
              style={{
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
          </div>
        </div>
      </div>
    </>
  )
}
 
