import React from 'react'
import { prefetchForHref } from '../../ui/routes'
import styles from '../../styles/menu.module.css'

export default function AdminModerationMenu(props: {
  onNavigate?: () => void
  showAdmin?: boolean
  showSpaceAdminLink?: boolean
  showSpaceModerationLink?: boolean
}) {
  const { onNavigate, showAdmin = false, showSpaceAdminLink = false, showSpaceModerationLink = false } = props
  const items = [
    showSpaceAdminLink ? { label: 'Space Admin', href: '/space/admin' } : null,
    showSpaceModerationLink ? { label: 'Space Moderation', href: '/space/moderation' } : null,
    showAdmin ? { label: 'Admin', href: '/admin' } : null,
  ].filter(Boolean) as Array<{ label: string; href: string }>

  return (
    <div className={styles.list}>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          onMouseEnter={() => prefetchForHref(it.href)}
          onFocus={() => prefetchForHref(it.href)}
          onClick={() => onNavigate && onNavigate()}
          className={styles.itemLink}
        >
          <span>{it.label}</span>
          <span className={styles.note}>opens console</span>
        </a>
      ))}
    </div>
  )
}
