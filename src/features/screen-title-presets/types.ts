export type InsetPreset = 'small' | 'medium' | 'large'

export type ScreenTitleStyle = 'none' | 'pill' | 'strip'
export type ScreenTitleFontKey = string
export type ScreenTitleAlignment = 'left' | 'center' | 'right'
export type ScreenTitlePosition = 'top' | 'middle' | 'bottom'
export type ScreenTitleTimingRule = 'entire' | 'first_only'
export type ScreenTitleFade = 'none' | 'in' | 'out' | 'in_out'
export type ScreenTitleSizeKey = string

export type ScreenTitlePresetRow = {
  id: number
  owner_user_id: number
  name: string
  description: string | null
  style: ScreenTitleStyle
  font_key: string
  size_key: ScreenTitleSizeKey
  font_size_pct: number
  tracking_pct: number
  line_spacing_pct: number
  font_color: string
  shadow_color: string
  shadow_offset_px: number
  shadow_blur_px: number
  shadow_opacity_pct: number
  font_gradient_key: string | null
  outline_width_pct: number | null
  outline_opacity_pct: number | null
  outline_color: string | null
  pill_bg_color: string
  pill_bg_opacity_pct: number
  alignment: ScreenTitleAlignment
  position: ScreenTitlePosition
  max_width_pct: number
  inset_x_preset: string | null
  inset_y_preset: string | null
  margin_left_pct: number | null
  margin_right_pct: number | null
  margin_top_pct: number | null
  margin_bottom_pct: number | null
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
  sizeKey: ScreenTitleSizeKey
  fontSizePct: number
  trackingPct: number
  lineSpacingPct: number
  fontColor: string
  shadowColor: string
  shadowOffsetPx: number
  shadowBlurPx: number
  shadowOpacityPct: number
  fontGradientKey: string | null
  outlineWidthPct: number | null
  outlineOpacityPct: number | null
  outlineColor: string | null
  pillBgColor: string
  pillBgOpacityPct: number
  alignment: ScreenTitleAlignment
  position: ScreenTitlePosition
  maxWidthPct: number
  insetXPreset: InsetPreset | null
  insetYPreset: InsetPreset | null
  marginLeftPct: number | null
  marginRightPct: number | null
  marginTopPct: number | null
  marginBottomPct: number | null
  timingRule: ScreenTitleTimingRule
  timingSeconds: number | null
  fade: ScreenTitleFade
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
