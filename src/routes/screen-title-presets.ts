import { Router } from 'express'
import { requireAuth } from '../middleware/auth'
import * as svc from '../features/screen-title-presets/service'
import { listScreenTitleFontFamilies } from '../services/fonts/screenTitleFonts'
import { listScreenTitleGradients } from '../services/fonts/screenTitleGradients'

export const screenTitlePresetsRouter = Router()

screenTitlePresetsRouter.get('/api/screen-title-fonts', requireAuth, async (_req, res, next) => {
  try {
    const families = listScreenTitleFontFamilies()
    res.json({ families })
  } catch (err: any) {
    next(err)
  }
})

screenTitlePresetsRouter.get('/api/screen-title-gradients', requireAuth, async (_req, res, next) => {
  try {
    const gradients = listScreenTitleGradients()
    res.json({ gradients })
  } catch (err: any) {
    next(err)
  }
})

screenTitlePresetsRouter.get('/api/screen-title-presets', requireAuth, async (req, res, next) => {
  try {
    const includeArchived = req.query?.include_archived === '1' || req.query?.include_archived === 'true'
    const limitRaw = req.query?.limit ? Number(req.query.limit) : undefined
    const limit = limitRaw != null && Number.isFinite(limitRaw) ? limitRaw : undefined
    const rows = await svc.listForUser(Number(req.user!.id), { includeArchived, limit })
    res.json(rows)
  } catch (err: any) { next(err) }
})

screenTitlePresetsRouter.post('/api/screen-title-presets', requireAuth, async (req, res, next) => {
  try {
    const body = req.body || {}
    const preset = await svc.createForUser({
      name: body.name,
      description: body.description,
      style: body.style,
      fontKey: body.fontKey,
      fontGradientKey: body.fontGradientKey,
      fontSizePct: body.fontSizePct,
      trackingPct: body.trackingPct,
      fontColor: body.fontColor,
      outlineWidthPct: body.outlineWidthPct,
      outlineOpacityPct: body.outlineOpacityPct,
      outlineColor: body.outlineColor,
      marginLeftPct: body.marginLeftPct,
      marginRightPct: body.marginRightPct,
      marginTopPct: body.marginTopPct,
      marginBottomPct: body.marginBottomPct,
      pillBgColor: body.pillBgColor,
      pillBgOpacityPct: body.pillBgOpacityPct,
      alignment: body.alignment,
      position: body.position,
      maxWidthPct: body.maxWidthPct,
      insetXPreset: body.insetXPreset,
      insetYPreset: body.insetYPreset,
      timingRule: body.timingRule,
      timingSeconds: body.timingSeconds,
      fade: body.fade,
    }, Number(req.user!.id))
    res.status(201).json({ preset })
  } catch (err: any) { next(err) }
})

screenTitlePresetsRouter.get('/api/screen-title-presets/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const preset = await svc.getForUser(id, Number(req.user!.id))
    res.json({ preset })
  } catch (err: any) { next(err) }
})

async function handleUpdate(req: any, res: any, next: any) {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const body = req.body || {}
    const preset = await svc.updateForUser(id, {
      name: body.name,
      description: body.description,
      style: body.style,
      fontKey: body.fontKey,
      fontGradientKey: body.fontGradientKey,
      fontSizePct: body.fontSizePct,
      trackingPct: body.trackingPct,
      fontColor: body.fontColor,
      outlineWidthPct: body.outlineWidthPct,
      outlineOpacityPct: body.outlineOpacityPct,
      outlineColor: body.outlineColor,
      marginLeftPct: body.marginLeftPct,
      marginRightPct: body.marginRightPct,
      marginTopPct: body.marginTopPct,
      marginBottomPct: body.marginBottomPct,
      pillBgColor: body.pillBgColor,
      pillBgOpacityPct: body.pillBgOpacityPct,
      alignment: body.alignment,
      position: body.position,
      maxWidthPct: body.maxWidthPct,
      insetXPreset: body.insetXPreset,
      insetYPreset: body.insetYPreset,
      timingRule: body.timingRule,
      timingSeconds: body.timingSeconds,
      fade: body.fade,
    }, Number(req.user!.id))
    res.json({ preset })
  } catch (err: any) { next(err) }
}

screenTitlePresetsRouter.patch('/api/screen-title-presets/:id', requireAuth, handleUpdate)
screenTitlePresetsRouter.put('/api/screen-title-presets/:id', requireAuth, handleUpdate)

screenTitlePresetsRouter.delete('/api/screen-title-presets/:id', requireAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const result = await svc.archiveForUser(id, Number(req.user!.id))
    res.json(result)
  } catch (err: any) { next(err) }
})
