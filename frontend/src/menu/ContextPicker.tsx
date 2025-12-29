import React from 'react'
import styles from '../styles/menu.module.css'

export type ContextId = 'info' | 'channel' | 'assets' | 'help' | 'settings' | 'messages' | 'profile'

export default function ContextPicker(props: {
  active: ContextId
  onSelect: (id: ContextId) => void
  showAdmin?: boolean
  showSpaceAdminLink?: boolean
  showSpaceModerationLink?: boolean
}) {
  const { active, onSelect, showAdmin = false, showSpaceAdminLink = false, showSpaceModerationLink = false } = props
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
      {showSpaceAdminLink ? (
        <a href="/space/admin" className={styles.itemLink}>
          <span>Space Admin</span>
          <span className={styles.note}>opens console</span>
        </a>
      ) : null}
      {showSpaceModerationLink ? (
        <a href="/space/moderation" className={styles.itemLink}>
          <span>Space Moderation</span>
          <span className={styles.note}>opens console</span>
        </a>
      ) : null}
      {showAdmin ? (
        <a href="/admin" className={styles.itemLink}>
          <span>Admin</span>
          <span className={styles.note}>opens console</span>
        </a>
      ) : null}
      {item('profile', 'Profile')}
      {item('help', 'Help')}
      {item('messages', 'My Messages', false, 'Coming soon')}
      {item('settings', 'Settings', false, 'Coming soon')}
    </div>
  )
}
