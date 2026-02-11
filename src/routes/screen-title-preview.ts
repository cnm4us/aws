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

function normalizeHexColor(raw: any, fallback: string): string {
  const s = String(raw ?? '').trim()
  const m = s.match(/^#([0-9a-fA-F]{6})$/)
  return m ? `#${m[1].toLowerCase()}` : fallback
}

function normalizePct(raw: any, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

function normalizeInt(raw: any, fallback: number, min: number, max: number): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.round(Math.min(Math.max(n, min), max))
}

function normalizeFrame(raw: any): { width: number; height: number } {
  const w = normalizeInt(raw?.width, 1080, 240, 4096)
  const h = normalizeInt(raw?.height, 1920, 240, 4096)
  return { width: w, height: h }
}

function sanitizePresetDraft(raw: any): any {
  const styleRaw = String(raw?.style || 'pill').trim().toLowerCase()
  const style = styleRaw === 'none' || styleRaw === 'strip' || styleRaw === 'pill' ? styleRaw : 'pill'
  const alignmentRaw = String(raw?.alignment || 'center').trim().toLowerCase()
  const alignment = alignmentRaw === 'left' || alignmentRaw === 'right' || alignmentRaw === 'center' ? alignmentRaw : 'center'
  const fadeRaw = String(raw?.fade || 'out').trim().toLowerCase()
  const fade = fadeRaw === 'none' || fadeRaw === 'in' || fadeRaw === 'out' || fadeRaw === 'in_out' ? fadeRaw : 'out'
  const timingRuleRaw = String(raw?.timingRule || 'first_only').trim().toLowerCase()
  const timingRule = timingRuleRaw === 'entire' || timingRuleRaw === 'first_only' ? timingRuleRaw : 'first_only'
  const fontGradientKeyRaw = raw?.fontGradientKey == null ? null : String(raw.fontGradientKey).trim()
  const fontGradientKey = fontGradientKeyRaw ? fontGradientKeyRaw : null
  const outlineColorRaw = raw?.outlineColor == null ? null : String(raw.outlineColor).trim()
  const outlineColor = outlineColorRaw && /^#([0-9a-fA-F]{6})$/.test(outlineColorRaw) ? outlineColorRaw.toLowerCase() : null

  return {
    style,
    fontKey: String(raw?.fontKey || 'dejavu_sans_bold').trim() || 'dejavu_sans_bold',
    sizeKey: String(raw?.sizeKey || '18').trim() || '18',
    fontSizePct: normalizePct(raw?.fontSizePct, 4.5, 1, 12),
    trackingPct: normalizePct(raw?.trackingPct, 0, -20, 50),
    lineSpacingPct: normalizePct(raw?.lineSpacingPct, 0, -20, 200),
    fontColor: normalizeHexColor(raw?.fontColor, '#ffffff'),
    shadowColor: normalizeHexColor(raw?.shadowColor, '#000000'),
    shadowOffsetPx: normalizeInt(raw?.shadowOffsetPx, 2, -50, 50),
    shadowBlurPx: normalizeInt(raw?.shadowBlurPx, 0, 0, 20),
    shadowOpacityPct: normalizeInt(raw?.shadowOpacityPct, 65, 0, 100),
    fontGradientKey,
    outlineWidthPct: raw?.outlineWidthPct == null ? null : normalizePct(raw?.outlineWidthPct, 0, 0, 100),
    outlineOpacityPct: raw?.outlineOpacityPct == null ? null : normalizePct(raw?.outlineOpacityPct, 0, 0, 100),
    outlineColor,
    pillBgColor: normalizeHexColor(raw?.pillBgColor, '#000000'),
    pillBgOpacityPct: normalizeInt(raw?.pillBgOpacityPct, 55, 0, 100),
    alignment,
    maxWidthPct: normalizePct(raw?.maxWidthPct, 90, 10, 100),
    timingRule,
    timingSeconds:
      timingRule === 'entire'
        ? null
        : normalizeInt(raw?.timingSeconds, 10, 0, 3600),
    fade,
  }
}

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
    if (text.length > 1000) throw new DomainError('invalid_screen_title', 'invalid_screen_title', 400)
    const lines = text.split('\n')
    if (lines.length > 30) throw new DomainError('invalid_screen_title_lines', 'invalid_screen_title_lines', 400)

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

screenTitlePreviewRouter.post('/api/screen-title-presets/preview', requireAuth, async (req, res, next) => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bacs-screen-title-preset-preview-'))
  try {
    const body = req.body || {}
    const presetId = Number(body.presetId)
    const hasPresetId = Number.isFinite(presetId) && presetId > 0
    const textRaw = String(body.text || '').replace(/\r\n/g, '\n')
    const text = textRaw.trim()
    if (!text) throw new DomainError('missing_text', 'missing_text', 400)
    if (text.length > 1000) throw new DomainError('invalid_screen_title', 'invalid_screen_title', 400)
    const lines = text.split('\n')
    if (lines.length > 30) throw new DomainError('invalid_screen_title_lines', 'invalid_screen_title_lines', 400)

    let preset: any = null
    if (hasPresetId) {
      preset = await screenTitlePresetsSvc.getActiveForUser(presetId, Number(req.user!.id))
    } else {
      preset = sanitizePresetDraft(body.preset || {})
    }

    const frame = normalizeFrame(body.frame)
    const outPath = path.join(tmpDir, 'preview.png')
    await renderScreenTitlePngWithPango({
      input: { text, preset, frame },
      outPath,
    })

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
