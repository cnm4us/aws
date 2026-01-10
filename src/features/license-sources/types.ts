export type LicenseSourceKind = 'audio'

export type LicenseSource = {
  id: number
  kind: LicenseSourceKind
  name: string
  slug: string
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type LicenseSourceSummary = {
  id: number
  name: string
  slug: string
}

