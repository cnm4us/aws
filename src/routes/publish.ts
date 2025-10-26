import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db';
import { MC_ROLE_ARN, OUTPUT_BUCKET } from '../config';
import { startProductionRender } from '../services/productionRunner';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';
import { PERM } from '../security/perm'
import * as prodSvc from '../features/productions/service'

export const publishRouter = Router();

const publishSchema = z.object({
  id: z.number().int().positive(),
  profile: z.string().optional(),
  quality: z.string().optional(),
  sound: z.string().optional(),
});

publishRouter.post('/api/publish', requireAuth, async (req, res) => {
  try {
    const { id, profile, quality, sound } = publishSchema.parse(req.body || {});
    if (!MC_ROLE_ARN) return res.status(500).json({ error: 'server_not_configured', detail: 'MC_ROLE_ARN not set' });
    const currentUserId = Number(req.user!.id);

    // Delegate to service wrapper preserving legacy permission semantics
    // Compute profile selection equivalent to legacy behavior
    let chosenProfile: string | null = profile || null
    try {
      if (!chosenProfile) {
        const db = getPool();
        const [rows] = await db.query(`SELECT width, height FROM uploads WHERE id = ? LIMIT 1`, [id]);
        const u = (rows as any[])[0] || {}
        chosenProfile = u.width && u.height ? (u.height > u.width ? 'portrait-hls' : 'landscape-both-hls') : 'simple-hls'
      }
      if (!profile && typeof quality === 'string') {
        if (quality.toLowerCase().startsWith('hq')) {
          if (!chosenProfile!.endsWith('-hq')) chosenProfile = `${chosenProfile}-hq`;
        } else {
          chosenProfile = chosenProfile!.replace(/-hq$/, '');
        }
      }
    } catch {}

    const result = await prodSvc.createForPublishRoute({ uploadId: id, profile: chosenProfile, quality, sound }, currentUserId)
    res.json({ ok: true, jobId: result.jobId, productionId: result.production.id, output: result.output, profile: chosenProfile })
  } catch (err: any) {
    console.error('publish error', err);
    res.status(400).json({ error: 'failed_to_publish', detail: String(err?.message || err) });
  }
});
