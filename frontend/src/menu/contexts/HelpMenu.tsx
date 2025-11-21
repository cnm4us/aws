import React from 'react'
import { prefetchForHref } from '../../ui/routes'
import styles from '../../styles/menu.module.css'

const items = [
  { label: 'About Us', href: '/help/about' },
  { label: 'Groups', href: '/help/groups' },
  { label: 'Channels', href: '/help/channels' },
  { label: 'Moderation', href: '/help/moderation' },
]

function isHelpPath(pathname: string): boolean {
  if (pathname === '/help' || pathname === '/help/') return true
  return /^\/help\/(?:[^/]+)\/?$/.test(pathname)
}

export default function HelpMenu(props: { onNavigate?: () => void }) {
  const { onNavigate } = props
  return (
    <div className={styles.list}>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          onMouseEnter={() => prefetchForHref(it.href)}
          onFocus={() => prefetchForHref(it.href)}
          onClick={(e) => {
            const currentPath = window.location.pathname || '/'
            // If we're already on a Help route, keep navigation SPA-style:
            // update the URL and notify listeners without reloading the page.
            if (isHelpPath(currentPath)) {
              e.preventDefault()
              try {
                if (currentPath !== it.href) {
                  window.history.pushState({}, '', it.href)
                  try {
                    window.dispatchEvent(new PopStateEvent('popstate', { state: null }))
                  } catch {
                    // Fallback: best-effort manual event without options
                    try { window.dispatchEvent(new PopStateEvent('popstate')) } catch {}
                  }
                }
              } catch {
                window.location.href = it.href
              }
              if (onNavigate) onNavigate()
            } else if (onNavigate) {
              // For non-Help contexts, allow full page navigation but close the drawer.
              onNavigate()
            }
          }}
          className={styles.itemLink}
        >
          {it.label}
        </a>
      ))}
    </div>
  )
}
