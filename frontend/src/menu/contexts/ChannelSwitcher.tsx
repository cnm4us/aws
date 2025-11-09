import React, { useEffect, useMemo, useState } from 'react'

type SpaceType = 'personal' | 'group' | 'channel'
type SpaceRelationship = 'owner' | 'admin' | 'member' | 'subscriber'

type SpaceSummary = {
  id: number
  name: string
  slug: string
  type: SpaceType
  relationship: SpaceRelationship
  subscribed: boolean
}

type MySpacesResponse = {
  personal: SpaceSummary | null
  global: SpaceSummary | null
  groups: SpaceSummary[]
  channels: SpaceSummary[]
}

export default function ChannelSwitcher(props: {
  open: boolean
  isAuthed: boolean
  activeSpaceId?: number | null
  isGlobalActive?: boolean
  onSelectGlobal?: () => void
  onSelectSpace?: (spaceId: number) => void
}) {
  const { open, isAuthed, activeSpaceId = null, isGlobalActive = false, onSelectGlobal, onSelectSpace } = props
  const [spaces, setSpaces] = useState<MySpacesResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAuthed) return
    if (!open) return
    if (loaded || loading) return
    let canceled = false
    setLoading(true)
    ;(async () => {
      try {
        const res = await fetch('/api/me/spaces', { credentials: 'same-origin' })
        if (!res.ok) throw new Error('failed_to_fetch_spaces')
        const data = (await res.json()) as MySpacesResponse
        if (canceled) return
        setSpaces({
          personal: data.personal || null,
          global: data.global || null,
          groups: Array.isArray(data.groups) ? data.groups : [],
          channels: Array.isArray(data.channels) ? data.channels : [],
        })
        setLoaded(true)
        setError(null)
      } catch (err: any) {
        if (canceled) return
        setError(err?.message ? String(err.message) : 'failed_to_fetch_spaces')
        setLoaded(false)
      } finally {
        if (!canceled) setLoading(false)
      }
    })()
    return () => { canceled = true }
  }, [open, isAuthed])

  const entries = useMemo(() => {
    if (!spaces) return { groups: [] as SpaceSummary[], channels: [] as SpaceSummary[] }
    return { groups: spaces.groups || [], channels: spaces.channels || [] }
  }, [spaces])

  if (!isAuthed) {
    return <div style={{ color: '#fff', fontSize: 15 }}>Login to switch spaces.</div>
  }

  const gotoGlobal = () => {
    if (onSelectGlobal) return onSelectGlobal()
    window.location.href = '/'
  }

  const gotoSpace = (spaceId: number) => {
    if (onSelectSpace) return onSelectSpace(spaceId)
    const url = new URL(window.location.href)
    url.pathname = '/'
    url.searchParams.set('space', String(spaceId))
    window.location.href = url.toString()
  }

  const renderSpaceButton = (space: SpaceSummary, accent?: string) => {
    const active = activeSpaceId === space.id
    const badge =
      space.relationship === 'owner'
        ? 'Owner'
        : space.relationship === 'admin'
        ? 'Admin'
        : space.relationship === 'subscriber'
        ? 'Subscriber'
        : undefined
    return (
      <button
        key={space.id}
        onClick={() => gotoSpace(space.id)}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 14px',
          borderRadius: 10,
          marginBottom: 8,
          border: active ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.15)',
          background: active ? 'rgba(33,150,243,0.25)' : 'rgba(255,255,255,0.05)',
          color: '#fff',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <span>
          {space.name}
          {accent ? <span style={{ marginLeft: 6, fontSize: 12, color: accent }}>{accent}</span> : null}
        </span>
        <span style={{ fontSize: 12, opacity: 0.8 }}>
          {badge}
          {space.subscribed && badge !== 'Subscriber' ? ' · Subscriber' : ''}
        </span>
      </button>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <button
        onClick={gotoGlobal}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 14px',
          borderRadius: 10,
          marginBottom: 12,
          border: isGlobalActive ? '1px solid rgba(255,255,255,0.9)' : '1px solid rgba(255,255,255,0.15)',
          background: isGlobalActive ? 'rgba(33,150,243,0.25)' : 'rgba(255,255,255,0.05)',
          color: '#fff',
          fontSize: 15,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        Global
        <span style={{ fontSize: 12, opacity: 0.8 }}>Feed</span>
      </button>

      {loading && <div style={{ color: '#fff', fontSize: 13, opacity: 0.7, marginBottom: 8 }}>Loading…</div>}
      {error && <div style={{ color: '#ffb3b3', fontSize: 13, marginBottom: 8 }}>Failed to load spaces.</div>}

      {spaces?.global && renderSpaceButton(spaces.global, 'Global')}
      {spaces?.personal && renderSpaceButton(spaces.personal, 'Personal')}
      {entries.groups.length > 0 && (
        <div style={{ marginTop: 18, marginBottom: 6, fontWeight: 600, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>
          Groups
        </div>
      )}
      {entries.groups.map((g) => renderSpaceButton(g))}

      {entries.channels.length > 0 && (
        <div style={{ marginTop: 18, marginBottom: 6, fontWeight: 600, fontSize: 13, letterSpacing: 1, textTransform: 'uppercase', opacity: 0.7 }}>
          Channels
        </div>
      )}
      {entries.channels.map((c) => renderSpaceButton(c))}
    </div>
  )
}
