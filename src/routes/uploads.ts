import { Router } from 'express';
import { getPool } from '../db';
import { enhanceUploadRow } from '../utils/enhance';
import { OUTPUT_BUCKET, UPLOAD_BUCKET } from '../config';
import { s3 } from '../services/s3';
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';
import * as uploadsSvc from '../features/uploads/service'

export const uploadsRouter = Router();

uploadsRouter.get('/api/uploads', async (req, res) => {
  try {
    const { status, limit, cursor, user_id, space_id, include_publications } = req.query as any
    const includePubs = include_publications === '1' || include_publications === 'true'
    const result = await uploadsSvc.list({
      status: status ? String(status) : undefined,
      userId: user_id ? Number(user_id) : undefined,
      spaceId: space_id ? Number(space_id) : undefined,
      cursorId: cursor ? Number(cursor) : undefined,
      limit: limit ? Number(limit) : undefined,
      includePublications: includePubs,
    }, { userId: (req as any).user?.id ? Number((req as any).user.id) : undefined })
    return res.json(result)
  } catch (err: any) {
    console.error('list uploads error', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_list', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/uploads/:id', async (req, res) => {
  try {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'bad_id' })
    const includePublications = req.query?.include_publications === '1' || req.query?.include_publications === 'true'
    const data = await uploadsSvc.get(id, { includePublications }, { userId: (req as any).user?.id ? Number((req as any).user.id) : undefined })
    return res.json(data)
  } catch (err: any) {
    console.error('get upload error', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_get', detail: String(err?.message || err) })
  }
})

uploadsRouter.get('/api/uploads/:id/publish-options', requireAuth, async (req, res) => {
  try {
    const uploadId = Number(req.params.id)
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' })
    const data = await uploadsSvc.getPublishOptions(uploadId, { userId: Number(req.user!.id) })
    res.json(data)
  } catch (err: any) {
    console.error('publish options failed', err)
    const status = err?.status || 500
    res.status(status).json({ error: 'failed_to_fetch_options', detail: String(err?.message || err) })
  }
})

type DeleteSummary = { bucket: string; prefix: string; deleted: number; batches: number; samples: string[]; errors: string[] };

async function deletePrefix(bucket: string, prefix: string): Promise<DeleteSummary> {
  let token: string | undefined = undefined;
  let totalDeleted = 0;
  let batches = 0;
  const samples: string[] = [];
  const errors: string[] = [];
  do {
    let list: ListObjectsV2CommandOutput;
    try {
      list = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
    } catch (e: any) {
      errors.push(`list:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`);
      break;
    }
    const contents = list.Contents ?? [];
    if (contents.length) {
      const Objects = contents.map((o: _Object) => ({ Key: o.Key! }));
      // Collect up to 10 sample keys for diagnostics
      for (let i = 0; i < Math.min(10, contents.length); i++) {
        const k = contents[i]?.Key; if (k && samples.length < 10) samples.push(String(k));
      }
      try {
        await s3.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects, Quiet: true } }));
      } catch (e: any) {
        errors.push(`delete:${bucket}:${prefix}:${String(e?.name || e?.Code || e)}:${String(e?.message || e)}`);
        break;
      }
      totalDeleted += Objects.length;
      batches += 1;
    }
    token = list.IsTruncated ? list.NextContinuationToken : undefined;
  } while (token);
  return { bucket, prefix, deleted: totalDeleted, batches, samples, errors };
}

function extractUuidDirPrefix(pathStr: string): string | null {
  try {
    const p = String(pathStr);
    // Match: .../YYYY-MM/DD/UUID/
    const m = p.match(/(^|\/)\d{4}-\d{2}\/\d{2}\/([0-9a-fA-F-]{36})\//);
    if (!m) return null;
    const idx = p.indexOf(m[0]);
    if (idx < 0) return null;
    return p.slice(0, idx + m[0].length);
  } catch { return null; }
}

uploadsRouter.delete('/api/uploads/:id', requireAuth, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad_request' });
    const db = getPool();
    const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id]);
    const u = (rows as any[])[0];
    if (!u) return res.status(404).json({ error: 'not_found' });
    const currentUserId = Number(req.user!.id);
    const ownerId = u.user_id ? Number(u.user_id) : null;
    const spaceId = u.space_id ? Number(u.space_id) : null;
    const allowed =
      (ownerId && (await can(currentUserId, 'video:delete_own', { ownerId }))) ||
      (await can(currentUserId, 'video:delete_any')) ||
      (spaceId && (await can(currentUserId, 'video:unpublish_space', { spaceId })));
    if (!allowed) return res.status(403).json({ error: 'forbidden' });

    // Delete S3 objects
    let delUp: DeleteSummary | null = null;
    try {
      if (u.s3_key) {
        const key: string = String(u.s3_key);
        // Prefer regex extraction of date/uuid folder
        const byRegex = extractUuidDirPrefix(key);
        let dirPrefix = byRegex;
        if (!dirPrefix) {
          const lastSlash = key.lastIndexOf('/');
          dirPrefix = lastSlash > 0 ? key.slice(0, lastSlash + 1) : key;
        }
        if (dirPrefix) { delUp = await deletePrefix(UPLOAD_BUCKET, dirPrefix); }
      }
    } catch (e) { console.warn('delete upload object failed', e); }
    let delOut: DeleteSummary | null = null;
    try {
      if (u.output_prefix) {
        let outPrefix: string = String(u.output_prefix);
        if (!outPrefix.endsWith('/')) outPrefix += '/';
        const byRegex = extractUuidDirPrefix(outPrefix);
        let uuidDir = byRegex || outPrefix;
        // If regex failed, strip trailing orientation folder
        if (!byRegex) uuidDir = uuidDir.replace(/(?:portrait|landscape)\/$/, '');
        delOut = await deletePrefix(OUTPUT_BUCKET, uuidDir);
      }
    } catch (e) { console.warn('delete output prefix failed', e); }

    // If S3 access denied or other error, do not remove DB row; return error and log
    const hadErr = (delUp && delUp.errors.length) || (delOut && delOut.errors.length);
    if (hadErr) {
      try {
        const detail = {
          s3_key: u.s3_key,
          output_prefix: u.output_prefix,
          size_bytes: u.size_bytes,
          s3_ops: [ delUp, delOut ].filter(Boolean),
        };
        await db.query(`INSERT INTO action_log (user_id, action, resource_type, resource_id, detail) VALUES (?, 'delete_error', 'upload', ?, ?)`, [currentUserId, id, JSON.stringify(detail)]);
      } catch {}
      return res.status(502).json({ error: 's3_delete_failed', detail: { up: delUp, out: delOut } });
    }

    // Delete row (hard delete)
    await db.query(`DELETE FROM uploads WHERE id = ?`, [id]);
    // Log action
    try {
      const detail = {
        s3_key: u.s3_key,
        output_prefix: u.output_prefix,
        size_bytes: u.size_bytes,
        s3_ops: [ delUp, delOut ].filter(Boolean),
      };
      await db.query(`INSERT INTO action_log (user_id, action, resource_type, resource_id, detail) VALUES (?, 'delete', 'upload', ?, ?)`, [currentUserId, id, JSON.stringify(detail)]);
    } catch {}
    res.json({ ok: true });
  } catch (err: any) {
    console.error('delete upload error', err);
    res.status(500).json({ error: 'failed_to_delete', detail: String(err?.message || err) });
  }
});
