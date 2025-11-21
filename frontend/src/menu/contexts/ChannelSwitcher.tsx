import React, { useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import styles from '../../styles/channelSwitcher.module.css'

type SpaceType = 'personal' | 'group' | 'channel'
type SpaceRelationship = 'owner' | 'admin' | 'member' | 'subscriber'

type SpaceSummary = {
  id: number
  ulid?: string | null
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
    return <div className={styles.loading}>Login to switch spaces.</div>
  }

  const gotoGlobal = () => {
    if (onSelectGlobal) return onSelectGlobal()
    window.location.href = '/'
  }

  const gotoSpace = (spaceId: number) => {
    if (onSelectSpace) return onSelectSpace(spaceId)
    // Outside Feed, navigate to canonical URLs when possible
    try {
      const s =
        entries.groups.find((g) => g.id === spaceId) ||
        entries.channels.find((c) => c.id === spaceId) ||
        spaces?.personal ||
        spaces?.global
      if (s && s.slug && (s.type === 'group' || s.type === 'channel')) {
        const base = s.type === 'group' ? '/groups/' : '/channels/'
        const slug = encodeURIComponent(s.slug)
        window.location.href = `${base}${slug}`
        return
      }
    } catch {
      // Fall through to legacy param-based navigation
    }
    // Fallback: legacy query-param style (ULID or numeric id)
    const url = new URL(window.location.href)
    url.pathname = '/'
    try {
      const s =
        entries.groups.find((g) => g.id === spaceId) ||
        entries.channels.find((c) => c.id === spaceId) ||
        spaces?.personal ||
        spaces?.global
      const su = (s && 'ulid' in (s as any)) ? (s as any).ulid : null
      if (su && typeof su === 'string' && su.length === 26) url.searchParams.set('spaceUlid', su)
      else url.searchParams.set('space', String(spaceId))
    } catch {
      url.searchParams.set('space', String(spaceId))
    }
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
    const variant = space.type === 'group' ? styles.variantGroup : space.type === 'channel' ? styles.variantChannel : styles.variantPersonal
    return (
      <button
        key={space.id}
        onClick={() => gotoSpace(space.id)}
        title={space.ulid ? `ULID: ${space.ulid}` : undefined}
        data-space-ulid={space.ulid || undefined}
        className={clsx(styles.btn, variant, active && styles.btnActive)}
      >
        <span className={styles.labelLeft}>
          {space.name}
          {accent ? <span className={styles.accent}>{accent}</span> : null}
        </span>
        <span className={styles.badge}>
          {badge}
          {space.subscribed && badge !== 'Subscriber' ? ' · Subscriber' : ''}
        </span>
      </button>
    )
  }

  return (
    <div className={styles.list}>
      <button onClick={gotoGlobal} className={clsx(styles.btn, styles.variantGlobal, isGlobalActive && styles.btnActive)}>
        Global
        <span className={styles.badge}>Feed</span>
      </button>

      {loading && <div className={styles.loading}>Loading…</div>}
      {error && <div className={styles.error}>Failed to load spaces.</div>}

      {spaces?.global && renderSpaceButton(spaces.global, 'Global')}
      {spaces?.personal && renderSpaceButton(spaces.personal, 'Personal')}
      {entries.groups.length > 0 && (<div className={styles.sectionLabel}>Groups</div>)}
      {entries.groups.map((g) => renderSpaceButton(g))}

      {entries.channels.length > 0 && (<div className={styles.sectionLabel}>Channels</div>)}
      {entries.channels.map((c) => renderSpaceButton(c))}
    </div>
  )
}
