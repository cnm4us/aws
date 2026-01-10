import { Router } from 'express';
import { z } from 'zod';
// route now delegates to uploads service; no direct crypto/db/config usage here
import * as uploadsSvc from '../features/uploads/service'
import { requireAuthOrAdminToken } from '../middleware/auth';

export const signingRouter = Router();

const signSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  kind: z.enum(['video', 'logo', 'audio', 'image']).optional(),
  imageRole: z.string().max(64).optional(),
  userId: z.number().int().positive().optional(),
  modifiedFilename: z.string().max(512).optional(),
  description: z.string().max(4000).optional(),
  artist: z.string().max(255).optional(),
  genreTagIds: z.array(z.number().int().positive()).max(200).optional(),
  moodTagIds: z.array(z.number().int().positive()).max(200).optional(),
});

signingRouter.post('/api/sign-upload', requireAuthOrAdminToken, async (req, res) => {
  try {
    const parsed = signSchema.parse(req.body || {})
    const actorId = req.user ? Number(req.user.id) : null
    const result = await uploadsSvc.createSignedUpload({
      filename: parsed.filename,
      contentType: parsed.contentType,
      sizeBytes: parsed.sizeBytes,
      width: parsed.width ?? null,
      height: parsed.height ?? null,
      durationSeconds: parsed.durationSeconds ?? null,
      kind: parsed.kind,
      imageRole: parsed.imageRole ?? null,
      modifiedFilename: parsed.modifiedFilename,
      description: parsed.description,
      artist: parsed.artist,
      genreTagIds: parsed.genreTagIds,
      moodTagIds: parsed.moodTagIds,
      ownerUserId: parsed.userId ?? null,
    }, { userId: actorId })
    res.json(result)
  } catch (err: any) {
    console.error('sign-upload error', err);
    res.status(400).json({ error: 'failed_to_sign', detail: String(err?.message || err) });
  }
});

const completeSchema = z.object({
  id: z.number().int().positive(),
  etag: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
});

signingRouter.post('/api/mark-complete', requireAuthOrAdminToken, async (req, res) => {
  try {
    const { id, etag, sizeBytes } = completeSchema.parse(req.body || {})
    const result = await uploadsSvc.markComplete({ id, etag: etag ?? undefined, sizeBytes: sizeBytes ?? undefined }, { userId: req.user ? Number(req.user.id) : null })
    res.json(result)
  } catch (err: any) {
    console.error('mark-complete error', err);
    res.status(400).json({ error: 'failed_to_mark', detail: String(err?.message || err) });
  }
});
