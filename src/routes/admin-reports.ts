import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../middleware/auth'
import * as reportsSvc from '../features/reports/service'
import { isDismissedResolutionCode, isResolvedResolutionCode } from '../features/reports/resolution-codes'

export const adminReportsRouter = Router()

const collectionPaths = ['/api/admin/reports']
const detailPaths = ['/api/admin/reports/:id']
const assignPaths = ['/api/admin/reports/:id/assign']
const statusPaths = ['/api/admin/reports/:id/status']
const resolvePaths = ['/api/admin/reports/:id/resolve']
const dismissPaths = ['/api/admin/reports/:id/dismiss']

adminReportsRouter.use(collectionPaths, requireAuth)
adminReportsRouter.use(detailPaths, requireAuth)
adminReportsRouter.use(assignPaths, requireAuth)
adminReportsRouter.use(statusPaths, requireAuth)
adminReportsRouter.use(resolvePaths, requireAuth)
adminReportsRouter.use(dismissPaths, requireAuth)

const listSchema = z.object({
  status: z.enum(['open', 'in_review', 'resolved', 'dismissed']).optional(),
  scope: z.enum(['global', 'space_culture', 'unknown']).optional(),
  space_id: z.coerce.number().int().positive().optional(),
  rule_id: z.coerce.number().int().positive().optional(),
  reporter_user_id: z.coerce.number().int().positive().optional(),
  assigned_to_user_id: z.coerce.number().int().positive().optional(),
  from: z.string().trim().min(1).max(32).optional(),
  to: z.string().trim().min(1).max(32).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.coerce.number().int().positive().optional(),
})

adminReportsRouter.get(collectionPaths, async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_query', detail: parsed.error.flatten() })
    const currentUserId = Number(req.user!.id)
    const data = await reportsSvc.listReportsForAdmin(currentUserId, {
      status: parsed.data.status ?? null,
      scope: parsed.data.scope ?? null,
      spaceId: parsed.data.space_id ?? null,
      ruleId: parsed.data.rule_id ?? null,
      reporterUserId: parsed.data.reporter_user_id ?? null,
      assignedToUserId: parsed.data.assigned_to_user_id ?? null,
      from: parsed.data.from ?? null,
      to: parsed.data.to ?? null,
      limit: parsed.data.limit ?? 50,
      cursorId: parsed.data.cursor ?? null,
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

adminReportsRouter.get(detailPaths, async (req, res, next) => {
  try {
    const reportId = Number(req.params.id)
    if (!Number.isFinite(reportId) || reportId <= 0) return res.status(400).json({ error: 'bad_report_id' })
    const currentUserId = Number(req.user!.id)
    const data = await reportsSvc.getReportDetailForAdmin(currentUserId, reportId)
    res.json(data)
  } catch (err) {
    next(err)
  }
})

const assignSchema = z.object({
  assigned_to_user_id: z.union([z.number().int().positive(), z.null()]),
  note: z.string().trim().max(500).optional(),
})

adminReportsRouter.post(assignPaths, async (req, res, next) => {
  try {
    const reportId = Number(req.params.id)
    if (!Number.isFinite(reportId) || reportId <= 0) return res.status(400).json({ error: 'bad_report_id' })
    const parsed = assignSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const currentUserId = Number(req.user!.id)
    const data = await reportsSvc.assignReportForAdmin({
      reportId,
      actorUserId: currentUserId,
      assignedToUserId: parsed.data.assigned_to_user_id,
      note: parsed.data.note ?? null,
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

const statusSchema = z.object({
  status: z.enum(['open', 'in_review', 'resolved', 'dismissed']),
  note: z.string().trim().max(500).optional(),
})

adminReportsRouter.post(statusPaths, async (req, res, next) => {
  try {
    const reportId = Number(req.params.id)
    if (!Number.isFinite(reportId) || reportId <= 0) return res.status(400).json({ error: 'bad_report_id' })
    const parsed = statusSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const currentUserId = Number(req.user!.id)
    const data = await reportsSvc.setReportStatusForAdmin({
      reportId,
      actorUserId: currentUserId,
      status: parsed.data.status,
      note: parsed.data.note ?? null,
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

const resolveSchema = z.object({
  resolution_code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => isResolvedResolutionCode(value), { message: 'invalid_resolution_code' }),
  resolution_note: z.string().trim().max(500).optional(),
})

adminReportsRouter.post(resolvePaths, async (req, res, next) => {
  try {
    const reportId = Number(req.params.id)
    if (!Number.isFinite(reportId) || reportId <= 0) return res.status(400).json({ error: 'bad_report_id' })
    const parsed = resolveSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const currentUserId = Number(req.user!.id)
    const data = await reportsSvc.resolveReportForAdmin({
      reportId,
      actorUserId: currentUserId,
      resolutionCode: parsed.data.resolution_code,
      resolutionNote: parsed.data.resolution_note ?? null,
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})

const dismissSchema = z.object({
  resolution_code: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .refine((value) => isDismissedResolutionCode(value), { message: 'invalid_resolution_code' })
    .optional(),
  resolution_note: z.string().trim().max(500).optional(),
})

adminReportsRouter.post(dismissPaths, async (req, res, next) => {
  try {
    const reportId = Number(req.params.id)
    if (!Number.isFinite(reportId) || reportId <= 0) return res.status(400).json({ error: 'bad_report_id' })
    const parsed = dismissSchema.safeParse(req.body || {})
    if (!parsed.success) return res.status(400).json({ error: 'invalid_body', detail: parsed.error.flatten() })
    const currentUserId = Number(req.user!.id)
    const data = await reportsSvc.dismissReportForAdmin({
      reportId,
      actorUserId: currentUserId,
      resolutionCode: parsed.data.resolution_code ?? null,
      resolutionNote: parsed.data.resolution_note ?? null,
    })
    res.json(data)
  } catch (err) {
    next(err)
  }
})
