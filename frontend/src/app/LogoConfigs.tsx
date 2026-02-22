import React, { useCallback, useEffect, useMemo, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type LogoPosition =
  | 'top_left' | 'top_center' | 'top_right'
  | 'middle_left' | 'middle_center' | 'middle_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right'
  | 'center'
type LogoTimingRule = 'entire' | 'start_after' | 'first_only' | 'last_only'
type LogoFade = 'none' | 'in' | 'out' | 'in_out'
type InsetPreset = 'small' | 'medium' | 'large'

type LogoConfig = {
  id: number
  name: string
  description?: string | null
  position: LogoPosition
  sizePctWidth: number
  opacityPct: number
  timingRule: LogoTimingRule
  timingSeconds: number | null
  fade: LogoFade
  insetXPreset?: InsetPreset | null
  insetYPreset?: InsetPreset | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

const SIZE_PRESETS: Array<{ label: string; pct: number }> = [
  { label: 'Tiny', pct: 10 },
  { label: 'Small', pct: 15 },
  { label: 'Medium', pct: 22 },
  { label: 'Large', pct: 30 },
]

const INSET_PRESETS: Array<{ label: string; value: InsetPreset }> = [
  { label: 'Small', value: 'small' },
  { label: 'Medium', value: 'medium' },
  { label: 'Large', value: 'large' },
]

function normalizeLegacyPosition(pos: LogoPosition): Exclude<LogoPosition, 'center'> {
  return (pos === 'center' ? 'middle_center' : pos) as any
}

function positionAxes(posRaw: LogoPosition): { x: 'left' | 'center' | 'right'; y: 'top' | 'middle' | 'bottom' } {
  const pos = normalizeLegacyPosition(posRaw)
  const [row, col] = String(pos).split('_') as [string, string]
  const y = row === 'top' ? 'top' : row === 'bottom' ? 'bottom' : 'middle'
  const x = col === 'left' ? 'left' : col === 'right' ? 'right' : 'center'
  return { x, y }
}

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

function formatRule(t: LogoTimingRule, seconds: number | null): string {
  if (t === 'entire') return 'Entire video'
  const s = seconds != null ? `${seconds}s` : '?'
  if (t === 'start_after') return `Start after ${s}`
  if (t === 'first_only') return `First ${s}`
  if (t === 'last_only') return `Last ${s}`
  return t
}

function formatFade(f: LogoFade): string {
  if (f === 'none') return 'No fade'
  if (f === 'in') return 'Fade in'
  if (f === 'out') return 'Fade out'
  return 'Fade in + out'
}

function positionLabel(p: LogoPosition): string {
  if (p === 'top_left') return 'Top-left'
  if (p === 'top_center') return 'Top-center'
  if (p === 'top_right') return 'Top-right'
  if (p === 'middle_left') return 'Middle-left'
  if (p === 'middle_center') return 'Middle-center'
  if (p === 'middle_right') return 'Middle-right'
  if (p === 'bottom_left') return 'Bottom-left'
  if (p === 'bottom_center') return 'Bottom-center'
  if (p === 'bottom_right') return 'Bottom-right'
  return 'Middle-center'
}

function defaultDraft(): Omit<LogoConfig, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'> {
  return {
    name: 'Standard watermark',
    description: null,
    position: 'bottom_right',
    sizePctWidth: 15,
    opacityPct: 35,
    timingRule: 'entire',
    timingSeconds: null,
    fade: 'none',
    insetXPreset: 'medium',
    insetYPreset: 'medium',
  }
}

export default function LogoConfigsPage() {
  const [me, setMe] = useState<MeResponse | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)

  const [configs, setConfigs] = useState<LogoConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState(defaultDraft())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<Record<number, boolean>>({})

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadingMe(true)
      const user = await ensureLoggedIn()
      if (cancelled) return
      setMe(user)
      setLoadingMe(false)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const loadConfigs = useCallback(async () => {
    if (!me?.userId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/logo-configs', { credentials: 'same-origin' })
      const data = await res.json().catch(() => [])
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to load logo configurations')
      const list: LogoConfig[] = Array.isArray(data) ? data : []
      setConfigs(list)
      if (selectedId == null) {
        if (list.length) {
          setSelectedId(list[0].id)
        } else {
          setSelectedId('new')
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load logo configurations')
    } finally {
      setLoading(false)
    }
  }, [me?.userId, selectedId])

  useEffect(() => {
    if (!me?.userId) return
    void loadConfigs()
  }, [me?.userId, loadConfigs])

  const selected = useMemo(() => {
    if (selectedId == null || selectedId === 'new') return null
    return configs.find((c) => c.id === selectedId) || null
  }, [configs, selectedId])

  useEffect(() => {
    if (selectedId === 'new') {
      setDraft(defaultDraft())
      return
    }
    if (!selected) return
    setDraft({
      name: selected.name,
      description: selected.description ?? null,
      position: selected.position,
      sizePctWidth: selected.sizePctWidth,
      opacityPct: selected.opacityPct,
      timingRule: selected.timingRule,
      timingSeconds: selected.timingSeconds,
      fade: selected.fade,
      insetXPreset: selected.insetXPreset ?? null,
      insetYPreset: selected.insetYPreset ?? null,
    })
  }, [selectedId, selected])

  const onNew = () => setSelectedId('new')

  const onSelect = (id: number) => setSelectedId(id)

  const onSave = async () => {
    if (!me?.userId) return
    if (saving) return
    setSaving(true)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf

      const body = JSON.stringify({
        name: draft.name,
        description: draft.description,
        position: draft.position,
        sizePctWidth: draft.sizePctWidth,
        opacityPct: draft.opacityPct,
        timingRule: draft.timingRule,
        timingSeconds: draft.timingRule === 'entire' ? null : draft.timingSeconds,
        fade: draft.fade,
        insetXPreset: draft.insetXPreset ?? null,
        insetYPreset: draft.insetYPreset ?? null,
      })

      if (selectedId === 'new' || selectedId == null) {
        const res = await fetch('/api/logo-configs', { method: 'POST', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to create')
        const created: LogoConfig | undefined = data?.config
        if (!created?.id) throw new Error('Failed to create')
        setConfigs((prev) => [created, ...prev])
        setSelectedId(created.id)
      } else {
        const res = await fetch(`/api/logo-configs/${encodeURIComponent(String(selectedId))}`, { method: 'PATCH', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to save')
        const updated: LogoConfig | undefined = data?.config
        if (!updated?.id) throw new Error('Failed to save')
        setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      }
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const onDuplicate = async (id: number) => {
    if (actionBusy[id]) return
    setActionBusy((prev) => ({ ...prev, [id]: true }))
    setSaveError(null)
    try {
      const headers: Record<string, string> = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/logo-configs/${encodeURIComponent(String(id))}/duplicate`, { method: 'POST', credentials: 'same-origin', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to duplicate')
      const created: LogoConfig | undefined = data?.config
      if (!created?.id) throw new Error('Failed to duplicate')
      setConfigs((prev) => [created, ...prev])
      setSelectedId(created.id)
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to duplicate')
    } finally {
      setActionBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const onArchive = async (id: number) => {
    if (actionBusy[id]) return
    const ok = window.confirm('Archive this logo configuration? You can re-enable it later (in a future UI).')
    if (!ok) return
    setActionBusy((prev) => ({ ...prev, [id]: true }))
    setSaveError(null)
    try {
      const headers: Record<string, string> = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/logo-configs/${encodeURIComponent(String(id))}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to archive')
      setConfigs((prev) => prev.filter((c) => c.id !== id))
      if (selectedId === id) {
        setSelectedId((prev) => {
          if (prev !== id) return prev
          return null
        })
      }
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to archive')
    } finally {
      setActionBusy((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }

  const previewBox = useMemo(() => {
    const opacity = Math.min(Math.max(draft.opacityPct / 100, 0), 1)
    const sizePct = Math.min(Math.max(draft.sizePctWidth, 1), 100)

    const posStyle: React.CSSProperties = { position: 'absolute' }
    const { x, y } = positionAxes(draft.position)
    const padFor = (preset: InsetPreset | null | undefined) => {
      if (preset === 'small') return 12
      if (preset === 'large') return 28
      return 20
    }
    const padX = x === 'center' ? 0 : padFor(draft.insetXPreset ?? null)
    const padY = y === 'middle' ? 0 : padFor(draft.insetYPreset ?? null)

    if (x === 'left') posStyle.left = padX
    else if (x === 'right') posStyle.right = padX
    else { posStyle.left = '50%'; posStyle.transform = 'translateX(-50%)' }

    if (y === 'top') posStyle.top = padY
    else if (y === 'bottom') posStyle.bottom = padY
    else {
      posStyle.top = '50%'
      posStyle.transform = posStyle.transform ? `${posStyle.transform} translateY(-50%)` : 'translateY(-50%)'
    }

    return (
      <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#070707', padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#bbb', marginBottom: 10 }}>Preview</div>
        <div
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16 / 9',
            borderRadius: 12,
            background:
              'linear-gradient(135deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02)), radial-gradient(circle at 30% 30%, rgba(10,132,255,0.20), transparent 55%)',
            overflow: 'hidden',
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          <div style={{ position: 'absolute', inset: 0, backgroundImage: 'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)', backgroundSize: '28px 28px', opacity: 0.25 }} />
          <div
            style={{
              ...posStyle,
              width: `${sizePct}%`,
              aspectRatio: '1 / 1',
              borderRadius: 10,
              background: `rgba(255,255,255,${0.85 * opacity})`,
              boxShadow: `0 10px 30px rgba(0,0,0,${0.45 + 0.35 * opacity})`,
              border: '1px solid rgba(0,0,0,0.35)',
              display: 'grid',
              placeItems: 'center',
              overflow: 'hidden',
            }}
          >
            <div style={{ color: 'rgba(0,0,0,0.7)', fontWeight: 900, letterSpacing: 0.6, fontSize: 12, textTransform: 'uppercase' }}>
              Logo
            </div>
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <span style={{ fontSize: 12, color: '#999', border: '1px solid rgba(255,255,255,0.12)', padding: '4px 8px', borderRadius: 999 }}>
            {positionLabel(draft.position)}
          </span>
          <span style={{ fontSize: 12, color: '#999', border: '1px solid rgba(255,255,255,0.12)', padding: '4px 8px', borderRadius: 999 }}>
            Size {draft.sizePctWidth}%
          </span>
          <span style={{ fontSize: 12, color: '#999', border: '1px solid rgba(255,255,255,0.12)', padding: '4px 8px', borderRadius: 999 }}>
            Opacity {draft.opacityPct}%
          </span>
          <span style={{ fontSize: 12, color: '#999', border: '1px solid rgba(255,255,255,0.12)', padding: '4px 8px', borderRadius: 999 }}>
            {formatRule(draft.timingRule, draft.timingSeconds)}
          </span>
          <span style={{ fontSize: 12, color: '#999', border: '1px solid rgba(255,255,255,0.12)', padding: '4px 8px', borderRadius: 999 }}>
            {formatFade(draft.fade)}
          </span>
        </div>
      </div>
    )
  }, [draft])

  if (loadingMe) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Logo Configurations</h1>
        <div style={{ marginTop: 12, color: '#888' }}>Loading…</div>
      </div>
    )
  }

  if (!me?.userId) {
    return (
      <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Logo Configurations</h1>
        <p style={{ marginTop: 10, color: '#bbb' }}>
          Please <a href="/login" style={{ color: '#0a84ff' }}>sign in</a> to manage branding presets.
        </p>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#050505', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px 80px' }}>
        <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Logo Configurations</h1>
            <div style={{ marginTop: 4, color: '#aaa' }}>Branding presets for logo placement, size, opacity, and timing.</div>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={onNew}
              style={{
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.14)',
                borderRadius: 10,
                padding: '10px 14px',
                fontWeight: 750,
                cursor: 'pointer',
              }}
            >
              New configuration
            </button>
            <a
              href="/assets/logo"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 10,
                padding: '10px 14px',
                fontWeight: 750,
                textDecoration: 'none',
                border: '1px solid rgba(255,255,255,0.14)',
                background: 'rgba(255,255,255,0.04)',
                color: '#fff',
              }}
            >
              Back to Logos
            </a>
          </div>
        </header>

        {error ? <div style={{ color: '#ff9b9b', marginBottom: 12 }}>{error}</div> : null}
        {saveError ? <div style={{ color: '#ff9b9b', marginBottom: 12 }}>{saveError}</div> : null}

        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <aside style={{ flex: '1 1 320px', minWidth: 280 }}>
            <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#070707', overflow: 'hidden' }}>
              <div style={{ padding: '12px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ fontWeight: 800 }}>Your presets</div>
                <button
                  type="button"
                  onClick={() => void loadConfigs()}
                  disabled={loading}
                  style={{
                    background: 'transparent',
                    color: '#9cf',
                    border: '1px solid rgba(153,204,255,0.25)',
                    borderRadius: 10,
                    padding: '6px 10px',
                    fontWeight: 700,
                    cursor: loading ? 'default' : 'pointer',
                    opacity: loading ? 0.6 : 1,
                  }}
                >
                  {loading ? 'Refreshing…' : 'Refresh'}
                </button>
              </div>

              {loading ? (
                <div style={{ padding: 12, color: '#888' }}>Loading…</div>
              ) : configs.length === 0 ? (
                <div style={{ padding: 12, color: '#bbb' }}>
                  No logo configurations yet. Click “New configuration” to create your first preset.
                </div>
              ) : (
                <div>
                  {configs.map((c) => {
                    const active = selectedId === c.id
                    const busy = !!actionBusy[c.id]
                    return (
                      <div
                        key={c.id}
                        style={{
                          padding: 12,
                          borderBottom: '1px solid rgba(255,255,255,0.06)',
                          background: active ? 'rgba(10,132,255,0.12)' : 'transparent',
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => onSelect(c.id)}
                          style={{
                            width: '100%',
                            textAlign: 'left',
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            color: '#fff',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ fontWeight: 850, lineHeight: 1.25 }}>{c.name}</div>
                          <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {[positionLabel(c.position), `${c.sizePctWidth}%`, `${c.opacityPct}%`, formatRule(c.timingRule, c.timingSeconds), formatFade(c.fade)].map((t) => (
                              <span key={t} style={{ fontSize: 12, color: '#bbb', border: '1px solid rgba(255,255,255,0.10)', padding: '3px 8px', borderRadius: 999 }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        </button>
                        <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            onClick={() => void onDuplicate(c.id)}
                            disabled={busy}
                            style={{
                              background: 'transparent',
                              color: '#fff',
                              border: '1px solid rgba(255,255,255,0.16)',
                              borderRadius: 10,
                              padding: '6px 10px',
                              fontWeight: 750,
                              cursor: busy ? 'default' : 'pointer',
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            onClick={() => void onArchive(c.id)}
                            disabled={busy}
                            style={{
                              background: 'transparent',
                              color: '#ff9b9b',
                              border: '1px solid rgba(255,155,155,0.35)',
                              borderRadius: 10,
                              padding: '6px 10px',
                              fontWeight: 750,
                              cursor: busy ? 'default' : 'pointer',
                              opacity: busy ? 0.6 : 1,
                            }}
                          >
                            Archive
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </aside>

          <main style={{ flex: '2 1 420px', minWidth: 320 }}>
            <div style={{ display: 'grid', gap: 14 }}>
              {previewBox}

              <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#070707', padding: 12 }}>
                <div style={{ fontWeight: 900, marginBottom: 10 }}>
                  {selectedId === 'new' || selectedId == null ? 'New configuration' : 'Edit configuration'}
                </div>

                <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Name</div>
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Standard watermark"
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: '#0c0c0c', color: '#fff', outline: 'none' }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Description</div>
                  <textarea
                    value={draft.description ?? ''}
                    onChange={(e) => setDraft((prev) => ({ ...prev, description: e.target.value }))}
                    placeholder="Notes for yourself (shown via About in Produce)."
                    rows={5}
                    maxLength={2000}
                    style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: '#0c0c0c', color: '#fff', outline: 'none', resize: 'vertical', lineHeight: 1.4 }}
                  />
                </label>

	                <div style={{ display: 'grid', gap: 10 }}>
	                  <div style={{ color: '#bbb', fontWeight: 750 }}>Position</div>
	                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 }}>
	                    {([
	                      { value: 'top_left', label: '↖' },
	                      { value: 'top_center', label: '↑' },
	                      { value: 'top_right', label: '↗' },
	                      { value: 'middle_left', label: '←' },
	                      { value: 'middle_center', label: '•' },
	                      { value: 'middle_right', label: '→' },
	                      { value: 'bottom_left', label: '↙' },
	                      { value: 'bottom_center', label: '↓' },
	                      { value: 'bottom_right', label: '↘' },
	                    ] as Array<{ value: LogoPosition; label: string }>).map((p) => {
	                      const active = normalizeLegacyPosition(draft.position) === p.value
	                      return (
	                        <button
	                          key={p.value}
	                          type="button"
	                          onClick={() => {
	                            setDraft((prev) => {
	                              const nextPos = p.value
	                              const axes = positionAxes(nextPos)
	                              // Safeguard: only keep inset values relevant to the active axes.
	                              const nextInsetX = axes.x === 'center' ? null : (prev.insetXPreset ?? 'medium')
	                              const nextInsetY = axes.y === 'middle' ? null : (prev.insetYPreset ?? 'medium')
	                              return {
	                                ...prev,
	                                position: nextPos,
	                                insetXPreset: nextInsetX,
	                                insetYPreset: nextInsetY,
	                              }
	                            })
	                          }}
	                          title={positionLabel(p.value)}
	                          style={{
	                            padding: '12px 10px',
	                            borderRadius: 12,
	                            border: active ? '1px solid rgba(10,132,255,0.85)' : '1px solid rgba(255,255,255,0.14)',
	                            background: active ? 'rgba(10,132,255,0.18)' : 'rgba(255,255,255,0.04)',
	                            color: '#fff',
	                            fontWeight: 900,
	                            cursor: 'pointer',
	                            textAlign: 'center',
	                            fontSize: 16,
	                            lineHeight: 1,
	                          }}
	                        >
	                          {p.label}
	                        </button>
	                      )
	                    })}
	                  </div>
	                  <div style={{ color: '#888', fontSize: 12 }}>
	                    Selected: {positionLabel(draft.position)}
	                  </div>

	                  {(() => {
	                    const axes = positionAxes(draft.position)
	                    const showX = axes.x !== 'center'
	                    const showY = axes.y !== 'middle'
	                    const xLabel = axes.x === 'left' ? 'Left inset' : axes.x === 'right' ? 'Right inset' : ''
	                    const yLabel = axes.y === 'top' ? 'Top inset' : axes.y === 'bottom' ? 'Bottom inset' : ''
	                    return (
	                      <div style={{ display: 'grid', gap: 10 }}>
	                        {showY ? (
	                          <div style={{ display: 'grid', gap: 8 }}>
	                            <div style={{ color: '#bbb', fontWeight: 750 }}>{yLabel}</div>
	                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
	                              {INSET_PRESETS.map((p) => {
	                                const active = (draft.insetYPreset || 'medium') === p.value
	                                return (
	                                  <button
	                                    key={p.value}
	                                    type="button"
	                                    onClick={() => setDraft((prev) => ({ ...prev, insetYPreset: p.value }))}
	                                    style={{
	                                      padding: '10px 12px',
	                                      borderRadius: 999,
	                                      border: active ? '1px solid rgba(10,132,255,0.75)' : '1px solid rgba(255,255,255,0.14)',
	                                      background: active ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.04)',
	                                      color: '#fff',
	                                      fontWeight: 850,
	                                      cursor: 'pointer',
	                                    }}
	                                  >
	                                    {p.label}
	                                  </button>
	                                )
	                              })}
	                            </div>
	                          </div>
	                        ) : null}

	                        {showX ? (
	                          <div style={{ display: 'grid', gap: 8 }}>
	                            <div style={{ color: '#bbb', fontWeight: 750 }}>{xLabel}</div>
	                            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
	                              {INSET_PRESETS.map((p) => {
	                                const active = (draft.insetXPreset || 'medium') === p.value
	                                return (
	                                  <button
	                                    key={p.value}
	                                    type="button"
	                                    onClick={() => setDraft((prev) => ({ ...prev, insetXPreset: p.value }))}
	                                    style={{
	                                      padding: '10px 12px',
	                                      borderRadius: 999,
	                                      border: active ? '1px solid rgba(10,132,255,0.75)' : '1px solid rgba(255,255,255,0.14)',
	                                      background: active ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.04)',
	                                      color: '#fff',
	                                      fontWeight: 850,
	                                      cursor: 'pointer',
	                                    }}
	                                  >
	                                    {p.label}
	                                  </button>
	                                )
	                              })}
	                            </div>
	                          </div>
	                        ) : null}
	                      </div>
	                    )
	                  })()}

	                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

                  <div style={{ color: '#bbb', fontWeight: 750 }}>Size</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {SIZE_PRESETS.map((s) => {
                      const active = draft.sizePctWidth === s.pct
                      return (
                        <button
                          key={s.label}
                          type="button"
                          onClick={() => setDraft((prev) => ({ ...prev, sizePctWidth: s.pct }))}
                          style={{
                            padding: '10px 12px',
                            borderRadius: 999,
                            border: active ? '1px solid rgba(10,132,255,0.75)' : '1px solid rgba(255,255,255,0.14)',
                            background: active ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.04)',
                            color: '#fff',
                            fontWeight: 850,
                            cursor: 'pointer',
                          }}
                        >
                          {s.label}
                        </button>
                      )
                    })}
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

                  <div style={{ color: '#bbb', fontWeight: 750 }}>Opacity</div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={draft.opacityPct}
                      onChange={(e) => setDraft((prev) => ({ ...prev, opacityPct: Number(e.target.value) }))}
                      style={{ flex: 1 }}
                    />
                    <div style={{ width: 52, textAlign: 'right', fontWeight: 850, color: '#fff' }}>{draft.opacityPct}%</div>
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

                  <div style={{ color: '#bbb', fontWeight: 750 }}>Timing</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {([
                      { value: 'entire', label: 'Entire video' },
                      { value: 'start_after', label: 'Start after…' },
                      { value: 'first_only', label: 'First…' },
                      { value: 'last_only', label: 'Last…' },
                    ] as Array<{ value: LogoTimingRule; label: string }>).map((t) => {
                      const checked = draft.timingRule === t.value
                      return (
                        <label key={t.value} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                          <input
                            type="radio"
                            name="timing"
                            checked={checked}
                            onChange={() => setDraft((prev) => ({ ...prev, timingRule: t.value }))}
                          />
                          <div style={{ fontWeight: 800 }}>{t.label}</div>
                        </label>
                      )
                    })}
                    {draft.timingRule !== 'entire' ? (
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginLeft: 24 }}>
                        <div style={{ color: '#bbb', fontWeight: 750 }}>Seconds</div>
                        <input
                          type="number"
                          min={0}
                          max={3600}
                          value={draft.timingSeconds ?? 0}
                          onChange={(e) => setDraft((prev) => ({ ...prev, timingSeconds: Number(e.target.value) }))}
                          style={{ width: 120, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.16)', background: '#0c0c0c', color: '#fff', outline: 'none' }}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

                  <div style={{ color: '#bbb', fontWeight: 750 }}>Fade</div>
                  <div style={{ display: 'grid', gap: 10 }}>
                    {([
                      { value: 'none', label: 'None' },
                      { value: 'in', label: 'Fade in' },
                      { value: 'out', label: 'Fade out' },
                      { value: 'in_out', label: 'Fade in + out' },
                    ] as Array<{ value: LogoFade; label: string }>).map((f) => (
                      <label key={f.value} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="fade"
                          checked={draft.fade === f.value}
                          onChange={() => setDraft((prev) => ({ ...prev, fade: f.value }))}
                        />
                        <div style={{ fontWeight: 800 }}>{f.label}</div>
                      </label>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                  <button
                    type="button"
                    onClick={() => void onSave()}
                    disabled={saving}
                    style={{
                      background: '#0a84ff',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 10,
                      padding: '10px 16px',
                      fontWeight: 900,
                      cursor: saving ? 'default' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    {saving ? 'Saving…' : selectedId === 'new' || selectedId == null ? 'Create' : 'Save'}
                  </button>
                  <div style={{ color: '#888', fontSize: 13 }}>
                    No pixel coordinates. These are reusable presets used during production.
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  )
}
