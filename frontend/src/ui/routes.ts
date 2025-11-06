// Centralized dynamic import loaders for SPA pages
// Allows both lazy() and proactive prefetching to share the same importers.

export const loadFeed = () => import('../app/Feed')
export const loadUploads = () => import('../app/Uploads')
export const loadUploadNew = () => import('../app/UploadNew')
export const loadProductions = () => import('../app/Productions')
export const loadPublish = () => import('../app/Publish')

export function prefetchForHref(href: string) {
  try {
    if (!href) return
    if (href.startsWith('/uploads/new')) { void loadUploadNew() }
    else if (href.startsWith('/uploads')) { void loadUploads() }
    else if (href.startsWith('/productions')) { void loadProductions() }
    else if (href.startsWith('/publish')) { void loadPublish() }
    else if (href === '/' || href === '') { void loadFeed() }
  } catch {}
}

