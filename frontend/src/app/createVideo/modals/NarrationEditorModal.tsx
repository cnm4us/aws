import React from 'react'
import { DEFAULT_NARRATION_VISUALIZER } from '../timelineTypes'
import type { NarrationVisualizerConfig } from '../timelineTypes'

type NarrationEditorState = {
  id: string
  start: number
  end: number
  boostDb: number
  visualizer: NarrationVisualizerConfig
}

type NarrationEditorModalProps = {
  narrationEditor: NarrationEditorState
  narrationEditorError: string | null
  setNarrationEditor: React.Dispatch<React.SetStateAction<NarrationEditorState | null>>
  setNarrationEditorError: React.Dispatch<React.SetStateAction<string | null>>
  narration: any[]
  namesByUploadId: Record<number, string>
  audioPreviewPlayingId: number | null
  toggleAudioPreview: (uploadId: number, options?: { beforePlay?: (player: HTMLAudioElement) => void }) => void
  audioPreviewRef: React.MutableRefObject<HTMLAudioElement | null>
  onClose: () => void
  onSave: () => void
}

export default function NarrationEditorModal({
  narrationEditor,
  narrationEditorError,
  setNarrationEditor,
  setNarrationEditorError,
  narration,
  namesByUploadId,
  audioPreviewPlayingId,
  toggleAudioPreview,
  audioPreviewRef,
  onClose,
  onSave,
}: NarrationEditorModalProps) {
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null)
  const vizRafRef = React.useRef<number | null>(null)
  const audioCtxRef = React.useRef<AudioContext | null>(null)
  const analyserRef = React.useRef<AnalyserNode | null>(null)
  const sourceRef = React.useRef<MediaElementAudioSourceNode | null>(null)
  const lastAudioElRef = React.useRef<HTMLAudioElement | null>(null)
  const timeDomainRef = React.useRef<Uint8Array | null>(null)
  const freqDomainRef = React.useRef<Uint8Array | null>(null)
  const [vizPreset, setVizPreset] = React.useState<'custom' | 'thin_gold' | 'thick_gold' | 'glow_bars'>('custom')

  const vizPresets = React.useMemo(
    () => ({
      thin_gold: {
        style: 'wave_line' as const,
        fgColor: '#d4af37',
        gradientEnabled: false,
        gradientStart: '#d4af37',
        gradientEnd: '#f7d774',
        gradientMode: 'vertical' as const,
        bgColor: 'transparent' as const,
        opacity: 0.95,
        scale: 'linear' as const,
      },
      thick_gold: {
        style: 'wave_fill' as const,
        fgColor: '#d4af37',
        gradientEnabled: false,
        gradientStart: '#d4af37',
        gradientEnd: '#f7d774',
        gradientMode: 'vertical' as const,
        bgColor: 'transparent' as const,
        opacity: 0.9,
        scale: 'linear' as const,
      },
      glow_bars: {
        style: 'spectrum_bars' as const,
        fgColor: '#d4af37',
        gradientEnabled: false,
        gradientStart: '#d4af37',
        gradientEnd: '#f7d774',
        gradientMode: 'vertical' as const,
        bgColor: 'transparent' as const,
        opacity: 0.95,
        scale: 'log' as const,
      },
    }),
    []
  )

  const setupAnalyser = React.useCallback(() => {
    const audioEl = audioPreviewRef.current
    if (!audioEl) return null
    if (lastAudioElRef.current && lastAudioElRef.current !== audioEl) {
      try { sourceRef.current?.disconnect?.() } catch {}
      sourceRef.current = null
      analyserRef.current = null
    }
    lastAudioElRef.current = audioEl
    let ctx = audioCtxRef.current
    if (!ctx) {
      const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext
      if (!Ctx) return null
      try {
        ctx = new Ctx()
      } catch {
        return null
      }
      audioCtxRef.current = ctx
    }
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    let analyser = analyserRef.current
    if (!analyser) {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.75
      analyserRef.current = analyser
    }
    if (!sourceRef.current) {
      try {
        sourceRef.current = ctx.createMediaElementSource(audioEl)
        sourceRef.current.connect(analyser)
        analyser.connect(ctx.destination)
      } catch {
        // ignore
      }
    }
    return analyser
  }, [audioPreviewRef])

  const viz = narrationEditor.visualizer || DEFAULT_NARRATION_VISUALIZER

  const prepareVisualizerPlayback = React.useCallback(() => {
    if (!viz.enabled) return
    if (!audioPreviewRef.current) {
      const player = new Audio()
      player.crossOrigin = 'anonymous'
      player.preload = 'none'
      audioPreviewRef.current = player
    }
    setupAnalyser()
    const ctx = audioCtxRef.current
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
  }, [audioPreviewRef, setupAnalyser, viz.enabled])

  React.useEffect(() => {
    return () => {
      if (vizRafRef.current != null) {
        try { window.cancelAnimationFrame(vizRafRef.current) } catch {}
      }
      vizRafRef.current = null
    }
  }, [])

  React.useEffect(() => {
    const seg = narration.find((n: any) => String((n as any).id) === String(narrationEditor.id)) as any
    const uploadId = seg ? Number(seg.uploadId) : null
    const isPlaying = uploadId != null && audioPreviewPlayingId === uploadId
    const viz = narrationEditor.visualizer || DEFAULT_NARRATION_VISUALIZER

    if (!viz?.enabled || !isPlaying) {
      if (vizRafRef.current != null) {
        try { window.cancelAnimationFrame(vizRafRef.current) } catch {}
      }
      vizRafRef.current = null
      const canvas = canvasRef.current
      if (canvas) {
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      }
      return
    }

    const analyser = setupAnalyser()
    if (!analyser) return
    const canvas = canvasRef.current
    if (!canvas) return

    const draw = () => {
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

      const clipMode = viz.clipMode || 'none'
      const clipInsetPct = Number.isFinite(Number(viz.clipInsetPct)) ? Math.max(0, Math.min(40, Number(viz.clipInsetPct))) : 0
      const clipHeightPct = Number.isFinite(Number(viz.clipHeightPct)) ? Math.max(10, Math.min(100, Number(viz.clipHeightPct))) : 100
      let didClip = false
      if (clipMode === 'rect' && (clipInsetPct > 0 || clipHeightPct < 100)) {
        const insetX = Math.round((w * clipInsetPct) / 100)
        const insetY = Math.round((h * clipInsetPct) / 100)
        const desiredH = Math.max(1, Math.round((h * clipHeightPct) / 100))
        const maxH = Math.max(1, h - insetY * 2)
        const clipH = Math.min(maxH, desiredH)
        const top = Math.round(insetY + (maxH - clipH) / 2)
        const clipW = Math.max(1, w - insetX * 2)
        ctx.save()
        ctx.beginPath()
        ctx.rect(insetX, top, clipW, clipH)
        ctx.clip()
        didClip = true
      }

      if (viz.bgColor && viz.bgColor !== 'transparent') {
        ctx.fillStyle = viz.bgColor
        ctx.fillRect(0, 0, w, h)
      }

      ctx.globalAlpha = Number.isFinite(viz.opacity) ? Math.max(0, Math.min(1, viz.opacity)) : 1
      const fg = viz.fgColor || '#d4af37'
      const gradientOn = viz.gradientEnabled && viz.gradientStart && viz.gradientEnd
      const grad =
        gradientOn && w > 0 && h > 0
          ? (() => {
              const isHorizontal = viz.gradientMode === 'horizontal'
              const g = ctx.createLinearGradient(0, 0, isHorizontal ? w : 0, isHorizontal ? 0 : h)
              g.addColorStop(0, String(viz.gradientStart || fg))
              g.addColorStop(1, String(viz.gradientEnd || fg))
              return g
            })()
          : null
      ctx.strokeStyle = grad || fg
      ctx.fillStyle = grad || fg

      if (viz.style === 'radial_bars') {
        const freq = freqDomainRef.current || new Uint8Array(analyser.frequencyBinCount)
        freqDomainRef.current = freq
        analyser.getByteFrequencyData(freq)
        const bars = 64
        const cx = w / 2
        const cy = h / 2
        const minDim = Math.min(w, h)
        const inner = Math.max(6, minDim * 0.18)
        const maxLen = Math.max(10, minDim * 0.32)
        ctx.lineWidth = 2
        ctx.lineCap = 'round'
        ctx.beginPath()
        for (let i = 0; i < bars; i++) {
          const t = bars <= 1 ? 0 : i / bars
          const idx = viz.scale === 'log' ? Math.floor(Math.pow(t, 2) * (freq.length - 1)) : Math.floor(t * (freq.length - 1))
          const v = freq[Math.max(0, Math.min(freq.length - 1, idx))] / 255
          const len = inner + v * maxLen
          const ang = t * Math.PI * 2 - Math.PI / 2
          const x0 = cx + Math.cos(ang) * inner
          const y0 = cy + Math.sin(ang) * inner
          const x1 = cx + Math.cos(ang) * len
          const y1 = cy + Math.sin(ang) * len
          ctx.moveTo(x0, y0)
          ctx.lineTo(x1, y1)
        }
        ctx.stroke()
      } else if (viz.style === 'spectrum_bars') {
        const freq = freqDomainRef.current || new Uint8Array(analyser.frequencyBinCount)
        freqDomainRef.current = freq
        analyser.getByteFrequencyData(freq)
        const bars = 48
        const gap = 2
        const barW = Math.max(2, (w - gap * (bars - 1)) / bars)
        for (let i = 0; i < bars; i++) {
          const t = bars <= 1 ? 0 : i / (bars - 1)
          const idx = viz.scale === 'log' ? Math.floor(Math.pow(t, 2) * (freq.length - 1)) : Math.floor(t * (freq.length - 1))
          const v = freq[Math.max(0, Math.min(freq.length - 1, idx))] / 255
          const bh = Math.max(1, Math.round(v * h))
          const x = i * (barW + gap)
          ctx.fillRect(x, h - bh, barW, bh)
        }
      } else {
        const data = timeDomainRef.current || new Uint8Array(analyser.fftSize)
        timeDomainRef.current = data
        analyser.getByteTimeDomainData(data)
        ctx.lineWidth = 2
        ctx.beginPath()
        for (let i = 0; i < data.length; i++) {
          const v = data[i] / 255
          const y = v * h
          const x = (i / (data.length - 1)) * w
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        if (viz.style === 'wave_fill') {
          ctx.lineTo(w, h / 2)
          ctx.lineTo(0, h / 2)
          ctx.closePath()
          ctx.fill()
        } else {
          ctx.stroke()
        }
      }
      if (didClip) {
        try { ctx.restore() } catch {}
      }
      ctx.globalAlpha = 1
      vizRafRef.current = window.requestAnimationFrame(draw)
    }

    vizRafRef.current = window.requestAnimationFrame(draw)
    return () => {
      if (vizRafRef.current != null) {
        try { window.cancelAnimationFrame(vizRafRef.current) } catch {}
      }
      vizRafRef.current = null
    }
  }, [audioPreviewPlayingId, narration, narrationEditor.id, narrationEditor.visualizer, setupAnalyser])

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.86)', zIndex: 1100, overflowY: 'auto', WebkitOverflowScrolling: 'touch', padding: '64px 16px 80px' }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 560,
          margin: '0 auto',
          borderRadius: 14,
          border: '1px solid rgba(96,165,250,0.95)',
          background: 'linear-gradient(180deg, rgba(28,45,58,0.96) 0%, rgba(12,16,20,0.96) 100%)',
          padding: 16,
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline' }}>
          <div style={{ fontSize: 18, fontWeight: 900 }}>Narration Properties</div>
          <button
            type="button"
            onClick={onClose}
            style={{ color: '#fff', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.20)', padding: '8px 10px', borderRadius: 10, cursor: 'pointer', fontWeight: 800 }}
          >
            Close
          </button>
        </div>

        {(() => {
          const seg = narration.find((n: any) => String((n as any).id) === String(narrationEditor.id)) as any
          const uploadId = seg ? Number(seg.uploadId) : null
          const name = uploadId != null ? namesByUploadId[uploadId] || `Narration ${uploadId}` : 'Narration'
          const isPlaying = uploadId != null && audioPreviewPlayingId === uploadId
          return (
            <div style={{ marginTop: 10, color: '#bbb', fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 900, color: '#fff' }}>{name}</div>
                {uploadId != null ? (
                  <button
                    type="button"
                    onClick={() =>
                      toggleAudioPreview(uploadId, {
                        beforePlay: () => {
                          prepareVisualizerPlayback()
                        },
                      })
                    }
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      border: '1px solid rgba(255,255,255,0.18)',
                      background: isPlaying ? 'rgba(48,209,88,0.20)' : 'rgba(255,255,255,0.06)',
                      color: '#fff',
                      fontWeight: 900,
                      cursor: 'pointer',
                    }}
                  >
                    {isPlaying ? 'Pause preview' : 'Play preview'}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })()}

        <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6, maxWidth: 260 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Preset</div>
            <select
              value={vizPreset}
              onChange={(e) => {
                const next = String(e.target.value || 'custom') as typeof vizPreset
                setVizPreset(next)
                if (next === 'custom') return
                const preset = (vizPresets as any)[next]
                if (!preset) return
                setNarrationEditor((p) =>
                  p
                    ? ({
                        ...p,
                        visualizer: {
                          ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                          ...preset,
                        },
                      } as any)
                    : p
                )
              }}
              style={{
                width: '100%',
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.18)',
                background: '#0b0b0b',
                color: '#fff',
                padding: '10px 12px',
                fontSize: 14,
                fontWeight: 900,
                boxSizing: 'border-box',
              }}
            >
              <option value="custom">Custom</option>
              <option value="thin_gold">Thin Gold Line</option>
              <option value="thick_gold">Thick Gold Fill</option>
              <option value="glow_bars">Glow Bars</option>
            </select>
          </label>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
            <div style={{ fontSize: 14, fontWeight: 900, color: '#fff' }}>Visualizer</div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: '#bbb' }}>
              <input
                type="checkbox"
                checked={Boolean(viz.enabled)}
                onChange={(e) =>
                  setNarrationEditor((p) =>
                    p ? { ...p, visualizer: { ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER), enabled: Boolean(e.target.checked) } } : p
                  )
                }
              />
              Enabled
            </label>
          </div>

          {viz.enabled ? (
            <>
              <div
                style={{
                  borderRadius: 12,
                  border: '1px solid rgba(255,255,255,0.14)',
                  background: 'rgba(10,12,16,0.6)',
                  padding: 10,
                }}
              >
                <div style={{ fontSize: 12, color: '#9aa0a6', marginBottom: 8 }}>Live Preview (play narration)</div>
                <canvas
                  ref={canvasRef}
                  style={{
                    width: '100%',
                    height: 120,
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.12)',
                    background: viz.bgColor === 'transparent' ? 'rgba(0,0,0,0.35)' : viz.bgColor,
                  }}
                />
              </div>

              <label style={{ display: 'grid', gap: 6 }}>
                <div style={{ color: '#bbb', fontSize: 13 }}>Style</div>
                <select
                  value={String(viz.style || 'wave_line')}
                  onChange={(e) =>
                    setNarrationEditor((p) =>
                      p ? { ...p, visualizer: { ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER), style: e.target.value as any } } : p
                    )
                  }
                  style={{
                    width: '100%',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.18)',
                    background: '#0b0b0b',
                    color: '#fff',
                    padding: '10px 12px',
                    fontSize: 14,
                    fontWeight: 900,
                    boxSizing: 'border-box',
                  }}
                >
                  <option value="wave_line">Wave Line</option>
                  <option value="wave_fill">Wave Fill</option>
                  <option value="spectrum_bars">Spectrum Bars</option>
                  <option value="radial_bars">Radial Bars</option>
                </select>
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Foreground</div>
                  <input
                    type="color"
                    value={String(viz.fgColor || '#d4af37')}
                    onChange={(e) =>
                      setNarrationEditor((p) =>
                        p ? { ...p, visualizer: { ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER), fgColor: e.target.value } } : p
                      )
                    }
                    style={{ width: '100%', height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Background</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
                    <input
                      type="color"
                      disabled={viz.bgColor === 'transparent'}
                      value={
                        viz.bgColor === 'transparent'
                          ? '#000000'
                          : String(viz.bgColor || '#000000')
                      }
                      onChange={(e) =>
                        setNarrationEditor((p) =>
                          p ? { ...p, visualizer: { ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER), bgColor: e.target.value } } : p
                        )
                      }
                      style={{ width: '100%', height: 36, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b' }}
                    />
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12, color: '#bbb' }}>
                      <input
                        type="checkbox"
                        checked={viz.bgColor === 'transparent'}
                        onChange={(e) =>
                          setNarrationEditor((p) =>
                            p
                              ? {
                                  ...p,
                                  visualizer: {
                                    ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                                    bgColor: e.target.checked ? 'transparent' : '#000000',
                                  },
                                }
                              : p
                          )
                        }
                      />
                      Transparent
                    </label>
                  </div>
                </label>
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Gradient</div>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#bbb' }}>
                    <input
                      type="checkbox"
                      checked={Boolean(viz.gradientEnabled)}
                      onChange={(e) =>
                        setNarrationEditor((p) => {
                          if (!p) return p
                          const enabled = Boolean(e.target.checked)
                          const fg = (p.visualizer || DEFAULT_NARRATION_VISUALIZER).fgColor || '#d4af37'
                          return {
                            ...p,
                            visualizer: {
                              ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                              gradientEnabled: enabled,
                              gradientStart: (p.visualizer as any)?.gradientStart || fg,
                              gradientEnd: (p.visualizer as any)?.gradientEnd || '#f7d774',
                              gradientMode: (p.visualizer as any)?.gradientMode || 'vertical',
                            },
                          }
                        })
                      }
                    />
                    Enabled
                  </label>
                </div>
                {viz.gradientEnabled ? (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 12 }}>Start</div>
                      <input
                        type="color"
                        value={String(viz.gradientStart || viz.fgColor || '#d4af37')}
                        onChange={(e) =>
                          setNarrationEditor((p) =>
                            p
                              ? {
                                  ...p,
                                  visualizer: {
                                    ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                                    gradientEnabled: true,
                                    gradientStart: String(e.target.value || '#d4af37'),
                                  },
                                }
                              : p
                          )
                        }
                        style={{ width: '100%', height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6 }}>
                      <div style={{ color: '#bbb', fontSize: 12 }}>End</div>
                      <input
                        type="color"
                        value={String(viz.gradientEnd || '#f7d774')}
                        onChange={(e) =>
                          setNarrationEditor((p) =>
                            p
                              ? {
                                  ...p,
                                  visualizer: {
                                    ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                                    gradientEnabled: true,
                                    gradientEnd: String(e.target.value || '#f7d774'),
                                  },
                                }
                              : p
                          )
                        }
                        style={{ width: '100%', height: 34, borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b' }}
                      />
                    </label>
                    <label style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                      <div style={{ color: '#bbb', fontSize: 12 }}>Direction</div>
                      <select
                        value={String(viz.gradientMode || 'vertical')}
                        onChange={(e) =>
                          setNarrationEditor((p) =>
                            p
                              ? {
                                  ...p,
                                  visualizer: {
                                    ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                                    gradientEnabled: true,
                                    gradientMode: String(e.target.value || 'vertical') as any,
                                  },
                                }
                              : p
                          )
                        }
                        style={{
                          width: '100%',
                          borderRadius: 10,
                          border: '1px solid rgba(255,255,255,0.18)',
                          background: '#0b0b0b',
                          color: '#fff',
                          padding: '8px 10px',
                          fontSize: 13,
                          fontWeight: 800,
                          boxSizing: 'border-box',
                        }}
                      >
                        <option value="vertical">Vertical</option>
                        <option value="horizontal">Horizontal</option>
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>

              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Clip</div>
                  <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: '#bbb' }}>
                    <input
                      type="checkbox"
                      checked={String(viz.clipMode || 'none') === 'rect'}
                      onChange={(e) =>
                        setNarrationEditor((p) => {
                          if (!p) return p
                          const enabled = Boolean(e.target.checked)
                          const inset = Number.isFinite(Number((p.visualizer as any)?.clipInsetPct))
                            ? Number((p.visualizer as any).clipInsetPct)
                            : (DEFAULT_NARRATION_VISUALIZER.clipInsetPct || 0)
                          const heightPct = Number.isFinite(Number((p.visualizer as any)?.clipHeightPct))
                            ? Number((p.visualizer as any).clipHeightPct)
                            : (DEFAULT_NARRATION_VISUALIZER.clipHeightPct || 100)
                          return {
                            ...p,
                            visualizer: {
                              ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                              clipMode: enabled ? 'rect' : 'none',
                              clipInsetPct: enabled ? inset : inset,
                              clipHeightPct: enabled ? heightPct : heightPct,
                            },
                          }
                        })
                      }
                    />
                    Rectangle
                  </label>
                </div>
                {String(viz.clipMode || 'none') === 'rect' ? (
                  <label style={{ display: 'grid', gap: 6, maxWidth: 200 }}>
                    <div style={{ color: '#bbb', fontSize: 12 }}>Inset (%)</div>
                    <input
                      type="number"
                      min={0}
                      max={40}
                      step={1}
                      value={String(Number.isFinite(Number(viz.clipInsetPct)) ? viz.clipInsetPct : DEFAULT_NARRATION_VISUALIZER.clipInsetPct || 0)}
                      onChange={(e) =>
                        setNarrationEditor((p) =>
                          p
                            ? {
                                ...p,
                                visualizer: {
                                  ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                                  clipMode: 'rect',
                                  clipInsetPct: Number(e.target.value),
                                },
                              }
                            : p
                        )
                      }
                      style={{
                        width: '100%',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0b0b0b',
                        color: '#fff',
                        padding: '8px 10px',
                        fontSize: 13,
                        fontWeight: 800,
                        boxSizing: 'border-box',
                      }}
                    />
                  </label>
                ) : null}
                {String(viz.clipMode || 'none') === 'rect' ? (
                  <label style={{ display: 'grid', gap: 6, maxWidth: 200 }}>
                    <div style={{ color: '#bbb', fontSize: 12 }}>Height (%)</div>
                    <input
                      type="number"
                      min={10}
                      max={100}
                      step={5}
                      value={String(
                        Number.isFinite(Number(viz.clipHeightPct)) ? viz.clipHeightPct : DEFAULT_NARRATION_VISUALIZER.clipHeightPct || 100
                      )}
                      onChange={(e) =>
                        setNarrationEditor((p) =>
                          p
                            ? {
                                ...p,
                                visualizer: {
                                  ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER),
                                  clipMode: 'rect',
                                  clipHeightPct: Number(e.target.value),
                                },
                              }
                            : p
                        )
                      }
                      style={{
                        width: '100%',
                        borderRadius: 10,
                        border: '1px solid rgba(255,255,255,0.18)',
                        background: '#0b0b0b',
                        color: '#fff',
                        padding: '8px 10px',
                        fontSize: 13,
                        fontWeight: 800,
                        boxSizing: 'border-box',
                      }}
                    />
                  </label>
                ) : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Opacity</div>
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={String(viz.opacity ?? 1)}
                    onChange={(e) =>
                      setNarrationEditor((p) =>
                        p ? { ...p, visualizer: { ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER), opacity: Number(e.target.value) } } : p
                      )
                    }
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                  />
                </label>
                <label style={{ display: 'grid', gap: 6 }}>
                  <div style={{ color: '#bbb', fontSize: 13 }}>Scale</div>
                  <select
                    value={String(viz.scale || 'linear')}
                    onChange={(e) =>
                      setNarrationEditor((p) =>
                        p ? { ...p, visualizer: { ...(p.visualizer || DEFAULT_NARRATION_VISUALIZER), scale: e.target.value as any } } : p
                      )
                    }
                    style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
                  >
                    <option value="linear">Linear</option>
                    <option value="log">Log</option>
                  </select>
                </label>
              </div>
            </>
          ) : null}
        </div>

        <div style={{ marginTop: 12, display: 'grid', gap: 10 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Start (seconds)</div>
            <input
              type="number"
              step={0.1}
              min={0}
              value={String(narrationEditor.start)}
              onChange={(e) => {
                setNarrationEditorError(null)
                setNarrationEditor((p) => (p ? { ...p, start: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            />
          </label>
          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>End (seconds)</div>
            <input
              type="number"
              step={0.1}
              min={0}
              value={String(narrationEditor.end)}
              onChange={(e) => {
                setNarrationEditorError(null)
                setNarrationEditor((p) => (p ? { ...p, end: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            />
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <div style={{ color: '#bbb', fontSize: 13 }}>Boost</div>
            <select
              value={String(narrationEditor.boostDb)}
              onChange={(e) => {
                setNarrationEditorError(null)
                setNarrationEditor((p) => (p ? { ...p, boostDb: Number(e.target.value) } : p))
              }}
              style={{ width: '100%', borderRadius: 10, border: '1px solid rgba(255,255,255,0.18)', background: '#0b0b0b', color: '#fff', padding: '10px 12px', fontSize: 14, fontWeight: 900, boxSizing: 'border-box' }}
            >
              <option value="0">None</option>
              <option value="3">+3 dB</option>
              <option value="6">+6 dB</option>
              <option value="9">+9 dB</option>
            </select>
          </label>

          {narrationEditorError ? <div style={{ color: '#ff9b9b', fontSize: 13 }}>{narrationEditorError}</div> : null}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
            <button
              type="button"
              onClick={onSave}
              style={{ padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(96,165,250,0.95)', background: 'rgba(96,165,250,0.14)', color: '#fff', fontWeight: 900, cursor: 'pointer' }}
            >
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
