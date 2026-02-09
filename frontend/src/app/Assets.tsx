import React, { useMemo } from 'react'
import ScreenTitlePresetsPage from './ScreenTitlePresets'

type UploadListItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description: string | null
  size_bytes: number | null
  duration_seconds?: number | null
  width: number | null
  height: number | null
  status: string
  kind?: 'video' | 'logo' | 'audio' | 'image' | string
  image_role?: string | null
  created_at: string
  uploaded_at: string | null
  source_deleted_at?: string | null
  s3_key?: string | null
  video_role?: string | null
  poster_portrait_cdn?: string
  poster_landscape_cdn?: string
  poster_cdn?: string
  poster_portrait_s3?: string
  poster_landscape_s3?: string
  poster_s3?: string
  is_favorite?: boolean
  last_used_at?: string | null
}

type LibraryClipItem = {
  id: number
  upload_id: number
  start_seconds: number
  end_seconds: number
  title?: string | null
  description?: string | null
  is_system?: number
  is_shared?: number
  owner_user_id?: number
  modified_filename?: string | null
  original_filename?: string | null
  upload_description?: string | null
  duration_seconds?: number | null
  width?: number | null
  height?: number | null
  source_org?: string | null
}
type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type Mode = 'manage' | 'pick'

type AssetType = {
  key: string
  label: string
  description: string
  href: string
}

function parseMode(): Mode {
  try {
    const qs = new URLSearchParams(window.location.search)
    const raw = String(qs.get('mode') || '').trim().toLowerCase()
    return raw === 'pick' ? 'pick' : 'manage'
  } catch {
    return 'manage'
  }
}

function getQueryParam(name: string): string | null {
  try {
    const qs = new URLSearchParams(window.location.search)
    const v = qs.get(name)
    return v == null ? null : String(v)
  } catch {
    return null
  }
}

function withParams(href: string, extra: Record<string, string>): string {
  try {
    const u = new URL(href, window.location.origin)
    for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v)
    return u.pathname + (u.search ? u.search : '')
  } catch {
    return href
  }
}

function isSourceVideoUpload(u: UploadListItem): boolean {
  const role = u.video_role ? String(u.video_role) : ''
  if (role === 'source') return true
  if (role === 'export') return false
  const key = u.s3_key ? String(u.s3_key) : ''
  if (key.includes('/renders/') || key.startsWith('renders/')) return false
  return true
}

function buildReturnHref(extraParams: Record<string, string>): string | null {
  const rawReturn = getQueryParam('return')
  if (!rawReturn) return null
  try {
    const u = new URL(rawReturn, window.location.origin)
    for (const [k, v] of Object.entries(extraParams)) u.searchParams.set(k, v)
    return u.pathname + (u.search ? u.search : '') + (u.hash ? u.hash : '')
  } catch {
    return rawReturn
  }
}

function getPickPassthrough(): Record<string, string> {
  const mode = parseMode()
  if (mode !== 'pick') return {}
  const out: Record<string, string> = { mode: 'pick' }
  const project = getQueryParam('project')
  const ret = getQueryParam('return')
  if (project) out.project = String(project)
  if (ret) out.return = String(ret)
  return out
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return ''
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return ''
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatDate(input: string | null): string {
  if (!input) return ''
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return input
  return d.toISOString().slice(0, 10)
}

function formatDuration(seconds: number | null | undefined): string {
  const s = seconds == null ? 0 : Number(seconds)
  if (!Number.isFinite(s) || s <= 0) return ''
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${String(ss).padStart(2, '0')}`
}

async function ensureLoggedIn(): Promise<MeResponse | null> {
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' })
    if (!res.ok) throw new Error('not_authenticated')
    const data = (await res.json()) as MeResponse
    if (!data || !data.userId) return null
    return data
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { credentials: 'same-origin' })
  const json: any = await res.json().catch(() => null)
  if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
  return json
}

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

const YellowModal: React.FC<{ title: string; body: string; onClose: () => void }> = ({ title, body, onClose }) => {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 22000,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: 16,
        paddingTop: 'calc(72px + env(safe-area-inset-top))',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          borderRadius: 16,
          border: '1px solid rgba(255,214,10,0.20)',
          background: 'linear-gradient(180deg, rgba(92, 62, 24, 0.98), rgba(40, 28, 14, 0.98))',
          color: '#fff',
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div style={{ fontWeight: 900, fontSize: 16, lineHeight: 1.2 }}>{title}</div>
          <button
            type="button"
            onClick={onClose}
            style={{
              width: 42,
              height: 42,
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#000',
              color: '#fff',
              fontWeight: 900,
              cursor: 'pointer',
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', lineHeight: 1.4 }}>{body || 'No description'}</div>
      </div>
    </div>
  )
}

const EditUploadModal: React.FC<{
  upload: UploadListItem
  onClose: () => void
  onSaved: (next: { name: string; description: string }) => void
}> = ({ upload, onClose, onSaved }) => {
  const [name, setName] = React.useState<string>((upload.modified_filename || upload.original_filename || '').trim())
  const [description, setDescription] = React.useState<string>((upload.description || '').trim())
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={() => {
        if (saving) return
        onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 22000,
        background: 'rgba(0,0,0,0.65)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 'min(720px, 100%)',
          borderRadius: 16,
          background: '#0b0b0b',
          border: '1px solid rgba(255,255,255,0.14)',
          padding: 16,
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Edit</div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            style={{
              padding: '8px 10px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: '#0c0c0c',
              color: '#fff',
              fontWeight: 700,
              cursor: saving ? 'default' : 'pointer',
              opacity: saving ? 0.6 : 1,
            }}
          >
            ✕
          </button>
        </div>

        <div style={{ display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontWeight: 700 }}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.14)',
                background: '#0c0c0c',
                color: '#fff',
              }}
              maxLength={512}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontWeight: 700 }}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                minHeight: 120,
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.14)',
                background: '#0c0c0c',
                color: '#fff',
                resize: 'vertical',
              }}
              maxLength={2000}
            />
          </label>

          {error ? <div style={{ color: '#ff9b9b' }}>{error}</div> : null}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={saving}
              onClick={onClose}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0c0c0c',
                color: '#fff',
                fontWeight: 800,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.6 : 1,
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                const trimmed = name.trim()
                if (!trimmed) {
                  setError('Name is required')
                  return
                }
                setSaving(true)
                setError(null)
                try {
                  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                  const csrf = getCsrfToken()
                  if (csrf) headers['x-csrf-token'] = csrf
                  const res = await fetch(`/api/uploads/${upload.id}`, {
                    method: 'PATCH',
                    credentials: 'same-origin',
                    headers,
                    body: JSON.stringify({ name: trimmed, description }),
                  })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to save')
                  onSaved({ name: trimmed, description })
                  onClose()
                } catch (e: any) {
                  setError(e?.message || 'Failed to save changes')
                } finally {
                  setSaving(false)
                }
              }}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: saving ? 'default' : 'pointer',
                opacity: saving ? 0.7 : 1,
              }}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const AssetUploadsListPage: React.FC<{
  title: string
  subtitle: string
  kind: 'video' | 'logo' | 'image'
  imageRole?: string | null
  uploadHref: string
  showDuration?: boolean
  filterFn?: (u: UploadListItem) => boolean
  allowDelete?: boolean
  onPick?: (u: UploadListItem) => void
}> = ({ title, subtitle, kind, imageRole, uploadHref, showDuration, filterFn, allowDelete, onPick }) => {
  const mode = useMemo(() => parseMode(), [])
  const [me, setMe] = React.useState<MeResponse | null>(null)
  const [items, setItems] = React.useState<UploadListItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [descOpen, setDescOpen] = React.useState(false)
  const [descTitle, setDescTitle] = React.useState('')
  const [descBody, setDescBody] = React.useState('')
  const [editUpload, setEditUpload] = React.useState<UploadListItem | null>(null)
  const [deleting, setDeleting] = React.useState<Record<number, boolean>>({})
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [imagePreview, setImagePreview] = React.useState<{ title: string; src: string } | null>(null)
  const returnTo = useMemo(() => window.location.pathname + window.location.search, [])

  const backHref = useMemo(() => {
    const base = '/assets'
    if (mode !== 'pick') return base
    try {
      const qs = new URLSearchParams(window.location.search)
      const ret = qs.get('return')
      return ret ? String(ret) : base
    } catch {
      return base
    }
  }, [mode])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const user = await ensureLoggedIn()
      setMe(user)
      if (!user?.userId) throw new Error('not_authenticated')
      const params = new URLSearchParams({
        kind,
        status: 'uploaded,completed',
        user_id: String(user.userId),
        limit: '200',
      })
      if (kind === 'image' && imageRole) params.set('image_role', String(imageRole))
      const res = await fetch(`/api/uploads?${params.toString()}`, { credentials: 'same-origin' })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.error || 'failed_to_load'))
      const raw: UploadListItem[] = Array.isArray(json?.items) ? json.items : Array.isArray(json) ? json : []
      const next = raw.filter((u) => !u.source_deleted_at)
      const filtered = filterFn ? next.filter(filterFn) : next
      setItems(filtered)
    } catch (e: any) {
      setError(e?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [filterFn, imageRole, kind])

  React.useEffect(() => {
    void load()
  }, [load])

	  const thumbOrFile = (u: UploadListItem): string => {
	    if (kind === 'video') return `/api/uploads/${encodeURIComponent(String(u.id))}/thumb`
	    return `/api/uploads/${encodeURIComponent(String(u.id))}/file`
	  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Assets
          </a>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            {mode === 'pick' ? '← Back to Timeline' : 'Timelines'}
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
            <p style={{ margin: '4px 0 0 0', color: '#bbb' }}>{subtitle}</p>
          </div>
          {mode !== 'pick' ? (
            <a
              href={withParams(uploadHref, { return: returnTo })}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              Upload
            </a>
          ) : null}
        </div>

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}
        {deleteError ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{deleteError}</div> : null}

	        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
	          {items.map((u) => {
	            const name = (u.modified_filename || u.original_filename || `Upload ${u.id}`).trim()
	            const originalName = (u.original_filename || '').trim()
	            const date = formatDate(u.created_at)
	            const size = formatBytes(u.size_bytes)
	            const dur = showDuration ? formatDuration(u.duration_seconds) : ''
	            const dims = u.width && u.height ? `${u.width}px × ${u.height}px` : ''
	            const meta = [date, size, dur].filter(Boolean).join(kind === 'logo' ? ' * ' : ' · ')
	            const isDeleting = !!deleting[u.id]
	            const desc = (u.description || '').trim()
	            const thumbSrc = thumbOrFile(u)
	            const isImageLike = kind === 'logo' || kind === 'image'
	            return (
	              <div
	                key={u.id}
	                style={{
	                  border: '1px solid rgba(255,255,255,0.14)',
	                  background: 'rgba(255,255,255,0.04)',
	                  borderRadius: 16,
	                  overflow: 'hidden',
	                }}
	              >
	                <div style={{ padding: 12, display: 'grid', gap: 8 }}>
	                  <button
	                    type="button"
	                    onClick={() => {
	                      setDescTitle(name)
	                      setDescBody(desc || 'No description')
	                      setDescOpen(true)
	                    }}
                    style={{
                      padding: 0,
                      margin: 0,
                      border: 'none',
                      background: 'transparent',
                      color: '#d4af37',
                      fontWeight: 900,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
	                  >
	                    {name}
	                  </button>
	                  {isImageLike ? (
	                    <div style={{ display: 'grid', gap: 4 }}>
	                      {originalName ? <div style={{ color: '#9a9a9a', fontSize: 13 }}>File Name: {originalName}</div> : null}
	                      {date ? <div style={{ color: '#9a9a9a', fontSize: 13 }}>Date: {date}</div> : null}
	                      {dims ? <div style={{ color: '#9a9a9a', fontSize: 13 }}>Size: {dims}</div> : null}
	                    </div>
	                  ) : meta ? (
	                    <div style={{ color: '#9a9a9a', fontSize: 13 }}>{meta}</div>
	                  ) : null}

	                  <button
	                    type="button"
	                    onClick={() => setImagePreview({ title: name, src: thumbSrc })}
	                    style={{
	                      padding: 0,
	                      margin: 0,
	                      border: 'none',
	                      background: 'transparent',
	                      cursor: 'pointer',
	                      width: kind === 'logo' || kind === 'image' ? 120 : '100%',
	                      maxWidth: kind === 'logo' || kind === 'image' ? 140 : undefined,
	                      alignSelf: kind === 'logo' || kind === 'image' ? 'flex-start' : undefined,
	                    }}
	                  >
	                    <div
	                      style={{
	                        position: 'relative',
	                        aspectRatio: kind === 'video' ? '16 / 9' : '1 / 1',
	                        background: '#0b0b0b',
	                        borderRadius: 12,
	                        overflow: 'hidden',
	                      }}
	                    >
	                      <img
	                        src={thumbSrc}
	                        alt=""
	                        style={{ width: '100%', height: '100%', objectFit: kind === 'logo' ? 'contain' : 'cover', display: 'block' }}
	                      />
	                    </div>
	                  </button>

	                  {mode !== 'pick' ? (
	                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
	                      <button
	                        type="button"
                        disabled={!allowDelete || isDeleting}
                        onClick={async () => {
                          if (!allowDelete) return
                          if (isDeleting) return
                          const ok = window.confirm('Delete this asset? This cannot be undone.')
                          if (!ok) return
                          setDeleteError(null)
                          setDeleting((prev) => ({ ...prev, [u.id]: true }))
                          try {
                            const headers: Record<string, string> = {}
                            const csrf = getCsrfToken()
                            if (csrf) headers['x-csrf-token'] = csrf
                            const res = await fetch(`/api/uploads/${u.id}`, { method: 'DELETE', credentials: 'same-origin', headers })
                            const data = await res.json().catch(() => ({}))
                            if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to delete')
                            setItems((prev) => prev.filter((x) => x.id !== u.id))
                          } catch (e: any) {
                            setDeleteError(e?.message || 'Failed to delete')
                          } finally {
                            setDeleting((prev) => {
                              const next = { ...prev }
                              delete next[u.id]
                              return next
                            })
                          }
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '1px solid rgba(255,155,155,0.40)',
                          background: allowDelete ? 'rgba(128,0,0,1)' : 'rgba(255,255,255,0.06)',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: allowDelete && !isDeleting ? 'pointer' : 'default',
                          opacity: allowDelete ? (isDeleting ? 0.7 : 1) : 0.5,
                        }}
                      >
                        {isDeleting ? 'Deleting…' : 'Delete'}
                      </button>

                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          onClick={() => setEditUpload(u)}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 12,
                            border: '1px solid rgba(10,132,255,0.55)',
                            background: '#0c0c0c',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 6 }}>
                      <button
                        type="button"
                        onClick={() => {
                          if (typeof onPick === 'function') onPick(u)
                          else window.alert('Pick mode is not wired for this asset type yet.')
                        }}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: '#0a84ff',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        Select
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
	          {!loading && !items.length ? <div style={{ color: '#bbb' }}>No items yet.</div> : null}
	        </div>

        {descOpen ? (
          <YellowModal
            title={descTitle}
            body={descBody}
            onClose={() => {
              setDescOpen(false)
              setDescTitle('')
              setDescBody('')
            }}
          />
        ) : null}

	        {editUpload ? (
	          <EditUploadModal
	            upload={editUpload}
	            onClose={() => setEditUpload(null)}
	            onSaved={({ name, description }) => {
	              setItems((prev) => prev.map((x) => (x.id === editUpload.id ? { ...x, modified_filename: name, description } : x)))
	            }}
	          />
	        ) : null}

	        {imagePreview ? (
	          <div
	            role="dialog"
	            aria-modal="true"
	            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 24000 }}
	            onClick={() => setImagePreview(null)}
	          >
	            <div
	              style={{
	                position: 'fixed',
	                left: '50%',
	                top: '50%',
	                transform: 'translate(-50%, -50%)',
	                width: 'min(92vw, 720px)',
	                maxHeight: '82vh',
	                background: '#0b0b0b',
	                border: '1px solid rgba(255,255,255,0.18)',
	                borderRadius: 16,
	                padding: 12,
	                boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
	              }}
	              onClick={(e) => e.stopPropagation()}
	            >
	              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
	                <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{imagePreview.title}</div>
	                <button
	                  type="button"
	                  onClick={() => setImagePreview(null)}
	                  style={{
	                    width: 34,
	                    height: 34,
	                    borderRadius: 10,
	                    border: '1px solid rgba(255,255,255,0.18)',
	                    background: 'rgba(0,0,0,0.35)',
	                    color: '#fff',
	                    fontWeight: 900,
	                    cursor: 'pointer',
	                  }}
	                >
	                  ✕
	                </button>
	              </div>
	              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
	                <img
	                  src={imagePreview.src}
	                  alt=""
	                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block', borderRadius: 12, background: '#000' }}
	                />
	              </div>
	            </div>
	          </div>
	        ) : null}
	      </div>
	    </div>
	  )
}

type VideoAssetsResponse = {
  recent?: UploadListItem[]
  items?: UploadListItem[]
}

function normalizeVideoSort(raw: string): string {
  const s = String(raw || '').trim()
  const allowed = new Set([
    'newest',
    'oldest',
    'name_asc',
    'name_desc',
    'duration_asc',
    'duration_desc',
    'size_asc',
    'size_desc',
    'recent',
  ])
  return allowed.has(s) ? s : 'newest'
}

function normalizeGraphicSort(raw: string): string {
  const s = String(raw || '').trim()
  const allowed = new Set(['newest', 'oldest', 'name_asc', 'name_desc', 'size_asc', 'size_desc', 'recent'])
  return allowed.has(s) ? s : 'newest'
}

const VideoAssetsListPage: React.FC<{
  title: string
  subtitle: string
  uploadHref: string
  pickType?: 'video' | 'videoOverlay'
}> = ({ title, subtitle, uploadHref, pickType }) => {
  const mode = useMemo(() => parseMode(), [])
  const [me, setMe] = React.useState<MeResponse | null>(null)
  const [items, setItems] = React.useState<UploadListItem[]>([])
  const [clipItems, setClipItems] = React.useState<LibraryClipItem[]>([])
  const [recent, setRecent] = React.useState<UploadListItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [sort, setSort] = React.useState<string>('newest')
  const [favoritesOnly, setFavoritesOnly] = React.useState(false)
  const [clipScope, setClipScope] = React.useState<'uploads' | 'system' | 'mine' | 'shared'>('uploads')
  const [togglingFav, setTogglingFav] = React.useState<Record<number, boolean>>({})
  const [editUpload, setEditUpload] = React.useState<UploadListItem | null>(null)
  const [videoPreview, setVideoPreview] = React.useState<{ title: string; src: string } | null>(null)

  const returnTo = useMemo(() => window.location.pathname + window.location.search, [])
  const allowClips = mode === 'pick' && (pickType === 'video' || pickType === 'videoOverlay')
  const isClipMode = allowClips && clipScope !== 'uploads'

  React.useEffect(() => {
    if (!allowClips) setClipScope('uploads')
  }, [allowClips])

  React.useEffect(() => {
    if (isClipMode && favoritesOnly) setFavoritesOnly(false)
  }, [isClipMode, favoritesOnly])

  const backHref = useMemo(() => {
    const base = '/assets'
    if (mode !== 'pick') return base
    try {
      const qs = new URLSearchParams(window.location.search)
      const ret = qs.get('return')
      return ret ? String(ret) : base
    } catch {
      return base
    }
  }, [mode])

  const load = React.useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        setMe(user)
        if (!user?.userId) throw new Error('not_authenticated')
        const qTrim = q.trim()
        if (isClipMode) {
          const params = new URLSearchParams()
          if (qTrim) params.set('q', qTrim)
          params.set('scope', clipScope)
          params.set('limit', '200')
          const res = await fetch(`/api/library/clips?${params.toString()}`, {
            credentials: 'same-origin',
            signal: opts?.signal,
          })
          const json: any = await res.json().catch(() => null)
          if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
          setClipItems(Array.isArray(json?.items) ? json.items : [])
          setItems([])
          setRecent([])
        } else {
          const params = new URLSearchParams()
          if (qTrim) params.set('q', qTrim)
          params.set('sort', normalizeVideoSort(sort))
          if (favoritesOnly) params.set('favorites_only', '1')
          if (!qTrim && !favoritesOnly && normalizeVideoSort(sort) === 'newest') params.set('include_recent', '1')
          params.set('limit', '200')
          const res = await fetch(`/api/assets/videos?${params.toString()}`, {
            credentials: 'same-origin',
            signal: opts?.signal,
          })
          const json: VideoAssetsResponse | any = await res.json().catch(() => null)
          if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
          setItems(Array.isArray(json?.items) ? json.items : [])
          setRecent(Array.isArray(json?.recent) ? json.recent : [])
          setClipItems([])
        }
      } catch (e: any) {
        if (String(e?.name || '') === 'AbortError') return
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    },
    [favoritesOnly, q, sort, isClipMode, clipScope]
  )

  const sortedUploadItems = React.useMemo(() => {
    const next = items.slice()
    const key = normalizeVideoSort(sort)
    if (key === 'recent') {
      return next.sort((a, b) => {
        const at = a.last_used_at ? Date.parse(String(a.last_used_at)) : 0
        const bt = b.last_used_at ? Date.parse(String(b.last_used_at)) : 0
        return bt - at || Number(b.id) - Number(a.id)
      })
    }
    if (key === 'oldest') return next.sort((a, b) => Number(a.id) - Number(b.id))
    if (key === 'name_asc') {
      return next.sort((a, b) =>
        String(a.modified_filename || a.original_filename || '').localeCompare(
          String(b.modified_filename || b.original_filename || '')
        ) || Number(b.id) - Number(a.id)
      )
    }
    if (key === 'name_desc') {
      return next.sort((a, b) =>
        String(b.modified_filename || b.original_filename || '').localeCompare(
          String(a.modified_filename || a.original_filename || '')
        ) || Number(b.id) - Number(a.id)
      )
    }
    if (key === 'duration_asc') {
      return next.sort((a, b) => Number(a.duration_seconds || 0) - Number(b.duration_seconds || 0) || Number(b.id) - Number(a.id))
    }
    if (key === 'duration_desc') {
      return next.sort((a, b) => Number(b.duration_seconds || 0) - Number(a.duration_seconds || 0) || Number(b.id) - Number(a.id))
    }
    if (key === 'size_asc') {
      return next.sort((a, b) => Number(a.size_bytes || 0) - Number(b.size_bytes || 0) || Number(b.id) - Number(a.id))
    }
    if (key === 'size_desc') {
      return next.sort((a, b) => Number(b.size_bytes || 0) - Number(a.size_bytes || 0) || Number(b.id) - Number(a.id))
    }
    return next.sort((a, b) => Number(b.id) - Number(a.id))
  }, [items, sort])

  const sortedClipItems = React.useMemo(() => {
    const next = clipItems.slice()
    const key = normalizeVideoSort(sort)
    const clipName = (c: LibraryClipItem) =>
      String(c.title || c.modified_filename || c.original_filename || '')
    if (key === 'oldest') return next.sort((a, b) => Number(a.id) - Number(b.id))
    if (key === 'name_asc') return next.sort((a, b) => clipName(a).localeCompare(clipName(b)) || Number(b.id) - Number(a.id))
    if (key === 'name_desc') return next.sort((a, b) => clipName(b).localeCompare(clipName(a)) || Number(b.id) - Number(a.id))
    if (key === 'duration_asc') {
      return next.sort((a, b) => (Number(a.end_seconds) - Number(a.start_seconds)) - (Number(b.end_seconds) - Number(b.start_seconds)) || Number(b.id) - Number(a.id))
    }
    if (key === 'duration_desc') {
      return next.sort((a, b) => (Number(b.end_seconds) - Number(b.start_seconds)) - (Number(a.end_seconds) - Number(a.start_seconds)) || Number(b.id) - Number(a.id))
    }
    return next.sort((a, b) => Number(b.id) - Number(a.id))
  }, [clipItems, sort])

  React.useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => void load({ signal: ctrl.signal }), 200)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [load])

  const onPick = React.useCallback(
    (u: UploadListItem) => {
      const href = buildReturnHref({ cvPickType: pickType || 'video', cvPickUploadId: String(u.id) })
      if (href) window.location.href = href
    },
    [pickType]
  )

  const toggleFavorite = React.useCallback(
    async (u: UploadListItem) => {
      if (!u?.id) return
      if (togglingFav[u.id]) return
      setTogglingFav((prev) => ({ ...prev, [u.id]: true }))
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const nextFav = !Boolean(u.is_favorite)
        const res = await fetch(`/api/assets/videos/${u.id}/favorite`, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ favorite: nextFav }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed')
        setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_favorite: nextFav } : x)))
        setRecent((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_favorite: nextFav } : x)))
      } catch (e: any) {
        window.alert(e?.message || 'Failed to favorite')
      } finally {
        setTogglingFav((prev) => {
          const next = { ...prev }
          delete next[u.id]
          return next
        })
      }
    },
    [togglingFav]
  )

  const renderCard = (u: UploadListItem) => {
    const name = (u.modified_filename || u.original_filename || `Upload ${u.id}`).trim()
    const date = formatDate(u.created_at)
    const size = formatBytes(u.size_bytes)
    const dur = formatDuration(u.duration_seconds ?? null)
    const meta = [date, size, dur].filter(Boolean).join(' · ')
    const thumbSrc = `/api/uploads/${encodeURIComponent(String(u.id))}/thumb`
    const isPortrait = u.width != null && u.height != null && Number(u.width) > 0 && Number(u.height) > 0 ? Number(u.height) > Number(u.width) : false
    const previewAspect = isPortrait ? '9 / 16' : '16 / 9'
    const previewFit = isPortrait ? 'contain' : 'cover'
    const fav = Boolean(u.is_favorite)
    const isPick = mode === 'pick'
    return (
      <div
        key={u.id}
        style={{
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(28,28,28,0.96)',
          borderRadius: 16,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18, wordBreak: 'break-word' }}>{name}</div>
            <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>{meta}</div>
          </div>
          <button
            type="button"
            onClick={() => void toggleFavorite(u)}
            disabled={!!togglingFav[u.id]}
            title={fav ? 'Unfavorite' : 'Favorite'}
            style={{
              flex: '0 0 auto',
              width: 40,
              height: 40,
              borderRadius: 12,
              border: '1px solid rgba(10,132,255,0.35)',
              background: '#0c0c0c',
              color: fav ? '#ffd35a' : '#bbb',
              fontSize: 18,
              fontWeight: 900,
              cursor: togglingFav[u.id] ? 'default' : 'pointer',
              opacity: togglingFav[u.id] ? 0.7 : 1,
            }}
          >
            {fav ? '★' : '☆'}
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => {
              setVideoPreview({
                title: name,
                src: `/api/uploads/${encodeURIComponent(String(u.id))}/edit-proxy#t=0.1`,
              })
            }}
            style={{
              position: 'relative',
              aspectRatio: previewAspect,
              background: '#0b0b0b',
              borderRadius: 12,
              overflow: 'hidden',
              width: '100%',
              border: 'none',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
            }}
          >
            <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: previewFit, display: 'block' }} />
          </button>
        </div>

        {isPick ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button
              type="button"
              onClick={() => onPick(u)}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Select
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <button
              type="button"
              onClick={async () => {
                const ok = window.confirm('Delete this asset? This cannot be undone.')
                if (!ok) return
                try {
                  const headers: Record<string, string> = {}
                  const csrf = getCsrfToken()
                  if (csrf) headers['x-csrf-token'] = csrf
                  const res = await fetch(`/api/uploads/${u.id}`, { method: 'DELETE', credentials: 'same-origin', headers })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to delete')
                  setItems((prev) => prev.filter((x) => x.id !== u.id))
                  setRecent((prev) => prev.filter((x) => x.id !== u.id))
                } catch (e: any) {
                  window.alert(e?.message || 'Failed to delete')
                }
              }}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,155,155,0.40)',
                background: 'rgba(128,0,0,1)',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setEditUpload(u)}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0c0c0c',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>
    )
  }

  const renderClipCard = (c: LibraryClipItem) => {
    const baseName = (c.modified_filename || c.original_filename || `Video ${c.upload_id}`).toString()
    const name = (c.title || baseName).trim()
    const clipDur = Number(c.end_seconds) - Number(c.start_seconds)
    const meta = [
      c.source_org ? String(c.source_org).toUpperCase() : null,
      formatDuration(clipDur),
      baseName && c.title ? baseName : null,
    ]
      .filter(Boolean)
      .join(' · ')
    const isPortrait = c.width != null && c.height != null && Number(c.width) > 0 && Number(c.height) > 0 ? Number(c.height) > Number(c.width) : false
    const previewAspect = isPortrait ? '9 / 16' : '16 / 9'
    const previewFit = isPortrait ? 'contain' : 'cover'
    const start = Number(c.start_seconds || 0)
    const previewSrc = `/api/uploads/${encodeURIComponent(String(c.upload_id))}/edit-proxy#t=${(start + 0.1).toFixed(1)}`
    const isPick = mode === 'pick'
    return (
      <div
        key={`clip-${c.id}`}
        style={{
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(28,28,28,0.96)',
          borderRadius: 16,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18, wordBreak: 'break-word' }}>{name}</div>
            {meta ? <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>{meta}</div> : null}
          </div>
          {isPick ? (
            <button
              type="button"
              onClick={() => {
                const pick = pickType === 'videoOverlay' ? 'videoOverlayClip' : 'clip'
                const href = buildReturnHref({ cvPickType: pick, cvPickClipId: String(c.id) })
                if (href) window.location.href = href
              }}
              style={{
                flex: '0 0 auto',
                padding: '8px 12px',
                borderRadius: 10,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              Select
            </button>
          ) : null}
        </div>
        <div
          style={{
            marginTop: 12,
            width: '100%',
            aspectRatio: previewAspect,
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.18)',
            background: '#000',
            overflow: 'hidden',
            cursor: 'pointer',
          }}
          onClick={() => setVideoPreview({ title: name, src: previewSrc })}
        >
          <video
            preload="metadata"
            playsInline
            src={previewSrc}
            style={{ width: '100%', height: '100%', objectFit: previewFit, display: 'block' }}
          />
        </div>
        {c.description ? <div style={{ marginTop: 8, color: '#a8a8a8', fontSize: 13 }}>{c.description}</div> : null}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Assets
          </a>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            {mode === 'pick' ? '← Back to Timeline' : 'Timelines'}
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
            <p style={{ margin: '4px 0 0 0', color: '#bbb' }}>{subtitle}</p>
          </div>
          {mode !== 'pick' ? (
            <a
              href={withParams(uploadHref, { return: returnTo })}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              Upload
            </a>
          ) : null}
        </div>

        {allowClips ? (
          <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { key: 'uploads', label: 'Uploads' },
              { key: 'system', label: 'System Clips' },
              { key: 'mine', label: 'My Clips' },
              { key: 'shared', label: 'Other Users' },
            ].map((opt) => {
              const active = clipScope === opt.key
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setClipScope(opt.key as any)}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 999,
                    border: active ? '1px solid rgba(10,132,255,0.6)' : '1px solid rgba(255,255,255,0.18)',
                    background: active ? 'rgba(10,132,255,0.2)' : '#0c0c0c',
                    color: '#fff',
                    fontWeight: 800,
                    cursor: 'pointer',
                  }}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        ) : null}

        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input
            value={q}
            onChange={(e) => setQ(String((e.target as any).value || ''))}
            placeholder="Search name or description…"
            style={{
              flex: '1 1 220px',
              minWidth: 200,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#0c0c0c',
              color: '#fff',
              outline: 'none',
            }}
          />

          <select
            value={sort}
            onChange={(e) => setSort(normalizeVideoSort(String((e.target as any).value || 'newest')))}
            style={{
              flex: '0 0 auto',
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#0c0c0c',
              color: '#fff',
              outline: 'none',
              fontWeight: 900,
            }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name_asc">Name A→Z</option>
            <option value="name_desc">Name Z→A</option>
            <option value="duration_asc">Duration (short→long)</option>
            <option value="duration_desc">Duration (long→short)</option>
            <option value="size_asc">Size (small→large)</option>
            <option value="size_desc">Size (large→small)</option>
            <option value="recent">Recent</option>
          </select>

          {!isClipMode ? (
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#bbb', fontWeight: 900 }}>
              <input
                type="checkbox"
                checked={favoritesOnly}
                onChange={(e) => setFavoritesOnly(Boolean((e.target as any).checked))}
              />
              Favorites
            </label>
          ) : null}
        </div>

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}

        {!isClipMode && !q.trim() && !favoritesOnly && recent.length ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 900, color: '#ffd35a', marginBottom: 8 }}>Recent</div>
            <div style={{ display: 'grid', gap: 14 }}>{recent.map(renderCard)}</div>
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
          {isClipMode ? sortedClipItems.map(renderClipCard) : sortedUploadItems.map(renderCard)}
        </div>

        {editUpload ? (
          <EditUploadModal
            upload={editUpload}
            onClose={() => setEditUpload(null)}
            onSaved={({ name, description }) => {
              setItems((prev) => prev.map((x) => (x.id === editUpload.id ? { ...x, modified_filename: name, description } : x)))
              setRecent((prev) => prev.map((x) => (x.id === editUpload.id ? { ...x, modified_filename: name, description } : x)))
            }}
          />
        ) : null}

        {videoPreview ? (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 24000 }}
            onClick={() => setVideoPreview(null)}
          >
            <div
              style={{
                position: 'fixed',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(92vw, 900px)',
                maxHeight: '82vh',
                background: '#0b0b0b',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 16,
                padding: 12,
                boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{videoPreview.title}</div>
                <button
                  type="button"
                  onClick={() => setVideoPreview(null)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <video
                  controls
                  playsInline
                  preload="metadata"
                  src={videoPreview.src}
                  style={{
                    width: '100%',
                    maxHeight: '72vh',
                    background: '#000',
                    borderRadius: 12,
                    objectFit: 'contain',
                    display: 'block',
                  }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const GraphicAssetsListPage: React.FC<{
  title: string
  subtitle: string
  uploadHref: string
  pickType?: 'graphic' | 'timelineBackground'
}> = ({ title, subtitle, uploadHref, pickType }) => {
  const mode = useMemo(() => parseMode(), [])
  const [me, setMe] = React.useState<MeResponse | null>(null)
  const [items, setItems] = React.useState<UploadListItem[]>([])
  const [recent, setRecent] = React.useState<UploadListItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [q, setQ] = React.useState('')
  const [sort, setSort] = React.useState<string>('newest')
  const [favoritesOnly, setFavoritesOnly] = React.useState(false)
  const [togglingFav, setTogglingFav] = React.useState<Record<number, boolean>>({})
  const [editUpload, setEditUpload] = React.useState<UploadListItem | null>(null)
  const [imagePreview, setImagePreview] = React.useState<{ title: string; src: string } | null>(null)

  const returnTo = useMemo(() => window.location.pathname + window.location.search, [])

  const backHref = useMemo(() => {
    const base = '/assets'
    if (mode !== 'pick') return base
    try {
      const qs = new URLSearchParams(window.location.search)
      const ret = qs.get('return')
      return ret ? String(ret) : base
    } catch {
      return base
    }
  }, [mode])

  const load = React.useCallback(
    async (opts?: { signal?: AbortSignal }) => {
      setLoading(true)
      setError(null)
      try {
        const user = await ensureLoggedIn()
        setMe(user)
        if (!user?.userId) throw new Error('not_authenticated')
        const params = new URLSearchParams()
        const qTrim = q.trim()
        if (qTrim) params.set('q', qTrim)
        params.set('sort', normalizeGraphicSort(sort))
        if (favoritesOnly) params.set('favorites_only', '1')
        if (!qTrim && !favoritesOnly && normalizeGraphicSort(sort) === 'newest') params.set('include_recent', '1')
        params.set('limit', '200')
        const res = await fetch(`/api/assets/graphics?${params.toString()}`, {
          credentials: 'same-origin',
          signal: opts?.signal,
        })
        const json: VideoAssetsResponse | any = await res.json().catch(() => null)
        if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_load'))
        setItems(Array.isArray(json?.items) ? json.items : [])
        setRecent(Array.isArray(json?.recent) ? json.recent : [])
      } catch (e: any) {
        if (String(e?.name || '') === 'AbortError') return
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    },
    [favoritesOnly, q, sort]
  )

  React.useEffect(() => {
    const ctrl = new AbortController()
    const t = setTimeout(() => void load({ signal: ctrl.signal }), 200)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [load])

  const sortedItems = React.useMemo(() => {
    const next = items.slice()
    const key = normalizeGraphicSort(sort)
    if (key === 'recent') {
      return next.sort((a, b) => {
        const at = a.last_used_at ? Date.parse(String(a.last_used_at)) : 0
        const bt = b.last_used_at ? Date.parse(String(b.last_used_at)) : 0
        return bt - at || Number(b.id) - Number(a.id)
      })
    }
    if (key === 'oldest') return next.sort((a, b) => Number(a.id) - Number(b.id))
    if (key === 'name_asc') {
      return next.sort((a, b) =>
        String(a.modified_filename || a.original_filename || '').localeCompare(
          String(b.modified_filename || b.original_filename || '')
        ) || Number(b.id) - Number(a.id)
      )
    }
    if (key === 'name_desc') {
      return next.sort((a, b) =>
        String(b.modified_filename || b.original_filename || '').localeCompare(
          String(a.modified_filename || a.original_filename || '')
        ) || Number(b.id) - Number(a.id)
      )
    }
    if (key === 'size_asc') {
      return next.sort((a, b) => Number(a.size_bytes || 0) - Number(b.size_bytes || 0) || Number(b.id) - Number(a.id))
    }
    if (key === 'size_desc') {
      return next.sort((a, b) => Number(b.size_bytes || 0) - Number(a.size_bytes || 0) || Number(b.id) - Number(a.id))
    }
    return next.sort((a, b) => Number(b.id) - Number(a.id))
  }, [items, sort])

  const onPick = React.useCallback(
    (u: UploadListItem) => {
      const href = buildReturnHref({ cvPickType: pickType || 'graphic', cvPickUploadId: String(u.id) })
      if (href) window.location.href = href
    },
    [pickType]
  )

  const toggleFavorite = React.useCallback(
    async (u: UploadListItem) => {
      if (!u?.id) return
      if (togglingFav[u.id]) return
      setTogglingFav((prev) => ({ ...prev, [u.id]: true }))
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const nextFav = !Boolean(u.is_favorite)
        const res = await fetch(`/api/assets/graphics/${u.id}/favorite`, {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({ favorite: nextFav }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed')
        setItems((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_favorite: nextFav } : x)))
        setRecent((prev) => prev.map((x) => (x.id === u.id ? { ...x, is_favorite: nextFav } : x)))
      } catch (e: any) {
        window.alert(e?.message || 'Failed to favorite')
      } finally {
        setTogglingFav((prev) => {
          const next = { ...prev }
          delete next[u.id]
          return next
        })
      }
    },
    [togglingFav]
  )

  const renderCard = (u: UploadListItem) => {
    const name = (u.modified_filename || u.original_filename || `Upload ${u.id}`).trim()
    const originalName = (u.original_filename || '').trim()
    const date = formatDate(u.created_at)
    const size = formatBytes(u.size_bytes)
    const dims = u.width && u.height ? `${u.width}px × ${u.height}px` : ''
    const meta = [date, size, dims].filter(Boolean).join(' · ')
    const fileLine = originalName ? `File: ${originalName}` : ''
    const thumbSrc = `/api/uploads/${encodeURIComponent(String(u.id))}/file`
    const fav = Boolean(u.is_favorite)
    const isPick = mode === 'pick'
    return (
      <div
        key={u.id}
        style={{
          border: '1px solid rgba(255,255,255,0.14)',
          background: 'rgba(28,28,28,0.96)',
          borderRadius: 16,
          padding: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <div style={{ fontWeight: 900, fontSize: 18, wordBreak: 'break-word' }}>{name}</div>
            {fileLine ? <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>{fileLine}</div> : null}
            <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>{meta}</div>
          </div>
          <button
            type="button"
            onClick={() => void toggleFavorite(u)}
            disabled={!!togglingFav[u.id]}
            title={fav ? 'Unfavorite' : 'Favorite'}
            style={{
              flex: '0 0 auto',
              width: 40,
              height: 40,
              borderRadius: 12,
              border: '1px solid rgba(10,132,255,0.35)',
              background: '#0c0c0c',
              color: fav ? '#ffd35a' : '#bbb',
              fontSize: 18,
              fontWeight: 900,
              cursor: togglingFav[u.id] ? 'default' : 'pointer',
              opacity: togglingFav[u.id] ? 0.7 : 1,
            }}
          >
            {fav ? '★' : '☆'}
          </button>
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setImagePreview({ title: name, src: thumbSrc })}
            style={{
              padding: 0,
              margin: 0,
              border: 'none',
              background: 'transparent',
              cursor: 'pointer',
              width: 120,
              maxWidth: 140,
              alignSelf: 'flex-start',
            }}
          >
            <div
              style={{
                position: 'relative',
                aspectRatio: '1 / 1',
                background: '#0b0b0b',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              <img src={thumbSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            </div>
          </button>
        </div>

        {isPick ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
            <button
              type="button"
              onClick={() => onPick(u)}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Select
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 10 }}>
            <button
              type="button"
              onClick={async () => {
                const ok = window.confirm('Delete this asset? This cannot be undone.')
                if (!ok) return
                try {
                  const headers: Record<string, string> = {}
                  const csrf = getCsrfToken()
                  if (csrf) headers['x-csrf-token'] = csrf
                  const res = await fetch(`/api/uploads/${u.id}`, { method: 'DELETE', credentials: 'same-origin', headers })
                  const data = await res.json().catch(() => ({}))
                  if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to delete')
                  setItems((prev) => prev.filter((x) => x.id !== u.id))
                  setRecent((prev) => prev.filter((x) => x.id !== u.id))
                } catch (e: any) {
                  window.alert(e?.message || 'Failed to delete')
                }
              }}
              style={{
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,155,155,0.40)',
                background: 'rgba(128,0,0,1)',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
            <button
              type="button"
              onClick={() => setEditUpload(u)}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0c0c0c',
                color: '#fff',
                fontWeight: 900,
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Assets
          </a>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            {mode === 'pick' ? '← Back to Timeline' : 'Timelines'}
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>{title}</h1>
            <p style={{ margin: '4px 0 0 0', color: '#bbb' }}>{subtitle}</p>
          </div>
          {mode !== 'pick' ? (
            <a
              href={withParams(uploadHref, { return: returnTo })}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              Upload
            </a>
          ) : null}
        </div>

        <div style={{ marginTop: 14, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input
            value={q}
            onChange={(e) => setQ(String((e.target as any).value || ''))}
            placeholder="Search name or description…"
            style={{
              flex: '1 1 220px',
              minWidth: 200,
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#0c0c0c',
              color: '#fff',
              outline: 'none',
            }}
          />

          <select
            value={sort}
            onChange={(e) => setSort(normalizeGraphicSort(String((e.target as any).value || 'newest')))}
            style={{
              flex: '0 0 auto',
              padding: '10px 12px',
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.14)',
              background: '#0c0c0c',
              color: '#fff',
              outline: 'none',
              fontWeight: 900,
            }}
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="name_asc">Name A→Z</option>
            <option value="name_desc">Name Z→A</option>
            <option value="size_asc">Size (small→large)</option>
            <option value="size_desc">Size (large→small)</option>
            <option value="recent">Recent</option>
          </select>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: '#bbb', fontWeight: 900 }}>
            <input
              type="checkbox"
              checked={favoritesOnly}
              onChange={(e) => setFavoritesOnly(Boolean((e.target as any).checked))}
            />
            Favorites
          </label>
        </div>

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}

        {!q.trim() && !favoritesOnly && recent.length ? (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 900, color: '#ffd35a', marginBottom: 8 }}>Recent</div>
            <div style={{ display: 'grid', gap: 14 }}>{recent.map(renderCard)}</div>
          </div>
        ) : null}

        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>{sortedItems.map(renderCard)}</div>

        {editUpload ? (
          <EditUploadModal
            upload={editUpload}
            onClose={() => setEditUpload(null)}
            onSaved={({ name, description }) => {
              setItems((prev) => prev.map((x) => (x.id === editUpload.id ? { ...x, modified_filename: name, description } : x)))
              setRecent((prev) => prev.map((x) => (x.id === editUpload.id ? { ...x, modified_filename: name, description } : x)))
            }}
          />
        ) : null}

        {imagePreview ? (
          <div
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 24000 }}
            onClick={() => setImagePreview(null)}
          >
            <div
              style={{
                position: 'fixed',
                left: '50%',
                top: '50%',
                transform: 'translate(-50%, -50%)',
                width: 'min(92vw, 720px)',
                maxHeight: '82vh',
                background: '#0b0b0b',
                border: '1px solid rgba(255,255,255,0.18)',
                borderRadius: 16,
                padding: 12,
                boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <div style={{ fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{imagePreview.title}</div>
                <button
                  type="button"
                  onClick={() => setImagePreview(null)}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  ✕
                </button>
              </div>
              <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                <img
                  src={imagePreview.src}
                  alt=""
                  style={{ maxWidth: '100%', maxHeight: '70vh', objectFit: 'contain', display: 'block', borderRadius: 12, background: '#000' }}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

async function probeAudioDurationSeconds(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const audio = document.createElement('audio')
      audio.preload = 'metadata'
      const url = URL.createObjectURL(file)
      const cleanup = () => {
        try {
          audio.src = ''
        } catch {}
        try {
          URL.revokeObjectURL(url)
        } catch {}
      }
      audio.onloadedmetadata = () => {
        const d = Number(audio.duration)
        cleanup()
        if (!Number.isFinite(d) || d <= 0) resolve(null)
        else resolve(d)
      }
      audio.onerror = () => {
        cleanup()
        resolve(null)
      }
      audio.src = url
    } catch {
      resolve(null)
    }
  })
}

async function uploadAudioViaCreateVideoSign(
  endpoint: '/api/create-video/narration/sign' | '/api/create-video/audio/sign',
  file: File,
  opts: { name?: string; description?: string }
): Promise<{ uploadId: number; durationSeconds: number | null }> {
  const durationSeconds = await probeAudioDurationSeconds(file)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const csrf = getCsrfToken()
  if (csrf) headers['x-csrf-token'] = csrf
  const signRes = await fetch(endpoint, {
    method: 'POST',
    credentials: 'same-origin',
    headers,
    body: JSON.stringify({
      name: opts?.name || null,
      description: opts?.description || null,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      sizeBytes: file.size,
      durationSeconds: durationSeconds != null ? Math.round(durationSeconds) : null,
    }),
  })
  const signJson: any = await signRes.json().catch(() => null)
  if (!signRes.ok) throw new Error(String(signJson?.detail || signJson?.error || 'failed_to_sign'))
  const uploadId = Number(signJson?.id || 0)
  const post = signJson?.post
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new Error('failed_to_sign')
  if (!post || typeof post !== 'object' || !post.url) throw new Error('failed_to_sign')

  const formData = new FormData()
  for (const [k, v] of Object.entries(post.fields || {})) formData.append(k, String(v))
  formData.append('file', file)
  const upRes = await fetch(String(post.url), { method: 'POST', body: formData })
  if (!upRes.ok) throw new Error(`s3_upload_failed_${String(upRes.status)}`)

  const completeHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
  const csrf2 = getCsrfToken()
  if (csrf2) completeHeaders['x-csrf-token'] = csrf2
  const completeRes = await fetch('/api/mark-complete', {
    method: 'POST',
    credentials: 'same-origin',
    headers: completeHeaders,
    body: JSON.stringify({ id: uploadId, sizeBytes: file.size }),
  })
  if (!completeRes.ok) {
    const j: any = await completeRes.json().catch(() => null)
    throw new Error(String(j?.detail || j?.error || 'failed_to_mark'))
  }
  return { uploadId, durationSeconds: durationSeconds != null && Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : null }
}

const AudioUploadForm: React.FC<{
  title: string
  onCancelHref: string
  onUploadedHref: string
  endpoint: '/api/create-video/narration/sign' | '/api/create-video/audio/sign'
}> = ({ title, onCancelHref, onUploadedHref, endpoint }) => {
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')
  const [file, setFile] = React.useState<File | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href={onCancelHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Back
          </a>
        </div>

        <h1 style={{ margin: '12px 0 8px', fontSize: 28 }}>{title}</h1>
        <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.4 }}>Name and describe the audio, then upload a file from your device.</div>

        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}

        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontWeight: 800 }}>Name</div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={512}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.14)',
                background: '#0c0c0c',
                color: '#fff',
                fontSize: 16,
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontWeight: 800 }}>Description</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={2000}
              style={{
                width: '100%',
                minHeight: 120,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.14)',
                background: '#0c0c0c',
                color: '#fff',
                resize: 'vertical',
                fontSize: 16,
              }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontWeight: 800 }}>File</div>
            <input
              type="file"
              accept="audio/*,video/mp4"
              onChange={(e) => setFile(e.target.files && e.target.files[0] ? e.target.files[0] : null)}
              style={{ color: '#fff' }}
            />
          </label>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 6 }}>
            <a
              href={onCancelHref}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(255,255,255,0.16)',
                background: '#0c0c0c',
                color: '#fff',
                fontWeight: 900,
                textDecoration: 'none',
              }}
            >
              Cancel
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                if (busy) return
                const nm = name.trim()
                if (!nm) {
                  setError('Name is required.')
                  return
                }
                if (!file) {
                  setError('Choose a file first.')
                  return
                }
                setBusy(true)
                setError(null)
                try {
                  await uploadAudioViaCreateVideoSign(endpoint, file, { name: nm, description: description.trim() })
                  window.location.href = onUploadedHref
                } catch (e: any) {
                  setError(String(e?.message || 'failed_to_upload'))
                } finally {
                  setBusy(false)
                }
              }}
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                cursor: busy ? 'default' : 'pointer',
                opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? 'Uploading…' : 'Upload'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const PickListShell: React.FC<{ title: string; subtitle?: string; backHref: string; children: React.ReactNode }> = ({
  title,
  subtitle,
  backHref,
  children,
}) => {
  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Back
          </a>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            Assets
          </a>
        </div>
        <h1 style={{ margin: '12px 0 6px', fontSize: 28 }}>{title}</h1>
        {subtitle ? <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.4 }}>{subtitle}</div> : null}
        <div style={{ marginTop: 14 }}>{children}</div>
      </div>
    </div>
  )
}

const LogoConfigPickPage: React.FC = () => {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const logoUploadId = Number(getQueryParam('logoUploadId') || 0)
  const passthrough = useMemo(() => getPickPassthrough(), [])

  const backHref = useMemo(() => withParams('/assets/logo', passthrough), [passthrough])

  React.useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchJson('/api/logo-configs')
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setItems(raw)
      } catch (e: any) {
        setError(String(e?.message || 'Failed to load'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [])

  return (
    <PickListShell title="Select Logo Config" subtitle="Pick a config to apply to the selected logo." backHref={backHref}>
      {loading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
      {error ? <div style={{ color: '#ff9b9b' }}>{error}</div> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((c: any) => {
          const id = Number(c?.id || 0)
          if (!Number.isFinite(id) || id <= 0) return null
          const name = String(c?.name || `Config ${id}`)
          const desc = String(c?.description || '').trim()
          return (
            <div
              key={`logo-cfg-${id}`}
              style={{
                padding: 12,
                borderRadius: 12,
                border: '1px solid rgba(255,214,10,0.55)',
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 900 }}>{name}</div>
              {desc ? <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.35 }}>{desc}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!Number.isFinite(logoUploadId) || logoUploadId <= 0) return
                    const href = buildReturnHref({
                      cvPickType: 'logo',
                      cvPickUploadId: String(logoUploadId),
                      cvPickConfigId: String(id),
                    })
                    if (href) window.location.href = href
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  Select
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </PickListShell>
  )
}

const LowerThirdConfigPickPage: React.FC = () => {
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const uploadId = Number(getQueryParam('lowerThirdUploadId') || 0)
  const passthrough = useMemo(() => getPickPassthrough(), [])
  const backHref = useMemo(() => withParams('/assets/lower-third', passthrough), [passthrough])

  React.useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchJson('/api/lower-third-configs?limit=200')
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setItems(raw)
      } catch (e: any) {
        setError(String(e?.message || 'Failed to load'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [])

  return (
    <PickListShell title="Select Lower Third Config" subtitle="Pick a config to apply to the selected lower third." backHref={backHref}>
      {loading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
      {error ? <div style={{ color: '#ff9b9b' }}>{error}</div> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((c: any) => {
          const id = Number(c?.id || 0)
          if (!Number.isFinite(id) || id <= 0) return null
          const name = String(c?.name || `Config ${id}`)
          const desc = String(c?.description || '').trim()
          return (
            <div
              key={`lt-cfg-${id}`}
              style={{
                padding: 12,
                borderRadius: 12,
                border: '1px solid rgba(255,214,10,0.55)',
                background: 'rgba(0,0,0,0.35)',
                color: '#fff',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 900 }}>{name}</div>
              {desc ? <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.35 }}>{desc}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    if (!Number.isFinite(uploadId) || uploadId <= 0) return
                    const href = buildReturnHref({
                      cvPickType: 'lowerThird',
                      cvPickUploadId: String(uploadId),
                      cvPickConfigId: String(id),
                    })
                    if (href) window.location.href = href
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  Select
                </button>
              </div>
            </div>
          )
        })}
      </div>
    </PickListShell>
  )
}

const NarrationAssetsPage: React.FC = () => {
  const mode = useMemo(() => parseMode(), [])
  const passthrough = useMemo(() => getPickPassthrough(), [])
  const isNew = mode !== 'pick' && (getQueryParam('new') === '1' || getQueryParam('new') === 'true')

  const backHref = useMemo(() => {
    if (mode !== 'pick') return '/assets'
    const ret = getQueryParam('return')
    return ret ? String(ret) : '/assets'
  }, [mode])

  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [descModal, setDescModal] = React.useState<{ title: string; description: string } | null>(null)
  const [edit, setEdit] = React.useState<{ id: number; name: string; description: string } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<number | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetchJson('/api/create-video/narration/list')
      const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
      setItems(raw)
    } catch (e: any) {
      setError(String(e?.message || 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    if (isNew) return
    void load()
  }, [isNew, load])

  if (isNew) {
    return <AudioUploadForm title="Upload Narration" onCancelHref="/assets/narration" onUploadedHref="/assets/narration" endpoint="/api/create-video/narration/sign" />
  }

  const editSave = async () => {
    if (!edit) return
    const id = Number(edit.id || 0)
    const name = String(edit.name || '').trim()
    const description = String(edit.description || '').trim()
    if (!name) {
      setSaveError('Name is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/narration/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ name, description: description.length ? description : null }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_update'))
      setItems((prev) =>
        prev.map((it: any) => (Number(it?.id || 0) === id ? { ...(it || {}), modified_filename: name, description: description.length ? description : null } : it))
      )
      setEdit(null)
    } catch (e: any) {
      setSaveError(String(e?.message || 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const deleteOne = async (id: number) => {
    setDeleting(id)
    setDeleteError(null)
    try {
      const headers: any = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/narration/${id}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_delete'))
      setItems((prev) => prev.filter((it: any) => Number(it?.id || 0) !== id))
    } catch (e: any) {
      setDeleteError(String(e?.message || 'Failed to delete'))
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Assets
          </a>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            {mode === 'pick' ? '← Back to Timeline' : 'Timelines'}
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Narration</h1>
            <p style={{ margin: '4px 0 0 0', color: '#bbb' }}>Voice clips for narration track.</p>
          </div>
          {mode !== 'pick' ? (
            <a
              href="/assets/narration?new=1"
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                textDecoration: 'none',
              }}
            >
              New Audio
            </a>
          ) : null}
        </div>

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}
        {deleteError ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{deleteError}</div> : null}

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          {items.map((it: any) => {
            const id = Number(it?.id || 0)
            if (!Number.isFinite(id) || id <= 0) return null
            const name = String(it?.modified_filename || it?.original_filename || `Narration ${id}`).trim() || `Narration ${id}`
            const date = formatDate(it?.uploaded_at || it?.created_at || null)
            const size = formatBytes(it?.size_bytes == null ? null : Number(it.size_bytes))
            const dur = formatDuration(it?.duration_seconds)
            const meta = [date, size, dur].filter(Boolean).join(' · ')
            const description = String(it?.description || '').trim()
            return (
              <div
                key={`nar-${id}`}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: '1px solid rgba(191,90,242,0.55)',
                  background: 'rgba(0,0,0,0.35)',
                  color: '#fff',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => setDescModal({ title: name, description })}
                    style={{
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      color: '#ffd60a',
                      fontWeight: 900,
                      cursor: 'pointer',
                      textAlign: 'left',
                      maxWidth: '100%',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                    title={name}
                  >
                    {name}
                  </button>
                </div>

                {meta ? <div style={{ color: '#bbb', fontSize: 12 }}>{meta}</div> : null}
                <audio controls preload="none" style={{ width: '100%' }} src={`/api/uploads/${id}/file`} />

                {mode === 'pick' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const href = buildReturnHref({ cvPickType: 'narration', cvPickUploadId: String(id) })
                        if (href) window.location.href = href
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(10,132,255,0.55)',
                        background: '#0a84ff',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Select
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
                    <button
                      type="button"
                      disabled={deleting === id}
                      onClick={async () => {
                        const ok = window.confirm('Delete this narration audio? This cannot be undone.')
                        if (!ok) return
                        await deleteOne(id)
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,155,155,0.40)',
                        background: 'rgba(128,0,0,1)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: deleting === id ? 'default' : 'pointer',
                        opacity: deleting === id ? 0.7 : 1,
                      }}
                    >
                      {deleting === id ? 'Deleting…' : 'Delete'}
                    </button>

                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={() => setEdit({ id, name, description })}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '1px solid rgba(191,90,242,0.65)',
                          background: '#0c0c0c',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
          {!loading && !items.length ? <div style={{ color: '#bbb' }}>No narration audio yet.</div> : null}
        </div>

        {descModal ? (
          <YellowModal title={descModal.title} body={descModal.description || 'No description'} onClose={() => setDescModal(null)} />
        ) : null}

        {edit ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (saving) return
              setEdit(null)
              setSaveError(null)
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 22000,
              background: 'rgba(0,0,0,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(720px, 100%)',
                borderRadius: 16,
                background: '#0b0b0b',
                border: '1px solid rgba(255,255,255,0.14)',
                padding: 16,
                color: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Edit narration</div>
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  disabled={saving}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0c0c0c',
                    color: '#fff',
                    fontWeight: 800,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  ✕
                </button>
              </div>

              {saveError ? <div style={{ color: '#ff9b9b', marginBottom: 10 }}>{saveError}</div> : null}
              <div style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 800 }}>Name</div>
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                      fontSize: 16,
                    }}
                    maxLength={512}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 800 }}>Description</div>
                  <textarea
                    value={edit.description}
                    onChange={(e) => setEdit((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                      resize: 'vertical',
                      fontSize: 16,
                    }}
                    maxLength={2000}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={editSave}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

const ScreenTitleStylesAssetsPage: React.FC = () => {
  const mode = useMemo(() => parseMode(), [])
  const passthrough = useMemo(() => getPickPassthrough(), [])
  const returnHref = useMemo(() => getQueryParam('return'), [])
  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [deletingId, setDeletingId] = React.useState<number | null>(null)
  const [cloningId, setCloningId] = React.useState<number | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const backHref = useMemo(() => {
    if (mode !== 'pick') return '/assets'
    const ret = getQueryParam('return')
    return ret ? String(ret) : '/assets'
  }, [mode])

  React.useEffect(() => {
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchJson('/api/screen-title-presets?limit=200')
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setItems(raw)
      } catch (e: any) {
        setError(String(e?.message || 'Failed to load'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [])

  if (mode !== 'pick') {
    const makeHref = (base: string): string => {
      const extras: Record<string, string> = {}
      if (returnHref) extras.return = String(returnHref)
      return Object.keys(extras).length ? withParams(base, extras) : base
    }
    return (
      <PickListShell
        title="Screen Title Styles"
        subtitle="Manage reusable screen title styles."
        backHref={returnHref ? String(returnHref) : '/assets'}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.35 }}>Create and edit reusable Screen Title styles.</div>
          <a
            href={makeHref('/assets/screen-titles/new')}
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              border: '1px solid rgba(10,132,255,0.55)',
              background: '#0a84ff',
              color: '#fff',
              fontWeight: 900,
              textDecoration: 'none',
              display: 'inline-flex',
            }}
          >
            New Style
          </a>
        </div>

        {deleteError ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{deleteError}</div> : null}
        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}

        <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
          {items.map((it) => {
            const id = Number(it?.id || 0)
            const name = String(it?.name || `Style ${id}`).trim()
            const desc = String(it?.description || '').trim()
            const isDeleting = deletingId === id
            return (
              <div
                key={`st-style-${id}`}
                style={{
                  borderRadius: 16,
                  border: '1px solid rgba(255,214,10,0.55)',
                  background: 'rgba(28,28,28,0.96)',
                  padding: 12,
                  display: 'grid',
                  gap: 8,
                }}
              >
                <div style={{ fontWeight: 900 }}>{name}</div>
                {desc ? <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.35 }}>{desc}</div> : null}

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', marginTop: 6 }}>
                  <button
                    type="button"
                    disabled={isDeleting}
                    onClick={async () => {
                      const ok = window.confirm('Delete this style? This cannot be undone.')
                      if (!ok) return
                      setDeleteError(null)
                      setDeletingId(id)
                      try {
                        const headers: Record<string, string> = {}
                        const csrf = getCsrfToken()
                        if (csrf) headers['x-csrf-token'] = csrf
                        const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(id))}`, {
                          method: 'DELETE',
                          credentials: 'same-origin',
                          headers,
                        })
                        const j: any = await res.json().catch(() => ({}))
                        if (!res.ok) throw new Error(String(j?.detail || j?.error || 'Failed to delete'))
                        setItems((prev) => prev.filter((x) => Number((x as any)?.id || 0) !== id))
                      } catch (e: any) {
                        setDeleteError(e?.message || 'Failed to delete')
                      } finally {
                        setDeletingId(null)
                      }
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,155,155,0.40)',
                      background: 'rgba(128,0,0,1)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: isDeleting ? 'default' : 'pointer',
                      opacity: isDeleting ? 0.7 : 1,
                    }}
                  >
                    {isDeleting ? 'Deleting…' : 'Delete'}
                  </button>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      disabled={cloningId === id}
                      onClick={async () => {
                        setDeleteError(null)
                        setCloningId(id)
                        try {
                          const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                          const csrf = getCsrfToken()
                          if (csrf) headers['x-csrf-token'] = csrf
                          const cloneName = `${name} (copy)`
                          const body = JSON.stringify({
                            name: cloneName,
                            description: it?.description ?? null,
                            style: it?.style === 'outline' ? 'none' : it?.style,
                            fontKey: it?.fontKey,
                            sizeKey: it?.sizeKey || 'medium',
                            fontSizePct: it?.fontSizePct,
                            trackingPct: it?.trackingPct ?? 0,
                            lineSpacingPct: Number.isFinite(Number(it?.lineSpacingPct)) ? Number(it?.lineSpacingPct) : 0,
                            fontColor: it?.fontColor,
                            shadowColor: it?.shadowColor || '#000000',
                            shadowOffsetPx: Number.isFinite(Number(it?.shadowOffsetPx)) ? Number(it?.shadowOffsetPx) : 2,
                            shadowBlurPx: Number.isFinite(Number(it?.shadowBlurPx)) ? Number(it?.shadowBlurPx) : 0,
                            shadowOpacityPct: Number.isFinite(Number(it?.shadowOpacityPct)) ? Number(it?.shadowOpacityPct) : 65,
                            fontGradientKey: it?.fontGradientKey ?? null,
                            outlineWidthPct: it?.outlineWidthPct ?? null,
                            outlineOpacityPct: it?.outlineOpacityPct ?? null,
                            outlineColor: it?.outlineColor ?? null,
                            marginLeftPct: it?.marginLeftPct ?? null,
                            marginRightPct: it?.marginRightPct ?? null,
                            marginTopPct: it?.marginTopPct ?? null,
                            marginBottomPct: it?.marginBottomPct ?? null,
                            pillBgColor: it?.pillBgColor,
                            pillBgOpacityPct: it?.pillBgOpacityPct,
                            alignment: it?.alignment ?? 'center',
                            position: it?.position,
                            maxWidthPct: it?.maxWidthPct,
                            insetXPreset: it?.insetXPreset ?? null,
                            insetYPreset: it?.insetYPreset ?? null,
                            timingRule: it?.timingRule,
                            timingSeconds: it?.timingSeconds ?? null,
                            fade: it?.fade,
                          })
                          const res = await fetch('/api/screen-title-presets', { method: 'POST', credentials: 'same-origin', headers, body })
                          const data = await res.json().catch(() => ({}))
                          if (!res.ok) throw new Error(String(data?.detail || data?.error || 'Failed to clone'))
                          const newId = Number(data?.preset?.id || data?.id || 0)
                          if (!newId) throw new Error('Clone did not return an id')
                          window.location.href = makeHref(`/assets/screen-titles/${encodeURIComponent(String(newId))}/edit`)
                        } catch (e: any) {
                          setDeleteError(e?.message || 'Failed to clone')
                        } finally {
                          setCloningId(null)
                        }
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(10,132,255,0.55)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: cloningId === id ? 'default' : 'pointer',
                        opacity: cloningId === id ? 0.7 : 1,
                      }}
                    >
                      {cloningId === id ? 'Cloning…' : 'Clone'}
                    </button>

                    <a
                      href={makeHref(`/assets/screen-titles/${encodeURIComponent(String(id))}/edit`)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(10,132,255,0.55)',
                        background: '#0c0c0c',
                        color: '#fff',
                        fontWeight: 900,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      Edit
                    </a>
                  </div>
                </div>
              </div>
            )
          })}
          {!loading && !items.length ? <div style={{ color: '#bbb' }}>No styles yet.</div> : null}
        </div>
      </PickListShell>
    )
  }

  return (
    <PickListShell title="Select Screen Title Style" subtitle="Pick a style to add to your timeline." backHref={backHref}>
      {loading ? <div style={{ color: '#bbb' }}>Loading…</div> : null}
      {error ? <div style={{ color: '#ff9b9b' }}>{error}</div> : null}
      <div style={{ display: 'grid', gap: 12 }}>
        {items.map((p: any) => {
          const id = Number(p?.id || 0)
          if (!Number.isFinite(id) || id <= 0) return null
          const name = String(p?.name || `Style ${id}`)
          const desc = String(p?.description || '').trim()
          return (
            <div
              key={`st-style-${id}`}
              style={{
                padding: 12,
                borderRadius: 14,
                border: '1px solid rgba(255,214,10,0.55)',
                background: 'rgba(28,28,28,0.96)',
                color: '#fff',
                display: 'grid',
                gap: 8,
              }}
            >
              <div style={{ fontWeight: 900 }}>{name}</div>
              {desc ? <div style={{ color: '#bbb', fontSize: 13, lineHeight: 1.35 }}>{desc}</div> : null}
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={() => {
                    const href = buildReturnHref({ cvPickType: 'screenTitle', cvPickPresetId: String(id) })
                    if (href) window.location.href = href
                  }}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 12,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: 'pointer',
                  }}
                >
                  Select
                </button>
              </div>
            </div>
          )
        })}
        {!loading && !items.length ? <div style={{ color: '#bbb' }}>No styles yet.</div> : null}
      </div>
    </PickListShell>
  )
}

const GoldAudioPreviewPlayer: React.FC<{
  playerKey: string
  src: string
  activePlayerKey: string | null
  setActivePlayerKey: (k: string | null) => void
  activeAudioRef: React.MutableRefObject<HTMLAudioElement | null>
}> = ({ playerKey, src, activePlayerKey, setActivePlayerKey, activeAudioRef }) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null)
  const [duration, setDuration] = React.useState(0)
  const [currentTime, setCurrentTime] = React.useState(0)
  const isPlaying = activePlayerKey === playerKey

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const onLoaded = () => {
      const d = Number.isFinite(audio.duration) ? Number(audio.duration) : 0
      setDuration(d > 0 ? d : 0)
    }

    const onTime = () => setCurrentTime(audio.currentTime || 0)

    const onPause = () => {
      setCurrentTime(audio.currentTime || 0)
      if (activePlayerKey === playerKey) {
        activeAudioRef.current = null
        setActivePlayerKey(null)
      }
    }

    const onEnded = () => {
      if (activePlayerKey === playerKey) {
        activeAudioRef.current = null
        setActivePlayerKey(null)
      }
    }

    audio.addEventListener('loadedmetadata', onLoaded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    return () => {
      audio.removeEventListener('loadedmetadata', onLoaded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
    }
  }, [activeAudioRef, activePlayerKey, playerKey, setActivePlayerKey])

  React.useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (activePlayerKey !== playerKey && !audio.paused) {
      audio.pause()
    }
  }, [activePlayerKey, playerKey])

  const togglePlay = async () => {
    const audio = audioRef.current
    if (!audio) return

    if (isPlaying) {
      audio.pause()
      activeAudioRef.current = null
      setActivePlayerKey(null)
      return
    }

    if (activeAudioRef.current && activeAudioRef.current !== audio) {
      try {
        activeAudioRef.current.pause()
      } catch {}
    }

    activeAudioRef.current = audio
    setActivePlayerKey(playerKey)
    try {
      await audio.play()
    } catch {
      activeAudioRef.current = null
      setActivePlayerKey(null)
    }
  }

  const max = duration > 0 ? duration : 0
  const safeTime = Math.max(0, Math.min(currentTime || 0, max || 0))
  const pct = max > 0 ? Math.round((safeTime / max) * 10000) / 100 : 0

  const fmtTime = (seconds: number): string => {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00'
    const s = Math.floor(seconds)
    const m = Math.floor(s / 60)
    const r = s % 60
    return `${m}:${String(r).padStart(2, '0')}`
  }

  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <audio ref={audioRef} preload="metadata" src={src} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button
          type="button"
          onClick={togglePlay}
          aria-label={isPlaying ? 'Pause audio preview' : 'Play audio preview'}
          style={{
            width: 44,
            height: 44,
            borderRadius: 999,
            border: 'none',
            background: '#0c0c0c',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            padding: 0,
          }}
        >
          {isPlaying ? (
            <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true">
              <rect x="4" y="3" width="4" height="12" fill="#ffd60a" rx="1" />
              <rect x="10" y="3" width="4" height="12" fill="#ffd60a" rx="1" />
            </svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden="true">
              <path d="M6 4 L14 9 L6 14 Z" fill="#ffd60a" />
            </svg>
          )}
        </button>
        <div style={{ flex: 1, display: 'grid', gap: 6 }}>
          <input
            type="range"
            min={0}
            max={max || 0}
            step={0.01}
            value={safeTime}
            onInput={(e) => {
              const audio = audioRef.current
              if (!audio) return
              const v = Number((e.target as HTMLInputElement).value || 0)
              audio.currentTime = Number.isFinite(v) ? v : 0
              setCurrentTime(audio.currentTime || 0)
            }}
            disabled={!max}
            aria-label="Audio preview position"
            style={{
              width: '100%',
              height: 10,
              borderRadius: 999,
              background: `linear-gradient(90deg, rgba(255,214,10,0.95) 0%, rgba(255,214,10,0.95) ${pct}%, rgba(255,255,255,0.18) ${pct}%, rgba(255,255,255,0.18) 100%)`,
              accentColor: '#ffd60a',
            }}
          />
          <div style={{ textAlign: 'center', fontSize: 12, color: '#ffd60a', fontWeight: 800 }}>
            {fmtTime(safeTime)} / {fmtTime(max)}
          </div>
        </div>
      </div>
    </div>
  )
}

const AudioMusicAssetsPage: React.FC = () => {
  const mode = useMemo(() => parseMode(), [])
  const passthrough = useMemo(() => getPickPassthrough(), [])
  const scopeRaw = (getQueryParam('scope') || '').trim().toLowerCase()
  const scope: 'system' | 'search' | 'my' = scopeRaw === 'my' ? 'my' : scopeRaw === 'search' ? 'search' : 'system'
  const isNew = mode !== 'pick' && scope === 'my' && (getQueryParam('new') === '1' || getQueryParam('new') === 'true')

  const backHref = useMemo(() => {
    if (mode !== 'pick') return '/assets'
    const ret = getQueryParam('return')
    return ret ? String(ret) : '/assets'
  }, [mode])

  const [items, setItems] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [tags, setTags] = React.useState<any | null>(null)
  const [expandedAxis, setExpandedAxis] = React.useState<Record<string, boolean>>({})
  const [selectedTagIds, setSelectedTagIds] = React.useState<{ genre: number[]; mood: number[]; theme: number[]; instrument: number[] }>({
    genre: [],
    mood: [],
    theme: [],
    instrument: [],
  })
  const [descModal, setDescModal] = React.useState<{ title: string; description: string } | null>(null)
  const [edit, setEdit] = React.useState<{ id: number; name: string; description: string } | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [saveError, setSaveError] = React.useState<string | null>(null)
  const [deleting, setDeleting] = React.useState<number | null>(null)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [activePreviewKey, setActivePreviewKey] = React.useState<string | null>(null)
  const activePreviewAudioRef = React.useRef<HTMLAudioElement | null>(null)

  React.useEffect(() => {
    return () => {
      try {
        activePreviewAudioRef.current?.pause()
      } catch {}
      activePreviewAudioRef.current = null
    }
  }, [])

  React.useEffect(() => {
    if (scope !== 'search') return
    const run = async () => {
      try {
        const res = await fetchJson('/api/audio-tags')
        setTags(res)
      } catch {}
    }
    void run()
  }, [scope])

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (scope === 'system') {
        const res = await fetchJson('/api/system-audio?limit=200')
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setItems(raw)
      } else if (scope === 'my') {
        const res = await fetchJson('/api/create-video/audio/list')
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setItems(raw)
      } else {
        const qs = new URLSearchParams({ limit: '200' })
        if (selectedTagIds.genre.length) qs.set('genreTagIds', selectedTagIds.genre.join(','))
        if (selectedTagIds.mood.length) qs.set('moodTagIds', selectedTagIds.mood.join(','))
        if (selectedTagIds.theme.length) qs.set('themeTagIds', selectedTagIds.theme.join(','))
        if (selectedTagIds.instrument.length) qs.set('instrumentTagIds', selectedTagIds.instrument.join(','))
        const res = await fetchJson(`/api/system-audio/search?${qs.toString()}`)
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        setItems(raw)
      }
    } catch (e: any) {
      setError(String(e?.message || 'Failed to load'))
    } finally {
      setLoading(false)
    }
  }, [scope, selectedTagIds.genre, selectedTagIds.instrument, selectedTagIds.mood, selectedTagIds.theme])

  React.useEffect(() => {
    if (isNew) return
    if (scope === 'search') {
      const t = window.setTimeout(() => {
        void load()
      }, 250)
      return () => window.clearTimeout(t)
    }
    void load()
  }, [isNew, load, scope])

  if (isNew) {
    return (
      <AudioUploadForm
        title="Upload Audio"
        onCancelHref="/assets/audio?scope=my"
        onUploadedHref="/assets/audio?scope=my"
        endpoint="/api/create-video/audio/sign"
      />
    )
  }

  const setScopeHref = (nextScope: 'system' | 'search' | 'my'): string => {
    const u = new URL('/assets/audio', window.location.origin)
    u.searchParams.set('scope', nextScope)
    const pt = getPickPassthrough()
    for (const [k, v] of Object.entries(pt)) u.searchParams.set(k, v)
    return u.pathname + u.search
  }

  const canShowSearch = true

  const selectTrack = (uploadId: number) => {
    if (!Number.isFinite(uploadId) || uploadId <= 0) return
    if (mode === 'pick') {
      const href = buildReturnHref({ cvPickType: 'audio', cvPickUploadId: String(uploadId) })
      if (href) window.location.href = href
    }
  }

  const editSave = async () => {
    if (!edit) return
    const id = Number(edit.id || 0)
    const name = String(edit.name || '').trim()
    const description = String(edit.description || '').trim()
    if (!name) {
      setSaveError('Name is required.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const headers: any = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/audio/${id}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify({ name, description: description.length ? description : null }),
      })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_update'))
      setItems((prev) =>
        prev.map((it: any) => (Number(it?.id || 0) === id ? { ...(it || {}), modified_filename: name, description: description.length ? description : null } : it))
      )
      setEdit(null)
    } catch (e: any) {
      setSaveError(String(e?.message || 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  const deleteOne = async (id: number) => {
    setDeleting(id)
    setDeleteError(null)
    try {
      const headers: any = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/create-video/audio/${id}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const json: any = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'failed_to_delete'))
      setItems((prev) => prev.filter((it: any) => Number(it?.id || 0) !== id))
    } catch (e: any) {
      setDeleteError(String(e?.message || 'Failed to delete'))
    } finally {
      setDeleting(null)
    }
  }

  const Axis: React.FC<{ label: string; kind: 'genre' | 'mood' | 'theme' | 'instrument'; items: any[] }> = ({ label, kind, items }) => {
    const open = Boolean(expandedAxis[kind])
    const selected = new Set<number>(selectedTagIds[kind])
    return (
      <div style={{ border: '1px solid rgba(255,255,255,0.14)', borderRadius: 12, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
        <button
          type="button"
          onClick={() => setExpandedAxis((prev) => ({ ...prev, [kind]: !prev[kind] }))}
          style={{
            width: '100%',
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            padding: '10px 12px',
            border: 'none',
            background: 'transparent',
            color: '#d4af37',
            fontWeight: 900,
            cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>{label}</span>
          <span style={{ color: '#bbb', fontWeight: 800 }}>{open ? '−' : '+'}</span>
        </button>
        {open ? (
          <div style={{ padding: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {items.map((t: any) => {
              const id = Number(t?.id || 0)
              if (!Number.isFinite(id) || id <= 0) return null
              const name = String(t?.name || '').trim()
              const on = selected.has(id)
              return (
                <button
                  key={`${kind}-${id}`}
                  type="button"
                  onClick={() => {
                    setSelectedTagIds((prev) => {
                      const curr = new Set<number>(prev[kind])
                      if (curr.has(id)) curr.delete(id)
                      else curr.add(id)
                      return { ...prev, [kind]: Array.from(curr).sort((a, b) => a - b) }
                    })
                  }}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: on ? 'rgba(10,132,255,0.35)' : 'rgba(0,0,0,0.35)',
                    color: '#fff',
                    cursor: 'pointer',
                    fontWeight: 800,
                    fontSize: 13,
                  }}
                >
                  {name}
                </button>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Assets
          </a>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            {mode === 'pick' ? '← Back to Timeline' : 'Timelines'}
          </a>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Audio/Music</h1>
            <p style={{ margin: '4px 0 0 0', color: '#bbb' }}>System tracks + your uploads.</p>
          </div>
          {mode !== 'pick' && scope === 'my' ? (
            <a
              href="/assets/audio?scope=my&new=1"
              style={{
                padding: '10px 14px',
                borderRadius: 12,
                border: '1px solid rgba(10,132,255,0.55)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 900,
                textDecoration: 'none',
              }}
            >
              New Audio
            </a>
          ) : null}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
          <a
            href={setScopeHref('system')}
            style={{
              padding: '8px 10px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: scope === 'system' ? 'rgba(10,132,255,0.35)' : 'rgba(0,0,0,0.35)',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 900,
            }}
          >
            System
          </a>
          {canShowSearch ? (
            <a
              href={setScopeHref('search')}
              style={{
                padding: '8px 10px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.18)',
                background: scope === 'search' ? 'rgba(10,132,255,0.35)' : 'rgba(0,0,0,0.35)',
                color: '#fff',
                textDecoration: 'none',
                fontWeight: 900,
              }}
            >
              Search
            </a>
          ) : null}
          <a
            href={setScopeHref('my')}
            style={{
              padding: '8px 10px',
              borderRadius: 999,
              border: '1px solid rgba(255,255,255,0.18)',
              background: scope === 'my' ? 'rgba(10,132,255,0.35)' : 'rgba(0,0,0,0.35)',
              color: '#fff',
              textDecoration: 'none',
              fontWeight: 900,
            }}
          >
            My Audio
          </a>
        </div>

        {scope === 'search' ? (
          <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
            <Axis label="Genres" kind="genre" items={Array.isArray(tags?.genres) ? tags.genres : []} />
            <Axis label="Moods" kind="mood" items={Array.isArray(tags?.moods) ? tags.moods : []} />
            <Axis label="Video Themes" kind="theme" items={Array.isArray(tags?.themes) ? tags.themes : []} />
            <Axis label="Instruments" kind="instrument" items={Array.isArray(tags?.instruments) ? tags.instruments : []} />
          </div>
        ) : null}

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}
        {deleteError ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{deleteError}</div> : null}

        <div style={{ display: 'grid', gap: 12, marginTop: 14 }}>
          {items.map((it: any) => {
            const id = Number(it?.id || 0)
            if (!Number.isFinite(id) || id <= 0) return null
            const name = String(it?.modified_filename || it?.original_filename || `Audio ${id}`).trim() || `Audio ${id}`
            const date = formatDate(it?.uploaded_at || it?.created_at || null)
            const size = formatBytes(it?.size_bytes == null ? null : Number(it.size_bytes))
            const dur = formatDuration(it?.duration_seconds)
            const meta = [date, size, dur].filter(Boolean).join(' · ')
            const description = String(it?.description || '').trim()
            const isSystem = scope !== 'my'
            const border = isSystem ? '1px solid rgba(255,214,10,0.55)' : '1px solid rgba(255,255,255,0.14)'
            return (
              <div
                key={`aud-${scope}-${id}`}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border,
                  background: 'rgba(0,0,0,0.35)',
                  color: '#fff',
                  display: 'grid',
                  gap: 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => setDescModal({ title: name, description })}
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'transparent',
                    color: '#ffd60a',
                    fontWeight: 900,
                    cursor: 'pointer',
                    textAlign: 'left',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={name}
                >
                  {name}
                </button>
                {meta ? <div style={{ color: '#bbb', fontSize: 12 }}>{meta}</div> : null}
                <GoldAudioPreviewPlayer
                  playerKey={`aud-${scope}-${id}`}
                  src={`/api/uploads/${id}/file`}
                  activePlayerKey={activePreviewKey}
                  setActivePlayerKey={setActivePreviewKey}
                  activeAudioRef={activePreviewAudioRef}
                />

                {mode === 'pick' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => selectTrack(id)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(10,132,255,0.55)',
                        background: '#0a84ff',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: 'pointer',
                      }}
                    >
                      Select
                    </button>
                  </div>
                ) : scope === 'my' ? (
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <button
                      type="button"
                      disabled={deleting === id}
                      onClick={async () => {
                        const ok = window.confirm('Delete this audio? This cannot be undone.')
                        if (!ok) return
                        await deleteOne(id)
                      }}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 12,
                        border: '1px solid rgba(255,155,155,0.40)',
                        background: 'rgba(128,0,0,1)',
                        color: '#fff',
                        fontWeight: 900,
                        cursor: deleting === id ? 'default' : 'pointer',
                        opacity: deleting === id ? 0.7 : 1,
                      }}
                    >
                      {deleting === id ? 'Deleting…' : 'Delete'}
                    </button>
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        type="button"
                        onClick={() => setEdit({ id, name, description })}
                        style={{
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: '1px solid rgba(10,132,255,0.55)',
                          background: '#0c0c0c',
                          color: '#fff',
                          fontWeight: 900,
                          cursor: 'pointer',
                        }}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
          {!loading && !items.length ? <div style={{ color: '#bbb' }}>No tracks yet.</div> : null}
        </div>

        {descModal ? <YellowModal title={descModal.title} body={descModal.description || 'No description'} onClose={() => setDescModal(null)} /> : null}

        {edit ? (
          <div
            role="dialog"
            aria-modal="true"
            onClick={() => {
              if (saving) return
              setEdit(null)
              setSaveError(null)
            }}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 22000,
              background: 'rgba(0,0,0,0.65)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(720px, 100%)',
                borderRadius: 16,
                background: '#0b0b0b',
                border: '1px solid rgba(255,255,255,0.14)',
                padding: 16,
                color: '#fff',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 12 }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>Edit audio</div>
                <button
                  type="button"
                  onClick={() => setEdit(null)}
                  disabled={saving}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0c0c0c',
                    color: '#fff',
                    fontWeight: 800,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  ✕
                </button>
              </div>

              {saveError ? <div style={{ color: '#ff9b9b', marginBottom: 10 }}>{saveError}</div> : null}
              <div style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 800 }}>Name</div>
                  <input
                    value={edit.name}
                    onChange={(e) => setEdit((prev) => (prev ? { ...prev, name: e.target.value } : prev))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                      fontSize: 16,
                    }}
                    maxLength={512}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 800 }}>Description</div>
                  <textarea
                    value={edit.description}
                    onChange={(e) => setEdit((prev) => (prev ? { ...prev, description: e.target.value } : prev))}
                    style={{
                      width: '100%',
                      minHeight: 120,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: '#0c0c0c',
                      color: '#fff',
                      resize: 'vertical',
                      fontSize: 16,
                    }}
                    maxLength={2000}
                  />
                </label>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  disabled={saving}
                  onClick={editSave}
                  style={{
                    padding: '10px 14px',
                    borderRadius: 12,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: '#0a84ff',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export default function Assets() {
  const mode = useMemo(() => parseMode(), [])
  const pathname = useMemo(() => String(window.location.pathname || ''), [])
  const pickPassthrough = useMemo(() => getPickPassthrough(), [])
  const graphicPickType = useMemo<'graphic' | 'timelineBackground'>(() => {
    if (mode !== 'pick') return 'graphic'
    const raw = String(getQueryParam('pickType') || '').trim()
    return raw === 'timelineBackground' ? 'timelineBackground' : 'graphic'
  }, [mode])
  const route = useMemo(() => {
    const p = pathname.replace(/\/+$/, '')
    if (p === '/assets') return null
    if (!p.startsWith('/assets/')) return null
    const seg = p.slice('/assets/'.length)
    if (!seg) return null
    const parts = seg.split('/').filter(Boolean)
    if (!parts.length) return null
    return { type: parts[0], rest: parts.slice(1) }
  }, [pathname])

  if (route?.type === 'logo-config') return <LogoConfigPickPage />
  if (route?.type === 'lower-third-config') return <LowerThirdConfigPickPage />

  if (route?.type === 'narration') return <NarrationAssetsPage />
  if (route?.type === 'audio') return <AudioMusicAssetsPage />
  if (route?.type === 'screen-titles') {
    if (route.rest.length === 0) return <ScreenTitleStylesAssetsPage />
    return <ScreenTitlePresetsPage />
  }

  if (route?.type === 'video-overlay') {
    // “Video overlay” is a timeline lane concept; the underlying asset type is still a source video.
    // Manage mode should not present a separate video-overlay library.
    if (mode !== 'pick') {
      window.location.href = '/assets/video'
      return null
    }
    return (
      <VideoAssetsListPage
        title="Video Overlays"
        subtitle="Pick a source video to place on the Video Overlay lane."
        uploadHref="/uploads/new?kind=video"
        pickType="videoOverlay"
      />
    )
  }

  if (route?.type === 'video') {
    return (
      <VideoAssetsListPage title="Videos" subtitle="Raw uploaded source videos." uploadHref="/uploads/new?kind=video" pickType="video" />
    )
  }

  if (route?.type === 'graphic') {
    return (
      <GraphicAssetsListPage
        title="Graphics"
        subtitle="Graphics (overlay images) for your timeline."
        uploadHref="/uploads/new?kind=image&image_role=overlay"
        pickType={graphicPickType}
      />
    )
  }

  if (route?.type === 'logo') {
    return (
      <AssetUploadsListPage
        title="Logos"
        subtitle="Upload and manage watermark logos."
        kind="logo"
        uploadHref="/uploads/new?kind=logo"
        allowDelete
        onPick={
          mode === 'pick'
            ? (u) => {
                const href = buildReturnHref({ cvPickType: 'logo', cvPickUploadId: String(u.id) })
                if (href) window.location.href = href
              }
            : undefined
        }
      />
    )
  }

  if (route?.type === 'lower-third') {
    return (
      <AssetUploadsListPage
        title="Lower Thirds"
        subtitle="Lower third images (PNG) used on the timeline."
        kind="image"
        imageRole="lower_third"
        uploadHref="/uploads/new?kind=image&image_role=lower_third"
        allowDelete
        onPick={
          mode === 'pick'
            ? (u) => {
                const href = withParams('/assets/lower-third-config', { ...pickPassthrough, lowerThirdUploadId: String(u.id) })
                window.location.href = href
              }
            : undefined
        }
      />
    )
  }

  if (route?.type) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <a href="/assets" style={{ color: '#0a84ff', textDecoration: 'none' }}>
            ← Assets
          </a>
          <h1 style={{ margin: '12px 0 10px', fontSize: 28 }}>Coming Soon</h1>
          <p style={{ margin: 0, color: '#bbb' }}>`/assets/{route.type}` isn’t wired yet.</p>
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            <a href="/create-video" style={{ color: '#0a84ff', textDecoration: 'none' }}>
              Create Video
            </a>
            <a href="/assets/screen-titles" style={{ color: '#0a84ff', textDecoration: 'none' }}>
              Screen Title Styles
            </a>
          </div>
        </div>
      </div>
    )
  }

  const passthrough = useMemo(() => {
    try {
      const qs = new URLSearchParams(window.location.search)
      const out: Record<string, string> = {}
      const project = qs.get('project')
      const ret = qs.get('return')
      if (mode === 'pick') {
        if (project) out.project = String(project)
        if (ret) out.return = String(ret)
        out.mode = 'pick'
      }
      return out
    } catch {
      return mode === 'pick' ? { mode: 'pick' } : {}
    }
  }, [mode])

  const types: AssetType[] = useMemo(() => {
    const base: AssetType[] = [
      { key: 'logo', label: 'Logos', description: 'Watermark logos to place above everything.', href: '/assets/logo' },
      { key: 'lower_third', label: 'Lower Thirds', description: 'Lower third images and configs.', href: '/assets/lower-third' },
      { key: 'screen_title', label: 'Screen Titles', description: 'Screen title styles and presets.', href: '/assets/screen-titles' },
      { key: 'graphic', label: 'Graphics', description: 'Full-screen images for overlays and cutaways.', href: '/assets/graphic' },
      { key: 'video', label: 'Videos', description: 'Raw uploaded videos (source clips).', href: '/assets/video' },
      { key: 'narration', label: 'Narration', description: 'Voice clips for narration track.', href: '/assets/narration' },
      { key: 'audio', label: 'Audio/Music', description: 'System + user music tracks.', href: '/assets/audio' },
    ]
    if (mode === 'pick') {
      base.splice(3, 0, { key: 'video_overlay', label: 'Video Overlays', description: 'Picture-in-picture videos (source clips).', href: '/assets/video-overlay' })
    }
    return base.map((t) => ({ ...t, href: Object.keys(passthrough).length ? withParams(t.href, passthrough) : t.href }))
  }, [mode, passthrough])

  const headerRight = useMemo(() => {
    if (mode === 'pick') {
      const ret = passthrough.return
      return ret ? (
        <a href={ret} style={{ color: '#0a84ff', textDecoration: 'none' }}>
          ← Back to Timeline
        </a>
      ) : null
    }
    return (
      <a href="/timelines" style={{ color: '#0a84ff', textDecoration: 'none' }}>
        Timelines
      </a>
    )
  }, [mode, passthrough.return])

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        {mode === 'pick' ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>{headerRight}</div>
        ) : null}

        <h1 style={{ margin: '12px 0 10px', fontSize: 28 }}>{mode === 'pick' ? 'Select Assets' : 'Manage Assets'}</h1>
        <p style={{ margin: 0, color: '#bbb' }}>
          {mode === 'pick' ? 'Select an asset type to add to your timeline.' : 'Browse and manage your assets.'}
        </p>

        <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
	          {types.map((t) => (
	            <a
	              key={t.key}
	              href={t.href}
	              style={{
	                display: 'block',
	                textDecoration: 'none',
	                color: '#fff',
	                borderRadius: 16,
	                border: '1px solid rgba(212,175,55,0.55)',
	                background: 'rgba(28,28,28,0.96)',
	                padding: 14,
	              }}
	            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                <div style={{ fontSize: 18, fontWeight: 900 }}>{t.label}</div>
                <div style={{ color: '#d4af37', fontWeight: 900 }}>→</div>
              </div>
              <div style={{ marginTop: 6, color: '#bbb', lineHeight: 1.35 }}>{t.description}</div>
            </a>
          ))}
        </div>
      </div>
    </div>
  )
}
