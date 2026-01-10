export type AudioTagKind = 'genre' | 'mood' | 'theme' | 'instrument'

export type AudioTag = {
  id: number
  kind: AudioTagKind
  name: string
  slug: string
  sort_order: number
  archived_at: string | null
  created_at: string
  updated_at: string
}

export type AudioTagSummary = {
  id: number
  name: string
  slug: string
}
