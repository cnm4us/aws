import { getPool } from '../../db'
import type { AudioConfigRow } from './types'

export async function listAvailable(params?: { limit?: number }): Promise<AudioConfigRow[]> {
  const db = getPool()
  const limit = params?.limit != null && Number.isFinite(params.limit) ? Math.max(1, Math.min(500, Number(params.limit))) : 200
  const [rows] = await db.query(
    `SELECT *
       FROM audio_configurations
      WHERE archived_at IS NULL
      ORDER BY id ASC
      LIMIT ?`,
    [limit]
  )
  return rows as AudioConfigRow[]
}

export async function listByOwner(ownerUserId: number, params?: { includeArchived?: boolean; limit?: number }): Promise<AudioConfigRow[]> {
  const db = getPool()
  const includeArchived = Boolean(params?.includeArchived)
  const limit = Math.min(Math.max(Number(params?.limit ?? 200), 1), 500)
  const where = includeArchived ? '' : 'AND archived_at IS NULL'
  const [rows] = await db.query(
    `SELECT *
       FROM audio_configurations
      WHERE owner_user_id = ?
        ${where}
      ORDER BY id DESC
      LIMIT ?`,
    [ownerUserId, limit]
  )
  return rows as any[]
}

export async function getById(id: number): Promise<AudioConfigRow | null> {
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM audio_configurations WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  return row || null
}

export async function create(input: {
  ownerUserId: number
  name: string
  mode: string
  videoGainDb: number
  musicGainDb: number
  duckingMode: string
  duckingGate: string
  duckingAmountDb: number
  audioDurationSeconds: number | null
  audioFadeEnabled: boolean
}): Promise<AudioConfigRow> {
  const db = getPool()
  const duckEnabled = String(input.duckingMode || '').toLowerCase() !== 'none'
  const [result] = await db.query(
    `INSERT INTO audio_configurations
      (owner_user_id, name, mode, video_gain_db, music_gain_db, ducking_enabled, ducking_amount_db, ducking_mode, ducking_gate,
       intro_sfx_upload_id, intro_sfx_seconds, intro_sfx_gain_db, intro_sfx_fade_enabled, intro_sfx_ducking_enabled, intro_sfx_ducking_amount_db)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.ownerUserId,
      input.name,
      input.mode,
      input.videoGainDb,
      input.musicGainDb,
      duckEnabled ? 1 : 0,
      input.duckingAmountDb,
      input.duckingMode,
      input.duckingGate,
      null,
      input.audioDurationSeconds,
      0,
      input.audioFadeEnabled ? 1 : 0,
      0,
      12,
    ]
  )
  const id = Number((result as any).insertId)
  const row = await getById(id)
  if (!row) throw new Error('failed_to_create_audio_config')
  return row
}

export async function update(id: number, patch: {
  name?: string
  mode?: string
  videoGainDb?: number
  musicGainDb?: number
  duckingAmountDb?: number
  duckingMode?: string
  duckingGate?: string
  audioDurationSeconds?: number | null
  audioFadeEnabled?: boolean
}): Promise<AudioConfigRow> {
  const db = getPool()
  const sets: string[] = []
  const args: any[] = []
  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name) }
  if (patch.mode !== undefined) { sets.push('mode = ?'); args.push(patch.mode) }
  if (patch.videoGainDb !== undefined) { sets.push('video_gain_db = ?'); args.push(patch.videoGainDb) }
  if (patch.musicGainDb !== undefined) { sets.push('music_gain_db = ?'); args.push(patch.musicGainDb) }
  if (patch.duckingAmountDb !== undefined) { sets.push('ducking_amount_db = ?'); args.push(patch.duckingAmountDb) }
  if (patch.duckingMode !== undefined) {
    const dm = String(patch.duckingMode || '').toLowerCase()
    sets.push('ducking_mode = ?'); args.push(patch.duckingMode)
    sets.push('ducking_enabled = ?'); args.push(dm !== 'none' ? 1 : 0)
  }
  if (patch.duckingGate !== undefined) { sets.push('ducking_gate = ?'); args.push(patch.duckingGate) }
  // Intro SFX is removed; keep upload_id NULL and repurpose seconds/fade columns.
  sets.push('intro_sfx_upload_id = NULL')
  if (patch.audioDurationSeconds !== undefined) { sets.push('intro_sfx_seconds = ?'); args.push(patch.audioDurationSeconds) }
  if (patch.audioFadeEnabled !== undefined) { sets.push('intro_sfx_fade_enabled = ?'); args.push(patch.audioFadeEnabled ? 1 : 0) }
  if (!sets.length) {
    const row = await getById(id)
    if (!row) throw new Error('not_found')
    return row
  }
  await db.query(`UPDATE audio_configurations SET ${sets.join(', ')} WHERE id = ?`, [...args, id])
  const row = await getById(id)
  if (!row) throw new Error('not_found')
  return row
}

export async function archive(id: number): Promise<void> {
  const db = getPool()
  await db.query(`UPDATE audio_configurations SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP) WHERE id = ?`, [id])
}

export async function ensureDefaultsIfNoneActive(ownerUserId: number): Promise<{ created: boolean }> {
  const db = getPool()
  const [result] = await db.query(
    `INSERT INTO audio_configurations (owner_user_id, name, mode, video_gain_db, music_gain_db, ducking_enabled, ducking_amount_db, ducking_mode, ducking_gate)
     SELECT * FROM (
        SELECT ? AS owner_user_id, 'Mix (Quiet)' AS name, 'mix' AS mode, 0 AS video_gain_db, -24 AS music_gain_db, 0 AS ducking_enabled, 12 AS ducking_amount_db, 'none' AS ducking_mode, 'normal' AS ducking_gate
        UNION ALL SELECT ?, 'Mix (Medium)', 'mix', 0, -18, 0, 12, 'none', 'normal'
        UNION ALL SELECT ?, 'Mix (Loud)', 'mix', 0, -12, 0, 12, 'none', 'normal'
        UNION ALL SELECT ?, 'Mix (Medium) + Ducking', 'mix', 0, -18, 1, 12, 'rolling', 'normal'
     ) AS defaults
      WHERE NOT EXISTS (
        SELECT 1 FROM audio_configurations WHERE archived_at IS NULL LIMIT 1
      )`,
    [ownerUserId, ownerUserId, ownerUserId, ownerUserId]
  )
  const affected = Number((result as any)?.affectedRows || 0)
  return { created: affected > 0 }
}
