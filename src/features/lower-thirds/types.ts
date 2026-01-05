export type LowerThirdTemplateRow = {
  id: number
  template_key: string
  version: number
  label: string
  category: string | null
  svg_markup: string
  descriptor_json: any
  created_at: string
  archived_at: string | null
}

export type LowerThirdConfigRow = {
  id: number
  owner_user_id: number
  name: string
  template_key: string
  template_version: number
  params_json: any
  timing_rule: string
  timing_seconds: number | null
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type LowerThirdDescriptorField = {
  id: string
  label: string
  type: 'text'
  maxLength?: number
}

export type LowerThirdDescriptorColor = {
  id: string
  label: string
}

export type LowerThirdDescriptorV1 = {
  fields?: LowerThirdDescriptorField[]
  colors?: LowerThirdDescriptorColor[]
  defaults?: Record<string, string>
}

export type LowerThirdParamType = 'text' | 'color'

export type LowerThirdDescriptorV2Param = {
  type: LowerThirdParamType
  label: string
  maxLength?: number
  default?: string
}

export type LowerThirdDescriptorV2Binding = {
  param: string
  selector: string
  attributes: Record<string, string>
}

export type LowerThirdDescriptorV2 = {
  // Optional metadata (informational only; DB holds the canonical id/version).
  templateId?: string
  version?: number
  params: Record<string, LowerThirdDescriptorV2Param>
  bindings: LowerThirdDescriptorV2Binding[]
}

export type LowerThirdDescriptor = LowerThirdDescriptorV1 | LowerThirdDescriptorV2

export type LowerThirdTemplateDto = {
  templateKey: string
  version: number
  label: string
  category: string | null
  descriptor: LowerThirdDescriptor
  createdAt: string
  archivedAt: string | null
}

export type LowerThirdConfigDto = {
  id: number
  name: string
  templateKey: string
  templateVersion: number
  params: Record<string, string>
  timingRule: 'first_only' | 'entire'
  timingSeconds: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
