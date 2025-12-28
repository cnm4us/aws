import React, { useEffect, useState } from 'react'
import styles from '../styles/sharedNav.module.css'
import ContextDrawer from '../menu/ContextDrawer'
import ChannelSwitcher from '../menu/contexts/ChannelSwitcher'
import MyAssets from '../menu/contexts/MyAssets'
import AdminMenu from '../menu/contexts/AdminMenu'
import ContextPicker, { type ContextId } from '../menu/ContextPicker'
import HelpMenu from '../menu/contexts/HelpMenu'
import ProfileMenu from '../menu/contexts/ProfileMenu'
import InfoMenu from '../menu/contexts/InfoMenu'
import ReviewMenu from '../menu/contexts/ReviewMenu'
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
  hasSpaceReview?: boolean
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
      if (v === 'info' || v === 'channel' || v === 'review' || v === 'assets' || v === 'space-admin' || v === 'help' || v === 'settings' || v === 'messages' || v === 'profile') return v
    } catch {}
    return 'channel'
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const isSiteAdmin = props.isSiteAdmin === true
  const hasSpaceReview = props.hasSpaceReview === true
  const authLoaded = props.authLoaded === true

  // Normalize context when admin not allowed
  useEffect(() => {
    if (!authLoaded) return
    if (!isSiteAdmin && activeContext === 'space-admin') setActiveContext('channel')
    if (!hasSpaceReview && activeContext === 'review') setActiveContext('channel')
  }, [authLoaded, isSiteAdmin, hasSpaceReview, activeContext])

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
        title={
          pickerOpen
            ? 'Menu Selector'
            : activeContext === 'info'
            ? 'Info'
            : activeContext === 'assets'
            ? 'My Assets'
            : activeContext === 'channel'
            ? 'Channel Changer'
            : activeContext === 'review'
            ? 'Review'
            : activeContext === 'space-admin'
            ? 'Admin'
            : activeContext === 'profile'
            ? 'Profile'
            : activeContext === 'help'
            ? 'Help'
            : undefined
        }
      >
        {pickerOpen ? (
          <ContextPicker
            active={activeContext}
            onSelect={(id) => {
              setActiveContext(id)
              setPickerOpen(false)
            }}
            showAdmin={isSiteAdmin}
            showReview={hasSpaceReview}
          />
        ) : activeContext === 'info' ? (
          <InfoMenu onNavigate={() => setMenuOpen(false)} />
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
        ) : activeContext === 'review' ? (
          <ReviewMenu onNavigate={() => setMenuOpen(false)} />
        ) : activeContext === 'space-admin' ? (
          <AdminMenu onNavigate={() => setMenuOpen(false)} />
        ) : activeContext === 'profile' ? (
          <ProfileMenu onNavigate={() => setMenuOpen(false)} />
        ) : activeContext === 'help' ? (
          <HelpMenu onNavigate={() => setMenuOpen(false)} />
        ) : (
          <div style={{ color: '#fff', fontSize: 14, opacity: 0.8 }}>Coming soon…</div>
        )}
      </ContextDrawer>

      {/* No edge-swipe opener */}

      <div className={styles.container}>
        <div className={styles.safeTop} />
        <div className={styles.bar}>
          <div className={styles.title}>{currentFeedLabel}</div>
          <div className={styles.actionsRight}>
            <button
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen((v) => !v)
              }}
              className={styles.iconBtn}
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
 
