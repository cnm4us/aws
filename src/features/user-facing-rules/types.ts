export type UserFacingRuleRow = {
  id: number
  label: string
  short_description: string | null
  group_key: string | null
  group_label: string | null
  group_order: number
  display_order: number
  is_active: number
  created_at: string
  updated_at: string
}

export type UserFacingRuleMappingRow = {
  id: number
  user_facing_rule_id: number
  rule_id: number
  priority: number
  is_default: number
  created_at: string
  updated_at: string
}

export type UserFacingRuleDto = {
  id: number
  label: string
  shortDescription: string | null
  groupKey: string | null
  groupLabel: string | null
  groupOrder: number
  displayOrder: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type UserFacingRuleMappingDto = {
  id: number
  userFacingRuleId: number
  ruleId: number
  priority: number
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

