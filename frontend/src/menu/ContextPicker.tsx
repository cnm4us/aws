import React from 'react'

export type ContextId = 'channel' | 'assets' | 'space-admin' | 'settings' | 'messages'

export default function ContextPicker(props: {
  active: ContextId
  onSelect: (id: ContextId) => void
  showAdmin?: boolean
}) {
  const { active, onSelect, showAdmin = false } = props
  const item = (id: ContextId, label: string, enabled = true, note?: string) => (
    <button
      key={id}
      onClick={() => enabled && onSelect(id)}
      disabled={!enabled}
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '12px 14px',
        borderRadius: 10,
        marginBottom: 8,
        border: active === id ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.15)',
        background: active === id ? 'rgba(33,150,243,0.25)' : 'rgba(255,255,255,0.05)',
        color: enabled ? '#fff' : 'rgba(255,255,255,0.6)',
        fontSize: 15,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        opacity: enabled ? 1 : 0.7,
      }}
    >
      {label}
      {note ? <span style={{ fontSize: 12, opacity: 0.8 }}>{note}</span> : null}
    </button>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {item('assets', 'My Assets')}
      {item('channel', 'Channel Changer')}
      {showAdmin ? item('space-admin', 'Admin', true) : null}
      {item('messages', 'My Messages', false, 'Coming soon')}
      {item('settings', 'Settings', false, 'Coming soon')}
    </div>
  )
}
