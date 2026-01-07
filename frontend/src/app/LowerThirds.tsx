import React, { useCallback, useEffect, useMemo, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type InsetPreset = 'small' | 'medium' | 'large'
type TimingRule = 'first_only' | 'entire'
type Fade = 'none' | 'in' | 'out' | 'in_out'
type SizeMode = 'pct' | 'match_image'
type BaselineWidth = 1080 | 1920

type LowerThirdConfig = {
  id: number
  name: string
  sizeMode: SizeMode
  baselineWidth: BaselineWidth
  position: 'bottom_center'
  sizePctWidth: number
  opacityPct: number
  timingRule: TimingRule
  timingSeconds: number | null
  fade: Fade
  insetYPreset: InsetPreset | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

type Draft = {
  name: string
  sizeMode: SizeMode
  baselineWidth: BaselineWidth
  sizePctWidth: number
  opacityPct: number
  timingRule: TimingRule
  timingSeconds: number | null
  fade: Fade
  insetYPreset: InsetPreset | null
}

const SIZE_PRESETS: Array<{ label: string; pct: number }> = [
  { label: 'Lower third', pct: 82 },
  { label: 'Full width', pct: 100 },
]

const DURATION_OPTIONS: Array<{ label: string; seconds: number }> = [
  { label: 'First 5s', seconds: 5 },
  { label: 'First 10s', seconds: 10 },
  { label: 'First 15s', seconds: 15 },
  { label: 'First 20s', seconds: 20 },
]

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

function defaultDraft(): Draft {
  return {
    name: 'Lower Third',
    sizeMode: 'pct',
    baselineWidth: 1080,
    sizePctWidth: 82,
    opacityPct: 100,
    timingRule: 'first_only',
    timingSeconds: 10,
    fade: 'none',
    insetYPreset: 'medium',
  }
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

export default function LowerThirdsPage() {
  const fromHref = useMemo(() => parseFromHref(), [])
  const backHref = fromHref || '/produce'

  const [me, setMe] = useState<MeResponse | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)

  const [configs, setConfigs] = useState<LowerThirdConfig[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>(() => defaultDraft())
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

  const load = useCallback(async () => {
    if (!me?.userId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/lower-third-configs?limit=200', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to load lower third configs')
      const items: LowerThirdConfig[] = Array.isArray(data?.items) ? data.items : []
      const active = items.filter((c) => !c.archivedAt)
      setConfigs(active)
      if (selectedId == null) {
        setSelectedId(active.length ? active[0].id : 'new')
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load lower third configs')
    } finally {
      setLoading(false)
    }
  }, [me?.userId, selectedId])

  useEffect(() => {
    if (!me?.userId) return
    void load()
  }, [me?.userId, load])

  const selectedConfig = useMemo(() => {
    if (selectedId == null || selectedId === 'new') return null
    return configs.find((c) => c.id === selectedId) || null
  }, [configs, selectedId])

  useEffect(() => {
    if (!selectedConfig) return
    setDraft({
      name: selectedConfig.name,
      sizeMode: selectedConfig.sizeMode || 'pct',
      baselineWidth: selectedConfig.baselineWidth || 1080,
      sizePctWidth: selectedConfig.sizePctWidth,
      opacityPct: selectedConfig.opacityPct,
      timingRule: selectedConfig.timingRule,
      timingSeconds: selectedConfig.timingRule === 'entire' ? null : (selectedConfig.timingSeconds ?? 10),
      fade: selectedConfig.fade || 'none',
      insetYPreset: selectedConfig.insetYPreset ?? 'medium',
    })
  }, [selectedConfig])

  const onNew = () => {
    setSelectedId('new')
    setSaveError(null)
    setDraft(defaultDraft())
  }

  const onSelect = (id: number) => {
    setSelectedId(id)
    setSaveError(null)
  }

  const save = async () => {
    if (!me?.userId) return
    setSaving(true)
    setSaveError(null)
    const csrf = getCsrfToken()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (csrf) headers['x-csrf-token'] = csrf
    try {
      const payload: any = {
        name: draft.name,
        sizeMode: draft.sizeMode,
        baselineWidth: draft.baselineWidth,
        sizePctWidth: draft.sizePctWidth,
        opacityPct: draft.opacityPct,
        timingRule: draft.timingRule,
        timingSeconds: draft.timingRule === 'entire' ? null : draft.timingSeconds,
        fade: draft.fade,
        insetYPreset: draft.insetYPreset,
      }
      const isNew = selectedId == null || selectedId === 'new'
      const res = await fetch(isNew ? '/api/lower-third-configs' : `/api/lower-third-configs/${encodeURIComponent(String(selectedId))}`, {
        method: isNew ? 'POST' : 'PUT',
        credentials: 'same-origin',
        headers,
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Save failed')
      const saved: LowerThirdConfig = data?.config
      await load()
      if (saved?.id) setSelectedId(saved.id)
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const archive = async (id: number) => {
    if (!me?.userId) return
    const ok = window.confirm('Archive this lower third config? (You can re-enable it in a future UI.)')
    if (!ok) return
    setActionBusy((m) => ({ ...m, [id]: true }))
    const csrf = getCsrfToken()
    const headers: Record<string, string> = {}
    if (csrf) headers['x-csrf-token'] = csrf
    try {
      const res = await fetch(`/api/lower-third-configs/${encodeURIComponent(String(id))}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Archive failed')
      await load()
      if (selectedId === id) setSelectedId('new')
    } catch (e: any) {
      try { alert(e?.message || 'Archive failed') } catch {}
    } finally {
      setActionBusy((m) => ({ ...m, [id]: false }))
    }
  }

  if (loadingMe) return <div style={{ padding: 16 }}>Loading…</div>
  if (!me?.userId) {
    return (
      <div style={{ padding: 16 }}>
        <h2>Lower Thirds</h2>
        <div>Please log in to manage lower third configs.</div>
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100dvh', background: '#0b0b0b', color: '#fff' }}>
      <div style={{ padding: '16px 16px 10px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <a href={backHref} style={{ color: '#9cf', textDecoration: 'none' }}>← Back</a>
          <div style={{ fontSize: 18, fontWeight: 800 }}>Lower Thirds</div>
          <div style={{ marginLeft: 'auto' }}>
            <a href="/uploads?kind=image&image_role=lower_third" style={{ color: '#9cf', textDecoration: 'none', fontSize: 13 }}>Manage images</a>
          </div>
        </div>
        <div style={{ marginTop: 6, color: '#aaa', fontSize: 13 }}>
          Lower third configs control size, opacity, timing, and bottom inset (PNG images are managed separately).
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: 14, padding: 16 }}>
        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, overflow: 'hidden' }}>
          <div style={{ padding: 10, borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 800, color: '#ddd' }}>Configs</div>
            <button onClick={onNew} type="button" style={{ background: '#0a84ff', color: '#fff', border: 'none', borderRadius: 10, padding: '6px 10px', fontWeight: 800, cursor: 'pointer' }}>
              New
            </button>
          </div>
          {loading ? (
            <div style={{ padding: 12, color: '#aaa' }}>Loading…</div>
          ) : error ? (
            <div style={{ padding: 12, color: '#ff9b9b' }}>{error}</div>
          ) : configs.length === 0 ? (
            <div style={{ padding: 12, color: '#aaa' }}>No configs yet.</div>
          ) : (
            <div style={{ maxHeight: '70vh', overflowY: 'auto' }}>
              {configs.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onSelect(c.id)}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '10px 12px',
                    background: selectedId === c.id ? 'rgba(10,132,255,0.14)' : 'transparent',
                    border: 'none',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    color: '#fff',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: '#bbb' }}>
                    {c.sizeMode === 'match_image' ? `Match image @ ${c.baselineWidth}` : `${c.sizePctWidth}%`} · {c.opacityPct}% · {c.timingRule === 'entire' ? 'Entire' : `First ${c.timingSeconds ?? 10}s`}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{selectedId === 'new' || selectedId == null ? 'New config' : `Config #${selectedId}`}</div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              {selectedId != null && selectedId !== 'new' ? (
                <button
                  type="button"
                  onClick={() => archive(Number(selectedId))}
                  disabled={!!actionBusy[Number(selectedId)]}
                  style={{ background: 'rgba(255,255,255,0.08)', color: '#fff', border: '1px solid rgba(255,255,255,0.14)', borderRadius: 10, padding: '8px 10px', fontWeight: 800, cursor: 'pointer' }}
                >
                  {actionBusy[Number(selectedId)] ? 'Working…' : 'Archive'}
                </button>
              ) : null}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={{ background: '#0a84ff', color: '#fff', border: 'none', borderRadius: 10, padding: '8px 12px', fontWeight: 900, cursor: 'pointer' }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>

          {saveError ? <div style={{ marginTop: 10, color: '#ff9b9b' }}>{saveError}</div> : null}

          <div style={{ marginTop: 14, display: 'grid', gap: 12 }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontWeight: 750 }}>Name</div>
              <input
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                placeholder="Lower third"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#fff' }}
              />
            </div>

            <div style={{ color: '#bbb', fontWeight: 750 }}>Position</div>
            <div style={{ color: '#fff', opacity: 0.92 }}>Bottom-center (fixed for now)</div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

            <div style={{ color: '#bbb', fontWeight: 750 }}>Size Mode</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {([
                { label: 'Scale by %', value: 'pct' as const },
                { label: 'Match image @ baseline', value: 'match_image' as const },
              ] as const).map((opt) => {
                const active = draft.sizeMode === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDraft((prev) => ({ ...prev, sizeMode: opt.value }))}
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
                    {opt.label}
                  </button>
                )
              })}
            </div>

            {draft.sizeMode === 'match_image' ? (
              <div style={{ display: 'grid', gap: 10 }}>
                <div style={{ color: '#bbb', fontWeight: 750 }}>Baseline Width</div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {([
                    { label: '1080 (portrait)', value: 1080 as const },
                    { label: '1920 (landscape)', value: 1920 as const },
                  ] as const).map((opt) => {
                    const active = draft.baselineWidth === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDraft((prev) => ({ ...prev, baselineWidth: opt.value }))}
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
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <div style={{ color: '#aaa', fontSize: 13, lineHeight: 1.35 }}>
                  Uses the uploaded PNG’s pixel width to compute a % at the chosen baseline, then applies that % to all outputs. Avoids upscaling when outputs are ≤ baseline.
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
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
              </div>
            )}

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
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="radio"
                  name="timing"
                  checked={draft.timingRule === 'first_only'}
                  onChange={() => setDraft((p) => ({ ...p, timingRule: 'first_only', timingSeconds: p.timingSeconds ?? 10 }))}
                />
                <span>First</span>
              </label>
              {draft.timingRule === 'first_only' ? (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingLeft: 26 }}>
                  {DURATION_OPTIONS.map((d) => {
                    const active = (draft.timingSeconds ?? 10) === d.seconds
                    return (
                      <button
                        key={d.seconds}
                        type="button"
                        onClick={() => setDraft((p) => ({ ...p, timingSeconds: d.seconds }))}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 999,
                          border: active ? '1px solid rgba(10,132,255,0.75)' : '1px solid rgba(255,255,255,0.14)',
                          background: active ? 'rgba(10,132,255,0.16)' : 'rgba(255,255,255,0.04)',
                          color: '#fff',
                          fontWeight: 850,
                          cursor: 'pointer',
                        }}
                      >
                        {d.label}
                      </button>
                    )
                  })}
                </div>
              ) : null}
              <label style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <input
                  type="radio"
                  name="timing"
                  checked={draft.timingRule === 'entire'}
                  onChange={() => setDraft((p) => ({ ...p, timingRule: 'entire', timingSeconds: null }))}
                />
                <span>Entire video</span>
              </label>
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

            <div style={{ color: '#bbb', fontWeight: 750 }}>Fade</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {(['none', 'in', 'out', 'in_out'] as Fade[]).map((f) => {
                const active = draft.fade === f
                const label = f === 'none' ? 'None' : f === 'in' ? 'In' : f === 'out' ? 'Out' : 'In + Out'
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setDraft((p) => ({ ...p, fade: f }))}
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
                    {label}
                  </button>
                )
              })}
            </div>

            <div style={{ height: 1, background: 'rgba(255,255,255,0.08)', margin: '2px 0' }} />

            <div style={{ color: '#bbb', fontWeight: 750 }}>Bottom inset</div>
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
        </div>
      </div>
    </div>
  )
}
