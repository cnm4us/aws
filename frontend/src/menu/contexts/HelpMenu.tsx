import React from 'react'
import { prefetchForHref } from '../../ui/routes'
import styles from '../../styles/menu.module.css'

const items = [
  { label: 'About Us', href: '/help/about' },
  { label: 'Groups', href: '/help/groups' },
  { label: 'Channels', href: '/help/channels' },
  { label: 'Moderation', href: '/help/moderation' },
]

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
          onClick={() => onNavigate && onNavigate()}
          className={styles.itemLink}
        >
          {it.label}
        </a>
      ))}
    </div>
  )
}

