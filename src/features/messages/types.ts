export type MessageStatus = 'draft' | 'active' | 'paused' | 'archived'
export type MessageWidgetPosition = 'top' | 'middle' | 'bottom'
export type MessageBackgroundMode = 'none' | 'image' | 'video'
export type MessageVideoPlaybackMode = 'muted_autoplay' | 'tap_to_play_sound'
export type MessageSurface = 'global_feed'
export type MessageTieBreakStrategy = 'first' | 'round_robin' | 'weighted_random'
export type MessageType =
  | 'register_login'
  | 'fund_drive'
  | 'subscription_upgrade'
  | 'sponsor_message'
  | 'feature_announcement'

export type MessageCtaType = 'auth' | 'donate' | 'subscribe' | 'upgrade'
export type MessageCtaLayout = 'inline' | 'stacked'
export type MessageCtaSlotIndex = 1 | 2 | 3
export type MessageCtaSlot = {
  slot: MessageCtaSlotIndex
  ctaDefinitionId: number
  labelOverride?: string | null
  styleOverride?: {
    bgColor?: string
    textColor?: string
  } | null
}

export type MessageCreative = {
  version: 1
  background: {
    mode: MessageBackgroundMode
    videoPlaybackMode: MessageVideoPlaybackMode
    uploadId: number | null
    overlayColor: string
    overlayOpacity: number
  }
  widgets: {
    message: {
      enabled: boolean
      position: MessageWidgetPosition
      yOffsetPct: number
      bgColor: string
      bgOpacity: number
      textColor: string
      label: string
      headline: string
      body: string | null
      // Legacy fields retained for compatibility during CTA widget migration.
      primaryLabel?: string
      primaryHref?: string
      secondaryLabel?: string | null
      secondaryHref?: string | null
    }
    cta: {
      enabled: boolean
      position: MessageWidgetPosition
      yOffsetPct: number
      bgColor: string
      bgOpacity: number
      textColor: string
      layout: MessageCtaLayout
      count?: MessageCtaSlotIndex
      slots?: MessageCtaSlot[]
      type: MessageCtaType
      primaryLabel: string
      secondaryLabel: string | null
      config: {
        auth: {
          primaryHref: string
          secondaryHref: string | null
        }
        donate: {
          provider: 'mock' | 'paypal'
          campaignKey: string | null
          successReturn: string
        }
        subscribe: {
          provider: 'mock' | 'paypal'
          planKey: string | null
          successReturn: string
        }
        upgrade: {
          targetTier: string | null
          successReturn: string
        }
      }
    }
    // Legacy widget retained for compatibility during CTA widget migration.
    auth: {
      enabled: boolean
      position: MessageWidgetPosition
      yOffsetPct: number
      bgColor: string
      bgOpacity: number
      textColor: string
    }
  }
}

export type MessageRow = {
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
  type: MessageType
  applies_to_surface: MessageSurface
  tie_break_strategy: MessageTieBreakStrategy
  campaign_key: string | null
  eligibility_ruleset_id: number | null
  priority: number
  status: MessageStatus
  starts_at: string | null
  ends_at: string | null
  created_by: number
  updated_by: number
  created_at: string
  updated_at: string
}

export type MessageDto = {
  id: number
  name: string
  headline: string
  body: string | null
  ctaPrimaryLabel: string
  ctaPrimaryHref: string
  ctaSecondaryLabel: string | null
  ctaSecondaryHref: string | null
  mediaUploadId: number | null
  creative: MessageCreative
  type: MessageType
  appliesToSurface: MessageSurface
  tieBreakStrategy: MessageTieBreakStrategy
  campaignKey: string | null
  eligibilityRulesetId: number | null
  priority: number
  status: MessageStatus
  startsAt: string | null
  endsAt: string | null
  createdBy: number
  updatedBy: number
  createdAt: string
  updatedAt: string
}
