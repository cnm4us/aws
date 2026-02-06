import React, { Suspense, useEffect } from 'react'
import './styles/variables.css'
import './styles/base.css'
import './styles/buttons.css'
import { createRoot } from 'react-dom/client'
import { loadFeed, loadHomePage, loadPageView, loadRuleView, loadRulesIndex, loadUploads, loadUploadNew, loadProductions, loadPublish, loadPublishStory, loadProduce, loadEditVideo, loadCreateVideo, loadExports, loadAssets, loadTimelines, loadLogoConfigs, loadLowerThirds, loadLibrary, loadProfile, loadProfileAvatar } from './ui/routes'
import { UploadsSkeleton, UploadNewSkeleton, ProductionsSkeleton, PublishSkeleton } from './ui/Skeletons'
const HelpPage = React.lazy(() => import('./app/Help'))
const HomePage = React.lazy(loadHomePage)
const PageView = React.lazy(loadPageView)
const RuleView = React.lazy(loadRuleView)
const RulesIndexPage = React.lazy(loadRulesIndex)
const Feed = React.lazy(loadFeed)
const UploadsPage = React.lazy(loadUploads)
const UploadNewPage = React.lazy(loadUploadNew)
const PublishPage = React.lazy(loadPublish)
const PublishStoryPage = React.lazy(loadPublishStory)
const ProducePage = React.lazy(loadProduce)
const EditVideoPage = React.lazy(loadEditVideo)
const CreateVideoPage = React.lazy(loadCreateVideo)
const ExportsPage = React.lazy(loadExports)
const AssetsPage = React.lazy(loadAssets)
const TimelinesPage = React.lazy(loadTimelines)
const LogoConfigsPage = React.lazy(loadLogoConfigs)
const LowerThirdsPage = React.lazy(loadLowerThirds)
const LibraryPage = React.lazy(loadLibrary)
const ProductionsPage = React.lazy(loadProductions)
const ProfilePage = React.lazy(loadProfile)
const ProfilePublicPage = React.lazy(() => import('./app/ProfilePublic'))
const ProfileAvatarPage = React.lazy(loadProfileAvatar)
import Layout from './ui/Layout'
import debug from './debug'
import { preloadHelpDocs } from './help/helpDocs'

// Initialize debug flags early
try {
  debug.bootstrapFromQuery()
  debug.reloadFlags()
  debug.installStorageSync(() => { debug.reloadFlags() })
  debug.attachGlobal()
  if (debug.enabled('network')) {
    debug.installNetworkDebug()
  }
  // Fire-and-forget preload of help docs so Help pages are instant when opened
  try { void preloadHelpDocs() } catch {}
} catch {}

const root = createRoot(document.getElementById('root')!)

// App-open bootstrap: on first session open (new browsing context) in standalone/PWA,
// default the menu context to Channel Changer and normalize to '/'.
;(() => {
  try {
    const isStandalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || (navigator as any).standalone === true
    const started = sessionStorage.getItem('app:started')
    if (!started) {
      sessionStorage.setItem('app:started', '1')
      if (isStandalone) {
        try { localStorage.setItem('menu:context', 'channel') } catch {}
        const p = window.location.pathname || '/'
        // Preserve canonical deep links for groups/channels; only normalize unknown non-root paths
        const isCanonical = p.startsWith('/groups') || p.startsWith('/channels')
        if (!isCanonical && p !== '/' && p !== '') {
          // Ensure we land on the main feed for fresh app opens
          window.location.replace('/')
        }
      }
    }
  } catch {}
})()

const path = window.location.pathname

// Feed renders its own SharedNav (extracted) to preserve behavior.
const FullscreenFallback = ({ label = 'Loading…' }: { label?: string }) => (
  <div style={{ height: '100dvh', background: '#000', color: '#fff', display: 'grid', placeItems: 'center' }}>{label}</div>
)

if (path === '/' || path === '') {
  root.render(
    <Layout label="Home">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <HomePage />
      </Suspense>
    </Layout>
  )
} else if (/^\/pages\/.+/.test(path)) {
  root.render(
    <Layout label="Page">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <PageView />
      </Suspense>
    </Layout>
  )
} else if (path === '/rules' || path === '/rules/') {
  root.render(
    <Layout label="Rules">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <RulesIndexPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/rules/') && !/\/v:\d+\/?$/.test(path)) {
  root.render(
    <Layout label="Rule">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <RuleView />
      </Suspense>
    </Layout>
  )
} else if (path === '/groups' || path === '/groups/') {
  const GroupsBrowse = React.lazy(() => import('./app/GroupsBrowse'))
  root.render(
    <Layout label="Groups">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
        <GroupsBrowse />
      </Suspense>
    </Layout>
  )
} else if (/^\/groups\/(?:[^/]+)\/?$/.test(path)) {
  // Group feed by slug uses the same Feed shell
  root.render(
    <Suspense fallback={<FullscreenFallback label="Loading group…" />}> 
      <Feed />
    </Suspense>
  )
} else if (path === '/channels' || path === '/channels/') {
  const ChannelsBrowse = React.lazy(() => import('./app/ChannelsBrowse'))
  root.render(
    <Layout label="Channels">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
        <ChannelsBrowse />
      </Suspense>
    </Layout>
  )
} else if (/^\/channels\/(?:[^/]+)\/?$/.test(path)) {
  // Channel feed by slug uses the same Feed shell
  root.render(
    <Suspense fallback={<FullscreenFallback label="Loading channel…" />}> 
      <Feed />
    </Suspense>
  )
} else if (path.startsWith('/uploads/new')) {
  root.render(
    <Layout label="New Upload">
      <Suspense fallback={<UploadNewSkeleton />}> 
        <UploadNewPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/uploads')) {
  // Idle prefetch: when on Uploads, likely next is Publish or Productions.
  const App = () => {
    useEffect(() => {
      const idle = (cb: () => void) => (window as any).requestIdleCallback ? (window as any).requestIdleCallback(cb) : setTimeout(cb, 600)
      idle(() => { void loadPublish() })
      idle(() => { void loadProductions() })
    }, [])
    return (
      <Layout label="Uploads">
        <Suspense fallback={<UploadsSkeleton />}> 
          <UploadsPage />
        </Suspense>
      </Layout>
    )
  }
  root.render(<App />)
} else if (path.startsWith('/productions')) {
  root.render(
    <Layout label="Productions">
      <Suspense fallback={<ProductionsSkeleton />}> 
        <ProductionsPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/publish/story')) {
  root.render(
    <Layout label="Story">
      <Suspense fallback={<PublishSkeleton />}>
        <PublishStoryPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/publish')) {
  root.render(
    <Layout label="Publish">
      <Suspense fallback={<PublishSkeleton />}> 
        <PublishPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/produce')) {
  root.render(
    <Layout label="Produce">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <ProducePage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/edit-video')) {
  root.render(
    <Layout label="Edit Video">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <EditVideoPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/create-video')) {
  root.render(
    <Layout label="Create Video">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <CreateVideoPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/exports')) {
  root.render(
    <Layout label="Exports">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <ExportsPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/assets')) {
  root.render(
    <Layout label="Assets">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <AssetsPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/library')) {
  root.render(
    <Layout label="Library">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <LibraryPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/timelines')) {
  root.render(
    <Layout label="Timelines">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <TimelinesPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/logo-configs')) {
  root.render(
    <Layout label="Logo Configs">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <LogoConfigsPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/lower-thirds')) {
  root.render(
    <Layout label="Lower Thirds">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
        <LowerThirdsPage />
      </Suspense>
    </Layout>
  )
} else if (path === '/profile/avatar' || path === '/profile/avatar/') {
  root.render(
    <Layout label="Edit Avatar">
      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading avatar editor…</div>}> 
        <ProfileAvatarPage />
      </Suspense>
    </Layout>
  )
	} else if (path === '/profile' || path === '/profile/') {
	  root.render(
	    <Layout label="Profile">
	      <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading profile…</div>}> 
	        <ProfilePage />
	      </Suspense>
	    </Layout>
	  )
	} else if (path === '/help' || path === '/help/') {
	    root.render(
	      <Layout label="Help">
	        <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
	          <HelpPage />
	        </Suspense>
	      </Layout>
	    )
	} else if (/^\/help\/(?:[^/]+)\/?$/.test(path)) {
	    root.render(
	      <Layout label="Help">
	        <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
	          <HelpPage />
	        </Suspense>
	      </Layout>
	    )
  } else if (/^\/users\/(?:[^/]+)\/?$/.test(path)) {
    root.render(
      <Layout label="Profile">
        <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}>
          <ProfilePublicPage />
        </Suspense>
      </Layout>
    )
	  } else {
	  // Fallback: render Feed for unknown routes while preserving shell behavior.
	  root.render(
	    <Suspense fallback={<FullscreenFallback label="Loading…" />}> 
	      <Feed />
	    </Suspense>
	  )
	  }
