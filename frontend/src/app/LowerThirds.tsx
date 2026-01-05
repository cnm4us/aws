import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type LowerThirdDescriptorField = { id: string; label: string; type: 'text'; maxLength?: number }
type LowerThirdDescriptorColor = { id: string; label: string }
type LowerThirdDescriptorV1 = {
  fields?: LowerThirdDescriptorField[]
  colors?: LowerThirdDescriptorColor[]
  defaults?: Record<string, string>
}
type LowerThirdDescriptorV2Param = { type: 'text' | 'color'; label: string; maxLength?: number; default?: string }
type LowerThirdDescriptorV2Binding = { param: string; selector: string; attributes: Record<string, string> }
type LowerThirdDescriptorV2 = {
  templateId?: string
  version?: number
  params: Record<string, LowerThirdDescriptorV2Param>
  bindings: LowerThirdDescriptorV2Binding[]
}
type LowerThirdDescriptor = LowerThirdDescriptorV1 | LowerThirdDescriptorV2

type LowerThirdTemplate = {
  templateKey: string
  version: number
  label: string
  category: string | null
  descriptor: LowerThirdDescriptor
  createdAt: string
  archivedAt: string | null
}

type LowerThirdConfig = {
  id: number
  name: string
  templateKey: string
  templateVersion: number
  params: Record<string, string>
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
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

function isDescriptorV2(d: LowerThirdDescriptor | null | undefined): d is LowerThirdDescriptorV2 {
  return !!d && typeof d === 'object' && (d as any).params && typeof (d as any).params === 'object' && Array.isArray((d as any).bindings)
}

function buildDefaultParams(descriptor: LowerThirdDescriptor): Record<string, string> {
  const out: Record<string, string> = {}
  if (isDescriptorV2(descriptor)) {
    for (const [key, def] of Object.entries(descriptor.params || {})) {
      const v = def.default != null ? String(def.default) : def.type === 'color' ? '#000000' : ''
      out[key] = v
    }
    return out
  }
  const defaults = (descriptor as any).defaults || {}
  for (const f of (descriptor as any).fields || []) out[f.id] = String(defaults[f.id] ?? '')
  for (const c of (descriptor as any).colors || []) out[c.id] = String(defaults[c.id] ?? '#000000')
  return out
}

function parseFromHref(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('from') || '').trim()
    if (!raw) return null
    // Only allow local paths (avoid accidental open-redirect URLs).
    if (!raw.startsWith('/')) return null
    return raw
  } catch {
    return null
  }
}

type Draft = {
  name: string
  templateKey: string
  templateVersion: number
  params: Record<string, string>
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
}

export default function LowerThirdsPage() {
  const fromHref = useMemo(() => parseFromHref(), [])
  const backHref = fromHref || '/produce'

  const [me, setMe] = useState<MeResponse | null>(null)
  const [loadingMe, setLoadingMe] = useState(true)

  const [templates, setTemplates] = useState<LowerThirdTemplate[]>([])
  const [loadingTemplates, setLoadingTemplates] = useState(false)
  const [templateError, setTemplateError] = useState<string | null>(null)

  const [configs, setConfigs] = useState<LowerThirdConfig[]>([])
  const [loadingConfigs, setLoadingConfigs] = useState(false)
  const [configError, setConfigError] = useState<string | null>(null)

  const [selectedId, setSelectedId] = useState<number | 'new' | null>(null)
  const [draft, setDraft] = useState<Draft>({
    name: '',
    templateKey: '',
    templateVersion: 1,
    params: {},
    timingRule: 'first_only',
    timingSeconds: 10,
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [actionBusy, setActionBusy] = useState<Record<number, boolean>>({})

  const [previewSvg, setPreviewSvg] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)

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

  const loadTemplates = useCallback(async () => {
    if (!me?.userId) return
    setLoadingTemplates(true)
    setTemplateError(null)
    try {
      const res = await fetch('/api/lower-third-templates', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to load templates')
      const list: LowerThirdTemplate[] = Array.isArray(data?.items) ? data.items : []
      setTemplates(list.filter((t) => !t.archivedAt))
    } catch (e: any) {
      setTemplateError(e?.message || 'Failed to load templates')
    } finally {
      setLoadingTemplates(false)
    }
  }, [me?.userId])

  const loadConfigs = useCallback(async () => {
    if (!me?.userId) return
    setLoadingConfigs(true)
    setConfigError(null)
    try {
      const res = await fetch('/api/lower-third-configs', { credentials: 'same-origin' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to load presets')
      const list: LowerThirdConfig[] = Array.isArray(data?.items) ? data.items : []
      setConfigs(list.filter((c) => !c.archivedAt))
      if (selectedId == null) {
        setSelectedId(list.length ? list[0].id : 'new')
      }
    } catch (e: any) {
      setConfigError(e?.message || 'Failed to load presets')
    } finally {
      setLoadingConfigs(false)
    }
  }, [me?.userId, selectedId])

  useEffect(() => {
    if (!me?.userId) return
    void loadTemplates()
    void loadConfigs()
  }, [me?.userId, loadTemplates, loadConfigs])

  const selectedConfig = useMemo(() => {
    if (selectedId == null || selectedId === 'new') return null
    return configs.find((c) => c.id === selectedId) || null
  }, [configs, selectedId])

  const selectedTemplate = useMemo(() => {
    const key = draft.templateKey
    const ver = draft.templateVersion
    if (!key) return null
    return templates.find((t) => t.templateKey === key && t.version === ver) || null
  }, [templates, draft.templateKey, draft.templateVersion])

  // Initialize draft template/params once templates are loaded (new preset).
  useEffect(() => {
    if (!templates.length) return
    if (selectedId !== 'new' && selectedId != null) return
    if (draft.templateKey) return
    const first = templates[0]
    if (!first) return
    setDraft((prev) => ({
      ...prev,
      templateKey: first.templateKey,
      templateVersion: first.version,
      params: buildDefaultParams(first.descriptor),
      name: prev.name || 'Lower Third',
      timingRule: prev.timingRule || 'first_only',
      timingSeconds: prev.timingSeconds == null ? 10 : prev.timingSeconds,
    }))
  }, [templates, selectedId, draft.templateKey, draft.name])

  // When selecting an existing config, load it into the draft.
  useEffect(() => {
    if (!selectedConfig) return
    const tpl = templates.find((t) => t.templateKey === selectedConfig.templateKey && t.version === selectedConfig.templateVersion) || null
    const baseParams = tpl ? buildDefaultParams(tpl.descriptor) : {}
    setDraft({
      name: selectedConfig.name,
      templateKey: selectedConfig.templateKey,
      templateVersion: selectedConfig.templateVersion,
      params: { ...baseParams, ...(selectedConfig.params || {}) },
      timingRule: selectedConfig.timingRule || 'first_only',
      timingSeconds:
        selectedConfig.timingRule === 'entire' ? null : selectedConfig.timingSeconds == null ? 10 : selectedConfig.timingSeconds,
    })
  }, [selectedConfig, templates])

  const onNew = () => {
    setSelectedId('new')
    setSaveError(null)
    const first = templates[0] || null
    setDraft({
      name: 'Lower Third',
      templateKey: first?.templateKey || '',
      templateVersion: first?.version || 1,
      params: first ? buildDefaultParams(first.descriptor) : {},
      timingRule: 'first_only',
      timingSeconds: 10,
    })
  }

  const onSelect = (id: number) => {
    setSelectedId(id)
    setSaveError(null)
  }

  const onChangeTemplate = (templateKey: string, version: number) => {
    const tpl = templates.find((t) => t.templateKey === templateKey && t.version === version) || null
    setDraft((prev) => ({
      ...prev,
      templateKey,
      templateVersion: version,
      params: tpl ? buildDefaultParams(tpl.descriptor) : {},
    }))
  }

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
        templateKey: draft.templateKey,
        templateVersion: draft.templateVersion,
        params: draft.params,
        timingRule: draft.timingRule,
        timingSeconds: draft.timingRule === 'entire' ? null : draft.timingSeconds,
      })

      if (selectedId === 'new' || selectedId == null) {
        const res = await fetch('/api/lower-third-configs', { method: 'POST', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to create')
        const created: LowerThirdConfig | undefined = data?.config
        if (!created?.id) throw new Error('Failed to create')
        setConfigs((prev) => [created, ...prev])
        setSelectedId(created.id)
      } else {
        const res = await fetch(`/api/lower-third-configs/${encodeURIComponent(String(selectedId))}`, {
          method: 'PATCH',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({
            name: draft.name,
            params: draft.params,
            timingRule: draft.timingRule,
            timingSeconds: draft.timingRule === 'entire' ? null : draft.timingSeconds,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to save')
        const updated: LowerThirdConfig | undefined = data?.config
        if (!updated?.id) throw new Error('Failed to save')
        setConfigs((prev) => prev.map((c) => (c.id === updated.id ? updated : c)))
      }
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const onArchive = async (id: number) => {
    if (actionBusy[id]) return
    const ok = window.confirm('Archive this lower third preset? You can re-enable it later (in a future UI).')
    if (!ok) return
    setActionBusy((prev) => ({ ...prev, [id]: true }))
    setSaveError(null)
    try {
      const headers: Record<string, string> = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/lower-third-configs/${encodeURIComponent(String(id))}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to archive')
      setConfigs((prev) => prev.filter((c) => c.id !== id))
      if (selectedId === id) setSelectedId('new')
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

  // Debounced resolve (preview == render)
  useEffect(() => {
    if (!me?.userId) return
    if (!draft.templateKey || !draft.templateVersion) return
    setPreviewError(null)
    const timer = window.setTimeout(async () => {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' }
        const csrf = getCsrfToken()
        if (csrf) headers['x-csrf-token'] = csrf
        const res = await fetch('/api/lower-third-templates/resolve', {
          method: 'POST',
          credentials: 'same-origin',
          headers,
          body: JSON.stringify({
            templateKey: draft.templateKey,
            templateVersion: draft.templateVersion,
            params: draft.params,
          }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.detail || data?.error || 'Failed to resolve preview')
        setPreviewSvg(String(data?.svg || ''))
      } catch (e: any) {
        setPreviewSvg(null)
        setPreviewError(e?.message || 'Failed to resolve preview')
      }
    }, 250)
    return () => window.clearTimeout(timer)
  }, [me?.userId, draft.templateKey, draft.templateVersion, draft.params])

  // Normalize embedded SVG size to fit the preview container.
  useEffect(() => {
    const root = previewRef.current
    if (!root) return
    const svg = root.querySelector('svg') as SVGElement | null
    if (!svg) return
    try {
      svg.setAttribute('width', '100%')
      svg.removeAttribute('height')
      ;(svg as any).style.width = '100%'
      ;(svg as any).style.height = 'auto'
      ;(svg as any).style.display = 'block'
    } catch {}
  }, [previewSvg])

  const templateOptions = useMemo(() => {
    return templates.map((t) => ({
      value: `${t.templateKey}@@${t.version}`,
      label: `${t.label} (v${t.version})`,
    }))
  }, [templates])

  const editorFields = useMemo(() => {
    const d = selectedTemplate?.descriptor
    if (!d) return []
    if (isDescriptorV2(d)) {
      return Object.entries(d.params || {})
        .filter(([, p]) => p && p.type === 'text')
        .map(([id, p]) => ({ id, label: String(p.label || id), type: 'text' as const, maxLength: p.maxLength }))
    }
    return (d as any).fields || []
  }, [selectedTemplate])

  const editorColors = useMemo(() => {
    const d = selectedTemplate?.descriptor
    if (!d) return []
    if (isDescriptorV2(d)) {
      return Object.entries(d.params || {})
        .filter(([, p]) => p && p.type === 'color')
        .map(([id, p]) => ({ id, label: String(p.label || id) }))
    }
    return (d as any).colors || []
  }, [selectedTemplate])

  if (loadingMe) return <div style={{ color: '#bbb', padding: 16 }}>Loading…</div>
  if (!me?.userId) {
    return (
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 80px', color: '#fff' }}>
        <h1 style={{ margin: 0, fontSize: 28 }}>Lower Thirds</h1>
        <div style={{ marginTop: 8, color: '#bbb' }}>Please log in to manage lower third presets.</div>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px 80px' }}>
      <header style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Lower Third Presets</h1>
          <div style={{ marginTop: 4, color: '#aaa' }}>System templates + your saved configurations with live preview.</div>
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
            New preset
          </button>
          <a
            href={backHref}
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
            Back
          </a>
        </div>
      </header>

      {templateError ? <div style={{ color: '#ff9b9b', marginBottom: 12 }}>{templateError}</div> : null}
      {configError ? <div style={{ color: '#ff9b9b', marginBottom: 12 }}>{configError}</div> : null}
      {saveError ? <div style={{ color: '#ff9b9b', marginBottom: 12 }}>{saveError}</div> : null}

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <aside style={{ flex: '1 1 320px', minWidth: 280 }}>
          <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#070707', overflow: 'hidden' }}>
            <div style={{ padding: '12px 12px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ fontWeight: 800 }}>Your presets</div>
              <button
                type="button"
                onClick={() => void loadConfigs()}
                disabled={loadingConfigs}
                style={{
                  background: 'transparent',
                  color: '#9cf',
                  border: '1px solid rgba(153,204,255,0.25)',
                  borderRadius: 10,
                  padding: '6px 10px',
                  fontWeight: 700,
                  cursor: loadingConfigs ? 'default' : 'pointer',
                  opacity: loadingConfigs ? 0.6 : 1,
                }}
              >
                {loadingConfigs ? 'Refreshing…' : 'Refresh'}
              </button>
            </div>

            {loadingConfigs ? (
              <div style={{ padding: 12, color: '#888' }}>Loading…</div>
            ) : configs.length === 0 ? (
              <div style={{ padding: 12, color: '#bbb' }}>No presets yet. Click “New preset” to create your first one.</div>
            ) : (
              <div>
                {configs.map((c) => {
                  const active = selectedId === c.id
                  const busy = !!actionBusy[c.id]
                  const tpl = templates.find((t) => t.templateKey === c.templateKey && t.version === c.templateVersion) || null
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
	                          <div style={{ marginTop: 6, color: '#bbb', fontSize: 12 }}>
	                          {tpl ? `${tpl.label} (v${tpl.version})` : `${c.templateKey} v${c.templateVersion}`}
	                          </div>
	                          <div style={{ marginTop: 4, color: '#8f8f8f', fontSize: 12 }}>
	                            {c.timingRule === 'entire' ? 'Till end' : `First ${c.timingSeconds ?? 10}s`}
	                          </div>
	                        </button>
                      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void onArchive(c.id)}
                          style={{
                            background: 'transparent',
                            color: '#ffb4b4',
                            border: '1px solid rgba(255,180,180,0.25)',
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

        <section style={{ flex: '2 1 520px', minWidth: 320 }}>
          <div style={{ borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#070707', padding: 14 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ fontWeight: 850 }}>{selectedId === 'new' ? 'New preset' : 'Edit preset'}</div>
              <button
                type="button"
                onClick={onSave}
                disabled={saving || !draft.templateKey || !draft.name.trim()}
                style={{
                  background: saving ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.10)',
                  color: '#fff',
                  border: '1px solid rgba(255,255,255,0.14)',
                  borderRadius: 10,
                  padding: '8px 12px',
                  fontWeight: 800,
                  cursor: saving ? 'default' : 'pointer',
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>

            <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#bbb', fontWeight: 800 }}>Name</div>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="My lower third"
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    color: '#fff',
                    outline: 'none',
                  }}
                />
              </label>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#bbb', fontWeight: 800 }}>Template</div>
                <select
                  value={`${draft.templateKey}@@${draft.templateVersion}`}
                  disabled={loadingTemplates || templateOptions.length === 0}
                  onChange={(e) => {
                    const [key, ver] = String(e.target.value).split('@@')
                    onChangeTemplate(key, Number(ver))
                  }}
                  style={{
                    width: '100%',
                    background: 'rgba(255,255,255,0.06)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: 10,
                    padding: '10px 12px',
                    color: '#fff',
                    outline: 'none',
                  }}
                >
                  {templateOptions.length === 0 ? <option value="">No templates available</option> : null}
                  {templateOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'grid', gap: 6 }}>
                <div style={{ fontSize: 12, color: '#bbb', fontWeight: 800 }}>Timing</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select
                    value={draft.timingRule}
                    onChange={(e) => {
                      const next = String(e.target.value) as 'first_only' | 'entire'
                      setDraft((prev) => ({
                        ...prev,
                        timingRule: next,
                        timingSeconds: next === 'entire' ? null : prev.timingSeconds == null ? 10 : prev.timingSeconds,
                      }))
                    }}
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: 10,
                      padding: '10px 12px',
                      color: '#fff',
                      outline: 'none',
                    }}
                  >
                    <option value="first_only">First N seconds</option>
                    <option value="entire">Till end</option>
                  </select>

                  {draft.timingRule === 'first_only' ? (
                    <select
                      value={String(draft.timingSeconds ?? 10)}
                      onChange={(e) => {
                        const v = Number(e.target.value)
                        setDraft((prev) => ({ ...prev, timingSeconds: Number.isFinite(v) ? v : 10 }))
                      }}
                      style={{
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: 10,
                        padding: '10px 12px',
                        color: '#fff',
                        outline: 'none',
                      }}
                    >
                      <option value="5">5 seconds</option>
                      <option value="10">10 seconds</option>
                      <option value="15">15 seconds</option>
                      <option value="20">20 seconds</option>
                    </select>
                  ) : null}
                </div>
              </div>

              {selectedTemplate ? (
                <div style={{ display: 'grid', gap: 12, marginTop: 6 }}>
                  {editorFields.length ? (
                    <div>
                      <div style={{ fontSize: 12, color: '#bbb', fontWeight: 900, marginBottom: 8 }}>Text</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {editorFields.map((f) => (
                          <label key={f.id} style={{ display: 'grid', gap: 6 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                              <div style={{ fontSize: 12, color: '#ddd', fontWeight: 800 }}>{f.label}</div>
                              {f.maxLength ? <div style={{ fontSize: 12, color: '#888' }}>max {f.maxLength}</div> : null}
                            </div>
                            <input
                              value={draft.params[f.id] ?? ''}
                              maxLength={f.maxLength}
                              onChange={(e) => {
                                const v = e.target.value
                                setDraft((prev) => ({ ...prev, params: { ...prev.params, [f.id]: v } }))
                              }}
                              style={{
                                width: '100%',
                                background: 'rgba(255,255,255,0.06)',
                                border: '1px solid rgba(255,255,255,0.12)',
                                borderRadius: 10,
                                padding: '10px 12px',
                                color: '#fff',
                                outline: 'none',
                              }}
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {editorColors.length ? (
                    <div>
                      <div style={{ fontSize: 12, color: '#bbb', fontWeight: 900, marginBottom: 8 }}>Colors</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                        {editorColors.map((c) => (
                          <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                            <div style={{ fontSize: 12, color: '#ddd', fontWeight: 800 }}>{c.label}</div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <input
                                type="color"
                                value={draft.params[c.id] ?? '#000000'}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setDraft((prev) => ({ ...prev, params: { ...prev.params, [c.id]: v } }))
                                }}
                                style={{ width: 46, height: 30, background: 'transparent', border: 'none', padding: 0 }}
                              />
                              <input
                                value={draft.params[c.id] ?? '#000000'}
                                onChange={(e) => {
                                  const v = e.target.value
                                  setDraft((prev) => ({ ...prev, params: { ...prev.params, [c.id]: v } }))
                                }}
                                style={{
                                  width: 110,
                                  background: 'rgba(255,255,255,0.06)',
                                  border: '1px solid rgba(255,255,255,0.12)',
                                  borderRadius: 10,
                                  padding: '8px 10px',
                                  color: '#fff',
                                  outline: 'none',
                                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                }}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div style={{ marginTop: 10, color: '#bbb' }}>No template selected.</div>
              )}
            </div>
          </div>

          <div style={{ marginTop: 16, borderRadius: 14, border: '1px solid rgba(255,255,255,0.10)', background: '#070707', padding: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#bbb', marginBottom: 10 }}>Preview</div>
            {previewError ? <div style={{ color: '#ff9b9b', marginBottom: 10 }}>{previewError}</div> : null}
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
              <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, pointerEvents: 'none' }} ref={previewRef}>
                {previewSvg ? (
                  <div style={{ width: '100%', height: '100%' }} dangerouslySetInnerHTML={{ __html: previewSvg }} />
                ) : (
                  <div style={{ height: '100%', display: 'grid', placeItems: 'center', color: '#888', fontSize: 13 }}>
                    {loadingTemplates ? 'Loading templates…' : 'Preview will appear here'}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
