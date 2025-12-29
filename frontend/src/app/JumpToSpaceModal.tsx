import React, { useEffect, useMemo, useState } from 'react'

type JumpSpaceItem = {
  spaceId: number
  spaceUlid: string | null
  spaceName: string
  spaceSlug: string
  spaceType: 'group' | 'channel' | string
}

type JumpSpacesResponse = {
  items: JumpSpaceItem[]
}

export default function JumpToSpaceModal(props: {
  open: boolean
  publicationId: number | null
  pinProductionUlid?: string | null
  onClose: () => void
}) {
  const { open, publicationId, pinProductionUlid, onClose } = props

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<JumpSpaceItem[]>([])

  useEffect(() => {
    if (!open) return
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (!open) return
    if (publicationId == null) {
      setItems([])
      setError('Missing publication id')
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    setItems([])

    ;(async () => {
      try {
        const res = await fetch(`/api/publications/${publicationId}/jump-spaces`, { credentials: 'same-origin', signal: controller.signal })
        if (!res.ok) throw new Error('fetch_failed')
        const data = (await res.json()) as JumpSpacesResponse
        const next = Array.isArray(data?.items) ? data.items : []
        setItems(
          next
            .map((it: any) => ({
              spaceId: Number(it.spaceId),
              spaceUlid: it.spaceUlid == null ? null : String(it.spaceUlid),
              spaceName: String(it.spaceName || ''),
              spaceSlug: String(it.spaceSlug || ''),
              spaceType: String(it.spaceType || ''),
            }))
            .filter((it) => Number.isFinite(it.spaceId) && it.spaceId > 0 && it.spaceSlug.length > 0 && it.spaceName.length > 0)
        )
      } catch (e: any) {
        if (String(e?.name || '') === 'AbortError') return
        setError('Failed to load spaces')
      } finally {
        setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [open, publicationId])

  const title = useMemo(() => 'Jump to Space', [])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'grid',
        placeItems: 'center',
        background: 'transparent',
        paddingLeft: 'max(16px, env(safe-area-inset-left, 0px))',
        paddingRight: 'max(16px, env(safe-area-inset-right, 0px))',
        paddingTop: 'max(16px, env(safe-area-inset-top, 0px))',
        paddingBottom: 'max(16px, env(safe-area-inset-bottom, 0px))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(560px, 100%)',
          maxHeight: '86vh',
          background: 'rgba(18,18,18,0.98)',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.16)',
          borderRadius: 14,
          overflow: 'hidden',
          display: 'grid',
          gridTemplateRows: 'auto 1fr',
        }}
      >
        <div style={{ padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'grid', gap: 2 }}>
            <div style={{ fontWeight: 700 }}>{title}</div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>Pick a space to view and interact.</div>
          </div>
          <button onClick={onClose} style={{ background: 'transparent', color: '#fff', border: '1px solid rgba(255,255,255,0.28)', borderRadius: 10, padding: '6px 10px', fontSize: 16 }}>
            Close
          </button>
        </div>

        <div style={{ overflowY: 'auto', padding: 14 }}>
          {loading ? (
            <div style={{ padding: 6, opacity: 0.85 }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 6, color: '#ffb3b3' }}>{error}</div>
          ) : items.length === 0 ? (
            <div style={{ padding: 6, color: '#bbb' }}>Not published to any spaces yet.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {items.map((s) => {
                const baseHref = s.spaceType === 'group' ? `/groups/${encodeURIComponent(s.spaceSlug)}` : `/channels/${encodeURIComponent(s.spaceSlug)}`
                const pin = String(pinProductionUlid || '').trim()
                const href = pin ? `${baseHref}?pin=${encodeURIComponent(pin)}` : baseHref
                const meta = s.spaceType === 'group' ? 'Group' : s.spaceType === 'channel' ? 'Channel' : s.spaceType
                return (
                  <a
                    key={String(s.spaceId)}
                    href={href}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '12px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: 'rgba(255,255,255,0.04)',
                      color: '#fff',
                      textDecoration: 'none',
                    }}
                  >
                    <div style={{ display: 'grid', gap: 2 }}>
                      <div style={{ fontWeight: 650 }}>{s.spaceName}</div>
                      <div style={{ fontSize: 12, opacity: 0.75 }}>
                        {meta}
                        {s.spaceUlid ? <span style={{ opacity: 0.7 }}> · {s.spaceUlid}</span> : null}
                      </div>
                    </div>
                    <div style={{ fontSize: 18, opacity: 0.85 }}>→</div>
                  </a>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
