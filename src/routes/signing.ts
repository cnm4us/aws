import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getPool } from '../db';
import { s3 } from '../services/s3';
import { MAX_UPLOAD_MB, UPLOAD_BUCKET, UPLOAD_PREFIX } from '../config';
import { sanitizeFilename, pickExtension, nowDateYmd, buildUploadKey } from '../utils/naming';
import { requireAuthOrAdminToken } from '../middleware/auth';

export const signingRouter = Router();

const signSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
  userId: z.number().int().positive().optional(),
});

signingRouter.post('/api/sign-upload', requireAuthOrAdminToken, async (req, res) => {
  try {
    const parsed = signSchema.parse(req.body || {});
    const { filename, contentType, sizeBytes, width, height, durationSeconds, userId } = parsed;
    const safe = sanitizeFilename(filename);
    const { ymd: dateYmd, folder: datePrefix } = nowDateYmd();
    const basePrefix = UPLOAD_PREFIX ? (UPLOAD_PREFIX.endsWith('/') ? UPLOAD_PREFIX : UPLOAD_PREFIX + '/') : '';
    const assetUuid = randomUUID();

    const ext = pickExtension(contentType, safe);
    const key = buildUploadKey(basePrefix, datePrefix, assetUuid, ext);

    const db = getPool();
    const [result] = await db.query(
      `INSERT INTO uploads (s3_bucket, s3_key, original_filename, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed')`,
      [UPLOAD_BUCKET, key, filename, contentType ?? null, sizeBytes ?? null, width ?? null, height ?? null, durationSeconds ?? null, assetUuid, dateYmd]
    );
    const id = (result as any).insertId as number;

    // Associate owner with current session user when present, otherwise allow explicit userId (admin token flow)
    const ownerId = req.user ? Number(req.user.id) : userId ?? null;
    if (ownerId) {
      try {
        const [sp] = await db.query(`SELECT id FROM spaces WHERE type='personal' AND owner_user_id = ? LIMIT 1`, [ownerId]);
        const spaceId = (sp as any[]).length ? Number((sp as any[])[0].id) : null;
        await db.query(
          `UPDATE uploads
              SET user_id = ?,
                  space_id = COALESCE(?, space_id),
                  origin_space_id = COALESCE(?, origin_space_id)
            WHERE id = ?`,
          [ownerId, spaceId, spaceId, id]
        );
      } catch {}
    }

    const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
    const basePrefixCond = basePrefix || '';
    const conditions: any[] = [
      ['content-length-range', 1, maxBytes],
      ['starts-with', '$key', basePrefixCond],
    ];
    const fields: Record<string, string> = { key, 'success_action_status': '201' };
    if (contentType) fields['Content-Type'] = contentType;
    fields['x-amz-meta-original-filename'] = filename;

    const presigned = await createPresignedPost(s3, {
      Bucket: UPLOAD_BUCKET,
      Key: key,
      Conditions: conditions,
      Fields: fields,
      Expires: 60 * 5,
    });

    res.json({ id, key, bucket: UPLOAD_BUCKET, post: presigned });
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
    const { id, etag, sizeBytes } = completeSchema.parse(req.body || {});
    const db = getPool();
    await db.query(
      `UPDATE uploads
         SET status = 'uploaded', uploaded_at = CURRENT_TIMESTAMP,
             etag = COALESCE(?, etag), size_bytes = COALESCE(?, size_bytes)
       WHERE id = ?`,
      [etag ?? null, sizeBytes ?? null, id]
    );
    res.json({ ok: true });
  } catch (err: any) {
    console.error('mark-complete error', err);
    res.status(400).json({ error: 'failed_to_mark', detail: String(err?.message || err) });
  }
});
