// Centralized dynamic import loaders for SPA pages
// Allows both lazy() and proactive prefetching to share the same importers.

export const loadFeed = () => import('../app/Feed')
export const loadUploads = () => import('../app/Uploads')
export const loadUploadNew = () => import('../app/UploadNew')
export const loadProductions = () => import('../app/Productions')
export const loadPublish = () => import('../app/Publish')
export const loadProfile = () => import('../app/Profile')
export const loadProfileAvatar = () => import('../app/ProfileAvatar')
export const loadHomePage = () => import('../app/HomePage')
export const loadPageView = () => import('../app/PageView')
export const loadRuleView = () => import('../app/RuleView')
export const loadRulesIndex = () => import('../app/RulesIndex')

export function prefetchForHref(href: string) {
  try {
    if (!href) return
    if (href.startsWith('/uploads/new')) { void loadUploadNew() }
    else if (href.startsWith('/uploads')) { void loadUploads() }
    else if (href.startsWith('/productions')) { void loadProductions() }
    else if (href.startsWith('/publish')) { void loadPublish() }
     else if (href.startsWith('/profile/avatar')) { void loadProfileAvatar() }
     else if (href.startsWith('/profile')) { void loadProfile() }
    else if (href.startsWith('/pages/')) { void loadPageView() }
    else if (href === '/rules' || href === '/rules/') { void loadRulesIndex() }
    else if (href.startsWith('/rules/')) { void loadRuleView() }
    else if (href === '/' || href === '') { void loadHomePage() }
    else if (href.startsWith('/channels/') || href.startsWith('/groups/')) { void loadFeed() }
  } catch {}
}
