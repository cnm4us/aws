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
  sourceOrg: z.string().max(64).optional(),
  systemLibrary: z.boolean().optional(),
  genreTagIds: z.array(z.number().int().positive()).max(200).optional(),
  moodTagIds: z.array(z.number().int().positive()).max(200).optional(),
  themeTagIds: z.array(z.number().int().positive()).max(200).optional(),
  instrumentTagIds: z.array(z.number().int().positive()).max(200).optional(),
  licenseSourceId: z.number().int().positive().optional().nullable(),
  termsAccepted: z.boolean().optional(),
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
      sourceOrg: parsed.sourceOrg,
      systemLibrary: parsed.systemLibrary,
      genreTagIds: parsed.genreTagIds,
      moodTagIds: parsed.moodTagIds,
      themeTagIds: parsed.themeTagIds,
      instrumentTagIds: parsed.instrumentTagIds,
      licenseSourceId: parsed.licenseSourceId ?? null,
      termsAccepted: parsed.termsAccepted,
      ownerUserId: parsed.userId ?? null,
    }, { userId: actorId, ip: (req as any).ip ? String((req as any).ip) : null, userAgent: req.headers['user-agent'] ? String(req.headers['user-agent']) : null })
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
