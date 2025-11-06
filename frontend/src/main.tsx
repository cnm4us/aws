import React, { Suspense, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { loadFeed, loadUploads, loadUploadNew, loadProductions, loadPublish } from './ui/routes'
import { UploadsSkeleton, UploadNewSkeleton, ProductionsSkeleton, PublishSkeleton } from './ui/Skeletons'
const Feed = React.lazy(loadFeed)
const UploadsPage = React.lazy(loadUploads)
const UploadNewPage = React.lazy(loadUploadNew)
const PublishPage = React.lazy(loadPublish)
const ProductionsPage = React.lazy(loadProductions)
import Layout from './ui/Layout'

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
} else {
  // Fallback: render Feed for unknown routes while preserving shell behavior.
  root.render(
    <Suspense fallback={<FullscreenFallback label="Loading…" />}> 
      <Feed />
    </Suspense>
  )
}
