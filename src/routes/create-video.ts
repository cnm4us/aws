import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { requireAuth } from '../middleware/auth'
import * as createVideoSvc from '../features/create-video/service'
import { getPool } from '../db'
import { DomainError } from '../core/errors'
import * as prodSvc from '../features/productions/service'
import { can } from '../security/permissions'
import { PERM } from '../security/perm'
import * as screenTitlePresetsSvc from '../features/screen-title-presets/service'
import { renderScreenTitlePngWithPango } from '../services/pango/screenTitlePng'
import { uploadFileToS3 } from '../services/ffmpeg/audioPipeline'
import { nowDateYmd, sanitizeFilename } from '../utils/naming'
import { MAX_UPLOAD_MB, UPLOAD_BUCKET, UPLOAD_PREFIX } from '../config'
import { randomUUID } from 'crypto'
import { createPresignedPost } from '@aws-sdk/s3-presigned-post'
import { s3 } from '../services/s3'
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3'

export const createVideoRouter = Router()

type DeleteSummary = { bucket: string; prefix: string; deleted: number; batches: number; samples: string[]; errors: string[] }
async function deletePrefix(bucket: string, prefix: string): Promise<DeleteSummary> {
  let token: string | undefined = undefined
  let totalDeleted = 0
  let batches = 0
  const samples: string[] = []
  const errors: string[] = []
  do {
    let list: ListObjectsV2CommandOutput
    try {
      list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }))
    } catch (e: any) {
      errors.push(`list:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
      break
    }
    const contents = list.Contents ?? []
    if (contents.length) {
      const Objects = contents.map((o: _Object) => ({ Key: o.Key! }))
      for (let i = 0; i < Math.min(10, contents.length); i++) {
        const k = contents[i]?.Key
        if (k && samples.length < 10) samples.push(String(k))
      }
      try {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }))
      } catch (e: any) {
        errors.push(`delete:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`)
        break
      }
      totalDeleted += Objects.length
      batches += 1
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined
  } while (token)
  return { bucket, prefix, deleted: totalDeleted, batches, samples, errors }
}

createVideoRouter.post('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.createOrGetActiveProjectForUser(currentUserId)
    res.status(result.created ? 201 : 200).json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/projects', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.listProjectsForUser(currentUserId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/projects', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const result = await createVideoSvc.createProjectForUser(currentUserId, { name: body.name, description: body.description })
    res.status(201).json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const result = await createVideoSvc.getProjectForUserById(currentUserId, projectId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.patch('/api/create-video/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const body = (req.body || {}) as any
    const result = await createVideoSvc.updateProjectMetaForUser(currentUserId, projectId, { name: body.name, description: body.description })
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.patch('/api/create-video/projects/:id/timeline', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const timeline = (req.body || {}).timeline
    const result = await createVideoSvc.updateProjectTimelineForUser(currentUserId, projectId, timeline)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.delete('/api/create-video/projects/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const result = await createVideoSvc.deleteProjectForUserById(currentUserId, projectId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/projects/:id/archive', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const result = await createVideoSvc.archiveProjectForUserById(currentUserId, projectId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/projects/:id/export', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const result = await createVideoSvc.exportProjectForUserById(currentUserId, projectId)
    res.status(202).json(result)
  } catch (err: any) {
    next(err)
  }
})

type ExportHlsState = 'not_ready' | 'in_progress' | 'ready' | 'failed'
function mapProductionToHlsState(statusRaw: unknown): ExportHlsState {
  const status = String(statusRaw || '').toLowerCase()
  if (!status) return 'not_ready'
  if (status === 'completed') return 'ready'
  if (status === 'failed') return 'failed'
  // pending/pending_media/queued/processing all mean "started but not ready yet"
  return 'in_progress'
}

async function loadExportUploadForUser(uploadId: number, currentUserId: number) {
  const db = getPool()
  const [rows] = await db.query(
    `SELECT id, user_id, kind, video_role, s3_key, create_video_production_id, modified_filename
       FROM uploads
      WHERE id = ?
      LIMIT 1`,
    [uploadId]
  )
  const row = (rows as any[])[0]
  if (!row) throw new DomainError('not_found', 'not_found', 404)
  const ownerId = row.user_id != null ? Number(row.user_id) : null
  const isOwner = ownerId === currentUserId
  const isAdmin = await can(currentUserId, PERM.VIDEO_DELETE_ANY).catch(() => false)
  if (!isOwner && !isAdmin) throw new DomainError('forbidden', 'forbidden', 403)
  if (String(row.kind || '') !== 'video') throw new DomainError('invalid_kind', 'invalid_kind', 400)
  const role = row.video_role != null ? String(row.video_role) : ''
  const key = String(row.s3_key || '')
  const isExport = role === 'export' || key.includes('/renders/') || key.startsWith('renders/')
  if (!isExport) throw new DomainError('not_export', 'not_export', 400)
  return row
}

createVideoRouter.get('/api/exports/:uploadId/hls-status', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const uploadId = Number(req.params.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new DomainError('bad_upload_id', 'bad_upload_id', 400)
    const upload = await loadExportUploadForUser(uploadId, currentUserId)
    const db = getPool()

    let productionId: number | null =
      upload.create_video_production_id != null && Number.isFinite(Number(upload.create_video_production_id)) && Number(upload.create_video_production_id) > 0
        ? Number(upload.create_video_production_id)
        : null

    let productionRow: any | null = null
    if (productionId) {
      const [prows] = await db.query(
        `SELECT id, status, error_message
           FROM productions
          WHERE id = ? AND user_id = ?
          LIMIT 1`,
        [productionId, currentUserId]
      )
      productionRow = (prows as any[])[0] || null
      if (!productionRow) productionId = null
    }

    if (!productionRow) {
      const [prows] = await db.query(
        `SELECT id, status, error_message
           FROM productions
          WHERE upload_id = ? AND user_id = ?
          ORDER BY id DESC
          LIMIT 1`,
        [uploadId, currentUserId]
      )
      productionRow = (prows as any[])[0] || null
      if (productionRow) {
        productionId = Number(productionRow.id)
        try {
          await db.query(`UPDATE uploads SET create_video_production_id = ? WHERE id = ?`, [productionId, uploadId])
        } catch {}
      }
    }

    const state: ExportHlsState = productionRow ? mapProductionToHlsState(productionRow.status) : 'not_ready'
    res.json({
      state,
      productionId: productionId ?? null,
      productionStatus: productionRow ? String(productionRow.status || '') : null,
      errorMessage: productionRow && productionRow.error_message != null ? String(productionRow.error_message) : null,
    })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/exports/:uploadId/prep-hls', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const uploadId = Number(req.params.uploadId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new DomainError('bad_upload_id', 'bad_upload_id', 400)
    const upload = await loadExportUploadForUser(uploadId, currentUserId)
    const db = getPool()

    const requestedName = req.body && typeof req.body === 'object' ? (req.body as any).name : null
    const name = requestedName != null ? String(requestedName).slice(0, 255) : upload.modified_filename != null ? String(upload.modified_filename).slice(0, 255) : undefined

    // If already linked, respect current state unless failed (then retry by creating a fresh production and updating the link).
    const linkedIdRaw = upload.create_video_production_id
    const linkedId = linkedIdRaw != null && Number.isFinite(Number(linkedIdRaw)) && Number(linkedIdRaw) > 0 ? Number(linkedIdRaw) : null
    if (linkedId) {
      const [prows] = await db.query(
        `SELECT id, status
           FROM productions
          WHERE id = ? AND user_id = ?
          LIMIT 1`,
        [linkedId, currentUserId]
      )
      const p = (prows as any[])[0] || null
      if (p) {
        const state = mapProductionToHlsState(p.status)
        if (state === 'ready' || state === 'in_progress') {
          return res.json({ state, productionId: Number(p.id) })
        }
      }
      // Broken link or failed: fall through to create a new production and relink.
    }

    // If there's an existing production for this export, prefer linking to it (avoid duplicates) unless it's failed.
    const [existingRows] = await db.query(
      `SELECT id, status
         FROM productions
        WHERE upload_id = ? AND user_id = ?
        ORDER BY id DESC
        LIMIT 1`,
      [uploadId, currentUserId]
    )
    const existing = (existingRows as any[])[0] || null
    if (existing) {
      const existingState = mapProductionToHlsState(existing.status)
      if (existingState === 'ready' || existingState === 'in_progress') {
        const pid = Number(existing.id)
        try { await db.query(`UPDATE uploads SET create_video_production_id = ? WHERE id = ?`, [pid, uploadId]) } catch {}
        return res.json({ state: existingState, productionId: pid })
      }
      // failed -> we intentionally create a new production row for retry, and update mapping.
    }

    const created = await prodSvc.create({ uploadId, name }, currentUserId)
    const pid = Number(created?.production?.id)
    if (!Number.isFinite(pid) || pid <= 0) throw new DomainError('failed_to_create_production', 'failed_to_create_production', 500)
    await db.query(`UPDATE uploads SET create_video_production_id = ? WHERE id = ?`, [pid, uploadId])
    res.json({ state: 'in_progress' as const, productionId: pid })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/projects/:id/export-status', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const projectId = Number(req.params.id)
    const jobId = req.query.jobId != null ? Number(req.query.jobId) : null
    const result = await createVideoSvc.getExportStatusForUserByProjectId(currentUserId, projectId, { jobId })
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const project = await createVideoSvc.getActiveProjectForUser(currentUserId)
    res.json({ project })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.patch('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const timeline = (req.body || {}).timeline
    const project = await createVideoSvc.updateActiveProjectTimelineForUser(currentUserId, timeline)
    res.json({ project })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/project/archive', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.archiveActiveProjectForUser(currentUserId)
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/project/export', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.exportActiveProjectForUser(currentUserId)
    res.status(202).json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/project/export-status', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const jobId = req.query.jobId != null ? Number(req.query.jobId) : null
    const result = await createVideoSvc.getExportStatusForUser(currentUserId, { jobId })
    res.json(result)
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/screen-titles/render', requireAuth, async (req, res, next) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-create-video-screen-title-'))
  try {
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const presetId = Number(body.presetId)
    const textRaw = String(body.text || '').replace(/\r\n/g, '\n')
    const text = textRaw.trim()
    const frameW = Number(body.frameW)
    const frameH = Number(body.frameH)
    if (!Number.isFinite(presetId) || presetId <= 0) throw new DomainError('bad_preset_id', 'bad_preset_id', 400)
    if (!text) throw new DomainError('missing_text', 'missing_text', 400)
    if (text.length > 1000) throw new DomainError('invalid_screen_title', 'invalid_screen_title', 400)
    if (text.split('\n').length > 30) throw new DomainError('invalid_screen_title_lines', 'invalid_screen_title_lines', 400)
    if (!Number.isFinite(frameW) || !Number.isFinite(frameH) || frameW <= 0 || frameH <= 0) throw new DomainError('bad_frame', 'bad_frame', 400)
    if (frameW > 3840 || frameH > 3840) throw new DomainError('bad_frame', 'bad_frame', 400)

    const preset = await screenTitlePresetsSvc.getActiveForUser(presetId, currentUserId)
    const frame = { width: Math.round(frameW), height: Math.round(frameH) }

    const outPath = path.join(tmpDir, 'screen_title.png')
    await renderScreenTitlePngWithPango({ input: { text, preset, frame }, outPath })

    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new DomainError('missing_bucket', 'missing_bucket', 500)
    const { folder } = nowDateYmd()
    const uuid = randomUUID()
    const key = `images/${folder}/${uuid}/screen_title.png`

    await uploadFileToS3(bucket, key, outPath, 'image/png')

    const db = getPool()
    const [result] = await db.query(
      `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, content_type, kind, image_role, status, user_id, width, height, created_at, uploaded_at)
       VALUES (?, ?, 'screen_title.png', NULL, 'image/png', 'image', 'screen_title', 'completed', ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [bucket, key, currentUserId, frame.width, frame.height]
    )
    const uploadId = Number((result as any).insertId)
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new DomainError('failed_to_create_upload', 'failed_to_create_upload', 500)

    res.json({ uploadId })
  } catch (err: any) {
    next(err)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
})

createVideoRouter.post('/api/create-video/narration/sign', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const filenameRaw = String(body.filename || '').trim()
    const nameRaw = body.name == null ? '' : String(body.name || '').trim()
    const descRaw = body.description == null ? '' : String(body.description || '').trim()
    const contentTypeRaw = String(body.contentType || '').trim() || 'application/octet-stream'
    const sizeBytesRaw = body.sizeBytes == null ? null : Number(body.sizeBytes)
    const durationSecondsRaw = body.durationSeconds == null ? null : Number(body.durationSeconds)
    const modifiedFilenameRaw = body.modifiedFilename == null ? null : String(body.modifiedFilename || '').trim()

    if (!filenameRaw) throw new DomainError('bad_filename', 'bad_filename', 400)
    const safeName = sanitizeFilename(filenameRaw) || 'narration'
    const lowerCt = contentTypeRaw.toLowerCase()
    const extFromName = (safeName.match(/\.[^.]+$/) || [''])[0].toLowerCase()
    const pickExt = (): string => {
      if (extFromName) return extFromName
      if (lowerCt.includes('webm')) return '.webm'
      if (lowerCt.includes('wav')) return '.wav'
      if (lowerCt.includes('mpeg') || lowerCt.includes('mp3')) return '.mp3'
      if (lowerCt.includes('mp4') || lowerCt.includes('m4a') || lowerCt.includes('aac')) return '.m4a'
      return '.m4a'
    }
    const ext = pickExt()
    const allowedExt = ['.m4a', '.mp4', '.aac', '.mp3', '.wav', '.webm', '.ogg', '.opus']
    if (!(lowerCt.startsWith('audio/') || lowerCt === 'video/mp4') && !allowedExt.includes(ext)) {
      const err: any = new DomainError('invalid_file_type', 'invalid_file_type', 400)
      err.detail = { contentType: contentTypeRaw, ext }
      throw err
    }
    const leaf = `narration${ext}`

    const sizeBytes = sizeBytesRaw != null && Number.isFinite(sizeBytesRaw) && sizeBytesRaw > 0 ? Math.round(sizeBytesRaw) : null
    const maxBytes = MAX_UPLOAD_MB * 1024 * 1024
    if (sizeBytes != null && sizeBytes > maxBytes) throw new DomainError('file_too_large', 'file_too_large', 413)

    const durationSeconds =
      durationSecondsRaw != null && Number.isFinite(durationSecondsRaw) && durationSecondsRaw > 0
        ? Math.min(20 * 60, Math.round(durationSecondsRaw))
        : null

    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new DomainError('missing_bucket', 'missing_bucket', 500)

    const { ymd: dateYmd, folder } = nowDateYmd()
    const uuid = randomUUID()
    const basePrefix = UPLOAD_PREFIX ? (UPLOAD_PREFIX.endsWith('/') ? UPLOAD_PREFIX : UPLOAD_PREFIX + '/') : ''
    const key = `${basePrefix}audio/narration/${folder}/${uuid}/${leaf}`

    const db = getPool()
    let insertId: number | null = null
    try {
      const description = descRaw.length ? descRaw : null
      const modifiedFilename = (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512)
      const [result] = await db.query(
        `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, duration_seconds, status, kind, user_id, asset_uuid, date_ymd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'signed', 'audio', ?, ?, ?)`,
        [bucket, key, safeName, modifiedFilename, description, contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
      )
      insertId = Number((result as any).insertId)
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('Unknown column') && msg.includes('description')) {
        const modifiedFilename = (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512)
        const [result] = await db.query(
          `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, content_type, size_bytes, duration_seconds, status, kind, user_id, asset_uuid, date_ymd)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', 'audio', ?, ?, ?)`,
          [bucket, key, safeName, modifiedFilename, contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
        )
        insertId = Number((result as any).insertId)
      } else if (msg.includes('Unknown column') && msg.includes('kind')) {
        const [result] = await db.query(
          `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, content_type, size_bytes, duration_seconds, status, user_id, asset_uuid, date_ymd)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?)`,
          [bucket, key, safeName, (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512), contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
        )
        insertId = Number((result as any).insertId)
      } else {
        throw e
      }
    }
    const id = Number(insertId || 0)
    if (!Number.isFinite(id) || id <= 0) throw new DomainError('failed_to_create_upload', 'failed_to_create_upload', 500)

    const conditions: any[] = [
      ['content-length-range', 1, maxBytes],
      ['starts-with', '$key', `${basePrefix}audio/narration/`],
    ]
    const fields: Record<string, string> = {
      key,
      success_action_status: '201',
      'x-amz-meta-original-filename': safeName,
    }
    if (contentTypeRaw) fields['Content-Type'] = contentTypeRaw

    const presigned = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: key,
      Conditions: conditions,
      Fields: fields,
      Expires: 60 * 5,
    })

    res.json({ id, bucket, key, post: presigned })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.post('/api/create-video/audio/sign', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const body = (req.body || {}) as any
    const filenameRaw = String(body.filename || '').trim()
    const nameRaw = body.name == null ? '' : String(body.name || '').trim()
    const descRaw = body.description == null ? '' : String(body.description || '').trim()
    const contentTypeRaw = String(body.contentType || '').trim() || 'application/octet-stream'
    const sizeBytesRaw = body.sizeBytes == null ? null : Number(body.sizeBytes)
    const durationSecondsRaw = body.durationSeconds == null ? null : Number(body.durationSeconds)
    const modifiedFilenameRaw = body.modifiedFilename == null ? null : String(body.modifiedFilename || '').trim()

    if (!filenameRaw) throw new DomainError('bad_filename', 'bad_filename', 400)
    const safeName = sanitizeFilename(filenameRaw) || 'audio'
    const lowerCt = contentTypeRaw.toLowerCase()
    const extFromName = (safeName.match(/\.[^.]+$/) || [''])[0].toLowerCase()
    const pickExt = (): string => {
      if (extFromName) return extFromName
      if (lowerCt.includes('wav')) return '.wav'
      if (lowerCt.includes('mpeg') || lowerCt.includes('mp3')) return '.mp3'
      if (lowerCt.includes('mp4') || lowerCt.includes('m4a') || lowerCt.includes('aac')) return '.m4a'
      return '.m4a'
    }
    const ext = pickExt()
    const allowedExt = ['.m4a', '.mp4', '.aac', '.mp3', '.wav', '.webm', '.ogg', '.opus']
    if (!(lowerCt.startsWith('audio/') || lowerCt === 'video/mp4') && !allowedExt.includes(ext)) {
      const err: any = new DomainError('invalid_file_type', 'invalid_file_type', 400)
      err.detail = { contentType: contentTypeRaw, ext }
      throw err
    }
    const leaf = `audio${ext}`

    const sizeBytes = sizeBytesRaw != null && Number.isFinite(sizeBytesRaw) && sizeBytesRaw > 0 ? Math.round(sizeBytesRaw) : null
    const maxBytes = MAX_UPLOAD_MB * 1024 * 1024
    if (sizeBytes != null && sizeBytes > maxBytes) throw new DomainError('file_too_large', 'file_too_large', 413)

    const durationSeconds =
      durationSecondsRaw != null && Number.isFinite(durationSecondsRaw) && durationSecondsRaw > 0
        ? Math.min(20 * 60, Math.round(durationSecondsRaw))
        : null

    const bucket = String(UPLOAD_BUCKET || '')
    if (!bucket) throw new DomainError('missing_bucket', 'missing_bucket', 500)

    const { ymd: dateYmd, folder } = nowDateYmd()
    const uuid = randomUUID()
    const basePrefix = UPLOAD_PREFIX ? (UPLOAD_PREFIX.endsWith('/') ? UPLOAD_PREFIX : UPLOAD_PREFIX + '/') : ''
    const key = `${basePrefix}audio/music/${folder}/${uuid}/${leaf}`

    const db = getPool()
    let insertId: number | null = null
    try {
      const description = descRaw.length ? descRaw : null
      const modifiedFilename = (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512)
      const [result] = await db.query(
        `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, duration_seconds, status, kind, is_system, user_id, asset_uuid, date_ymd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'signed', 'audio', 0, ?, ?, ?)`,
        [bucket, key, safeName, modifiedFilename, description, contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
      )
      insertId = Number((result as any).insertId)
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('Unknown column') && msg.includes('description')) {
        const modifiedFilename = (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512)
        const [result] = await db.query(
          `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, content_type, size_bytes, duration_seconds, status, kind, is_system, user_id, asset_uuid, date_ymd)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', 'audio', 0, ?, ?, ?)`,
          [bucket, key, safeName, modifiedFilename, contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
        )
        insertId = Number((result as any).insertId)
      } else if (msg.includes('Unknown column') && msg.includes('is_system')) {
        const description = descRaw.length ? descRaw : null
        const modifiedFilename = (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512)
        const [result] = await db.query(
          `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, description, content_type, size_bytes, duration_seconds, status, kind, user_id, asset_uuid, date_ymd)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'signed', 'audio', ?, ?, ?)`,
          [bucket, key, safeName, modifiedFilename, description, contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
        )
        insertId = Number((result as any).insertId)
      } else if (msg.includes('Unknown column') && msg.includes('kind')) {
        const [result] = await db.query(
          `INSERT INTO uploads (s3_bucket, s3_key, original_filename, modified_filename, content_type, size_bytes, duration_seconds, status, user_id, asset_uuid, date_ymd)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'signed', ?, ?, ?)`,
          [bucket, key, safeName, (modifiedFilenameRaw && modifiedFilenameRaw.length ? modifiedFilenameRaw : (nameRaw.length ? nameRaw : safeName)).slice(0, 512), contentTypeRaw || null, sizeBytes, durationSeconds, currentUserId, uuid, dateYmd]
        )
        insertId = Number((result as any).insertId)
      } else {
        throw e
      }
    }

    const id = Number(insertId || 0)
    if (!Number.isFinite(id) || id <= 0) throw new DomainError('failed_to_create_upload', 'failed_to_create_upload', 500)

    const conditions: any[] = [
      ['content-length-range', 1, maxBytes],
      ['starts-with', '$key', `${basePrefix}audio/music/`],
    ]
    const fields: Record<string, string> = {
      key,
      success_action_status: '201',
      'x-amz-meta-original-filename': safeName,
    }
    if (contentTypeRaw) fields['Content-Type'] = contentTypeRaw

    const presigned = await createPresignedPost(s3, {
      Bucket: bucket,
      Key: key,
      Conditions: conditions,
      Fields: fields,
      Expires: 60 * 5,
    })

    res.json({ id, bucket, key, post: presigned })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/narration/list', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, modified_filename, original_filename, description, size_bytes, duration_seconds, created_at, uploaded_at
         FROM uploads
        WHERE user_id = ?
          AND kind = 'audio'
          AND s3_key LIKE '%audio/narration/%'
          AND status IN ('uploaded','completed')
        ORDER BY COALESCE(uploaded_at, created_at) DESC, id DESC
        LIMIT 200`,
      [currentUserId]
    )
    res.json({ items: rows })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.get('/api/create-video/audio/list', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, modified_filename, original_filename, description, size_bytes, duration_seconds, created_at, uploaded_at
         FROM uploads
        WHERE user_id = ?
          AND kind = 'audio'
          AND s3_key LIKE '%audio/music/%'
          AND status IN ('uploaded','completed')
        ORDER BY COALESCE(uploaded_at, created_at) DESC, id DESC
        LIMIT 200`,
      [currentUserId]
    )
    res.json({ items: rows })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.patch('/api/create-video/narration/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) throw new DomainError('bad_id', 'bad_id', 400)
    const body = (req.body || {}) as any
    const nameRaw = String(body.name ?? body.modified_filename ?? body.modifiedFilename ?? '').trim()
    const descRaw = body.description == null ? '' : String(body.description || '').trim()
    if (!nameRaw) throw new DomainError('missing_name', 'missing_name', 400)
    if (nameRaw.length > 512) throw new DomainError('invalid_name', 'invalid_name', 400)
    if (descRaw.length > 2000) throw new DomainError('invalid_description', 'invalid_description', 400)
    const description = descRaw.length ? descRaw : null

    const db = getPool()
    const [result] = await db.query(
      `UPDATE uploads
          SET modified_filename = ?, description = ?
        WHERE id = ?
          AND user_id = ?
          AND kind = 'audio'
          AND s3_key LIKE '%audio/narration/%'
        LIMIT 1`,
      [nameRaw, description, id, currentUserId]
    )
    const affected = Number((result as any)?.affectedRows || 0)
    if (!affected) throw new DomainError('not_found', 'not_found', 404)
    res.json({ ok: true })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.delete('/api/create-video/narration/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) throw new DomainError('bad_id', 'bad_id', 400)

    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, s3_bucket, s3_key
         FROM uploads
        WHERE id = ?
          AND user_id = ?
          AND kind = 'audio'
          AND s3_key LIKE '%audio/narration/%'
        LIMIT 1`,
      [id, currentUserId]
    )
    const u = (rows as any[])[0]
    if (!u) throw new DomainError('not_found', 'not_found', 404)
    const bucket = String(u.s3_bucket || '')
    const key = String(u.s3_key || '')
    if (!bucket || !key) throw new DomainError('not_found', 'not_found', 404)

    const lastSlash = key.lastIndexOf('/')
    const audioPrefix = lastSlash >= 0 ? key.slice(0, lastSlash + 1) : key
    const proxyPrefix = `proxies/uploads/${id}/audio/`

    const del1 = await deletePrefix(bucket, audioPrefix)
    const del2 = await deletePrefix(bucket, proxyPrefix)
    const hadErr = del1.errors.length || del2.errors.length
    if (hadErr) {
      const err: any = new DomainError('s3_delete_failed', 's3_delete_failed', 502)
      err.detail = { audio: del1, proxy: del2 }
      throw err
    }

    await db.query(`DELETE FROM uploads WHERE id = ? AND user_id = ? LIMIT 1`, [id, currentUserId])
    res.json({ ok: true })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.patch('/api/create-video/audio/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) throw new DomainError('bad_id', 'bad_id', 400)
    const body = (req.body || {}) as any
    const nameRaw = String(body.name ?? body.modified_filename ?? body.modifiedFilename ?? '').trim()
    const descRaw = body.description == null ? '' : String(body.description || '').trim()
    if (!nameRaw) throw new DomainError('missing_name', 'missing_name', 400)
    if (nameRaw.length > 512) throw new DomainError('invalid_name', 'invalid_name', 400)
    if (descRaw.length > 2000) throw new DomainError('invalid_description', 'invalid_description', 400)
    const description = descRaw.length ? descRaw : null

    const db = getPool()
    const [result] = await db.query(
      `UPDATE uploads
          SET modified_filename = ?, description = ?
        WHERE id = ?
          AND user_id = ?
          AND kind = 'audio'
          AND s3_key LIKE '%audio/music/%'
        LIMIT 1`,
      [nameRaw, description, id, currentUserId]
    )
    const affected = Number((result as any)?.affectedRows || 0)
    if (!affected) throw new DomainError('not_found', 'not_found', 404)
    res.json({ ok: true })
  } catch (err: any) {
    next(err)
  }
})

createVideoRouter.delete('/api/create-video/audio/:id', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) throw new DomainError('bad_id', 'bad_id', 400)

    const db = getPool()
    const [rows] = await db.query(
      `SELECT id, s3_bucket, s3_key
         FROM uploads
        WHERE id = ?
          AND user_id = ?
          AND kind = 'audio'
          AND s3_key LIKE '%audio/music/%'
        LIMIT 1`,
      [id, currentUserId]
    )
    const u = (rows as any[])[0]
    if (!u) throw new DomainError('not_found', 'not_found', 404)
    const bucket = String(u.s3_bucket || '')
    const key = String(u.s3_key || '')
    if (!bucket || !key) throw new DomainError('not_found', 'not_found', 404)

    const lastSlash = key.lastIndexOf('/')
    const audioPrefix = lastSlash >= 0 ? key.slice(0, lastSlash + 1) : key
    const proxyPrefix = `proxies/uploads/${id}/audio/`

    const del1 = await deletePrefix(bucket, audioPrefix)
    const del2 = await deletePrefix(bucket, proxyPrefix)
    const hadErr = del1.errors.length || del2.errors.length
    if (hadErr) {
      const err: any = new DomainError('s3_delete_failed', 's3_delete_failed', 502)
      err.detail = { audio: del1, proxy: del2 }
      throw err
    }

    await db.query(`DELETE FROM uploads WHERE id = ? AND user_id = ? LIMIT 1`, [id, currentUserId])
    res.json({ ok: true })
  } catch (err: any) {
    next(err)
  }
})
