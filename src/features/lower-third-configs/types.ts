export type LowerThirdPosition = 'bottom_center'

export type LowerThirdTimingRule = 'entire' | 'first_only'
export type LowerThirdFade = 'none' | 'in' | 'out' | 'in_out'
export type InsetPreset = 'small' | 'medium' | 'large'
export type LowerThirdSizeMode = 'pct' | 'match_image'
export type LowerThirdBaselineWidth = 1080 | 1920

export type LowerThirdConfigurationRow = {
  id: number
  owner_user_id: number
  name: string
  size_mode: string
  baseline_width: number
  position: string
  size_pct_width: number
  opacity_pct: number
  timing_rule: string
  timing_seconds: number | null
  fade: string
  inset_x_preset: string | null
  inset_y_preset: string | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type LowerThirdConfigurationDto = {
  id: number
  name: string
  sizeMode: LowerThirdSizeMode
  baselineWidth: LowerThirdBaselineWidth
  position: LowerThirdPosition
  sizePctWidth: number
  opacityPct: number
  timingRule: LowerThirdTimingRule
  timingSeconds: number | null
  fade: LowerThirdFade
  insetXPreset: InsetPreset | null
  insetYPreset: InsetPreset | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
