import React, { useEffect, useMemo, useState } from 'react'
import SharedNav from './SharedNav'
import { prefetchForHref } from './routes'

type DrawerMode = 'nav' | 'spaces'

export default function Layout(props: { label: string; children: React.ReactNode }) {
  const { label, children } = props
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('nav')
  const [isAuthed, setIsAuthed] = useState(false)
  const [isSiteAdmin, setIsSiteAdmin] = useState(false)
  const [hasSpaceReview, setHasSpaceReview] = useState(false)
  const [authLoaded, setAuthLoaded] = useState(false)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const res = await fetch('/api/me', { credentials: 'same-origin' })
        if (!res.ok) throw new Error('me')
        const me = await res.json()
        if (!canceled) {
          setIsAuthed(!!me && me.userId != null)
          setIsSiteAdmin(Boolean(me?.isSiteAdmin))
          const roles = me?.spaceRoles && typeof me.spaceRoles === 'object' ? me.spaceRoles : {}
          const values = Object.values(roles)
          const canReview = values.some((v: any) => Array.isArray(v) && (v.includes('space_admin') || v.includes('space_moderator')))
          setHasSpaceReview(Boolean(canReview))
        }
      } catch {
        if (!canceled) {
          setIsAuthed(false)
          setIsSiteAdmin(false)
          setHasSpaceReview(false)
        }
      } finally {
        if (!canceled) setAuthLoaded(true)
      }
    })()
    return () => { canceled = true }
  }, [])

  const openDrawer = (mode: DrawerMode) => {
    setDrawerMode(mode)
    if (typeof window !== 'undefined' && window.requestAnimationFrame) {
      window.requestAnimationFrame(() => setDrawerOpen(true))
    } else {
      setDrawerOpen(true)
    }
  }
  const closeDrawer = () => setDrawerOpen(false)

  const renderSpacesPanel = useMemo(() => {
    return () => (
      <div style={{ color: '#fff', fontSize: 15 }}>
        Space switching is available on the Feed.
        <div style={{ marginTop: 10 }}>
          <a href="/" style={{ color: '#9cf' }}>Go to Feed</a>
        </div>
      </div>
    )
  }, [])

  const navLinks = useMemo(() => [
    { label: 'My Uploads', href: '/uploads', enabled: true },
  ], [])

  const upcomingLinks = useMemo(() => [
    { label: 'My Groups', note: 'Coming soon' },
    { label: 'My Channels', note: 'Coming soon' },
    { label: 'My Messages', note: 'Coming soon' },
  ], [])

  return (
    <div style={{ minHeight: '100dvh', background: '#000', ['--header-h' as any]: 'calc(env(safe-area-inset-top, 0px) + 44px)' }}>
      <SharedNav
        drawerOpen={drawerOpen}
        drawerMode={drawerMode}
        openDrawer={openDrawer}
        closeDrawer={closeDrawer}
        currentFeedLabel={label}
        isAuthed={isAuthed}
        authLoaded={authLoaded}
        isSiteAdmin={isSiteAdmin}
        hasSpaceReview={hasSpaceReview}
        mineOnly={false}
        onChangeMineOnly={() => { /* no-op outside feed */ }}
        navLinks={navLinks}
        upcomingLinks={upcomingLinks}
        renderSpacesPanel={renderSpacesPanel}
        showMineOnlyToggle={false}
        onPrefetch={prefetchForHref}
        activeSpaceId={null}
        isGlobalActive={false}
      />
      <div
        style={{
          position: 'fixed',
          top: 'var(--header-h, calc(env(safe-area-inset-top, 0px) + 44px))',
          left: 0,
          right: 0,
          bottom: 0,
          overflowY: 'auto',
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
          overscrollBehavior: 'contain',
          color: '#fff',
        }}
      >
        {children}
      </div>
    </div>
  )
}
