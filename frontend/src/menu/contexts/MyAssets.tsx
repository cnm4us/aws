import React from 'react'
import { prefetchForHref } from '../../ui/routes'

export default function MyAssets(props: { onNavigate?: () => void }) {
  const { onNavigate } = props
  const items = [
    { label: 'Uploads', href: '/uploads' },
    // Label shown as "Assets" while pointing to productions list
    { label: 'Assets', href: '/productions' },
    { label: 'Publish', href: '/publish' },
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {items.map((it) => (
        <a
          key={it.href}
          href={it.href}
          onMouseEnter={() => prefetchForHref(it.href)}
          onFocus={() => prefetchForHref(it.href)}
          onClick={() => onNavigate && onNavigate()}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '12px 14px',
            borderRadius: 10,
            border: '1px solid rgba(255,255,255,0.15)',
            background: 'rgba(255,255,255,0.05)',
            color: '#fff',
            fontSize: 15,
            fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
            textDecoration: 'none',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            WebkitTapHighlightColor: 'transparent',
          }}
        >
          {it.label}
        </a>
      ))}
    </div>
  )
}
