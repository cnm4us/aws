import React from 'react'
import styles from '../styles/menu.module.css'

export type ContextId = 'info' | 'channel' | 'review' | 'assets' | 'space-admin' | 'help' | 'settings' | 'messages' | 'profile'

export default function ContextPicker(props: {
  active: ContextId
  onSelect: (id: ContextId) => void
  showAdmin?: boolean
  showReview?: boolean
}) {
  const { active, onSelect, showAdmin = false, showReview = false } = props
  const item = (id: ContextId, label: string, enabled = true, note?: string) => (
    <button
      key={id}
      onClick={() => enabled && onSelect(id)}
      disabled={!enabled}
      className={`${styles.itemBtn} ${active === id ? styles.itemActive : ''}`}
    >
      {label}
      {note ? <span className={styles.note}>{note}</span> : null}
    </button>
  )

  return (
    <div className={styles.list}>
      {item('info', 'Info (Pages & Rules)')}
      {item('assets', 'My Assets')}
      {item('channel', 'Channel Changer')}
      {showReview ? item('review', 'Review') : null}
      {showAdmin ? item('space-admin', 'Admin', true) : null}
      {item('profile', 'Profile')}
      {item('help', 'Help')}
      {item('messages', 'My Messages', false, 'Coming soon')}
      {item('settings', 'Settings', false, 'Coming soon')}
    </div>
  )
}
