import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type MeResponse = {
  userId: number | null
  email: string | null
  displayName: string | null
}

type InsetPreset = 'small' | 'medium' | 'large'
type ScreenTitleStyle = 'none' | 'pill' | 'strip'
type ScreenTitleFontKey = string
type ScreenTitleAlignment = 'left' | 'center' | 'right'
type ScreenTitlePosition = 'top' | 'middle' | 'bottom'
type ScreenTitleTimingRule = 'entire' | 'first_only'
type ScreenTitleFade = 'none' | 'in' | 'out' | 'in_out'

type ScreenTitleFontFamiliesResponse = {
  families: Array<{
    familyKey: string
    label: string
    variants: Array<{ key: string; label: string }>
  }>
}

type ScreenTitleGradientsResponse = {
  gradients: Array<{
    key: string
    label: string
  }>
}

type RouteContext = {
  base: 'legacy' | 'assets'
  action: 'list' | 'new' | 'edit'
  presetId: number | null
}

type FontSizeKey = 'x_small' | 'small' | 'medium' | 'large' | 'x_large'

type ScreenTitleFontPresetsResponse = {
  schemaVersion: number
  baselineFrame?: { width: number; height: number }
  families: Record<
    string,
    {
      label: string
      sizes: Record<FontSizeKey, { fontSizePct: number; trackingPct: number; lineSpacingPct: number }>
      variants?: Record<
        string,
        { label: string; sizes?: Partial<Record<FontSizeKey, { fontSizePct: number; trackingPct: number; lineSpacingPct: number }>> }
      >
    }
  >
}

type ScreenTitlePreset = {
  id: number
  name: string
  description?: string | null
  style: ScreenTitleStyle
  fontKey: ScreenTitleFontKey
  sizeKey?: FontSizeKey
  fontSizePct: number
  trackingPct?: number
  lineSpacingPct?: number
  fontColor: string
  shadowColor?: string
  shadowOffsetPx?: number
  shadowBlurPx?: number
  shadowOpacityPct?: number
  fontGradientKey?: string | null
  outlineWidthPct?: number | null
  outlineOpacityPct?: number | null
  outlineColor?: string | null
  pillBgColor: string
  pillBgOpacityPct: number
  alignment: ScreenTitleAlignment
  position: ScreenTitlePosition
  maxWidthPct: number
  insetXPreset?: InsetPreset | null
  insetYPreset?: InsetPreset | null
  marginLeftPct?: number | null
  marginRightPct?: number | null
  marginTopPct?: number | null
  marginBottomPct?: number | null
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

const DEFAULT_FONT_FAMILIES: Array<{
  familyKey: string
  label: string
  variants: Array<{ key: ScreenTitleFontKey; label: string }>
}> = [
  {
    familyKey: 'dejavu_sans',
    label: 'DejaVu Sans',
    variants: [
      { key: 'dejavu_sans_regular', label: 'Regular' },
      { key: 'dejavu_sans_bold', label: 'Bold' },
      { key: 'dejavu_sans_italic', label: 'Italic' },
      { key: 'dejavu_sans_bold_italic', label: 'Bold Italic' },
    ],
  },
  {
    familyKey: 'caveat',
    label: 'Caveat',
    variants: [
      { key: 'caveat_regular', label: 'Regular' },
      { key: 'caveat_medium', label: 'Medium' },
      { key: 'caveat_semibold', label: 'SemiBold' },
      { key: 'caveat_bold', label: 'Bold' },
    ],
  },
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
    sizeKey: 'medium',
    fontSizePct: 4.5,
    trackingPct: 0,
    lineSpacingPct: 0,
    fontColor: '#ffffff',
    shadowColor: '#000000',
    shadowOffsetPx: 2,
    shadowBlurPx: 0,
    shadowOpacityPct: 65,
    fontGradientKey: null,
    outlineWidthPct: null,
    outlineOpacityPct: null,
    outlineColor: null,
    pillBgColor: '#000000',
    pillBgOpacityPct: 55,
    alignment: 'center',
    position: 'top',
    maxWidthPct: 90,
    insetXPreset: null,
    insetYPreset: null,
    marginLeftPct: 10,
    marginRightPct: 10,
    marginTopPct: 10,
    marginBottomPct: 10,
    timingRule: 'first_only',
    timingSeconds: 10,
    fade: 'out',
  }
}

// Margin inputs are treated as pixels at a baseline 1080px-wide frame (even for vertical),
// and converted to pct-of-width for storage/rendering so equal numeric values look
// visually comparable in X and Y.
const SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX = 1080
// iOS Safari auto-zooms focused inputs if font-size < 16px.
const FORM_CONTROL_FONT_SIZE_PX = 16

const SIZE_OPTIONS: Array<{ value: FontSizeKey; label: string }> = [
  { value: 'x_small', label: 'X-Small' },
  { value: 'small', label: 'Small' },
  { value: 'medium', label: 'Medium' },
  { value: 'large', label: 'Large' },
  { value: 'x_large', label: 'X-Large' },
]

function positionLabel(p: ScreenTitlePosition): string {
  if (p === 'top') return 'Top'
  if (p === 'middle') return 'Middle'
  return 'Bottom'
}

function styleLabel(s: any): string {
  const v = String(s || '').toLowerCase()
  if (v === 'none' || v === 'outline') return 'None'
  if (v === 'pill') return 'Pill'
  if (v === 'strip') return 'Strip'
  return 'None'
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

function parseEditPresetId(): number | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('editPresetId') || params.get('edit') || '').trim()
    if (!raw) return null
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function parseOpenNew(): boolean {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('new') || params.get('create') || '').trim().toLowerCase()
    return raw === '1' || raw === 'true' || raw === 'yes'
  } catch {
    return false
  }
}

function parseReturnMode(): 'picker' | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('return') || '').trim().toLowerCase()
    return raw === 'picker' ? 'picker' : null
  } catch {
    return null
  }
}

function parseReturnHref(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('return') || '').trim()
    if (!raw) return null
    if (raw.trim().toLowerCase() === 'picker') return null
    const u = new URL(raw, window.location.origin)
    if (!u.pathname.startsWith('/')) return null
    return u.pathname + (u.search ? u.search : '') + (u.hash ? u.hash : '')
  } catch {
    return null
  }
}

function parseRouteContext(): RouteContext {
  const p = String(window.location.pathname || '').replace(/\/+$/, '')
  if (p === '/assets/screen-titles' || p.startsWith('/assets/screen-titles/')) {
    const rest = p.slice('/assets/screen-titles'.length).split('/').filter(Boolean)
    if (rest[0] === 'new') return { base: 'assets', action: 'new', presetId: null }
    if (rest.length >= 2 && rest[1] === 'edit') {
      const n = Number(rest[0])
      return { base: 'assets', action: 'edit', presetId: Number.isFinite(n) && n > 0 ? n : null }
    }
    return { base: 'assets', action: 'list', presetId: null }
  }
  return { base: 'legacy', action: 'list', presetId: null }
}

function buildBackToPickerHrefWithRefresh(
  returnMode: 'picker' | null,
  refreshPresetId?: number | null
): string | null {
  if (returnMode !== 'picker') return null
  const id = refreshPresetId == null ? NaN : Number(refreshPresetId)
  const refresh = Number.isFinite(id) && id > 0 ? id : null
  try {
    const url = new URL('/create-video', window.location.origin)
    url.searchParams.set('cvOpenAdd', 'screenTitle')
    if (refresh != null) url.searchParams.set('cvRefreshScreenTitlePresetId', String(refresh))
    return `${url.pathname}${url.search}${url.hash || ''}`
  } catch {
    return refresh != null
      ? `/create-video?cvOpenAdd=screenTitle&cvRefreshScreenTitlePresetId=${encodeURIComponent(String(refresh))}`
      : '/create-video?cvOpenAdd=screenTitle'
  }
}

export default function ScreenTitlePresetsPage() {
  const routeCtx = useMemo(() => parseRouteContext(), [])
  const fromHref = useMemo(() => parseFromHref(), [])
  const editPresetId = useMemo(() => parseEditPresetId(), [])
  const openNewParam = useMemo(() => parseOpenNew(), [])
  const returnMode = useMemo(() => parseReturnMode(), [])
  const returnHref = useMemo(() => parseReturnHref(), [])
  const effectiveEditPresetId = useMemo(() => (routeCtx.base === 'assets' ? routeCtx.presetId : editPresetId), [editPresetId, routeCtx.base, routeCtx.presetId])
  const effectiveOpenNew = useMemo(() => (routeCtx.base === 'assets' ? routeCtx.action === 'new' : openNewParam), [openNewParam, routeCtx.action, routeCtx.base])
  const assetsStylesHref = useMemo(() => {
    if (routeCtx.base !== 'assets') return null
    if (!returnHref) return '/assets/screen-titles'
    try {
      const url = new URL('/assets/screen-titles', window.location.origin)
      url.searchParams.set('return', returnHref)
      return url.pathname + url.search
    } catch {
      return `/assets/screen-titles?return=${encodeURIComponent(returnHref)}`
    }
  }, [returnHref, routeCtx.base])
  const backHref = routeCtx.base === 'assets' ? (assetsStylesHref || '/assets/screen-titles') : (fromHref || '/uploads')
  const backLabel =
    routeCtx.base === 'assets'
      ? '← Styles'
      : fromHref?.startsWith('/create-video') && fromHref.includes('cvScreenTitleId=') ? '← Screen Titles Properties'
        : fromHref?.startsWith('/create-video') ? '← Back to Create Video'
          : fromHref?.startsWith('/produce') ? '← Back to Produce'
            : '← Back'

  const [me, setMe] = useState<MeResponse | null>(null)
  const [presets, setPresets] = useState<ScreenTitlePreset[]>([])
  const [fontFamilies, setFontFamilies] = useState(DEFAULT_FONT_FAMILIES)
  const [fontPresets, setFontPresets] = useState<ScreenTitleFontPresetsResponse | null>(null)
  const [gradients, setGradients] = useState<Array<{ key: string; label: string }>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<'list' | 'edit'>('list')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [draft, setDraft] = useState(defaultDraft)
  const lastNonNoneOutlineRef = useRef<{
    outlineWidthPct: number | null
    outlineOpacityPct: number | null
    outlineColor: string | null
  }>({ outlineWidthPct: null, outlineOpacityPct: null, outlineColor: null })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [cloningId, setCloningId] = useState<number | null>(null)
  const handledDeepLinkRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const user = await ensureLoggedIn()
      if (cancelled) return
      setMe(user)
    })()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (routeCtx.base !== 'legacy') return
    try {
      // Debug-only route: we want this to be obvious in local testing.
      // eslint-disable-next-line no-console
      console.warn('[legacy] visited /screen-title-presets; use /assets/screen-titles instead')
    } catch {}
  }, [routeCtx.base])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [presetsRes, fontsRes, gradientsRes, fontPresetsRes] = await Promise.all([
        fetch('/api/screen-title-presets', { credentials: 'same-origin' }),
        fetch('/api/screen-title-fonts', { credentials: 'same-origin' }),
        fetch('/api/screen-title-gradients', { credentials: 'same-origin' }),
        fetch('/api/screen-title-font-presets', { credentials: 'same-origin' }),
      ])
      if (!presetsRes.ok) throw new Error('failed_to_load')
      const presetsData = await presetsRes.json()
      const items: ScreenTitlePreset[] = Array.isArray(presetsData) ? presetsData : []
      setPresets(items)

      if (fontsRes.ok) {
        const fontsData = (await fontsRes.json().catch(() => null)) as ScreenTitleFontFamiliesResponse | null
        const fams = Array.isArray(fontsData?.families) ? fontsData!.families : null
        if (fams && fams.length) {
          setFontFamilies(
            fams.map((f) => ({
              familyKey: String(f.familyKey || ''),
              label: String(f.label || ''),
              variants: Array.isArray(f.variants) ? f.variants.map((v) => ({ key: String(v.key || ''), label: String(v.label || '') })) : [],
            }))
          )
        }
      }

      if (gradientsRes.ok) {
        const data = (await gradientsRes.json().catch(() => null)) as ScreenTitleGradientsResponse | null
        const list = Array.isArray(data?.gradients) ? data!.gradients : []
        setGradients(
          list
            .map((g) => ({ key: String(g.key || ''), label: String(g.label || '') }))
            .filter((g) => g.key)
        )
      } else {
        setGradients([])
      }

      if (fontPresetsRes.ok) {
        const data = (await fontPresetsRes.json().catch(() => null)) as ScreenTitleFontPresetsResponse | null
        if (data && typeof data === 'object' && data.families && typeof data.families === 'object') {
          setFontPresets(data)
        }
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load presets')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!me?.userId) return
    void load()
  }, [me?.userId, load])

  const selected = useMemo(() => {
    if (selectedId == null) return null
    return presets.find((p) => p.id === selectedId) || null
  }, [presets, selectedId])
  const activePresets = useMemo(() => presets.filter((p) => !p.archivedAt), [presets])

  const openNew = useCallback(() => {
    setSelectedId(null)
    setDraft(defaultDraft())
    setSaveError(null)
    setView('edit')
  }, [])

  const openEdit = useCallback((preset: ScreenTitlePreset) => {
    const presetInsetToMargin = (raw: any) => {
      const s = String(raw || '').trim().toLowerCase()
      if (s === 'small') return 6
      if (s === 'large') return 14
      return 10
    }
    const deriveMargin = (value: any, fallback: number) => {
      const n = value == null ? NaN : Number(value)
      return Number.isFinite(n) ? n : fallback
    }
    setSelectedId(preset.id)
    setDraft({
      name: preset.name,
      description: preset.description ?? null,
      style: (preset.style === ('outline' as any) ? ('none' as any) : preset.style),
      fontKey: preset.fontKey,
      sizeKey: (preset as any).sizeKey || 'medium',
      fontSizePct: preset.fontSizePct ?? 4.5,
      trackingPct: preset.trackingPct ?? 0,
      lineSpacingPct: Number.isFinite(Number((preset as any).lineSpacingPct)) ? Number((preset as any).lineSpacingPct) : 0,
      fontColor: preset.fontColor || '#ffffff',
      shadowColor: (preset as any).shadowColor || '#000000',
      shadowOffsetPx: Number.isFinite(Number((preset as any).shadowOffsetPx)) ? Number((preset as any).shadowOffsetPx) : 2,
      shadowBlurPx: Number.isFinite(Number((preset as any).shadowBlurPx)) ? Number((preset as any).shadowBlurPx) : 0,
      shadowOpacityPct: Number.isFinite(Number((preset as any).shadowOpacityPct)) ? Number((preset as any).shadowOpacityPct) : 65,
      fontGradientKey: preset.fontGradientKey ?? null,
      outlineWidthPct: preset.outlineWidthPct ?? null,
      outlineOpacityPct: preset.outlineOpacityPct ?? null,
      outlineColor: preset.outlineColor ?? null,
      pillBgColor: preset.pillBgColor || '#000000',
      pillBgOpacityPct: preset.pillBgOpacityPct ?? 55,
      alignment: preset.alignment ?? 'center',
      position: preset.position,
      maxWidthPct: preset.maxWidthPct,
      insetXPreset: preset.insetXPreset ?? null,
      insetYPreset: preset.insetYPreset ?? null,
      marginLeftPct: deriveMargin((preset as any).marginLeftPct, presetInsetToMargin(preset.insetXPreset)),
      marginRightPct: deriveMargin((preset as any).marginRightPct, presetInsetToMargin(preset.insetXPreset)),
      marginTopPct: deriveMargin((preset as any).marginTopPct, presetInsetToMargin(preset.insetYPreset)),
      marginBottomPct: deriveMargin((preset as any).marginBottomPct, presetInsetToMargin(preset.insetYPreset)),
      timingRule: preset.timingRule,
      timingSeconds: preset.timingSeconds ?? null,
      fade: preset.fade,
    })
    setSaveError(null)
    setView('edit')
  }, [])

  const closeEdit = useCallback(() => {
    setView('list')
    setSelectedId(null)
    setDraft(defaultDraft())
    setSaveError(null)
    setDeletingId(null)
    setCloningId(null)
    setSaving(false)
  }, [])

  const selectedFontFamily = useMemo(() => {
    const currentKey = String(draft.fontKey || '').trim()
    for (const fam of fontFamilies) {
      if (fam.variants.some((v) => String(v.key) === currentKey)) return fam
    }
    return fontFamilies[0] || DEFAULT_FONT_FAMILIES[0]
  }, [draft.fontKey, fontFamilies])

  const resolveFamilyKeyForFontKey = useCallback((fontKey: string): string | null => {
    const k = String(fontKey || '').trim()
    if (!k) return null
    for (const fam of fontFamilies) {
      if (fam.variants.some((v) => String(v.key) === k)) return String(fam.familyKey)
    }
    return null
  }, [fontFamilies])

  const applySizePreset = useCallback(
    (next: { familyKey: string | null; fontKey: string; sizeKey: FontSizeKey }) => {
      setDraft((d) => {
        const baseUpdate: any = { ...d, sizeKey: next.sizeKey }
        if (!fontPresets?.families) return baseUpdate
        const famKey = String(next.familyKey || '').trim()
        const fam = famKey ? (fontPresets.families as any)[famKey] : null
        if (!fam?.sizes) return baseUpdate
        const base = fam.sizes[next.sizeKey]
        if (!base) return baseUpdate
        const v =
          fam.variants && (fam.variants as any)[String(next.fontKey)] ? (fam.variants as any)[String(next.fontKey)] : null
        const ov = v?.sizes && v.sizes[next.sizeKey] ? v.sizes[next.sizeKey] : null
        const resolved = { ...base, ...(ov || {}) }
        return {
          ...baseUpdate,
          fontSizePct: Number(resolved.fontSizePct),
          trackingPct: Number(resolved.trackingPct),
          lineSpacingPct: Number(resolved.lineSpacingPct),
        }
      })
    },
    [fontPresets]
  )

  const save = useCallback(async () => {
    if (!me?.userId) return
    setSaving(true)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const body = JSON.stringify(draft)
      let createdId: number | null = null
      if (selectedId == null) {
        const res = await fetch('/api/screen-title-presets', { method: 'POST', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to create')
        const n = Number(data?.preset?.id || data?.id || 0)
        if (Number.isFinite(n) && n > 0) {
          createdId = n
          setSelectedId(n)
        }
      } else {
        const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(selectedId))}`, { method: 'PATCH', credentials: 'same-origin', headers, body })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data?.error || 'Failed to save')
      }
      await load()
      const refreshId = selectedId != null ? Number(selectedId) : createdId
      if (routeCtx.base === 'assets') {
        if (returnHref) {
          const id = refreshId != null && Number.isFinite(Number(refreshId)) && Number(refreshId) > 0 ? Number(refreshId) : null
          if (id != null) {
            try {
              const url = new URL(returnHref, window.location.origin)
              url.searchParams.delete('cvScreenTitleId')
              url.searchParams.set('cvRefreshScreenTitlePresetId', String(id))
              window.location.href = `${url.pathname}${url.search}${url.hash || ''}`
              return
            } catch {
              window.location.href = returnHref
              return
            }
          }
          window.location.href = returnHref
          return
        }
        window.location.href = assetsStylesHref || '/assets/screen-titles'
        return
      }
      const href = buildBackToPickerHrefWithRefresh(returnMode, refreshId)
      if (href) {
        window.location.href = href
        return
      }
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [assetsStylesHref, load, me?.userId, draft, returnHref, returnMode, routeCtx.base, selectedId])

  const deletePreset = useCallback(async (id: number) => {
    if (!id) return
    setDeletingId(id)
    setSaveError(null)
    try {
      const headers: Record<string, string> = {}
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(id))}`, { method: 'DELETE', credentials: 'same-origin', headers })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to archive')
      await load()
      if (selectedId === id) closeEdit()
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to archive')
    } finally {
      setDeletingId(null)
    }
  }, [load, selectedId, closeEdit])

  const clonePreset = useCallback(async (preset: ScreenTitlePreset) => {
    setCloningId(preset.id)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const cloneName = `${preset.name} (copy)`
      const body = JSON.stringify({
        name: cloneName,
        description: preset.description ?? null,
        style: (preset.style === ('outline' as any) ? ('none' as any) : preset.style),
        fontKey: preset.fontKey,
        sizeKey: (preset as any).sizeKey || 'medium',
        fontSizePct: preset.fontSizePct,
        trackingPct: preset.trackingPct ?? 0,
        lineSpacingPct: Number.isFinite(Number((preset as any).lineSpacingPct)) ? Number((preset as any).lineSpacingPct) : 0,
        fontColor: preset.fontColor,
        shadowColor: (preset as any).shadowColor || '#000000',
        shadowOffsetPx: Number.isFinite(Number((preset as any).shadowOffsetPx)) ? Number((preset as any).shadowOffsetPx) : 2,
        shadowBlurPx: Number.isFinite(Number((preset as any).shadowBlurPx)) ? Number((preset as any).shadowBlurPx) : 0,
        shadowOpacityPct: Number.isFinite(Number((preset as any).shadowOpacityPct)) ? Number((preset as any).shadowOpacityPct) : 65,
        fontGradientKey: preset.fontGradientKey ?? null,
        outlineWidthPct: preset.outlineWidthPct ?? null,
        outlineOpacityPct: preset.outlineOpacityPct ?? null,
        outlineColor: preset.outlineColor ?? null,
        marginLeftPct: (preset as any).marginLeftPct ?? null,
        marginRightPct: (preset as any).marginRightPct ?? null,
        marginTopPct: (preset as any).marginTopPct ?? null,
        marginBottomPct: (preset as any).marginBottomPct ?? null,
        pillBgColor: preset.pillBgColor,
        pillBgOpacityPct: preset.pillBgOpacityPct,
        alignment: preset.alignment ?? 'center',
        position: preset.position,
        maxWidthPct: preset.maxWidthPct,
        insetXPreset: preset.insetXPreset ?? null,
        insetYPreset: preset.insetYPreset ?? null,
        timingRule: preset.timingRule,
        timingSeconds: preset.timingSeconds ?? null,
        fade: preset.fade,
      })

      const res = await fetch('/api/screen-title-presets', { method: 'POST', credentials: 'same-origin', headers, body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to clone')
      await load()
      if (data?.preset) openEdit(data.preset as ScreenTitlePreset)
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to clone')
    } finally {
      setCloningId(null)
    }
  }, [load, openEdit])

  useEffect(() => {
    if (handledDeepLinkRef.current) return
    if (effectiveEditPresetId != null) return
    if (!effectiveOpenNew) return
    handledDeepLinkRef.current = true
    openNew()
  }, [effectiveEditPresetId, effectiveOpenNew, openNew])

  useEffect(() => {
    if (handledDeepLinkRef.current) return
    if (effectiveEditPresetId == null) return
    if (!presets.length) return
    const p = presets.find((x) => Number(x.id) === Number(effectiveEditPresetId)) || null
    if (!p) return
    handledDeepLinkRef.current = true
    openEdit(p)
  }, [effectiveEditPresetId, openEdit, presets])

  const backToPickerHref = useMemo(() => {
    if (returnMode !== 'picker') return null
    try {
      const url = new URL('/create-video', window.location.origin)
      url.searchParams.set('cvOpenAdd', 'screenTitle')
      return `${url.pathname}${url.search}${url.hash || ''}`
    } catch {
      return '/create-video?cvOpenAdd=screenTitle'
    }
  }, [returnMode])

  const backToTimelineHref = useMemo(() => {
    const base = returnHref || fromHref
    if (!base) return null
    if (!base.startsWith('/create-video')) return null
    try {
      const url = new URL(base, window.location.origin)
      // Returning from editing a style: go back to the timeline only (no modal reopen).
      url.searchParams.delete('cvScreenTitleId')
      if (selectedId != null && Number.isFinite(Number(selectedId)) && Number(selectedId) > 0) {
        url.searchParams.set('cvRefreshScreenTitlePresetId', String(selectedId))
      }
      return `${url.pathname}${url.search}${url.hash || ''}`
    } catch {
      return base
    }
  }, [fromHref, returnHref, selectedId])

  const goBackToStyles = useCallback(() => {
    if (routeCtx.base === 'assets') {
      window.location.href = assetsStylesHref || '/assets/screen-titles'
      return
    }
    if (backToPickerHref) {
      window.location.href = backToPickerHref
      return
    }
    window.location.href = backHref
  }, [assetsStylesHref, backHref, backToPickerHref, routeCtx.base])

  const saveAndBackToTimeline = useCallback(async () => {
    if (!me?.userId) return
    if (!backToTimelineHref) return
    if (selectedId == null) {
      setSaveError('Save this style first before returning to the timeline.')
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const body = JSON.stringify(draft)
      const res = await fetch(`/api/screen-title-presets/${encodeURIComponent(String(selectedId))}`, {
        method: 'PATCH',
        credentials: 'same-origin',
        headers,
        body,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.error || 'Failed to save')
      window.location.href = backToTimelineHref
    } catch (e: any) {
      setSaveError(e?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [me?.userId, backToTimelineHref, selectedId, draft])

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
    <div
      style={{
        minHeight: '100vh',
        background: '#050505',
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        WebkitTextSizeAdjust: '100%',
      }}
    >
      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '24px 16px 80px' }}>
        {routeCtx.base === 'legacy' ? (
          <div
            style={{
              border: '1px solid rgba(255,214,10,0.65)',
              background: 'rgba(88, 20, 24, 0.95)',
              borderRadius: 14,
              padding: 12,
              marginBottom: 12,
              display: 'flex',
              justifyContent: 'space-between',
              gap: 12,
              alignItems: 'center',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontWeight: 900, color: '#ffd60a' }}>Legacy debug route</div>
            <a href="/assets/screen-titles" style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 900 }}>
              Open `/assets/screen-titles`
            </a>
          </div>
        ) : null}
        {view !== 'edit' ? (
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>{backLabel}</a>
        ) : null}
        <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginTop: 10 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>Screen Title Styles</h1>
            {view === 'edit' ? (
              <p style={{ margin: '6px 0 0', color: '#a0a0a0' }}>
                Currently editing: {String(draft?.name || '').trim() || 'Untitled'}
              </p>
            ) : (
              <p style={{ margin: '6px 0 0', color: '#a0a0a0' }}>Create reusable styles for Screen Titles</p>
            )}
          </div>
          {view === 'list' ? (
            <button
              type="button"
              onClick={openNew}
              style={{
                padding: '10px 14px',
                borderRadius: 10,
                border: '1px solid rgba(10,132,255,0.95)',
                background: '#0a84ff',
                color: '#fff',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              New
            </button>
          ) : null}
        </header>

        {loading ? <div style={{ color: '#888', padding: '12px 0' }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', padding: '12px 0' }}>{error}</div> : null}
        {saveError ? <div style={{ color: '#ff9b9b', padding: '12px 0' }}>{saveError}</div> : null}

        {view === 'list' ? (
          <div style={{ marginTop: 14, padding: 14, borderRadius: 14, border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(0,0,0,0.35)' }}>
            <div style={{ fontWeight: 900, fontSize: 16 }}>Styles are managed from Create Video</div>
            <div style={{ marginTop: 8, color: '#bbb', lineHeight: 1.35 }}>
              Open Create Video to select, edit, clone, or delete styles. This page is used for editing a specific style.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={openNew}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(10,132,255,0.95)',
                  background: '#0a84ff',
                  color: '#fff',
                  fontWeight: 900,
                  cursor: 'pointer',
                }}
              >
                New Style
              </button>
              <a href="/create-video?cvOpenAdd=screenTitle" style={{ color: '#0a84ff', textDecoration: 'none', fontWeight: 900, alignSelf: 'center' }}>
                Go to Create Video
              </a>
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 14,
              maxWidth: 560,
              marginLeft: 'auto',
              marginRight: 'auto',
              borderRadius: 14,
              padding: 16,
              boxSizing: 'border-box',
              border: '1px solid rgba(96,165,250,0.95)',
              background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', marginBottom: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 900 }}>Edit Style</div>
              <button
                type="button"
                onClick={goBackToStyles}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.18)',
                  background: 'rgba(255,255,255,0.06)',
                  color: '#fff',
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Close
              </button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                {selectedId ? (
                  <button
                    type="button"
                    onClick={() => deletePreset(selectedId)}
                    disabled={deletingId === selectedId || saving}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,59,48,0.95)',
                      background: '#ff3b30',
                      color: '#fff',
                      fontWeight: 850,
                      cursor: deletingId === selectedId || saving ? 'default' : 'pointer',
                      opacity: deletingId === selectedId || saving ? 0.7 : 1,
                    }}
                  >
                    {deletingId === selectedId ? 'Deleting…' : 'Delete'}
                  </button>
                ) : null}
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                {backToTimelineHref ? (
                  <button
                    type="button"
                    onClick={saveAndBackToTimeline}
                    disabled={saving}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(96,165,250,0.95)',
                      background: 'rgba(96,165,250,0.14)',
                      color: '#fff',
                      fontWeight: 850,
                      cursor: saving ? 'default' : 'pointer',
                      opacity: saving ? 0.7 : 1,
                    }}
                  >
                    ← Timeline
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={save}
                  disabled={saving}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(96,165,250,0.95)',
                    background: 'rgba(96,165,250,0.14)',
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

            <div
              style={{
                marginTop: 12,
              }}
            >
              <div style={{ display: 'grid', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontWeight: 750 }}>Name</div>
                <input
                  value={draft.name}
                  onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                  style={{
                    width: '100%',
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                    fontSize: FORM_CONTROL_FONT_SIZE_PX,
                    lineHeight: '20px',
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
                    maxWidth: '100%',
                    boxSizing: 'border-box',
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.16)',
                    background: '#0c0c0c',
                    color: '#fff',
                    outline: 'none',
                    resize: 'vertical',
                    fontSize: FORM_CONTROL_FONT_SIZE_PX,
                    lineHeight: '20px',
                  }}
                />
                </label>

                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Position</div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                    {([
                      { key: 'top_left', row: 'top', col: 'left' },
                      { key: 'top_center', row: 'top', col: 'center' },
                      { key: 'top_right', row: 'top', col: 'right' },
                      { key: 'middle_left', row: 'middle', col: 'left' },
                      { key: 'middle_center', row: 'middle', col: 'center' },
                      { key: 'middle_right', row: 'middle', col: 'right' },
                      { key: 'bottom_left', row: 'bottom', col: 'left' },
                      { key: 'bottom_center', row: 'bottom', col: 'center' },
                      { key: 'bottom_right', row: 'bottom', col: 'right' },
                    ] as const).map((g) => {
                      const active = `${draft.position}_${draft.alignment}` === g.key
                      return (
                        <button
                          key={g.key}
                          type="button"
                          onClick={() => setDraft((d) => ({ ...d, position: g.row, alignment: g.col }))}
                          style={{
                            height: 34,
                            borderRadius: 8,
                            border: `1px solid ${active ? 'rgba(96,165,250,0.95)' : 'rgba(255,255,255,0.16)'}`,
                            background: active ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.06)',
                            color: '#fff',
                            fontWeight: 900,
                            cursor: 'pointer',
                          }}
                        />
                      )
                    })}
                  </div>
                </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Horizontal margin (px)</div>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={Math.round((40 / 100) * SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX)}
                    value={
                      (draft.marginLeftPct ?? draft.marginRightPct) == null
                        ? ''
                        : String(
                            Math.round(
                              (((draft.marginLeftPct ?? draft.marginRightPct) as number) / 100) * SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX,
                            ),
                          )
                    }
                    onChange={(e) => {
                      const raw = e.target.value
                      const n = raw ? Number(raw) : null
                      setDraft((d) => {
                        const px = n != null && Number.isFinite(n) ? n : null
                        const horizontalMarginPct =
                          px != null ? Math.round(((px / SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX) * 100) * 100) / 100 : null
                        const derivedMax =
                          horizontalMarginPct != null
                            ? Math.round(Math.min(Math.max(100 - horizontalMarginPct - horizontalMarginPct, 10), 100))
                            : d.maxWidthPct
                        return {
                          ...d,
                          marginLeftPct: horizontalMarginPct,
                          marginRightPct: horizontalMarginPct,
                          insetXPreset: null,
                          maxWidthPct: derivedMax,
                        }
                      })
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Vertical margin (px)</div>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={Math.round((40 / 100) * SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX)}
                    value={
                      (draft.marginTopPct ?? draft.marginBottomPct) == null
                        ? ''
                        : String(
                            Math.round(
                              (((draft.marginTopPct ?? draft.marginBottomPct) as number) / 100) * SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX,
                            ),
                          )
                    }
                    onChange={(e) => {
                      const raw = e.target.value
                      const n = raw ? Number(raw) : null
                      const px = n != null && Number.isFinite(n) ? n : null
                      const verticalMarginPct =
                        px != null ? Math.round(((px / SCREEN_TITLE_MARGIN_BASELINE_WIDTH_PX) * 100) * 100) / 100 : null
                      setDraft((d) => ({
                        ...d,
                        marginTopPct: verticalMarginPct,
                        marginBottomPct: verticalMarginPct,
                        insetYPreset: null,
                      }))
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Font family</div>
                  <select
                    value={selectedFontFamily.familyKey}
                    onChange={(e) => {
                      const familyKey = e.target.value
                      const fam = fontFamilies.find((f) => f.familyKey === familyKey) || fontFamilies[0] || DEFAULT_FONT_FAMILIES[0]
                      const nextKey = fam.variants[0]?.key || 'dejavu_sans_bold'
                      setDraft((d) => ({ ...d, fontKey: nextKey }))
                      const sizeKey = ((draft as any).sizeKey as FontSizeKey) || 'medium'
                      applySizePreset({ familyKey, fontKey: String(nextKey), sizeKey })
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  >
                    {fontFamilies.map((f) => (
                      <option key={f.familyKey} value={f.familyKey}>{f.label}</option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Variant</div>
                  <select
                    value={String(draft.fontKey || '')}
                    onChange={(e) => {
                      const nextKey = e.target.value
                      setDraft((d) => ({ ...d, fontKey: nextKey }))
                      const familyKey = resolveFamilyKeyForFontKey(nextKey)
                      const sizeKey = ((draft as any).sizeKey as FontSizeKey) || 'medium'
                      applySizePreset({ familyKey, fontKey: String(nextKey), sizeKey })
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  >
                    {selectedFontFamily.variants.map((v) => (
                      <option key={String(v.key)} value={String(v.key)}>{v.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Text size</div>
                  <select
                    value={String((draft as any).sizeKey || 'medium')}
                    onChange={(e) => {
                      const sizeKey = (e.target.value as FontSizeKey) || 'medium'
                      const familyKey = resolveFamilyKeyForFontKey(String(draft.fontKey || ''))
                      applySizePreset({ familyKey, fontKey: String(draft.fontKey || ''), sizeKey })
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  >
                    {SIZE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Font color</div>
                  <input
                    type="color"
                    value={draft.fontColor || '#ffffff'}
                    onChange={(e) => setDraft((d) => ({ ...d, fontColor: e.target.value || '#ffffff' }))}
                    style={{
                      width: '100%',
                      height: 44,
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: 0,
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Text gradient</div>
                  <select
                    value={String(draft.fontGradientKey || '')}
                    onChange={(e) => setDraft((d) => ({ ...d, fontGradientKey: e.target.value ? e.target.value : null }))}
                    style={{
                      width: '100%',
                      height: 44,
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '0 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                    }}
                  >
                    <option value="">None (solid color)</option>
                    {gradients.map((g) => (
                      <option key={g.key} value={g.key}>{g.label || g.key}</option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Shadow color</div>
                  <input
                    type="color"
                    value={draft.shadowColor || '#000000'}
                    onChange={(e) => setDraft((d) => ({ ...d, shadowColor: e.target.value || '#000000' }))}
                    style={{
                      width: '100%',
                      height: 44,
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: 0,
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Shadow offset (px)</div>
                  <input
                    type="number"
                    step="1"
                    min={-50}
                    max={50}
                    value={Number.isFinite(Number(draft.shadowOffsetPx)) ? String(draft.shadowOffsetPx) : '2'}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setDraft((d) => ({ ...d, shadowOffsetPx: Number.isFinite(n) ? n : 2 }))
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12, marginTop: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Shadow blur (px)</div>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={20}
                    value={Number.isFinite(Number(draft.shadowBlurPx)) ? String(draft.shadowBlurPx) : '0'}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setDraft((d) => ({ ...d, shadowBlurPx: Number.isFinite(n) ? n : 0 }))
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  />
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Shadow opacity (%)</div>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={100}
                    value={Number.isFinite(Number(draft.shadowOpacityPct)) ? String(draft.shadowOpacityPct) : '65'}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      setDraft((d) => ({ ...d, shadowOpacityPct: Number.isFinite(n) ? n : 65 }))
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                <div style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Outline color</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 10, alignItems: 'center' }}>
                    <select
                      value={
                        Number(draft.outlineWidthPct) === 0 || Number(draft.outlineOpacityPct) === 0
                          ? 'none'
                          : draft.outlineColor
                            ? 'custom'
                            : 'auto'
                      }
                      onChange={(e) => {
                        const mode = e.target.value
                        setDraft((d) => {
                          const wasNone = Number(d.outlineWidthPct) === 0 || Number(d.outlineOpacityPct) === 0

                          if (mode === 'none') {
                            if (!wasNone) {
                              lastNonNoneOutlineRef.current = {
                                outlineWidthPct: d.outlineWidthPct ?? null,
                                outlineOpacityPct: d.outlineOpacityPct ?? null,
                                outlineColor: d.outlineColor ?? null,
                              }
                            }
                            return { ...d, outlineWidthPct: 0, outlineOpacityPct: 0, outlineColor: null }
                          }

                          const restore = wasNone ? lastNonNoneOutlineRef.current : null
                          const nextWidthPct = restore ? restore.outlineWidthPct : d.outlineWidthPct
                          const nextOpacityPct = restore ? restore.outlineOpacityPct : d.outlineOpacityPct
                          const restoredColor = restore ? restore.outlineColor : d.outlineColor

                          if (mode === 'custom') {
                            return {
                              ...d,
                              outlineWidthPct: nextWidthPct == null ? 5 : nextWidthPct,
                              outlineOpacityPct: nextOpacityPct == null ? 85 : nextOpacityPct,
                              outlineColor: restoredColor || '#000000',
                            }
                          }

                          // auto
                          return {
                            ...d,
                            outlineWidthPct: nextWidthPct == null ? 5 : nextWidthPct,
                            outlineOpacityPct: nextOpacityPct == null ? 85 : nextOpacityPct,
                            outlineColor: null,
                          }
                        })
                      }}
                      style={{
                        width: '100%',
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                        fontSize: FORM_CONTROL_FONT_SIZE_PX,
                        lineHeight: '20px',
                      }}
                    >
                      <option value="none">None</option>
                      <option value="auto">Auto</option>
                      <option value="custom">Custom</option>
                    </select>
                    <input
                      type="color"
                      value={draft.outlineColor || '#000000'}
                      disabled={!draft.outlineColor || Number(draft.outlineWidthPct) === 0 || Number(draft.outlineOpacityPct) === 0}
                      onChange={(e) => setDraft((d) => ({ ...d, outlineColor: e.target.value || '#000000' }))}
                      style={{
                        width: 56,
                        height: 44,
                        padding: '6px 8px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        opacity: draft.outlineColor && Number(draft.outlineWidthPct) !== 0 && Number(draft.outlineOpacityPct) !== 0 ? 1 : 0.45,
                        fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      }}
                    />
                  </div>
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Outline width (%)</div>
                  <select
                    value={draft.outlineWidthPct == null ? '' : String(draft.outlineWidthPct)}
                    onChange={(e) => {
                      const raw = String(e.target.value || '').trim()
                      if (!raw) return setDraft((d) => ({ ...d, outlineWidthPct: null }))
                      const n = Number(raw)
                      setDraft((d) => ({ ...d, outlineWidthPct: Number.isFinite(n) ? n : null }))
                    }}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  >
                    <option value="">Auto</option>
                    <option value="3">X-Thin (3)</option>
                    <option value="5">Thin (5)</option>
                    <option value="10">Medium (10)</option>
                    <option value="15">Thick (15)</option>
                    <option value="20">X-Thick (20)</option>
                  </select>
                </label>

                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Outline opacity (%)</div>
                  <input
                    type="number"
                    step="1"
                    min={0}
                    max={100}
                    value={draft.outlineOpacityPct == null ? '' : String(draft.outlineOpacityPct)}
                    onChange={(e) => {
                      const raw = e.target.value
                      if (!raw) return setDraft((d) => ({ ...d, outlineOpacityPct: null }))
                      const n = Number(raw)
                      setDraft((d) => ({ ...d, outlineOpacityPct: Number.isFinite(n) ? n : null }))
                    }}
                    placeholder="Auto"
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  />
                </label>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Background</div>
                  <select
                    value={draft.style}
                    onChange={(e) => setDraft((d) => ({ ...d, style: e.target.value as any }))}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  >
                    <option value="none">None</option>
                    <option value="pill">Pill</option>
                    <option value="strip">Strip</option>
                  </select>
                </label>
              </div>

              {draft.style !== 'none' ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontWeight: 750 }}>BG Color</div>
                    <input
                      type="color"
                      value={draft.pillBgColor || '#000000'}
                      onChange={(e) => setDraft((d) => ({ ...d, pillBgColor: e.target.value || '#000000' }))}
                      style={{
                        width: '100%',
                        height: 44,
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        padding: '6px 8px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                        fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      }}
                    />
                  </label>

                  <label style={{ display: 'grid', gap: 6 }}>
                    <div style={{ color: '#bbb', fontWeight: 750 }}>BG opacity (%)</div>
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
                        maxWidth: '100%',
                        boxSizing: 'border-box',
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.16)',
                        background: '#0c0c0c',
                        color: '#fff',
                        outline: 'none',
                        fontSize: FORM_CONTROL_FONT_SIZE_PX,
                        lineHeight: '20px',
                      }}
                    />
                  </label>
                </div>
              ) : null}

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))', gap: 12 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontWeight: 750 }}>Fade</div>
                  <select
                    value={draft.fade}
                    onChange={(e) => setDraft((d) => ({ ...d, fade: e.target.value as any }))}
                    style={{
                      width: '100%',
                      maxWidth: '100%',
                      boxSizing: 'border-box',
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.16)',
                      background: '#0c0c0c',
                      color: '#fff',
                      outline: 'none',
                      fontSize: FORM_CONTROL_FONT_SIZE_PX,
                      lineHeight: '20px',
                    }}
                  >
                    <option value="none">None</option>
                    <option value="in">Fade in</option>
                    <option value="out">Fade out</option>
                    <option value="in_out">Fade in + out</option>
                  </select>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
              {backToTimelineHref ? (
                <button
                  type="button"
                  onClick={saveAndBackToTimeline}
                  disabled={saving}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(96,165,250,0.95)',
                    background: 'rgba(96,165,250,0.14)',
                    color: '#fff',
                    fontWeight: 850,
                    cursor: saving ? 'default' : 'pointer',
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  ← Timeline
                </button>
              ) : null}
              <button
                type="button"
                onClick={save}
                disabled={saving}
                style={{
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(96,165,250,0.95)',
                  background: 'rgba(96,165,250,0.14)',
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
          </div>
        )}
      </div>
    </div>
  )
}
