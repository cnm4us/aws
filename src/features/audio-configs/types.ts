export type AudioMode = 'replace' | 'mix'

export type AudioConfigRow = {
  id: number
  owner_user_id: number
  name: string
  mode: AudioMode
  video_gain_db: number
  music_gain_db: number
  ducking_enabled: number
  ducking_amount_db: number
  created_at: string
  updated_at: string
  archived_at: string | null
}

export type AudioConfigDto = {
  id: number
  name: string
  mode: AudioMode
  videoGainDb: number
  musicGainDb: number
  duckingEnabled: boolean
  duckingAmountDb: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

