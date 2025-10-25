import { Router } from 'express'
import { z } from 'zod'
import * as svc from './service'

// NOTE: This router is not yet mounted. It documents the intended thin-route shape.
// When wiring it in, keep response DTO shapes identical to current routes.

export const publicationsRouter = Router()

const createFromUploadSchema = z.object({
  spaceId: z.number().int().positive(),
  visibility: z.enum(['inherit', 'members', 'public']).optional(),
  distributionFlags: z.any().optional(),
})

publicationsRouter.post('/api/uploads/:uploadId/publications', async (_req, res) => {
  // Placeholder; not yet wired
  res.status(501).json({ error: 'not_implemented' })
})

const createFromProductionSchema = z.object({
  spaceId: z.number().int().positive(),
  visibility: z.enum(['inherit', 'members', 'public']).optional(),
  distributionFlags: z.any().optional(),
})

publicationsRouter.post('/api/productions/:productionId/publications', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})

publicationsRouter.get('/api/productions/:productionId/publications', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})

publicationsRouter.get('/api/publications/:id', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})

publicationsRouter.post('/api/publications/:id/approve', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})

publicationsRouter.post('/api/publications/:id/reject', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})

publicationsRouter.post('/api/publications/:id/unpublish', async (_req, res) => {
  res.status(501).json({ error: 'not_implemented' })
})

export default publicationsRouter

