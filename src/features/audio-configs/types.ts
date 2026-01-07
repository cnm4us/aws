export type AudioMode = 'replace' | 'mix'
export type DuckingMode = 'none' | 'rolling' | 'abrupt'
export type DuckingGate = 'sensitive' | 'normal' | 'strict'

export type AudioConfigRow = {
  id: number
  owner_user_id: number
  name: string
  description?: string | null
  mode: AudioMode
  video_gain_db: number
  music_gain_db: number
  ducking_enabled: number
  ducking_amount_db: number
  ducking_mode: DuckingMode
  ducking_gate: DuckingGate
  opener_cut_fade_before_ms: number | null
  opener_cut_fade_after_ms: number | null
  intro_sfx_upload_id: number | null
  intro_sfx_seconds: number | null
  intro_sfx_gain_db: number
  intro_sfx_fade_enabled: number
  intro_sfx_ducking_enabled: number
  intro_sfx_ducking_amount_db: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type AudioConfigDto = {
  id: number
  name: string
  description: string | null
  mode: AudioMode
  videoGainDb: number
  musicGainDb: number
  duckingMode: DuckingMode
  duckingGate: DuckingGate
  duckingEnabled: boolean
  duckingAmountDb: number
  audioDurationSeconds: number | null
  audioFadeEnabled: boolean
  openerCutFadeBeforeSeconds: number | null
  openerCutFadeAfterSeconds: number | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
