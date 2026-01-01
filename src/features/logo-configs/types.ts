// Note: `center` is a legacy alias for `middle_center` and will be normalized in DB.
export type LogoPosition =
  | 'top_left' | 'top_center' | 'top_right'
  | 'middle_left' | 'middle_center' | 'middle_right'
  | 'bottom_left' | 'bottom_center' | 'bottom_right'
  | 'center'
export type LogoTimingRule = 'entire' | 'start_after' | 'first_only' | 'last_only'
export type LogoFade = 'none' | 'in' | 'out' | 'in_out'
export type InsetPreset = 'small' | 'medium' | 'large'

export type LogoConfigRow = {
  id: number
  owner_user_id: number
  name: string
  position: LogoPosition
  size_pct_width: number
  opacity_pct: number
  timing_rule: LogoTimingRule
  timing_seconds: number | null
  fade: LogoFade
  inset_x_preset?: InsetPreset | null
  inset_y_preset?: InsetPreset | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type LogoConfigDto = {
  id: number
  name: string
  position: LogoPosition
  sizePctWidth: number
  opacityPct: number
  timingRule: LogoTimingRule
  timingSeconds: number | null
  fade: LogoFade
  insetXPreset?: InsetPreset | null
  insetYPreset?: InsetPreset | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
