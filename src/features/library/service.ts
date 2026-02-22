import { GetObjectCommand } from '@aws-sdk/client-s3'
import { getPool } from '../../db'
import { s3 } from '../../services/s3'
import { clampLimit } from '../../core/pagination'
import { ForbiddenError, NotFoundError, ValidationError } from '../../core/errors'
import { can } from '../../security/permissions'
import { PERM } from '../../security/perm'
type ServiceContext = { userId?: number | null }
import * as captionsRepo from '../captions/repo'

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'can',
  'could',
  'did',
  'do',
  'does',
  'done',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'here',
  'him',
  'his',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'me',
  'my',
  'not',
  'of',
  'on',
  'or',
  'our',
  'out',
  'over',
  'she',
  'should',
  'so',
  'than',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'too',
  'up',
  'us',
  'was',
  'we',
  'were',
  'will',
  'with',
  'would',
  'you',
  'your',
])

function parseVttTimestampMs(raw: string): number | null {
  const s = String(raw || '').trim()
  const m = s.match(/^(\d{1,2}:)?(\d{2}):(\d{2})\.(\d{3})$/)
  if (!m) return null
  const hasHours = !!m[1]
  const hours = hasHours ? Number(String(m[1]).replace(':', '')) : 0
  const minutes = Number(m[2])
  const seconds = Number(m[3])
  const ms = Number(m[4])
  if (![hours, minutes, seconds, ms].every((n) => Number.isFinite(n))) return null
  return (((hours * 60 + minutes) * 60 + seconds) * 1000 + ms)
}

function parseVttCues(vtt: string): Array<{ startMs: number; endMs: number; text: string }> {
  const src = String(vtt || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = src.split(/\n\n+/).map((b) => b.trim()).filter(Boolean)
  const cues: Array<{ startMs: number; endMs: number; text: string }> = []
  for (const block of blocks) {
    if (block.toUpperCase().startsWith('WEBVTT')) continue
    const lines = block.split('\n').map((l) => l.trimEnd())
    if (!lines.length) continue
    const timeLineIndex = lines.findIndex((l) => l.includes('-->'))
    if (timeLineIndex < 0) continue
    const timeLine = lines[timeLineIndex]
    const parts = timeLine.split('-->').map((p) => p.trim())
    if (parts.length < 2) continue
    const startRaw = parts[0]
    const endRaw = parts[1].split(/\s+/)[0]
    const startMs = parseVttTimestampMs(startRaw)
    const endMs = parseVttTimestampMs(endRaw)
    if (startMs == null || endMs == null) continue
    const textLines = lines.slice(timeLineIndex + 1).filter((l) => l.trim().length)
    if (!textLines.length) continue
    const text = textLines
      .join('\n')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (!text) continue
    cues.push({ startMs, endMs, text })
  }
  cues.sort((a, b) => a.startMs - b.startMs)
  return cues
}

function normalizeTokens(input: string): string[] {
  const cleaned = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  if (!cleaned) return []
  const tokens = cleaned.split(/\s+/).filter(Boolean)
  const filtered = tokens.filter((token) => token && !STOPWORDS.has(token))
  return Array.from(new Set(filtered))
}

async function readS3ObjectText(bucket: string, key: string): Promise<string> {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
  const body = resp.Body as any
  if (!body) return ''
  const chunks: Buffer[] = []
  for await (const chunk of body) {
    if (!chunk) continue
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf8')
}

async function ensureLibraryVideoAccess(uploadId: number, ctx: ServiceContext): Promise<void> {
  if (!ctx.userId) throw new ForbiddenError()
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id
       FROM uploads
      WHERE id = ?
        AND kind = 'video'
        AND status IN ('uploaded','completed')
        AND source_deleted_at IS NULL
        AND (is_system_library = 1 OR user_id = ?)
      LIMIT 1`,
    [uploadId, Number(ctx.userId)]
  )
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('upload_not_found')
}

export async function listSystemLibraryVideos(
  input: { q?: string; sourceOrg?: string; limit?: number },
  ctx: ServiceContext
): Promise<{ items: any[] }> {
  if (!ctx.userId) throw new ForbiddenError()
  const q = String(input.q || '').trim()
  const sourceOrg = String(input.sourceOrg || '').trim().toLowerCase()
  const lim = clampLimit(input.limit, 200, 1, 500)

  const where: string[] = []
  const args: any[] = []
  where.push(`u.kind = 'video'`)
  where.push(`u.is_system_library = 1`)
  where.push(`u.status IN ('uploaded','completed')`)
  where.push(`u.source_deleted_at IS NULL`)
  if (q) {
    where.push(`(COALESCE(u.modified_filename, u.original_filename) LIKE ? OR u.description LIKE ? OR u.original_filename LIKE ?)`)
    const like = `%${q}%`
    args.push(like, like, like)
  }
  if (sourceOrg && sourceOrg !== 'all') {
    where.push(`LOWER(COALESCE(u.source_org,'')) = ?`)
    args.push(sourceOrg)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = getPool()
  const [rows] = await db.query(
    `SELECT u.*
       FROM uploads u
       ${whereSql}
      ORDER BY u.id DESC
      LIMIT ?`,
    [...args, lim]
  )
  return { items: rows as any[] }
}

export async function getSystemLibraryVideo(uploadId: number, ctx: ServiceContext): Promise<any> {
  if (!ctx.userId) throw new ForbiddenError()
  const db = getPool()
  const [rows] = await db.query(
    `SELECT *
       FROM uploads
      WHERE id = ?
        AND kind = 'video'
        AND status IN ('uploaded','completed')
        AND source_deleted_at IS NULL
        AND (is_system_library = 1 OR user_id = ?)
      LIMIT 1`,
    [uploadId, Number(ctx.userId)]
  )
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('not_found')
  return row
}

export async function searchLibraryTranscript(
  input: { uploadId: number; q: string; limit?: number },
  ctx: ServiceContext
): Promise<{ items: Array<{ startSeconds: number; endSeconds: number; text: string }> }> {
  if (!ctx.userId) throw new ForbiddenError()
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_id')
  const q = String(input.q || '').trim()
  if (!q) return { items: [] }
  await ensureLibraryVideoAccess(uploadId, ctx)
  const queryTokens = normalizeTokens(q)
  if (!queryTokens.length) return { items: [] }

  const caps = await captionsRepo.getByUploadId(uploadId)
  if (!caps || !caps.s3_bucket || !caps.s3_key || caps.status !== 'ready') return { items: [] }
  const vtt = await readS3ObjectText(String(caps.s3_bucket), String(caps.s3_key))
  if (!vtt) return { items: [] }
  const cues = parseVttCues(vtt)
  const items: Array<{ startSeconds: number; endSeconds: number; text: string }> = []
  const lim = clampLimit(input.limit, 50, 1, 200)
  for (const cue of cues) {
    const cueTokens = normalizeTokens(cue.text)
    if (!cueTokens.length) continue
    const cueTokenSet = new Set(cueTokens)
    const match = queryTokens.every((token) => cueTokenSet.has(token))
    if (!match) continue
    items.push({
      startSeconds: Math.max(0, cue.startMs / 1000),
      endSeconds: Math.max(0, cue.endMs / 1000),
      text: cue.text,
    })
    if (items.length >= lim) break
  }
  return { items }
}

export async function getLibraryCaptions(
  uploadId: number,
  ctx: ServiceContext
): Promise<{ items: Array<{ startSeconds: number; endSeconds: number; text: string }> }> {
  if (!ctx.userId) throw new ForbiddenError()
  const id = Number(uploadId)
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('bad_id')
  await ensureLibraryVideoAccess(id, ctx)
  const caps = await captionsRepo.getByUploadId(id)
  if (!caps || !caps.s3_bucket || !caps.s3_key || caps.status !== 'ready') return { items: [] }
  const vtt = await readS3ObjectText(String(caps.s3_bucket), String(caps.s3_key))
  if (!vtt) return { items: [] }
  const cues = parseVttCues(vtt)
  return {
    items: cues.map((cue) => ({
      startSeconds: Math.max(0, cue.startMs / 1000),
      endSeconds: Math.max(0, cue.endMs / 1000),
      text: cue.text,
    })),
  }
}

export async function createLibraryClip(
  input: {
    uploadId: number
    title?: string
    description?: string
    startSeconds: number
    endSeconds: number
    isShared?: boolean
    isSystem?: boolean
  },
  ctx: ServiceContext
): Promise<{ id: number }> {
  if (!ctx.userId) throw new ForbiddenError()
  const uploadId = Number(input.uploadId)
  if (!Number.isFinite(uploadId) || uploadId <= 0) throw new ValidationError('bad_upload_id')
  const startSeconds = Number(input.startSeconds)
  const endSeconds = Number(input.endSeconds)
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || !(endSeconds > startSeconds)) {
    throw new ValidationError('invalid_range')
  }
  const minLen = 5
  const maxLen = 180
  if (endSeconds - startSeconds < minLen - 1e-6) throw new ValidationError('clip_too_short')
  if (endSeconds - startSeconds > maxLen + 1e-6) throw new ValidationError('clip_too_long')

  const db = getPool()
  const [rows] = await db.query(`SELECT id, duration_seconds FROM uploads WHERE id = ? AND is_system_library = 1 LIMIT 1`, [uploadId])
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('upload_not_found')
  const maxDur = row.duration_seconds != null ? Number(row.duration_seconds) : null
  if (maxDur && endSeconds > maxDur + 0.001) throw new ValidationError('end_exceeds_duration')

  const isSystem = Boolean(input.isSystem)
  if (isSystem) {
    const ok = await can(Number(ctx.userId), PERM.VIDEO_DELETE_ANY).catch(() => false)
    if (!ok) throw new ForbiddenError()
  }

  const title = (input.title || '').trim().slice(0, 255) || null
  const description = (input.description || '').trim().slice(0, 4000) || null
  const isShared = Boolean(input.isShared)

  const [result] = await db.query(
    `INSERT INTO library_clips (upload_id, owner_user_id, title, description, start_seconds, end_seconds, is_system, is_shared)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)` ,
    [uploadId, Number(ctx.userId), title, description, startSeconds, endSeconds, isSystem ? 1 : 0, isShared ? 1 : 0]
  )
  const id = Number((result as any).insertId)
  return { id }
}

export async function listLibraryClips(
  input: { scope?: 'system' | 'mine' | 'shared'; uploadId?: number; q?: string; limit?: number },
  ctx: ServiceContext
): Promise<{ items: any[] }> {
  if (!ctx.userId) throw new ForbiddenError()
  const userId = Number(ctx.userId)
  const scope = String(input.scope || '').trim().toLowerCase() as any
  const uploadId = input.uploadId != null ? Number(input.uploadId) : null
  const q = String(input.q || '').trim()
  const lim = clampLimit(input.limit, 200, 1, 500)

  const where: string[] = []
  const args: any[] = []
  if (scope === 'system') {
    where.push(`c.is_system = 1`)
  } else if (scope === 'mine') {
    where.push(`c.owner_user_id = ?`)
    args.push(userId)
  } else if (scope === 'shared') {
    where.push(`c.is_shared = 1`)
    where.push(`c.owner_user_id <> ?`)
    args.push(userId)
  } else {
    where.push(`(c.is_system = 1 OR c.owner_user_id = ? OR c.is_shared = 1)`)
    args.push(userId)
  }
  if (uploadId && Number.isFinite(uploadId)) {
    where.push(`c.upload_id = ?`)
    args.push(uploadId)
  }
  if (q) {
    where.push(`(COALESCE(c.title,'') LIKE ? OR COALESCE(c.description,'') LIKE ?)`)
    const like = `%${q}%`
    args.push(like, like)
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const db = getPool()
  const [rows] = await db.query(
    `SELECT c.*, u.modified_filename, u.original_filename, u.description AS upload_description, u.duration_seconds, u.width, u.height, u.source_org
       FROM library_clips c
       JOIN uploads u ON u.id = c.upload_id
       ${whereSql}
      ORDER BY c.id DESC
      LIMIT ?`,
    [...args, lim]
  )
  return { items: rows as any[] }
}

export async function getLibraryClip(
  clipId: number,
  ctx: ServiceContext
): Promise<any> {
  if (!ctx.userId) throw new ForbiddenError()
  const id = Number(clipId)
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('bad_id')
  const db = getPool()
  const [rows] = await db.query(
    `SELECT c.*, u.modified_filename, u.original_filename, u.description AS upload_description, u.duration_seconds, u.width, u.height, u.source_org
       FROM library_clips c
       JOIN uploads u ON u.id = c.upload_id
      WHERE c.id = ?
      LIMIT 1`,
    [id]
  )
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('clip_not_found')
  const userId = Number(ctx.userId)
  const canAccess = Number(row.is_system) === 1 || Number(row.owner_user_id) === userId || Number(row.is_shared) === 1
  if (!canAccess) throw new ForbiddenError()
  return row
}

export async function updateLibraryClip(
  clipId: number,
  input: { title?: string | null; description?: string | null },
  ctx: ServiceContext
): Promise<{ id: number; title: string | null; description: string | null }> {
  if (!ctx.userId) throw new ForbiddenError()
  const id = Number(clipId)
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('bad_id')
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM library_clips WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('clip_not_found')
  const userId = Number(ctx.userId)
  if (Number(row.owner_user_id) !== userId) throw new ForbiddenError()
  if (Number(row.is_system) === 1) throw new ForbiddenError()

  const title = String(input.title || '').trim().slice(0, 255) || null
  const description = String(input.description || '').trim().slice(0, 4000) || null
  await db.query(
    `UPDATE library_clips
        SET title = ?, description = ?
      WHERE id = ?`,
    [title, description, id]
  )
  return { id, title, description }
}

export async function deleteLibraryClip(
  clipId: number,
  ctx: ServiceContext
): Promise<{ ok: true }> {
  if (!ctx.userId) throw new ForbiddenError()
  const id = Number(clipId)
  if (!Number.isFinite(id) || id <= 0) throw new ValidationError('bad_id')
  const db = getPool()
  const [rows] = await db.query(`SELECT * FROM library_clips WHERE id = ? LIMIT 1`, [id])
  const row = (rows as any[])[0]
  if (!row) throw new NotFoundError('clip_not_found')
  const userId = Number(ctx.userId)
  if (Number(row.owner_user_id) !== userId) throw new ForbiddenError()
  if (Number(row.is_system) === 1) throw new ForbiddenError()
  await db.query(`DELETE FROM library_clips WHERE id = ?`, [id])
  return { ok: true }
}
