import React, { useEffect, useMemo, useState } from 'react'
import SharedNav from './SharedNav'
import { prefetchForHref } from './routes'

type DrawerMode = 'nav' | 'spaces'

export default function Layout(props: { label: string; children: React.ReactNode }) {
  const { label, children } = props
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [drawerMode, setDrawerMode] = useState<DrawerMode>('nav')
  const [isAuthed, setIsAuthed] = useState(false)

  useEffect(() => {
    let canceled = false
    ;(async () => {
      try {
        const res = await fetch('/api/me', { credentials: 'same-origin' })
        if (!res.ok) throw new Error('me')
        const me = await res.json()
        if (!canceled) setIsAuthed(!!me && me.userId != null)
      } catch {
        if (!canceled) setIsAuthed(false)
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
    <div style={{ height: '100dvh', overflow: 'hidden', background: '#000' }}>
      <SharedNav
        drawerOpen={drawerOpen}
        drawerMode={drawerMode}
        openDrawer={openDrawer}
        closeDrawer={closeDrawer}
        currentFeedLabel={label}
        isAuthed={isAuthed}
        mineOnly={false}
        onChangeMineOnly={() => { /* no-op outside feed */ }}
        navLinks={navLinks}
        upcomingLinks={upcomingLinks}
        renderSpacesPanel={renderSpacesPanel}
        showMineOnlyToggle={false}
        onPrefetch={prefetchForHref}
      />
      {children}
    </div>
  )
}
