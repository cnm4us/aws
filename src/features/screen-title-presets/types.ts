export type InsetPreset = 'small' | 'medium' | 'large'

export type ScreenTitleStyle = 'pill' | 'outline' | 'strip'
export type ScreenTitleFontKey = string
export type ScreenTitleAlignment = 'left' | 'center' | 'right'
export type ScreenTitlePosition = 'top' | 'middle' | 'bottom'
export type ScreenTitleTimingRule = 'entire' | 'first_only'
export type ScreenTitleFade = 'none' | 'in' | 'out' | 'in_out'

export type ScreenTitlePresetRow = {
  id: number
  owner_user_id: number
  name: string
  description: string | null
  style: ScreenTitleStyle
  font_key: string
  font_size_pct: number
  tracking_pct: number
  font_color: string
  font_gradient_key: string | null
  pill_bg_color: string
  pill_bg_opacity_pct: number
  alignment: ScreenTitleAlignment
  position: ScreenTitlePosition
  max_width_pct: number
  inset_x_preset: string | null
  inset_y_preset: string | null
  timing_rule: ScreenTitleTimingRule
  timing_seconds: number | null
  fade: ScreenTitleFade
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type ScreenTitlePresetDto = {
  id: number
  name: string
  description: string | null
  style: ScreenTitleStyle
  fontKey: ScreenTitleFontKey
  fontSizePct: number
  trackingPct: number
  fontColor: string
  fontGradientKey: string | null
  pillBgColor: string
  pillBgOpacityPct: number
  alignment: ScreenTitleAlignment
  position: ScreenTitlePosition
  maxWidthPct: number
  insetXPreset: InsetPreset | null
  insetYPreset: InsetPreset | null
  timingRule: ScreenTitleTimingRule
  timingSeconds: number | null
  fade: ScreenTitleFade
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
