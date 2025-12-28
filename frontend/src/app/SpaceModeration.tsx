import React, { useEffect, useMemo, useState } from 'react'
import HLSVideo from '../components/HLSVideo'
import styles from '../styles/spaceModeration.module.css'

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
        const res = await fetch(`/api/spaces/${spaceId}/review/queue`, { credentials: 'same-origin' })
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
    <div className={styles.container}>
      <div className={styles.title}>Review Queue</div>
      {error ? <div className={styles.error}>{error}</div> : null}
      {!items.length && !loading ? (
        <div className={styles.empty}>No pending items.</div>
      ) : (
        <div className={styles.list}>
          {items.map((it) => (
            <div key={it.publication.id} className={styles.card}>
              {/* Row 1: Thumbnail + Owner */}
              <div className={styles.row}>
                <button onClick={() => setReviewPubId(it.publication.id)} className={styles.thumbBtn} aria-label="Open review">
                  {thumbFor(it) ? (
                    <img src={thumbFor(it) as string} alt="thumbnail" className={styles.thumbImg} />
                  ) : (
                    <div className={styles.thumbPh}>—</div>
                  )}
                </button>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className={styles.ownerLabel}>Owner</div>
                  <div className={styles.ownerName}>
                    {it.owner?.displayName || it.owner?.email || (it.owner?.id != null ? `User ${it.owner.id}` : 'Unknown')}
                  </div>
                </div>
              </div>
              {/* Row 2: Title */}
              <div className={styles.rowTitle}>{titleFor(it)}</div>
              {/* Row 3: Details link */}
              <div className={styles.rowMeta}>
                <button onClick={() => setDetailsPubId(it.publication.id)} className="btn btn--outline btn--sm">Details</button>
                <div className={styles.metaRight}>Requested {new Date(it.publication.created_at).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
      {loading ? <div className={styles.loading}>Loading…</div> : null}

      {/* Review Overlay */}
      {current ? (
        <div className={styles.overlay}>
          <div className={styles.overlayHeader}>
            <button onClick={() => { setReviewPubId(null); setReviewNote('') }} className="btn btn--outline btn--sm">Back</button>
            <div className={styles.overlayTitle}>{titleFor(current)}</div>
          </div>
          <div className={styles.overlayBody}>
            <div className={styles.videoBox}>
              <HLSVideo src={(current.upload.cdn_master || current.upload.s3_master || '') as string} controls autoPlay={false} muted={false} playsInline style={{ width: '100%', maxHeight: '62vh', background: '#000', borderRadius: 10 }} />
            </div>
          </div>
          <div className={styles.noteBox}>
            <textarea value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="Optional notes…" rows={3} className={styles.note} />
            <div className={styles.actions}>
              <button onClick={() => approve(current.publication.id, reviewNote)} disabled={!!busy[current.publication.id]} className="btn btn--primary">Approve</button>
              <button onClick={() => reject(current.publication.id, reviewNote)} disabled={!!busy[current.publication.id]} className="btn btn--danger">Reject</button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Details Overlay */}
      {currentDetails ? (
        <div className={styles.overlay}>
          <div className={styles.noteBox}>
            <button onClick={() => setDetailsPubId(null)} className="btn btn--outline btn--sm">Back</button>
            <div className={styles.overlayTitle} style={{ marginTop: 8 }}>Details</div>
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
