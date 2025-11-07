import React, { Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { loadFeed, loadUploads, loadUploadNew, loadProductions, loadPublish } from './ui/routes'
import { UploadsSkeleton, UploadNewSkeleton, ProductionsSkeleton, PublishSkeleton } from './ui/Skeletons'
const AdminUsersPage = React.lazy(() => import('./app/AdminUsers'))
const AdminUserPage = React.lazy(() => import('./app/AdminUser'))
const AdminSiteSettingsPage = React.lazy(() => import('./app/AdminSiteSettings'))
const AdminSpacesPage = React.lazy(() => import('./app/AdminSpaces'))
const SpaceMembersPage = React.lazy(() => import('./app/SpaceMembers'))
const SpaceSettingsPage = React.lazy(() => import('./app/SpaceSettings'))
const SpaceModerationPage = React.lazy(() => import('./app/SpaceModeration'))
const AdminSpaceDetailPage = React.lazy(() => import('./app/AdminSpaceDetail'))
const Feed = React.lazy(loadFeed)
const UploadsPage = React.lazy(loadUploads)
const UploadNewPage = React.lazy(loadUploadNew)
const PublishPage = React.lazy(loadPublish)
const ProductionsPage = React.lazy(loadProductions)
import Layout from './ui/Layout'
import { AdminPlaceholder, SpaceAdminPlaceholder } from './app/Placeholders'

const root = createRoot(document.getElementById('root')!)

const path = window.location.pathname

// Feed renders its own SharedNav (extracted) to preserve behavior.
const FullscreenFallback = ({ label = 'Loading…' }: { label?: string }) => (
  <div style={{ height: '100dvh', background: '#000', color: '#fff', display: 'grid', placeItems: 'center' }}>{label}</div>
)

if (path === '/' || path === '') {
  // Idle prefetch: when on Feed, likely next is Uploads or Publish.
  const App = () => {
    useEffect(() => {
      const idle = (cb: () => void) => (window as any).requestIdleCallback ? (window as any).requestIdleCallback(cb) : setTimeout(cb, 600)
      idle(() => { void loadUploads() })
      idle(() => { void loadProductions() })
      idle(() => { void loadPublish() })
    }, [])
    return (
      <Suspense fallback={<FullscreenFallback label="Loading feed…" />}> 
        <Feed />
      </Suspense>
    )
  }
  root.render(<App />)
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
} else if (path.startsWith('/publish')) {
  root.render(
    <Layout label="Publish">
      <Suspense fallback={<PublishSkeleton />}> 
        <PublishPage />
      </Suspense>
    </Layout>
  )
} else if (path.startsWith('/adminx/users')) {
  if (/^\/adminx\/users\/(\d+)/.test(path)) {
    root.render(
      <Layout label="Admin • User (SPA)">
        <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
          <AdminUserPage />
        </Suspense>
      </Layout>
    )
  } else {
    root.render(
      <Layout label="Admin • Users (SPA)">
        <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
          <AdminUsersPage />
        </Suspense>
      </Layout>
    )
  }
} else {
  if (path.startsWith('/adminx/settings')) {
    root.render(
      <Layout label="Admin • Site Settings (SPA)">
        <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
          <AdminSiteSettingsPage />
        </Suspense>
      </Layout>
    )
  } else if (path.startsWith('/admin/')) {
    // Map legacy admin routes to SPA pages or placeholder
    if (/^\/admin\/users\/(\d+)/.test(path)) {
      root.render(
        <Layout label="Admin • User (SPA)">
          <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
            <AdminUserPage />
          </Suspense>
        </Layout>
      )
    } else if (path.startsWith('/admin/users')) {
      root.render(
        <Layout label="Admin • Users (SPA)">
          <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
            <AdminUsersPage />
          </Suspense>
        </Layout>
      )
    } else if (path.startsWith('/admin/settings')) {
      root.render(
        <Layout label="Admin • Site Settings (SPA)">
          <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
            <AdminSiteSettingsPage />
          </Suspense>
        </Layout>
      )
    } else {
      // Detail first to avoid matching list route prefix
      if (/^\/admin\/(groups|channels)\/\d+\/?$/.test(path)) {
        const isGroup = /^\/admin\/groups\//.test(path)
        root.render(
          <Layout label={`Admin • ${isGroup ? 'Group' : 'Channel'} (SPA)`}>
            <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
              <AdminSpaceDetailPage />
            </Suspense>
          </Layout>
        )
      } else if (path.startsWith('/admin/groups')) {
        root.render(
          <Layout label="Admin • Groups (SPA)">
            <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
              <AdminSpacesPage />
            </Suspense>
          </Layout>
        )
      } else if (path.startsWith('/admin/channels')) {
        root.render(
          <Layout label="Admin • Channels (SPA)">
            <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
              <AdminSpacesPage />
            </Suspense>
          </Layout>
        )
      } else {
        root.render(
          <Layout label="Admin (SPA)">
            <AdminPlaceholder />
          </Layout>
        )
      }
    }
  } else if (/^\/(spaces|groups|channels)\//.test(path) && (path.includes('/admin') || path.includes('/moderation'))) {
    // For now, show Space Members for /spaces/:id/admin and .../members
    if (/^\/spaces\/\d+\/(admin(\/members)?\/?$)/.test(path)) {
      root.render(
        <Layout label="Space Members (SPA)">
          <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
            <SpaceMembersPage />
          </Suspense>
        </Layout>
      )
    } else if (/^\/spaces\/\d+\/admin\/settings\/?$/.test(path)) {
      root.render(
        <Layout label="Space Settings (SPA)">
          <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
            <SpaceSettingsPage />
          </Suspense>
        </Layout>
      )
    } else if (/^\/spaces\/\d+\/moderation\/?$/.test(path)) {
      root.render(
        <Layout label="Space Moderation (SPA)">
          <Suspense fallback={<div style={{ color: '#fff', padding: 20 }}>Loading…</div>}> 
            <SpaceModerationPage />
          </Suspense>
        </Layout>
      )
    } else {
      root.render(
        <Layout label="Space Admin (SPA)">
          <SpaceAdminPlaceholder />
        </Layout>
      )
    }
  } else {
  // Fallback: render Feed for unknown routes while preserving shell behavior.
  root.render(
    <Suspense fallback={<FullscreenFallback label="Loading…" />}> 
      <Feed />
    </Suspense>
  )
  }
}
