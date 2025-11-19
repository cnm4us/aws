import React from 'react'
import { prefetchForHref } from '../../ui/routes'
import styles from '../../styles/menu.module.css'

export default function MyAssets(props: { onNavigate?: () => void }) {
  const { onNavigate } = props
  const items = [
    { label: 'Uploads', href: '/uploads' },
    { label: 'Productions', href: '/productions' },
    { label: 'Publish', href: '/publish' },
  ]
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
          {it.label}
        </a>
      ))}
    </div>
  )
}
