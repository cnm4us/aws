import React from 'react'
import styles from '../styles/menu.module.css'

export type ContextId = 'info' | 'channel' | 'assets' | 'admin_mod' | 'help' | 'settings' | 'messages' | 'profile'

export default function ContextPicker(props: {
  active: ContextId
  onSelect: (id: ContextId) => void
  showAdmin?: boolean
  showSpaceAdminLink?: boolean
  showSpaceModerationLink?: boolean
}) {
  const { active, onSelect, showAdmin = false, showSpaceAdminLink = false, showSpaceModerationLink = false } = props
  const hasAnyAdminModeration = showAdmin || showSpaceAdminLink || showSpaceModerationLink
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
    <div className={`${styles.list} ${styles.selectorList}`}>
      {item('info', 'Info (Pages & Rules)')}
      {item('assets', 'Creative Studio')}
      {item('channel', 'Channel Changer')}
      {hasAnyAdminModeration ? item('admin_mod', 'Admin & Moderation') : null}
      {item('profile', 'Profile')}
      {item('help', 'Help')}
      {item('messages', 'My Messages', false, 'Coming soon')}
      {item('settings', 'Settings', false, 'Coming soon')}
    </div>
  )
}
