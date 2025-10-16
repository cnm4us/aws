import { Router } from 'express';
import { getPool } from '../db';
import { enhanceUploadRow } from '../utils/enhance';
import { OUTPUT_BUCKET, UPLOAD_BUCKET } from '../config';
import { s3 } from '../services/s3';
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3';

export const uploadsRouter = Router();

uploadsRouter.get('/api/uploads', async (req, res) => {
  try {
    const db = getPool();
    const { status, limit, cursor, user_id, space_id } = req.query as any;
    const lim = Math.min(Number(limit || 50), 500);
    const curId = cursor ? Number(cursor) : undefined;
    const where: string[] = [];
    const params: any[] = [];
    if (status) { where.push('status = ?'); params.push(String(status)); }
    if (user_id) { where.push('user_id = ?'); params.push(Number(user_id)); }
    if (space_id) { where.push('space_id = ?'); params.push(Number(space_id)); }
    if (curId && Number.isFinite(curId)) { where.push('id < ?'); params.push(curId); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    if (true) {
      const [rows] = await db.query(`SELECT * FROM uploads ${whereSql} ORDER BY id DESC LIMIT ?`, [...params, lim]);
      return res.json((rows as any[]).map(enhanceUploadRow));
    }
  } catch (err: any) {
    console.error('list uploads error', err);
    res.status(500).json({ error: 'failed_to_list', detail: String(err?.message || err) });
  }
});

uploadsRouter.get('/api/uploads/:id', async (req, res) => {
  try {
    const db = getPool();
    const id = Number(req.params.id);
    if (!id) return res.status(400).json({ error: 'bad_id' });
    const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ?`, [id]);
    const row = (rows as any[])[0];
    if (!row) return res.status(404).json({ error: 'not_found' });
    return res.json(enhanceUploadRow(row));
  } catch (err: any) {
    console.error('get upload error', err);
    res.status(500).json({ error: 'failed_to_get', detail: String(err?.message || err) });
  }
});

// Helper: check if user is admin
async function isAdmin(db: any, userId: number): Promise<boolean> {
  const [rows] = await db.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=? AND r.name='admin' LIMIT 1`, [userId]);
  return (rows as any[]).length > 0;
}

// Helper: check if user is space admin for a given space
async function isSpaceAdmin(db: any, userId: number, spaceId: number | null): Promise<boolean> {
  if (!spaceId) return false;
  const [rows] = await db.query(`SELECT 1 FROM user_space_roles usr JOIN roles r ON r.id=usr.role_id WHERE usr.user_id=? AND usr.space_id=? AND r.name='channel_admin' LIMIT 1`, [userId, spaceId]);
  return (rows as any[]).length > 0;
}

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

uploadsRouter.delete('/api/uploads/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const userId = Number((req.body as any)?.userId || 0);
    if (!id || !userId) return res.status(400).json({ error: 'bad_request' });
    const db = getPool();
    const [rows] = await db.query(`SELECT * FROM uploads WHERE id = ? LIMIT 1`, [id]);
    const u = (rows as any[])[0];
    if (!u) return res.status(404).json({ error: 'not_found' });
    const admin = await isAdmin(db, userId);
    const owner = u.user_id && Number(u.user_id) === userId;
    const spaceAdmin = await isSpaceAdmin(db, userId, u.space_id ? Number(u.space_id) : null);
    if (!admin && !owner && !spaceAdmin) return res.status(403).json({ error: 'forbidden' });

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
        await db.query(`INSERT INTO action_log (user_id, action, resource_type, resource_id, detail) VALUES (?, 'delete_error', 'upload', ?, ?)`, [userId, id, JSON.stringify(detail)]);
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
      await db.query(`INSERT INTO action_log (user_id, action, resource_type, resource_id, detail) VALUES (?, 'delete', 'upload', ?, ?)`, [userId, id, JSON.stringify(detail)]);
    } catch {}
    res.json({ ok: true });
  } catch (err: any) {
    console.error('delete upload error', err);
    res.status(500).json({ error: 'failed_to_delete', detail: String(err?.message || err) });
  }
});
