import React, { useCallback, useEffect, useMemo, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type InsetPreset = 'small' | 'medium' | 'large'
type ScreenTitleStyle = 'pill' | 'outline' | 'strip'
type ScreenTitleFontKey = 'dejavu_sans_bold'
type ScreenTitlePosition = 'top' | 'middle' | 'bottom'
type ScreenTitleTimingRule = 'entire' | 'first_only'
type ScreenTitleFade = 'none' | 'in' | 'out' | 'in_out'

type ScreenTitlePreset = {
  id: number
  name: string
  description?: string | null
  style: ScreenTitleStyle
  fontKey: ScreenTitleFontKey
  fontSizePct: number
  trackingPct?: number
  fontColor: string
  pillBgColor: string
  pillBgOpacityPct: number
  position: ScreenTitlePosition
  maxWidthPct: number
  insetXPreset?: InsetPreset | null
  insetYPreset?: InsetPreset | null
  timingRule: ScreenTitleTimingRule
  timingSeconds: number | null
  fade: ScreenTitleFade
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

const INSET_PRESETS: Array<{ label: string; value: InsetPreset }> = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
]

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
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

function defaultDraft(): Omit<ScreenTitlePreset, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'> {
  return {
    name: 'Screen Title',
    description: null,
    style: 'pill',
    fontKey: 'dejavu_sans_bold',
    fontSizePct: 4.5,
    trackingPct: 0,
    fontColor: '#ffffff',
    pillBgColor: '#000000',
    pillBgOpacityPct: 55,
    position: 'top',
    maxWidthPct: 90,
    insetXPreset: 'medium',
    insetYPreset: 'medium',
    timingRule: 'first_only',
    timingSeconds: 10,
    fade: 'out',
  }
}

function positionLabel(p: ScreenTitlePosition): string {
  if (p === 'top') return 'Top'
  if (p === 'middle') return 'Middle'
  return 'Bottom'
}

function styleLabel(s: ScreenTitleStyle): string {
  if (s === 'pill') return 'Pill'
  if (s === 'outline') return 'Outline'
  return 'Strip'
}

function fadeLabel(f: ScreenTitleFade): string {
  if (f === 'none') return 'None'
  if (f === 'in') return 'Fade in'
  if (f === 'out') return 'Fade out'
  return 'Fade in + out'
}

function timingLabel(rule: ScreenTitleTimingRule, seconds: number | null): string {
  if (rule === 'entire') return 'Till end'
  const s = seconds != null ? `${seconds}s` : '?'
  return `First ${s}`
}

function parseFromHref(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('from') || '').trim()
    if (!raw) return null
    if (!raw.startsWith('/')) return null
    return raw
  } catch {
    return null
  }
}

export default function ScreenTitlePresetsPage() {
  const fromHref = useMemo(() => parseFromHref(), [])
  const backHref = fromHref || '/uploads'
  const backLabel = fromHref?.startsWith('/produce') ? '← Back to Produce' : '← Back'

  const [me, setMe] = useState<MeResponse | null>(null)
  const [presets, setPresets] = useState<ScreenTitlePreset[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState(defaultDraft)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const user = await ensureLoggedIn()
      if (cancelled) return
      setMe(user)
    })()
    return () => { cancelled = true }
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/screen-title-presets', { credentials: 'same-origin' })
      if (!res.ok) throw new Error('failed_to_load')
      const data = await res.json()
      const items: ScreenTitlePreset[] = Array.isArray(data) ? data : []
      setPresets(items)
      if (items.length && selectedId == null) setSelectedId(items[0].id)
    } catch (e: any) {
      setError(e?.message || 'Failed to load presets')
    } finally {
      setLoading(false)
    }
  }, [selectedId])

  useEffect(() => {
    if (!me?.userId) return
    void load()
  }, [me?.userId, load])

  const selected = useMemo(() => {
    if (selectedId == null) return null
    return presets.find((p) => p.id === selectedId) || null
  }, [presets, selectedId])

  useEffect(() => {
    if (!selected) return
    setDraft({
      name: selected.name,
      description: selected.description ?? null,
      style: selected.style,
      fontKey: selected.fontKey,
      fontSizePct: selected.fontSizePct ?? 4.5,
      trackingPct: selected.trackingPct ?? 0,
      fontColor: selected.fontColor || '#ffffff',
      pillBgColor: selected.pillBgColor || '#000000',
      pillBgOpacityPct: selected.pillBgOpacityPct ?? 55,
      position: selected.position,
      maxWidthPct: selected.maxWidthPct,
      insetXPreset: selected.insetXPreset ?? null,
      insetYPreset: selected.insetYPreset ?? null,
      timingRule: selected.timingRule,
      timingSeconds: selected.timingSeconds ?? null,
      fade: selected.fade,
    })
  }, [selected?.id])

  const save = useCallback(async () => {
    if (!me?.userId) return
    setSaving(true)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const body = JSON.stringify(draft)
      if (selectedId == null) {
        const res = await fetch('/api/screen-title-presets', { method: 'POST', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to create')
      } else {
        const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(selectedId))}`, { method: 'PATCH', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to save')
      }
      await load()
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [me?.userId, draft, selectedId, load])

  const archive = useCallback(async () => {
    if (!selectedId) return
    const ok = window.confirm('Archive this preset?')
    if (!ok) return
    setDeleting(true)
    setSaveError(null)
    try {
      const headers: Record<string, string> = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(selectedId))}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to archive')
      setSelectedId(null)
      setDraft(defaultDraft())
      await load()
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to archive')
    } finally {
      setDeleting(false)
    }
  }, [selectedId, load])

  if (me === null) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
          <h1 style={{ margin: 0, fontSize: 28 }}>Screen Title Presets</h1>
          <p style={{ color: '#bbb' }}>Please <a href="/login" style={{ color: '#0a84ff' }}>sign in</a>.</p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 80px' }}>
        <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>{backLabel}</a>
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginTop: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Screen Title Presets</h1>
            <p style={{ margin: '6px 0 0', color: '#a0a0a0' }}>Create reusable styles; set per-production title text on the Build Production page.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSelectedId(null)
              setDraft(defaultDraft())
            }}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              border: '1px solid rgba(255,255,255,0.18)',
              background: 'rgba(255,255,255,0.06)',
              color: '#fff',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            New
          </button>
        </header>

        {loading ? <div style={{ color: '#888', padding: '12px 0' }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', padding: '12px 0' }}>{error}</div> : null}
        {saveError ? <div style={{ color: '#ff9b9b', padding: '12px 0' }}>{saveError}</div> : null}

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 360px) 1fr', gap: 16, marginTop: 14 }}>
          <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, overflow: 'hidden', background: 'rgba(255,255,255,0.03)' }}>
            <div style={{ padding: 12, borderBottom: '1px solid rgba(255,255,255,0.10)', fontWeight: 800 }}>Presets</div>
            <div style={{ display: 'grid' }}>
              {presets.length === 0 ? (
                <div style={{ padding: 12, color: '#bbb' }}>No presets yet.</div>
              ) : (
                presets.map((p) => {
                  const active = p.id === selectedId
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      style={{
                        textAlign: 'left',
                        padding: 12,
                        border: 'none',
                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                        background: active ? 'rgba(10,132,255,0.18)' : 'transparent',
                        color: '#fff',
                        cursor: 'pointer',
                        display: 'grid',
                        gap: 4,
                      }}
                    >
                      <div style={{ fontWeight: 850 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: '#cfcfcf' }}>
                        {styleLabel(p.style)} • {positionLabel(p.position)} • {timingLabel(p.timingRule, p.timingSeconds)}
                      </div>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          <div style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 14, background: 'rgba(255,255,255,0.03)', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 850, fontSize: 16 }}>{selectedId ? 'Edit Preset' : 'New Preset'}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {selectedId ? (
                  <button
                    type="button"
                    onClick={archive}
                    disabled={deleting}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,155,155,0.35)',
                      background: 'rgba(255,155,155,0.08)',
                      color: '#fff',
                      fontWeight: 750,
                      cursor: deleting ? 'default' : 'pointer',
                      opacity: deleting ? 0.7 : 1,
                    }}
                  >
                    {deleting ? 'Archiving…' : 'Archive'}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(10,132,255,0.55)',
                    background: 'rgba(10,132,255,0.12)',
                    color: '#fff',
                    fontWeight: 850,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontWeight: 750 }}>Name</div>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontWeight: 750 }}>Description</div>
                <textarea
                  value={draft.description || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                    resize: 'vertical',
                  }}
                />
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Font size (% of frame height)</div>
                  <input
                    type="number"
                    step="0.1"
                    min={2}
                    max={8}
                    value={Number.isFinite(Number(draft.fontSizePct)) ? String(draft.fontSizePct) : '4.5'}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setDraft((d) => ({ ...d, fontSizePct: Number.isFinite(n) ? n : 4.5 }))
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Character spacing (%)</div>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={50}
                    value={Number.isFinite(Number(draft.trackingPct)) ? String(draft.trackingPct) : '0'}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setDraft((d) => ({ ...d, trackingPct: Number.isFinite(n) ? n : 0 }))
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Font color</div>
                  <input
                    type="color"
                    value={draft.fontColor || '#ffffff'}
                    onChange={(e) => setDraft((d) => ({ ...d, fontColor: e.target.value || '#ffffff' }))}
                    style={{
                      width: '100%',
                      height: 44,
                      padding: '6px 8px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  />
                </label>
              </div>

              {draft.style === 'pill' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontWeight: 750 }}>Pill background color</div>
                    <input
                      type="color"
                      value={draft.pillBgColor || '#000000'}
                      onChange={(e) => setDraft((d) => ({ ...d, pillBgColor: e.target.value || '#000000' }))}
                      style={{
                        width: '100%',
                        height: 44,
                        padding: '6px 8px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                      }}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontWeight: 750 }}>Pill background opacity (%)</div>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={Number.isFinite(Number(draft.pillBgOpacityPct)) ? String(draft.pillBgOpacityPct) : '55'}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        setDraft((d) => ({ ...d, pillBgOpacityPct: Number.isFinite(n) ? n : 55 }))
                      }}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                      }}
                    />
                  </label>
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Style</div>
                  <select
                    value={draft.style}
                    onChange={(e) => setDraft((d) => ({ ...d, style: e.target.value as any }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="pill">Pill</option>
                    <option value="outline">Outline</option>
                    <option value="strip">Strip</option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Position</div>
                  <select
                    value={draft.position}
                    onChange={(e) => setDraft((d) => ({ ...d, position: e.target.value as any }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="top">Top</option>
                    <option value="middle">Middle</option>
                    <option value="bottom">Bottom</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Max width (%)</div>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={draft.maxWidthPct}
                    onChange={(e) => setDraft((d) => ({ ...d, maxWidthPct: Number(e.target.value) }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Fade</div>
                  <select
                    value={draft.fade}
                    onChange={(e) => setDraft((d) => ({ ...d, fade: e.target.value as any }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="none">None</option>
                    <option value="in">Fade in</option>
                    <option value="out">Fade out</option>
                    <option value="in_out">Fade in + out</option>
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Inset X</div>
                  <select
                    value={draft.insetXPreset || ''}
                    onChange={(e) => setDraft((d) => ({ ...d, insetXPreset: (e.target.value || null) as any }))}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="">Auto</option>
                    {INSET_PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </label>

                {draft.position !== 'middle' ? (
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontWeight: 750 }}>Inset Y</div>
                    <select
                      value={draft.insetYPreset || ''}
                      onChange={(e) => setDraft((d) => ({ ...d, insetYPreset: (e.target.value || null) as any }))}
                      style={{
                        width: '100%',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                      }}
                    >
                      <option value="">Auto</option>
                      {INSET_PRESETS.map((p) => (
                        <option key={p.value} value={p.value}>{p.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Timing</div>
                  <select
                    value={draft.timingRule}
                    onChange={(e) => {
                      const rule = e.target.value as ScreenTitleTimingRule
                      setDraft((d) => ({
                        ...d,
                        timingRule: rule,
                        timingSeconds: rule === 'entire' ? null : (d.timingSeconds ?? 10),
                      }))
                    }}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="first_only">First N seconds</option>
                    <option value="entire">Till end</option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Seconds</div>
                  <select
                    value={draft.timingSeconds != null ? String(draft.timingSeconds) : ''}
                    onChange={(e) => setDraft((d) => ({ ...d, timingSeconds: Number(e.target.value) }))}
                    disabled={draft.timingRule === 'entire'}
                    style={{
                      width: '100%',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      opacity: draft.timingRule === 'entire' ? 0.6 : 1,
                    }}
                  >
                    {[5, 10, 15, 20].map((s) => (
                      <option key={s} value={String(s)}>{s}s</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ padding: 12, borderRadius: 12, border: '1px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.03)', color: '#bbb', fontSize: 13, lineHeight: 1.35 }}>
                Font: DejaVu Sans Bold (curated list; more fonts can be added later).
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
