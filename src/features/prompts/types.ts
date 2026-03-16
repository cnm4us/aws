export type PromptStatus = 'draft' | 'active' | 'paused' | 'archived'
export type PromptWidgetPosition = 'top' | 'middle' | 'bottom'
export type PromptBackgroundMode = 'none' | 'image' | 'video'
export type PromptVideoPlaybackMode = 'muted_autoplay' | 'tap_to_play_sound'
export type PromptSurface = 'global_feed'
export type PromptAudienceSegment = 'anonymous' | 'authenticated_non_subscriber' | 'authenticated_subscriber'
export type PromptTieBreakStrategy = 'first' | 'round_robin' | 'weighted_random'
export type PromptType =
  | 'register_login'
  | 'fund_drive'
  | 'subscription_upgrade'
  | 'sponsor_message'
  | 'feature_announcement'

export type PromptCreative = {
  version: 1
  background: {
    mode: PromptBackgroundMode
    videoPlaybackMode: PromptVideoPlaybackMode
    uploadId: number | null
    overlayColor: string
    overlayOpacity: number
  }
  widgets: {
    message: {
      enabled: boolean
      position: PromptWidgetPosition
      yOffsetPct: number
      bgColor: string
      bgOpacity: number
      textColor: string
      label: string
      headline: string
      body: string | null
      primaryLabel: string
      primaryHref: string
      secondaryLabel: string | null
      secondaryHref: string | null
    }
    auth: {
      enabled: boolean
      position: PromptWidgetPosition
      yOffsetPct: number
      bgColor: string
      bgOpacity: number
      textColor: string
    }
  }
}

export type PromptRow = {
  id: number
  name: string
  headline: string
  body: string | null
  cta_primary_label: string
  cta_primary_href: string
  cta_secondary_label: string | null
  cta_secondary_href: string | null
  media_upload_id: number | null
  creative_json: string | null
  prompt_type: PromptType
  applies_to_surface: PromptSurface
  audience_segment: PromptAudienceSegment
  tie_break_strategy: PromptTieBreakStrategy
  category: string
  priority: number
  status: PromptStatus
  starts_at: string | null
  ends_at: string | null
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type PromptDto = {
  id: number
  name: string
  headline: string
  body: string | null
  ctaPrimaryLabel: string
  ctaPrimaryHref: string
  ctaSecondaryLabel: string | null
  ctaSecondaryHref: string | null
  mediaUploadId: number | null
  creative: PromptCreative
  promptType: PromptType
  appliesToSurface: PromptSurface
  audienceSegment: PromptAudienceSegment
  tieBreakStrategy: PromptTieBreakStrategy
  category: string
  priority: number
  status: PromptStatus
  startsAt: string | null
  endsAt: string | null
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}
