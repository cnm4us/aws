export type VisualizerStyle = 'wave_line' | 'wave_fill' | 'spectrum_bars' | 'radial_bars'
export type VisualizerScale = 'linear' | 'log'
export type VisualizerGradientMode = 'vertical' | 'horizontal'
export type VisualizerClipMode = 'none' | 'rect'
export type VisualizerSpectrumMode = 'full' | 'voice'

export type VisualizerPresetRow = {
  id: number
  owner_user_id: number
  name: string
  description: string | null
  style: VisualizerStyle
  fg_color: string
  bg_color: string | 'transparent'
  opacity: number
  scale: VisualizerScale
  bar_count: number
  spectrum_mode: VisualizerSpectrumMode
  gradient_enabled: number
  gradient_start: string
  gradient_end: string
  gradient_mode: VisualizerGradientMode
  clip_mode: VisualizerClipMode
  clip_inset_pct: number
  clip_height_pct: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type VisualizerPresetDto = {
  id: number
  name: string
  description: string | null
  style: VisualizerStyle
  fgColor: string
  bgColor: string | 'transparent'
  opacity: number
  scale: VisualizerScale
  barCount: number
  spectrumMode: VisualizerSpectrumMode
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: VisualizerGradientMode
  clipMode: VisualizerClipMode
  clipInsetPct: number
  clipHeightPct: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
