import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { requireAuth } from '../middleware/auth'
import * as createVideoSvc from '../features/create-video/service'
import { getPool } from '../db'
import { DomainError } from '../core/errors'
import * as screenTitlePresetsSvc from '../features/screen-title-presets/service'
import { renderScreenTitlePngWithPango } from '../services/pango/screenTitlePng'
import { uploadFileToS3 } from '../services/ffmpeg/audioPipeline'
import { nowDateYmd } from '../utils/naming'
import { UPLOAD_BUCKET } from '../config'
import { randomUUID } from 'crypto'

export const createVideoRouter = Router()

createVideoRouter.post('/api/create-video/project', requireAuth, async (req, res, next) => {
  try {
    const currentUserId = Number(req.user!.id)
    const result = await createVideoSvc.createOrGetActiveProjectForUser(currentUserId)
    res.status(result.created ? 201 : 200).json(result)
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
    const result = await createVideoSvc.getExportStatusForUser(currentUserId)
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
    if (text.length > 140) throw new DomainError('invalid_screen_title', 'invalid_screen_title', 400)
    if (text.split('\n').length > 3) throw new DomainError('invalid_screen_title_lines', 'invalid_screen_title_lines', 400)
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
