import { Router } from 'express'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { requireAuth } from '../middleware/auth'
import { getPool } from '../db'
import { DomainError } from '../core/errors'
import * as screenTitlePresetsSvc from '../features/screen-title-presets/service'
import { renderScreenTitlePngWithPango } from '../services/pango/screenTitlePng'

export const screenTitlePreviewRouter = Router()

screenTitlePreviewRouter.post('/api/screen-titles/preview', requireAuth, async (req, res, next) => {
  const db = getPool()
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-screen-title-preview-'))
  try {
    const body = req.body || {}
    const uploadId = Number(body.uploadId)
    const presetId = Number(body.presetId)
    const textRaw = String(body.text || '').replace(/\r\n/g, '\n')
    const text = textRaw.trim()
    if (!Number.isFinite(uploadId) || uploadId <= 0) throw new DomainError('bad_upload_id', 'bad_upload_id', 400)
    if (!Number.isFinite(presetId) || presetId <= 0) throw new DomainError('bad_preset_id', 'bad_preset_id', 400)
    if (!text) throw new DomainError('missing_text', 'missing_text', 400)
    if (text.length > 800) throw new DomainError('invalid_screen_title', 'invalid_screen_title', 400)
    const lines = text.split('\n')
    if (lines.length > 24) throw new DomainError('invalid_screen_title_lines', 'invalid_screen_title_lines', 400)

    const [uRows] = await db.query(`SELECT id, user_id, width, height FROM uploads WHERE id = ? LIMIT 1`, [uploadId])
    const upload = (uRows as any[])[0]
    if (!upload) throw new DomainError('upload_not_found', 'upload_not_found', 404)
    if (Number(upload.user_id || 0) !== Number(req.user!.id)) throw new DomainError('forbidden', 'forbidden', 403)

    const preset = await screenTitlePresetsSvc.getActiveForUser(presetId, Number(req.user!.id))

    const w = upload.width != null ? Number(upload.width) : 0
    const h = upload.height != null ? Number(upload.height) : 0
    const portrait = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? (h >= w) : true
    const frame = w > 0 && h > 0 ? { width: w, height: h } : (portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 })

    const outPath = path.join(tmpDir, 'preview.png')
    await renderScreenTitlePngWithPango({
      input: { text, preset, frame },
      outPath,
    })

    // Avoid res.sendFile() here because it streams asynchronously; we'd delete tmpDir in finally
    // before the file is fully read. Read into memory and send as a single response.
    const png = fs.readFileSync(outPath)
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Length', String(png.length))
    res.status(200).end(png)
  } catch (err) {
    next(err)
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
})
