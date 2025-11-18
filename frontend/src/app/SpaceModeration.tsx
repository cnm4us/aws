import React, { useEffect, useMemo, useState } from 'react'
import HLSVideo from '../components/HLSVideo'

type QueueItem = {
  publication: {
    id: number
    upload_id: number
    production_id: number | null
    space_id: number
    status: string
    requested_by: number | null
    approved_by: number | null
    visibility: string
    published_at: string | null
    created_at: string
  }
  upload: {
    id: number
    original_filename?: string | null
    modified_filename?: string | null
    poster_portrait_cdn?: string | null
    poster_portrait_s3?: string | null
    poster_landscape_cdn?: string | null
    poster_landscape_s3?: string | null
    cdn_master?: string | null
    s3_master?: string | null
  }
  requester: { displayName: string | null; email: string | null } | null
  owner?: { id: number | null; displayName: string | null; email: string | null } | null
  production?: { id: number | null; name: string | null; createdAt: string | null }
  space?: { id: number; name: string | null; type: string | null }
}

function parseSpaceId(): number | null {
  const p = typeof window !== 'undefined' ? window.location.pathname : ''
  const m = p.match(/\/spaces\/(\d+)\//) || p.match(/\/spaces\/(\d+)$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

function getCsrfToken(): string | null {
  try {
    const m = document.cookie.match(/(?:^|; )csrf=([^;]+)/)
    return m ? decodeURIComponent(m[1]) : null
  } catch { return null }
}

export default function SpaceModerationPage() {
  const spaceId = useMemo(parseSpaceId, [])
  const [items, setItems] = useState<QueueItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<Record<number, boolean>>({})
  const [reviewPubId, setReviewPubId] = useState<number | null>(null)
  const [reviewNote, setReviewNote] = useState('')
  const [detailsPubId, setDetailsPubId] = useState<number | null>(null)

  useEffect(() => {
    let canceled = false
    async function load() {
      if (!spaceId) { setError('Bad space id'); setLoading(false); return }
      setLoading(true); setError(null)
      try {
        const res = await fetch(`/api/spaces/${spaceId}/moderation/queue`, { credentials: 'same-origin' })
        if (!res.ok) throw new Error('fetch_failed')
        const data = await res.json()
        if (canceled) return
        setItems(Array.isArray(data?.items) ? data.items : [])
      } catch (e) {
        if (!canceled) setError('Failed to load moderation queue')
      } finally { if (!canceled) setLoading(false) }
    }
    load();
    return () => { canceled = true }
  }, [spaceId])

  async function approve(publicationId: number, note?: string) {
    if (busy[publicationId]) return
    setBusy((b) => ({ ...b, [publicationId]: true }))
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/publications/${publicationId}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, credentials: 'same-origin', body: JSON.stringify(note && note.trim().length ? { note } : {}) })
      if (!res.ok) throw new Error('approve_failed')
      // Remove from list
      setItems((prev) => prev.filter((it) => it.publication.id !== publicationId))
      setReviewPubId((prev) => (prev === publicationId ? null : prev))
      setReviewNote('')
    } catch {}
    finally { setBusy((b) => ({ ...b, [publicationId]: false })) }
  }

  async function reject(publicationId: number, note?: string) {
    if (busy[publicationId]) return
    setBusy((b) => ({ ...b, [publicationId]: true }))
    try {
      const csrf = getCsrfToken()
      const res = await fetch(`/api/publications/${publicationId}/reject`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf } : {}) }, credentials: 'same-origin', body: JSON.stringify(note && note.trim().length ? { note } : {}) })
      if (!res.ok) throw new Error('reject_failed')
      setItems((prev) => prev.filter((it) => it.publication.id !== publicationId))
      setReviewPubId((prev) => (prev === publicationId ? null : prev))
      setReviewNote('')
    } catch {}
    finally { setBusy((b) => ({ ...b, [publicationId]: false })) }
  }
  function baseName(name?: string | null): string {
    if (!name) return ''
    const leaf = name.split('/').pop() || name
    const i = leaf.lastIndexOf('.')
    return i > 0 ? leaf.slice(0, i) : leaf
  }

  function titleFor(it: QueueItem): string {
    const prodName = (it.production?.name || '').trim()
    if (prodName) return prodName
    const original = it.upload.original_filename || ''
    return baseName(original) || `Upload ${it.upload.id}`
  }

  function thumbFor(it: QueueItem): string | null {
    return (
      it.upload.poster_portrait_cdn || it.upload.poster_portrait_s3 || it.upload.poster_landscape_cdn || it.upload.poster_landscape_s3 || null
    )
  }

  const current = reviewPubId != null ? items.find((x) => x.publication.id === reviewPubId) || null : null
  const currentDetails = detailsPubId != null ? items.find((x) => x.publication.id === detailsPubId) || null : null

  return (
    <div style={{ padding: 12, color: '#fff', fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' }}>
      <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>Moderation Queue</div>
      {error ? <div style={{ color: '#ffb3b3', marginBottom: 12 }}>{error}</div> : null}
      {!items.length && !loading ? (
        <div style={{ padding: 10, opacity: 0.8 }}>No pending items.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {items.map((it) => (
            <div key={it.publication.id} style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
              {/* Row 1: Thumbnail + Owner */}
              <div style={{ display: 'flex', alignItems: 'center', padding: 10, gap: 12 }}>
                <button onClick={() => setReviewPubId(it.publication.id)} style={{ border: 'none', background: 'transparent', padding: 0, lineHeight: 0, borderRadius: 8, overflow: 'hidden' }} aria-label="Open review">
                  {thumbFor(it) ? (
                    <img src={thumbFor(it) as string} alt="thumbnail" style={{ width: 84, height: 120, objectFit: 'cover', display: 'block' }} />
                  ) : (
                    <div style={{ width: 84, height: 120, background: 'rgba(255,255,255,0.08)', display: 'grid', placeItems: 'center' }}>—</div>
                  )}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, opacity: 0.75 }}>Owner</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>
                    {it.owner?.displayName || it.owner?.email || (it.owner?.id != null ? `User ${it.owner.id}` : 'Unknown')}
                  </div>
                </div>
              </div>
              {/* Row 2: Title */}
              <div style={{ padding: '4px 10px 8px 10px', fontSize: 16, fontWeight: 600 }}>{titleFor(it)}</div>
              {/* Row 3: Details link */}
              <div style={{ padding: '0 10px 10px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button onClick={() => setDetailsPubId(it.publication.id)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, padding: '6px 10px' }}>Details</button>
                <div style={{ fontSize: 12, opacity: 0.75 }}>Requested {new Date(it.publication.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {loading ? <div style={{ marginTop: 10, opacity: 0.8 }}>Loading…</div> : null}

      {/* Review Overlay */}
      {current ? (
        <div style={{ position: 'fixed', top: 'var(--header-h, 44px)', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1500, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', alignItems: 'center', padding: 10, gap: 12 }}>
            <button onClick={() => { setReviewPubId(null); setReviewNote('') }} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, padding: '6px 10px' }}>Back</button>
            <div style={{ fontSize: 16, fontWeight: 700, flex: 1, textAlign: 'center' }}>{titleFor(current)}</div>
          </div>
          <div style={{ flex: 1, display: 'grid', placeItems: 'center', padding: 10 }}>
            <div style={{ width: '100%', maxWidth: 720 }}>
              <HLSVideo src={(current.upload.cdn_master || current.upload.s3_master || '') as string} controls autoPlay={false} muted={false} playsInline style={{ width: '100%', maxHeight: '62vh', background: '#000', borderRadius: 10 }} />
            </div>
          </div>
          <div style={{ padding: 10 }}>
            <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Optional notes…" rows={3} style={{ width: '100%', borderRadius: 10, padding: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.05)', color: '#fff', marginBottom: 10 }} />
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => approve(current.publication.id, reviewNote)} disabled={!!busy[current.publication.id]} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: '#2e7d32', color: '#fff', fontSize: 16, fontWeight: 700 }}>Approve</button>
              <button onClick={() => reject(current.publication.id, reviewNote)} disabled={!!busy[current.publication.id]} style={{ flex: 1, padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.25)', background: '#b71c1c', color: '#fff', fontSize: 16, fontWeight: 700 }}>Reject</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Details Overlay */}
      {currentDetails ? (
        <div style={{ position: 'fixed', top: 'var(--header-h, 44px)', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.92)', zIndex: 1500, display: 'flex', flexDirection: 'column' }}>
          {/* Header: Back below app title, then Details centered */}
          <div style={{ padding: 10 }}>
            <button onClick={() => setDetailsPubId(null)} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 8, padding: '6px 10px' }}>Back</button>
            <div style={{ marginTop: 8, fontSize: 16, fontWeight: 700, textAlign: 'center' }}>Details</div>
          </div>
          <div style={{ padding: 14, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 15 }}>
            <div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>User Name</div>
              <div>{currentDetails.owner?.displayName || currentDetails.owner?.email || (currentDetails.owner?.id != null ? `User ${currentDetails.owner.id}` : 'Unknown')}</div>
            </div>
            <div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>Asset (Upload File Name)</div>
              <div>{currentDetails.upload.original_filename || `Upload ${currentDetails.upload.id}`}</div>
            </div>
            <div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>Production Name</div>
              <div>{(currentDetails.production?.name || '').trim() || '—'}</div>
            </div>
            <div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>Date Production</div>
              <div>{currentDetails.production?.createdAt ? new Date(currentDetails.production.createdAt).toLocaleString() : '—'}</div>
            </div>
            <div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>Submitted To</div>
              <div>{currentDetails.space?.name || `Space ${spaceId}`}</div>
            </div>
            <div>
              <div style={{ opacity: 0.7, fontSize: 13 }}>Date Requested</div>
              <div>{new Date(currentDetails.publication.created_at).toLocaleString()}</div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
