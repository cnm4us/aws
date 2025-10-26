import { Router } from 'express';
import { z } from 'zod';
import { getPool } from '../db';
import { MC_ROLE_ARN, OUTPUT_BUCKET } from '../config';
import { startProductionRender } from '../services/productionRunner';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';
import { PERM } from '../security/perm'

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

    const db = getPool();
    const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ?`, [id]);
    const upload = (rows as any)[0];
    if (!upload) return res.status(404).json({ error: 'not_found' });
    if (upload.status !== 'uploaded') return res.status(400).json({ error: 'invalid_state', detail: 'status must be uploaded' });

    const currentUserId = Number(req.user!.id);
    const ownerId = upload.user_id ? Number(upload.user_id) : null;
    const spaceId = upload.space_id ? Number(upload.space_id) : null;
    const allowed =
      (ownerId && (await can(currentUserId, PERM.VIDEO_PUBLISH_OWN, { ownerId }))) ||
      (spaceId && (await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE, { spaceId }))) ||
      (await can(currentUserId, PERM.VIDEO_PUBLISH_SPACE)) ||
      (await can(currentUserId, PERM.VIDEO_APPROVE));
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    let chosenProfile: string = profile || (
      upload.width && upload.height ? (upload.height > upload.width ? 'portrait-hls' : 'landscape-both-hls') : 'simple-hls'
    );
    if (!profile && typeof quality === 'string') {
      if (quality.toLowerCase().startsWith('hq')) {
        if (!chosenProfile.endsWith('-hq')) chosenProfile = `${chosenProfile}-hq`;
      } else {
        chosenProfile = chosenProfile.replace(/-hq$/, '');
      }
    }

    const { jobId, outPrefix, productionId } = await startProductionRender({
      upload,
      userId: currentUserId,
      profile: chosenProfile,
      quality,
      sound,
    });

    res.json({ ok: true, jobId, productionId, output: { bucket: OUTPUT_BUCKET, prefix: outPrefix }, profile: chosenProfile });
  } catch (err: any) {
    console.error('publish error', err);
    res.status(400).json({ error: 'failed_to_publish', detail: String(err?.message || err) });
  }
});
