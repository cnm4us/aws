export type PromptKind = 'prompt_full' | 'prompt_overlay'
export type PromptStatus = 'draft' | 'active' | 'paused' | 'archived'

export type PromptRow = {
  id: number
  name: string
  kind: PromptKind
  headline: string
  body: string | null
  cta_primary_label: string
  cta_primary_href: string
  cta_secondary_label: string | null
  cta_secondary_href: string | null
  media_upload_id: number | null
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
  kind: PromptKind
  headline: string
  body: string | null
  ctaPrimaryLabel: string
  ctaPrimaryHref: string
  ctaSecondaryLabel: string | null
  ctaSecondaryHref: string | null
  mediaUploadId: number | null
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
