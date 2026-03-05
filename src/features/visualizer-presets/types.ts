export type VisualizerStyle =
  | 'wave_line'
  | 'wave_fill'
  | 'center_wave'
  | 'spectrum_bars'
  | 'dot_spectrum'
  | 'mirror_bars'
  | 'stacked_bands'
  | 'ring_wave'
  | 'pulse_orb'
  | 'radial_bars'
export type VisualizerScale = 'linear' | 'log'
export type VisualizerGradientMode = 'vertical' | 'horizontal'
export type VisualizerClipMode = 'none' | 'rect'
export type VisualizerSpectrumMode = 'full' | 'voice'
export type VisualizerBandMode = 'full' | 'band_1' | 'band_2' | 'band_3' | 'band_4'
export type VisualizerBarTopShape = 'stepped' | 'smooth' | 'smooth_separated'

export type VisualizerPresetInstanceDto = {
  id: string
  style: VisualizerStyle
  fgColor: string
  opacity: number
  scale: VisualizerScale
  barCount: number
  spectrumMode: VisualizerSpectrumMode
  bandMode: VisualizerBandMode
  voiceLowHz: number
  voiceHighHz: number
  amplitudeGainPct: number
  baselineLiftPct: number
  waveVerticalGainPct: number
  waveVerticalOffsetPct: number
  waveLineWidthPx: number
  waveSmoothingPct: number
  waveNoiseGatePct: number
  waveTemporalSmoothPct: number
  ringBaseRadiusPct: number
  ringDepthPct: number
  orbRadiusPct: number
  orbBandCount: number
  orbBandSpacingPct: number
  barTopShape: VisualizerBarTopShape
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: VisualizerGradientMode
}

export type VisualizerPresetRow = {
  id: number
  owner_user_id: number
  name: string
  description: string | null
  source_template_key: string | null
  is_starter: number
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
  instances_json: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type VisualizerPresetDto = {
  id: number
  name: string
  description: string | null
  sourceTemplateKey: string | null
  isStarter: boolean
  style: VisualizerStyle
  fgColor: string
  bgColor: string | 'transparent'
  opacity: number
  scale: VisualizerScale
  barCount: number
  spectrumMode: VisualizerSpectrumMode
  bandMode: VisualizerBandMode
  voiceLowHz: number
  voiceHighHz: number
  amplitudeGainPct: number
  baselineLiftPct: number
  waveVerticalGainPct: number
  waveVerticalOffsetPct: number
  waveLineWidthPx: number
  waveSmoothingPct: number
  waveNoiseGatePct: number
  waveTemporalSmoothPct: number
  ringBaseRadiusPct: number
  ringDepthPct: number
  orbRadiusPct: number
  orbBandCount: number
  orbBandSpacingPct: number
  barTopShape: VisualizerBarTopShape
  gradientEnabled: boolean
  gradientStart: string
  gradientEnd: string
  gradientMode: VisualizerGradientMode
  clipMode: VisualizerClipMode
  clipInsetPct: number
  clipHeightPct: number
  instances: VisualizerPresetInstanceDto[]
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type VisualizerPresetTemplateRow = {
  id: number
  template_key: string
  name: string
  description: string | null
  bg_color: string | 'transparent'
  instances_json: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}
