import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getPool } from '../db';
import { s3 } from '../services/s3';
import { MAX_UPLOAD_MB, UPLOAD_BUCKET, UPLOAD_PREFIX } from '../config';

export const signingRouter = Router();

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 200);
}

const signSchema = z.object({
  filename: z.string().min(1),
  contentType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  width: z.number().int().positive().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  durationSeconds: z.number().int().positive().nullable().optional(),
});

signingRouter.post('/api/sign-upload', async (req, res) => {
  try {
    const parsed = signSchema.parse(req.body || {});
    const { filename, contentType, sizeBytes, width, height, durationSeconds } = parsed;
    const safe = sanitizeFilename(filename);
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const dateYmd = `${y}-${m}-${d}`;
    const datePrefix = `${y}-${m}/${d}`; // YYYY-MM/DD
    const basePrefix = UPLOAD_PREFIX ? (UPLOAD_PREFIX.endsWith('/') ? UPLOAD_PREFIX : UPLOAD_PREFIX + '/') : '';
    const assetUuid = randomUUID();

    const lowerCt = String(contentType || '').toLowerCase();
    const extFromName = (safe.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    const ext = lowerCt.includes('mp4') ? '.mp4'
      : lowerCt.includes('webm') ? '.webm'
      : lowerCt.includes('quicktime') || lowerCt.includes('mov') ? '.mov'
      : (extFromName || '.mp4');
    const key = `${basePrefix}${datePrefix}/${assetUuid}/video${ext}`;

    const db = getPool();
    const [result] = await db.query(
      `INSERT INTO uploads (s3_bucket, s3_key, original_filename, content_type, size_bytes, width, height, duration_seconds, asset_uuid, date_ymd, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'signed')`,
      [UPLOAD_BUCKET, key, filename, contentType ?? null, sizeBytes ?? null, width ?? null, height ?? null, durationSeconds ?? null, assetUuid, dateYmd]
    );
    const id = (result as any).insertId as number;

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

signingRouter.post('/api/mark-complete', async (req, res) => {
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

