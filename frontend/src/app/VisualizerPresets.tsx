import React from 'react'
import './styles/card-list.css'
import { cardThemeStyle, cardThemeTokens, mergeCardThemeVars } from './styles/cardThemes'
import nebulaBgImage from './images/nebula_bg.jpg'

type VisualizerStyle = 'wave_line' | 'wave_fill' | 'spectrum_bars' | 'radial_bars'
type VisualizerScale = 'linear' | 'log'
type VisualizerGradientMode = 'vertical' | 'horizontal'
type VisualizerSpectrumMode = 'full' | 'voice'
type VisualizerBandMode = 'full' | 'band_1' | 'band_2' | 'band_3' | 'band_4'
type VisualizerPresetInstance = {
  id: string
  style: VisualizerStyle
  fgColor: string
  opacity: number
  scale: VisualizerScale
  barCount: number
  spectrumMode: VisualizerSpectrumMode
  bandMode: VisualizerBandMode
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: VisualizerGradientMode
}

type VisualizerPreset = {
  id: number
  name: string
  description: string | null
  bgColor: string | 'transparent'
  instances: VisualizerPresetInstance[]
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

type SystemAudioItem = {
  id: number
  original_filename: string
  modified_filename: string | null
  description: string | null
  duration_seconds?: number | null
}

type RouteContext = {
  action: 'list' | 'new' | 'edit'
  presetId: number | null
}

type Mode = 'manage' | 'pick'

const DEFAULT_INSTANCE: VisualizerPresetInstance = {
  id: 'instance_1',
  style: 'wave_line',
  fgColor: '#d4af37',
  opacity: 1,
  scale: 'linear',
  barCount: 48,
  spectrumMode: 'full',
  bandMode: 'full',
  gradientEnabled: false,
  gradientStart: '#d4af37',
  gradientEnd: '#f7d774',
  gradientMode: 'vertical',
}

const DEFAULT_PRESET: Omit<VisualizerPreset, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'> = {
  name: 'Visualizer Preset',
  description: null,
  bgColor: 'transparent',
  instances: [DEFAULT_INSTANCE],
}

const nebulaShellBaseStyle: React.CSSProperties = {
  minHeight: '100vh',
  color: '#fff',
  fontFamily: 'system-ui, sans-serif',
  position: 'relative',
  background: '#050508',
}

const nebulaBackgroundLayerStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundImage: `url(${nebulaBgImage})`,
  backgroundPosition: 'center',
  backgroundRepeat: 'no-repeat',
  backgroundSize: 'cover',
  zIndex: 0,
  pointerEvents: 'none',
}

const FORM_CONTROL_FONT_SIZE_PX = 16
const MODAL_BACKDROP_STYLE: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1100,
  background: 'rgba(0,0,0,0.86)',
  overflowY: 'auto',
  WebkitOverflowScrolling: 'touch',
  padding: '64px 16px 80px',
}
const MODAL_CARD_STYLE: React.CSSProperties = {
  maxWidth: 560,
  margin: '0 auto',
  padding: 16,
  borderRadius: 14,
  border: '1px solid rgba(96,165,250,0.95)',
  background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
  boxSizing: 'border-box',
  color: '#fff',
}
const MODAL_HEADER_STYLE: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
  alignItems: 'baseline',
}
const MODAL_TITLE_STYLE: React.CSSProperties = { margin: 0, fontSize: 18, fontWeight: 900 }
const MODAL_INPUT_STYLE: React.CSSProperties = {
  width: '100%',
  maxWidth: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: '#0b0b0b',
  color: '#fff',
  fontSize: 14,
  fontWeight: 900,
}
const MODAL_TEXTAREA_STYLE: React.CSSProperties = {
  ...MODAL_INPUT_STYLE,
  minHeight: 90,
}
const MODAL_CLOSE_BUTTON_STYLE: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid rgba(255,255,255,0.18)',
  background: 'rgba(255,255,255,0.06)',
  color: '#fff',
  textDecoration: 'none',
  fontWeight: 800,
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

function parseReturnHref(): string | null {
  try {
    const params = new URLSearchParams(window.location.search)
    const raw = String(params.get('return') || '').trim()
    if (!raw) return null
    const u = new URL(raw, window.location.origin)
    if (!u.pathname.startsWith('/')) return null
    return u.pathname + (u.search ? u.search : '') + (u.hash ? u.hash : '')
  } catch {
    return null
  }
}

function parseRouteContext(): RouteContext {
  const p = String(window.location.pathname || '').replace(/\/+$/, '')
  if (p === '/assets/visualizers' || p.startsWith('/assets/visualizers/')) {
    const rest = p.slice('/assets/visualizers'.length).split('/').filter(Boolean)
    if (rest[0] === 'new') return { action: 'new', presetId: null }
    if (rest.length >= 2 && rest[1] === 'edit') {
      const n = Number(rest[0])
      return { action: 'edit', presetId: Number.isFinite(n) && n > 0 ? n : null }
    }
    return { action: 'list', presetId: null }
  }
  return { action: 'list', presetId: null }
}

function getCsrfToken(): string | null {
  try {
    const match = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/)
    return match ? decodeURIComponent(match[1]) : null
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { credentials: 'same-origin' })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(String(json?.detail || json?.error || 'Request failed'))
  return json
}

function parseBarCount(value: any): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return DEFAULT_INSTANCE.barCount
  return Math.round(Math.min(Math.max(n, 12), 128))
}

function getSpectrumRange(
  binsLength: number,
  spectrumMode: VisualizerSpectrumMode,
  bandMode: VisualizerBandMode
): { start: number; end: number } {
  const maxIdx = Math.max(1, binsLength - 1)
  let baseStart = 0
  let baseEnd = maxIdx
  if (spectrumMode === 'voice') {
    const lowIdx = Math.round(0.12 * maxIdx)
    const highIdx = Math.round(0.68 * maxIdx)
    baseStart = Math.max(0, Math.min(maxIdx, lowIdx))
    baseEnd = Math.max(baseStart + 1, Math.min(maxIdx, highIdx))
  }
  if (bandMode === 'full') return { start: baseStart, end: baseEnd }
  const bandIndex = bandMode === 'band_1' ? 0 : bandMode === 'band_2' ? 1 : bandMode === 'band_3' ? 2 : 3
  const span = Math.max(1, baseEnd - baseStart + 1)
  const step = span / 4
  const start = Math.round(baseStart + step * bandIndex)
  const end = Math.round(baseStart + step * (bandIndex + 1) - 1)
  return {
    start: Math.max(baseStart, Math.min(baseEnd, start)),
    end: Math.max(baseStart + 1, Math.min(baseEnd, end)),
  }
}

function normalizeInstance(raw: any, fallback: VisualizerPresetInstance, idx: number): VisualizerPresetInstance {
  const styleRaw = String(raw?.style || fallback.style).trim().toLowerCase()
  const style: VisualizerStyle =
    styleRaw === 'wave_fill' || styleRaw === 'spectrum_bars' || styleRaw === 'radial_bars' ? (styleRaw as any) : 'wave_line'
  const scale: VisualizerScale = String(raw?.scale || fallback.scale).trim().toLowerCase() === 'log' ? 'log' : 'linear'
  const spectrumMode: VisualizerSpectrumMode =
    String(raw?.spectrumMode || fallback.spectrumMode).trim().toLowerCase() === 'voice' ? 'voice' : 'full'
  const bandModeRaw = String(raw?.bandMode || fallback.bandMode || 'full').trim().toLowerCase()
  const bandMode: VisualizerBandMode =
    bandModeRaw === 'band_1' || bandModeRaw === 'band_2' || bandModeRaw === 'band_3' || bandModeRaw === 'band_4'
      ? (bandModeRaw as VisualizerBandMode)
      : 'full'
  const gradientMode: VisualizerGradientMode =
    String(raw?.gradientMode || fallback.gradientMode).trim().toLowerCase() === 'horizontal' ? 'horizontal' : 'vertical'
  return {
    id: String(raw?.id || fallback.id || `instance_${idx + 1}`).trim() || `instance_${idx + 1}`,
    style,
    fgColor: String(raw?.fgColor || fallback.fgColor || '#d4af37'),
    opacity: Number.isFinite(Number(raw?.opacity)) ? Math.max(0, Math.min(1, Number(raw.opacity))) : fallback.opacity,
    scale,
    barCount: parseBarCount(raw?.barCount),
    spectrumMode,
    bandMode,
    gradientEnabled: raw?.gradientEnabled == null ? Boolean(fallback.gradientEnabled) : raw?.gradientEnabled === true,
    gradientStart: String(raw?.gradientStart || fallback.gradientStart || '#d4af37'),
    gradientEnd: String(raw?.gradientEnd || fallback.gradientEnd || '#f7d774'),
    gradientMode,
  }
}

function normalizeInstances(raw: any): VisualizerPresetInstance[] {
  const list = Array.isArray(raw) ? raw : []
  const out: VisualizerPresetInstance[] = []
  for (let idx = 0; idx < Math.min(8, list.length); idx++) {
    const fallback = idx > 0 ? out[idx - 1] : DEFAULT_INSTANCE
    out.push(normalizeInstance(list[idx], fallback, idx))
  }
  if (out.length) return out
  return [{ ...DEFAULT_INSTANCE }]
}

function normalizePresetDraft(raw: any): Omit<VisualizerPreset, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'> {
  const instances = normalizeInstances(raw?.instances)
  return {
    name: String(raw?.name || DEFAULT_PRESET.name),
    description: raw?.description == null ? null : String(raw.description),
    bgColor: raw?.bgColor === 'transparent' ? 'transparent' : String(raw?.bgColor || 'transparent'),
    instances,
  }
}

function VisualizerPreview({
  config,
  audioEl,
  active,
}: {
  config: Omit<VisualizerPreset, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'>
  audioEl: HTMLAudioElement | null
  active: boolean
}) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const rafRef = React.useRef<number | null>(null)
  const audioCtxRef = React.useRef<AudioContext | null>(null)
  const sourceNodeRef = React.useRef<MediaElementAudioSourceNode | null>(null)
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const timeDataRef = React.useRef<Uint8Array | null>(null)
  const freqDataRef = React.useRef<Uint8Array | null>(null)

  React.useEffect(() => {
    if (!audioEl) return
    try {
      if (!audioEl.crossOrigin) audioEl.crossOrigin = 'anonymous'
    } catch {}
    try {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx()
      const ctx = audioCtxRef.current
      if (!ctx) return
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {})
      }
      if (!sourceNodeRef.current) {
        sourceNodeRef.current = ctx.createMediaElementSource(audioEl)
      }
      if (!analyserRef.current) {
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 2048
        analyser.smoothingTimeConstant = 0.72
        sourceNodeRef.current.connect(analyser)
        analyser.connect(ctx.destination)
        analyserRef.current = analyser
      }
    } catch {
      analyserRef.current = null
      timeDataRef.current = null
      freqDataRef.current = null
    }
  }, [audioEl])

  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const drawFrame = (ts: number) => {
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const w = Math.max(1, Math.round(rect.width))
      const h = Math.max(1, Math.round(rect.height))
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr)
        canvas.height = Math.round(h * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)

      const t = (ts || 0) / 1000
      const analyser = analyserRef.current
      const analyserReady = Boolean(analyser && active && audioEl && !audioEl.paused)
      if (analyserReady && analyser) {
        if (!timeDataRef.current || timeDataRef.current.length !== analyser.fftSize) {
          timeDataRef.current = new Uint8Array(analyser.fftSize)
        }
        if (!freqDataRef.current || freqDataRef.current.length !== analyser.frequencyBinCount) {
          freqDataRef.current = new Uint8Array(analyser.frequencyBinCount)
        }
        analyser.getByteTimeDomainData(timeDataRef.current)
        analyser.getByteFrequencyData(freqDataRef.current)
      }

      const getSpectrumValue = (
        tNorm: number,
        scale: VisualizerScale,
        spectrumMode: VisualizerSpectrumMode,
        bandMode: VisualizerBandMode
      ) => {
        const bins = freqDataRef.current
        if (!bins || bins.length < 2) {
          const base0 = scale === 'log' ? Math.pow(Math.max(0, Math.min(1, tNorm)), 2) : Math.max(0, Math.min(1, tNorm))
          const { start, end } = getSpectrumRange(512, spectrumMode, bandMode)
          const bandNorm = start / 511 + base0 * Math.max(0.0001, (end - start) / 511)
          const base = bandNorm
          return 0.2 + 0.8 * Math.abs(Math.sin(t * 2 + base * Math.PI * 3))
        }
        const clamped = Math.max(0, Math.min(1, tNorm))
        const scaled = scale === 'log' ? Math.pow(clamped, 2) : clamped
        const { start, end } = getSpectrumRange(bins.length, spectrumMode, bandMode)
        const idx = Math.max(start, Math.min(end, Math.round(start + scaled * (end - start))))
        const v = bins[idx] / 255
        return Math.max(0.03, Math.min(1, v))
      }

      const getWaveValue = (tNorm: number, scale: VisualizerScale) => {
        const samples = timeDataRef.current
        if (!samples || samples.length < 2) {
          const base = scale === 'log' ? Math.pow(Math.max(0, Math.min(1, tNorm)), 2) : Math.max(0, Math.min(1, tNorm))
          const wobble = Math.sin(t * 2 + base * Math.PI * 4)
          const wobble2 = Math.sin(t * 3 + base * Math.PI * 7) * 0.45
          return wobble * 0.55 + wobble2
        }
        const idx = Math.max(0, Math.min(samples.length - 1, Math.round(Math.max(0, Math.min(1, tNorm)) * (samples.length - 1))))
        return (samples[idx] - 128) / 128
      }

      if (config.bgColor && config.bgColor !== 'transparent') {
        ctx.fillStyle = config.bgColor
        ctx.fillRect(0, 0, w, h)
      }
      const instances = Array.isArray(config.instances) && config.instances.length ? config.instances : [DEFAULT_INSTANCE]
      for (const instRaw of instances) {
        const inst = normalizeInstance(instRaw, DEFAULT_INSTANCE, 0)
        const fg = inst.fgColor || '#d4af37'
        const gradientOn = inst.gradientEnabled && inst.gradientStart && inst.gradientEnd
        const grad =
          gradientOn && w > 0 && h > 0
            ? (() => {
                const isHorizontal = inst.gradientMode === 'horizontal'
                const g = ctx.createLinearGradient(0, 0, isHorizontal ? w : 0, isHorizontal ? 0 : h)
                g.addColorStop(0, String(inst.gradientStart || fg))
                g.addColorStop(1, String(inst.gradientEnd || fg))
                return g
              })()
            : null
        ctx.globalAlpha = Number.isFinite(inst.opacity) ? Math.max(0, Math.min(1, inst.opacity)) : 1
        ctx.strokeStyle = grad || fg
        ctx.fillStyle = grad || fg

        if (inst.style === 'radial_bars') {
          const bars = parseBarCount(inst.barCount)
          const cx = w / 2
          const cy = h / 2
          const minDim = Math.min(w, h)
          const inner = Math.max(6, minDim * 0.18)
          const maxLen = Math.max(10, minDim * 0.32)
          ctx.lineWidth = 2
          ctx.lineCap = 'round'
          ctx.beginPath()
          for (let i = 0; i < bars; i++) {
            const tt = bars <= 1 ? 0 : i / bars
            const v = getSpectrumValue(tt, inst.scale, inst.spectrumMode, inst.bandMode)
            const len = inner + v * maxLen
            const ang = tt * Math.PI * 2 - Math.PI / 2
            const x0 = cx + Math.cos(ang) * inner
            const y0 = cy + Math.sin(ang) * inner
            const x1 = cx + Math.cos(ang) * len
            const y1 = cy + Math.sin(ang) * len
            ctx.moveTo(x0, y0)
            ctx.lineTo(x1, y1)
          }
          ctx.stroke()
        } else if (inst.style === 'spectrum_bars') {
          const bars = parseBarCount(inst.barCount)
          const gap = 2
          const barW = Math.max(2, (w - gap * (bars - 1)) / bars)
          for (let i = 0; i < bars; i++) {
            const tt = bars <= 1 ? 0 : i / (bars - 1)
            const v = getSpectrumValue(tt, inst.scale, inst.spectrumMode, inst.bandMode)
            const bh = Math.max(1, Math.round(v * h))
            const x = i * (barW + gap)
            ctx.fillRect(x, h - bh, barW, bh)
          }
        } else {
          const points = 180
          const center = h / 2
          const amp = h * 0.35
          ctx.lineWidth = 2
          ctx.beginPath()
          for (let i = 0; i < points; i++) {
            const tt = points <= 1 ? 0 : i / (points - 1)
            const y = center + amp * getWaveValue(tt, inst.scale)
            const x = tt * w
            if (i === 0) ctx.moveTo(x, y)
            else ctx.lineTo(x, y)
          }
          if (inst.style === 'wave_fill') {
            ctx.lineTo(w, center)
            ctx.lineTo(0, center)
            ctx.closePath()
            ctx.fill()
          } else {
            ctx.stroke()
          }
        }
      }

      ctx.globalAlpha = 1
    }

    const draw = (ts: number) => {
      drawFrame(ts)
      if (active) rafRef.current = window.requestAnimationFrame(draw)
    }

    if (active) {
      rafRef.current = window.requestAnimationFrame(draw)
    } else {
      drawFrame(performance.now())
    }
    return () => {
      if (rafRef.current != null) {
        try { window.cancelAnimationFrame(rafRef.current) } catch {}
      }
      rafRef.current = null
    }
  }, [active, audioEl, config])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: 200,
        borderRadius: 12,
        background: 'rgba(0,0,0,0.35)',
        border: '1px solid rgba(255,255,255,0.12)',
      }}
    />
  )
}

export default function VisualizerPresetsPage() {
  const routeCtx = React.useMemo(() => parseRouteContext(), [])
  const mode = React.useMemo(() => parseMode(), [])
  const returnHref = React.useMemo(() => parseReturnHref(), [])
  const isPickMode = mode === 'pick'
  const [presets, setPresets] = React.useState<VisualizerPreset[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)
  const [formError, setFormError] = React.useState<string | null>(null)
  const [draft, setDraft] = React.useState<Omit<VisualizerPreset, 'id' | 'createdAt' | 'updatedAt' | 'archivedAt'>>(DEFAULT_PRESET)
  const [previewAudioItems, setPreviewAudioItems] = React.useState<SystemAudioItem[]>([])
  const [previewAudioLoading, setPreviewAudioLoading] = React.useState(false)
  const [previewAudioError, setPreviewAudioError] = React.useState<string | null>(null)
  const [previewAudioId, setPreviewAudioId] = React.useState<number | null>(null)
  const [previewPlaying, setPreviewPlaying] = React.useState(false)
  const [previewAudioEl, setPreviewAudioEl] = React.useState<HTMLAudioElement | null>(null)

  const sharedCardListStyle = React.useMemo(
    () =>
      cardThemeStyle(
        mergeCardThemeVars(cardThemeTokens.base, cardThemeTokens.assetsGlass, {
          '--card-list-gap': '14px',
          '--card-bg-image': 'none',
        })
      ),
    []
  )

  React.useEffect(() => {
    if (routeCtx.action !== 'edit') return
    if (!routeCtx.presetId) return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchJson(`/api/visualizer-presets/${encodeURIComponent(String(routeCtx.presetId))}`)
        const preset = res?.preset
        if (!preset) throw new Error('Failed to load')
        setDraft(normalizePresetDraft(preset))
      } catch (e: any) {
        setError(String(e?.message || 'Failed to load'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [routeCtx.action, routeCtx.presetId])

  React.useEffect(() => {
    if (routeCtx.action !== 'list') return
    const run = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchJson('/api/visualizer-presets?limit=200')
        const raw = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : []
        const items = raw.map((preset: any) => {
          const normalized = normalizePresetDraft(preset)
          return {
            id: Number(preset?.id || 0),
            name: String(preset?.name || normalized.name),
            description: preset?.description == null ? null : String(preset.description),
            bgColor: normalized.bgColor,
            instances: normalized.instances,
            createdAt: String(preset?.createdAt || ''),
            updatedAt: String(preset?.updatedAt || ''),
            archivedAt: preset?.archivedAt == null ? null : String(preset.archivedAt),
          } as VisualizerPreset
        })
        setPresets(items)
      } catch (e: any) {
        setError(String(e?.message || 'Failed to load'))
      } finally {
        setLoading(false)
      }
    }
    void run()
  }, [routeCtx.action])

  React.useEffect(() => {
    if (routeCtx.action === 'list') return
    let cancelled = false
    const run = async () => {
      setPreviewAudioLoading(true)
      setPreviewAudioError(null)
      try {
        const res = await fetchJson('/api/system-audio?limit=200')
        if (cancelled) return
        const items = Array.isArray(res?.items) ? (res.items as SystemAudioItem[]) : Array.isArray(res) ? (res as SystemAudioItem[]) : []
        setPreviewAudioItems(items)
        if (items.length > 0) setPreviewAudioId((prev) => (prev && items.some((x) => Number(x.id) === Number(prev)) ? prev : Number(items[0].id)))
      } catch (e: any) {
        if (cancelled) return
        setPreviewAudioError(String(e?.message || 'Failed to load audio sources'))
      } finally {
        if (!cancelled) setPreviewAudioLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [routeCtx.action])

  React.useEffect(() => {
    const el = previewAudioEl
    if (!el) return
    const onEnded = () => setPreviewPlaying(false)
    const onPause = () => setPreviewPlaying(false)
    const onPlay = () => setPreviewPlaying(true)
    el.addEventListener('ended', onEnded)
    el.addEventListener('pause', onPause)
    el.addEventListener('play', onPlay)
    return () => {
      el.removeEventListener('ended', onEnded)
      el.removeEventListener('pause', onPause)
      el.removeEventListener('play', onPlay)
    }
  }, [previewAudioEl])

  React.useEffect(() => {
    const el = previewAudioEl
    if (!el) return
    try {
      if (previewAudioId && Number.isFinite(previewAudioId) && previewAudioId > 0) {
        const nextSrc = `/api/uploads/${encodeURIComponent(String(previewAudioId))}/file`
        if (el.src !== new URL(nextSrc, window.location.origin).toString()) {
          el.pause()
          el.currentTime = 0
          el.src = nextSrc
          el.load()
          setPreviewPlaying(false)
        }
      } else {
        el.pause()
        el.removeAttribute('src')
        el.load()
        setPreviewPlaying(false)
      }
    } catch {}
  }, [previewAudioEl, previewAudioId])

  const backHref = routeCtx.action === 'list' ? '/assets' : '/assets/visualizers'
  const backLabel = routeCtx.action === 'list' ? '← Assets' : '← Visualizers'
  const secondaryBackHref = mode === 'pick' && returnHref ? returnHref : null
  const buildReturnHref = React.useCallback(
    (params: Record<string, string>) => {
      if (!returnHref) return null
      try {
        const url = new URL(returnHref, window.location.origin)
        Object.entries(params).forEach(([k, v]) => {
          if (v == null) return
          url.searchParams.set(k, String(v))
        })
        return url.pathname + url.search + (url.hash || '')
      } catch {
        return null
      }
    },
    [returnHref]
  )

  const updateInstance = React.useCallback((idx: number, patch: Partial<VisualizerPresetInstance>) => {
    setDraft((prev) => {
      const list = normalizeInstances(prev.instances)
      if (idx < 0 || idx >= list.length) return prev
      const next = list.slice()
      next[idx] = normalizeInstance({ ...next[idx], ...patch }, next[idx], idx)
      return { ...prev, instances: next }
    })
  }, [])

  const addInstance = React.useCallback(() => {
    setDraft((prev) => {
      const list = normalizeInstances(prev.instances)
      if (list.length >= 8) return prev
      const last = list[list.length - 1] || DEFAULT_INSTANCE
      const nextInst = normalizeInstance({ ...last, id: `instance_${list.length + 1}` }, last, list.length)
      return { ...prev, instances: [...list, nextInst] }
    })
  }, [])

  const removeInstance = React.useCallback((idx: number) => {
    setDraft((prev) => {
      const list = normalizeInstances(prev.instances)
      if (list.length <= 1) return prev
      if (idx < 0 || idx >= list.length) return prev
      const next = list.filter((_, i) => i !== idx).map((inst, i) => normalizeInstance({ ...inst, id: `instance_${i + 1}` }, inst, i))
      return { ...prev, instances: next }
    })
  }, [])

  const submit = async () => {
    setSaving(true)
    setFormError(null)
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const csrf = getCsrfToken()
      if (csrf) headers['x-csrf-token'] = csrf
      const instances = normalizeInstances(draft.instances)
      const primary = instances[0] || DEFAULT_INSTANCE
      const body = {
        name: draft.name,
        description: draft.description,
        instances,
        style: primary.style,
        fgColor: primary.fgColor,
        bgColor: draft.bgColor,
        opacity: primary.opacity,
        scale: primary.scale,
        barCount: primary.barCount,
        spectrumMode: primary.spectrumMode,
        bandMode: primary.bandMode,
        gradientEnabled: primary.gradientEnabled,
        gradientStart: primary.gradientStart,
        gradientEnd: primary.gradientEnd,
        gradientMode: primary.gradientMode,
      }
      const url = routeCtx.action === 'edit' && routeCtx.presetId
        ? `/api/visualizer-presets/${encodeURIComponent(String(routeCtx.presetId))}`
        : '/api/visualizer-presets'
      const method = routeCtx.action === 'edit' ? 'PATCH' : 'POST'
      const res = await fetch(url, { method, headers, credentials: 'same-origin', body: JSON.stringify(body) })
      const json = await res.json().catch(() => null)
      if (!res.ok) throw new Error(String(json?.detail || json?.error || 'Failed to save'))
      window.location.href = '/assets/visualizers'
    } catch (e: any) {
      setFormError(String(e?.message || 'Failed to save'))
    } finally {
      setSaving(false)
    }
  }

  if (routeCtx.action !== 'list') {
    return (
      <div style={MODAL_BACKDROP_STYLE}>
        <div style={MODAL_CARD_STYLE} role="dialog" aria-modal="true">
          <div style={MODAL_HEADER_STYLE}>
            <div>
              <h1 style={MODAL_TITLE_STYLE}>{routeCtx.action === 'edit' ? 'Visualizer Properties' : 'Visualizer Properties'}</h1>
              <div style={{ marginTop: 4, color: '#bbb', fontSize: 13 }}>Configure a reusable visualizer preset.</div>
            </div>
            <a href={backHref} style={MODAL_CLOSE_BUTTON_STYLE}>
              Close
            </a>
          </div>
          {secondaryBackHref ? (
            <div style={{ marginTop: 8 }}>
              <a href={secondaryBackHref} style={{ color: '#0a84ff', textDecoration: 'none', fontSize: 13 }}>
                ← Back to Timeline
              </a>
            </div>
          ) : null}

          {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
          {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}
          {formError ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{formError}</div> : null}

          <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Name</div>
              <input
                value={draft.name}
                onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
                style={MODAL_INPUT_STYLE}
              />
            </label>
            <label style={{ display: 'grid', gap: 6 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Description</div>
              <textarea
                value={draft.description || ''}
                onChange={(e) => setDraft((p) => ({ ...p, description: e.target.value }))}
                rows={3}
                style={MODAL_TEXTAREA_STYLE}
              />
            </label>

            <div style={{ display: 'grid', gap: 8 }}>
              <div style={{ color: '#bbb', fontSize: 13 }}>Preview</div>
              <div style={{ display: 'grid', gap: 8, gridTemplateColumns: '1fr auto', alignItems: 'end' }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 12 }}>Audio Source (System)</div>
                  <select
                    value={previewAudioId && Number.isFinite(previewAudioId) ? String(previewAudioId) : ''}
                    onChange={(e) => setPreviewAudioId(Number(e.target.value) || null)}
                    style={MODAL_INPUT_STYLE}
                    disabled={previewAudioLoading || previewAudioItems.length === 0}
                  >
                    {!previewAudioItems.length ? <option value="">No system audio</option> : null}
                    {previewAudioItems.map((a) => {
                      const id = Number((a as any).id || 0)
                      const baseName = String((a as any).modified_filename || (a as any).original_filename || `Audio ${id}`).trim()
                      return (
                        <option key={`preview-aud-${id}`} value={String(id)}>
                          {baseName}
                        </option>
                      )
                    })}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={async () => {
                    const el = previewAudioEl
                    if (!el) return
                    if (el.paused) {
                      try {
                        await el.play()
                      } catch (e: any) {
                        setFormError(String(e?.message || 'Unable to play preview audio'))
                      }
                    } else {
                      el.pause()
                    }
                  }}
                  disabled={!previewAudioId || !previewAudioEl}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 10,
                    border: '1px solid rgba(10,132,255,0.75)',
                    background: 'rgba(10,132,255,0.24)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: !previewAudioId || !previewAudioEl ? 'default' : 'pointer',
                    opacity: !previewAudioId || !previewAudioEl ? 0.6 : 1,
                    minWidth: 72,
                    height: 42,
                  }}
                >
                  {previewPlaying ? 'Pause' : 'Play'}
                </button>
              </div>
              {previewAudioLoading ? <div style={{ color: '#bbb', fontSize: 12 }}>Loading audio sources…</div> : null}
              {previewAudioError ? <div style={{ color: '#ff9b9b', fontSize: 12 }}>{previewAudioError}</div> : null}
              <audio ref={setPreviewAudioEl} preload="metadata" crossOrigin="anonymous" style={{ display: 'none' }} />
              <VisualizerPreview config={draft} audioEl={previewAudioEl} active={previewPlaying} />
            </div>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))' }}>
              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Background</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    type="color"
                    value={draft.bgColor === 'transparent' ? '#000000' : draft.bgColor}
                    onChange={(e) => setDraft((p) => ({ ...p, bgColor: e.target.value }))}
                    style={{ height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }}
                  />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#bbb', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={draft.bgColor === 'transparent'}
                      onChange={(e) => setDraft((p) => ({ ...p, bgColor: e.target.checked ? 'transparent' : '#000000' }))}
                    />
                    Transparent
                  </label>
                </div>
              </label>
            </div>

            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Instances</div>
                <button
                  type="button"
                  onClick={addInstance}
                  disabled={(draft.instances || []).length >= 8}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 10,
                    border: '1px solid rgba(10,132,255,0.75)',
                    background: 'rgba(10,132,255,0.24)',
                    color: '#fff',
                    fontWeight: 900,
                    cursor: (draft.instances || []).length >= 8 ? 'default' : 'pointer',
                    opacity: (draft.instances || []).length >= 8 ? 0.6 : 1,
                  }}
                >
                  + Add Instance
                </button>
              </div>
              {normalizeInstances(draft.instances).map((inst, idx, arr) => (
                <div
                  key={inst.id || `instance-${idx}`}
                  style={{
                    border: '1px solid rgba(255,255,255,0.18)',
                    borderRadius: 12,
                    padding: 10,
                    display: 'grid',
                    gap: 10,
                    background: 'rgba(0,0,0,0.28)',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 900 }}>Instance #{idx + 1}</div>
                    <button
                      type="button"
                      onClick={() => removeInstance(idx)}
                      disabled={arr.length <= 1}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(255,155,155,0.40)',
                        background: 'rgba(128,0,0,1)',
                        color: '#fff',
                        fontWeight: 800,
                        cursor: arr.length <= 1 ? 'default' : 'pointer',
                        opacity: arr.length <= 1 ? 0.55 : 1,
                      }}
                    >
                      -
                    </button>
                  </div>

                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Style</div>
                      <select
                        value={inst.style}
                        onChange={(e) => updateInstance(idx, { style: e.target.value as VisualizerStyle })}
                        style={MODAL_INPUT_STYLE}
                      >
                        <option value="wave_line">Wave Line</option>
                        <option value="wave_fill">Wave Fill</option>
                        <option value="spectrum_bars">Spectrum Bars</option>
                        <option value="radial_bars">Radial Bars</option>
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Scale</div>
                      <select
                        value={inst.scale}
                        onChange={(e) => updateInstance(idx, { scale: e.target.value as VisualizerScale })}
                        style={MODAL_INPUT_STYLE}
                      >
                        <option value="linear">Linear</option>
                        <option value="log">Log</option>
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Spectrum</div>
                      <select
                        value={inst.spectrumMode}
                        onChange={(e) => updateInstance(idx, { spectrumMode: e.target.value as VisualizerSpectrumMode })}
                        style={MODAL_INPUT_STYLE}
                      >
                        <option value="full">Full</option>
                        <option value="voice">Voice</option>
                      </select>
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Band</div>
                      <select
                        value={inst.bandMode}
                        onChange={(e) => updateInstance(idx, { bandMode: e.target.value as VisualizerBandMode })}
                        style={MODAL_INPUT_STYLE}
                      >
                        <option value="full">Full</option>
                        <option value="band_1">Band 1</option>
                        <option value="band_2">Band 2</option>
                        <option value="band_3">Band 3</option>
                        <option value="band_4">Band 4</option>
                      </select>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Bars</div>
                      <input
                        type="range"
                        min={12}
                        max={128}
                        step={4}
                        value={inst.barCount}
                        onChange={(e) => updateInstance(idx, { barCount: parseBarCount(e.target.value) })}
                      />
                      <div style={{ color: '#bbb', fontSize: 12 }}>{inst.barCount}</div>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Opacity</div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={inst.opacity}
                        onChange={(e) => updateInstance(idx, { opacity: Number(e.target.value) })}
                      />
                      <div style={{ color: '#bbb', fontSize: 12 }}>{Math.round(inst.opacity * 100)}%</div>
                    </label>
                  </div>

                  <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(0, 1fr))' }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Foreground</div>
                      <input
                        type="color"
                        value={inst.fgColor}
                        onChange={(e) => updateInstance(idx, { fgColor: e.target.value })}
                        style={{ height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 13 }}>Gradient</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#bbb', fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={inst.gradientEnabled}
                          onChange={(e) =>
                            updateInstance(idx, {
                              gradientEnabled: e.target.checked,
                              gradientStart: inst.gradientStart || inst.fgColor,
                              gradientEnd: inst.gradientEnd || '#f7d774',
                            })
                          }
                        />
                        Enable gradient
                      </label>
                      {inst.gradientEnabled ? (
                        <div style={{ display: 'grid', gap: 8 }}>
                          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                            <input
                              type="color"
                              value={inst.gradientStart}
                              onChange={(e) => updateInstance(idx, { gradientStart: e.target.value })}
                              style={{ height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }}
                            />
                            <input
                              type="color"
                              value={inst.gradientEnd}
                              onChange={(e) => updateInstance(idx, { gradientEnd: e.target.value })}
                              style={{ height: 40, borderRadius: 10, border: '1px solid rgba(255,255,255,0.2)', background: 'transparent' }}
                            />
                          </div>
                          <select
                            value={inst.gradientMode}
                            onChange={(e) => updateInstance(idx, { gradientMode: e.target.value as VisualizerGradientMode })}
                            style={MODAL_INPUT_STYLE}
                          >
                            <option value="vertical">Vertical</option>
                            <option value="horizontal">Horizontal</option>
                          </select>
                        </div>
                      ) : null}
                    </label>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
              <a
                href={backHref}
                style={MODAL_CLOSE_BUTTON_STYLE}
              >
                Cancel
              </a>
              <button
                type="button"
                disabled={saving}
                onClick={submit}
                style={{
                  padding: '10px 12px',
                  borderRadius: 10,
                  border: '1px solid rgba(96,165,250,0.95)',
                  background: 'rgba(96,165,250,0.14)',
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

  return (
    <div style={{ ...nebulaShellBaseStyle }}>
      <div aria-hidden="true" style={nebulaBackgroundLayerStyle} />
      <div style={{ position: 'relative', zIndex: 1, maxWidth: 960, margin: '0 auto', padding: '24px 16px 80px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <a href={backHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
            {backLabel}
          </a>
          {secondaryBackHref ? (
            <a href={secondaryBackHref} style={{ color: '#0a84ff', textDecoration: 'none' }}>
              ← Back to Timeline
            </a>
          ) : null}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 28 }}>{isPickMode ? 'Select Visualizer' : 'Visualizer Presets'}</h1>
            <p style={{ margin: '4px 0 0', color: '#bbb' }}>
              {isPickMode ? 'Pick a preset to add to your timeline.' : 'Create reusable audio visualizer presets.'}
            </p>
          </div>
          {!isPickMode ? (
            <a
              href="/assets/visualizers/new"
              className="card-btn card-btn-open"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginLeft: 'auto',
              }}
            >
              New
            </a>
          ) : null}
        </div>

        {loading ? <div style={{ color: '#bbb', marginTop: 12 }}>Loading…</div> : null}
        {error ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{error}</div> : null}
        {formError ? <div style={{ color: '#ff9b9b', marginTop: 12 }}>{formError}</div> : null}

        <div className="card-list" style={{ ...sharedCardListStyle, marginTop: 16 }}>
          {presets.map((preset) => {
            const id = Number(preset?.id || 0)
            const name = String(preset?.name || `Preset ${id}`).trim()
            const desc = String(preset?.description || '').trim()
            return (
              <div key={`viz-${id}`} className="card-item" style={{ display: 'grid', gap: 8 }}>
                <div className="card-title">{name}</div>
                {desc ? <div className="card-meta" style={{ lineHeight: 1.35 }}>{desc}</div> : null}
                <div className="card-actions card-actions-spread" style={{ marginTop: 6 }}>
                  {isPickMode ? (
                    <div className="card-actions card-actions-right" style={{ width: '100%' }}>
                      <button
                        className="card-btn card-btn-open"
                        type="button"
                        onClick={() => {
                          const href = buildReturnHref({ cvPickType: 'visualizer', cvPickPresetId: String(id) })
                          if (href) window.location.href = href
                        }}
                      >
                        Select
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        className="card-btn card-btn-delete"
                        type="button"
                        onClick={async () => {
                          const ok = window.confirm('Delete this preset? This cannot be undone.')
                          if (!ok) return
                          setFormError(null)
                          try {
                            const headers: Record<string, string> = {}
                            const csrf = getCsrfToken()
                            if (csrf) headers['x-csrf-token'] = csrf
                            const res = await fetch(`/api/visualizer-presets/${encodeURIComponent(String(id))}`, {
                              method: 'DELETE',
                              credentials: 'same-origin',
                              headers,
                            })
                            const j: any = await res.json().catch(() => ({}))
                            if (!res.ok) throw new Error(String(j?.detail || j?.error || 'Failed to delete'))
                            setPresets((prev) => prev.filter((x) => Number((x as any)?.id || 0) !== id))
                          } catch (e: any) {
                            setFormError(e?.message || 'Failed to delete')
                          }
                        }}
                      >
                        Delete
                      </button>
                      <div className="card-actions" style={{ gap: 8 }}>
                        <button
                          className="card-btn card-btn-edit"
                          type="button"
                          onClick={() => {
                            const target = `/assets/visualizers/${encodeURIComponent(String(id))}/edit`
                            window.location.href = target
                          }}
                        >
                          Edit
                        </button>
                        <button
                          className="card-btn card-btn-open"
                          type="button"
                          onClick={async () => {
                            setFormError(null)
                            try {
                              const headers: Record<string, string> = { 'Content-Type': 'application/json' }
                              const csrf = getCsrfToken()
                              if (csrf) headers['x-csrf-token'] = csrf
                              const body = {
                                name: `${name} Copy`,
                                description: preset.description,
                                bgColor: preset.bgColor,
                                instances: normalizeInstances(preset.instances),
                              }
                              const res = await fetch('/api/visualizer-presets', {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers,
                                body: JSON.stringify(body),
                              })
                              const json = await res.json().catch(() => null)
                              if (!res.ok) throw new Error(String(json?.detail || json?.error || 'Failed to clone'))
                              const created = json?.preset
                              if (created) {
                                setPresets((prev) => [created, ...prev])
                              }
                            } catch (e: any) {
                              setFormError(String(e?.message || 'Failed to clone'))
                            }
                          }}
                        >
                          Clone
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
