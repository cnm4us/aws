import { Router } from 'express';
import { getPool } from '../db';
import { enhanceUploadRow } from '../utils/enhance';
import { OUTPUT_BUCKET, UPLOAD_BUCKET } from '../config';
import { s3 } from '../services/s3';
import { DeleteObjectsCommand, ListObjectsV2Command, type ListObjectsV2CommandOutput, type _Object } from '@aws-sdk/client-s3';
import { requireAuth } from '../middleware/auth';
import { can } from '../security/permissions';

export const uploadsRouter = Router();

uploadsRouter.get('/api/uploads', async (req, res) => {
  try {
    const db = getPool();
    const { status, limit, cursor, user_id, space_id, include_publications } = req.query as any;
    const lim = Math.min(Number(limit || 50), 500);
    const curId = cursor ? Number(cursor) : undefined;
    const where: string[] = [];
    const params: any[] = [];
    if (status) { where.push('status = ?'); params.push(String(status)); }
    if (user_id) { where.push('user_id = ?'); params.push(Number(user_id)); }
    if (space_id) { where.push('space_id = ?'); params.push(Number(space_id)); }
    if (curId && Number.isFinite(curId)) { where.push('id < ?'); params.push(curId); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [rows] = await db.query(`SELECT * FROM uploads ${whereSql} ORDER BY id DESC LIMIT ?`, [...params, lim]);
    const rawUploads = (rows as any[]);

    let publicationsByUpload: Record<number, any[]> | null = null;
    const includePubs = include_publications === '1' || include_publications === 'true';
    if (includePubs && rawUploads.length) {
      const ids = rawUploads.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
      if (ids.length) {
        try {
          const placeholders = ids.map(() => '?').join(',');
          const [pubRows] = await db.query(
            `SELECT sp.upload_id, sp.space_id, sp.status, sp.published_at, sp.unpublished_at,
                    s.name AS space_name, s.type AS space_type
               FROM space_publications sp
               JOIN spaces s ON s.id = sp.space_id
              WHERE sp.upload_id IN (${placeholders})
              ORDER BY sp.published_at DESC, sp.id DESC`,
            ids
          );
          publicationsByUpload = {};
          for (const row of pubRows as any[]) {
            const uploadId = Number(row.upload_id);
            if (!publicationsByUpload[uploadId]) publicationsByUpload[uploadId] = [];
            publicationsByUpload[uploadId].push({
              spaceId: Number(row.space_id),
              spaceName: row.space_name,
              spaceType: row.space_type,
              status: row.status,
              publishedAt: row.published_at,
              unpublishedAt: row.unpublished_at,
            });
          }
        } catch (err) {
          console.warn('fetch upload publications failed', err);
        }
      }
    }

    const result = rawUploads.map((row) => {
      const enhanced = enhanceUploadRow(row);
      if (publicationsByUpload) {
        const list = publicationsByUpload[Number(row.id)] || [];
        enhanced.publications = list;
      }
      return enhanced;
    });

    return res.json(result);
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
    const enhanced = enhanceUploadRow(row);

    const includePublications = req.query?.include_publications === '1' || req.query?.include_publications === 'true';
    if (includePublications) {
      try {
        const [pubRows] = await db.query(
          `SELECT sp.space_id, sp.status, sp.published_at, sp.unpublished_at,
                  s.name AS space_name, s.type AS space_type
             FROM space_publications sp
             JOIN spaces s ON s.id = sp.space_id
            WHERE sp.upload_id = ?
            ORDER BY sp.published_at DESC, sp.id DESC`,
          [id]
        );
        enhanced.publications = (pubRows as any[]).map((r) => ({
          spaceId: Number(r.space_id),
          spaceName: r.space_name,
          spaceType: r.space_type,
          status: r.status,
          publishedAt: r.published_at,
          unpublishedAt: r.unpublished_at,
        }));
      } catch (err) {
        console.warn('fetch upload publications failed', err);
      }
    }

    return res.json(enhanced);
  } catch (err: any) {
    console.error('get upload error', err);
    res.status(500).json({ error: 'failed_to_get', detail: String(err?.message || err) });
  }
});

uploadsRouter.get('/api/uploads/:id/publish-options', requireAuth, async (req, res) => {
  try {
    const db = getPool();
    const uploadId = Number(req.params.id);
    if (!Number.isFinite(uploadId) || uploadId <= 0) return res.status(400).json({ error: 'bad_id' });

    const [rows] = await db.query(`SELECT id, user_id, origin_space_id FROM uploads WHERE id = ?`, [uploadId]);
    const upload = (rows as any[])[0];
    if (!upload) return res.status(404).json({ error: 'not_found' });

    const currentUserId = Number(req.user!.id);
    const ownerId = upload.user_id != null ? Number(upload.user_id) : null;

    const allowedOwner = ownerId != null && (await can(currentUserId, 'video:publish_own', { ownerId }));
    const originSpaceId = upload.origin_space_id != null ? Number(upload.origin_space_id) : null;
    const allowedOrigin = originSpaceId ? await can(currentUserId, 'video:publish_space', { spaceId: originSpaceId }) : false;
    const allowedAdmin = await can(currentUserId, 'video:publish_space');
    if (!allowedOwner && !allowedOrigin && !allowedAdmin) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const spaces: { id: number; name: string; slug: string; type: string }[] = [];

    // Personal space for owner
    if (ownerId != null) {
      const [personalRows] = await db.query(
        `SELECT id, name, slug, type FROM spaces WHERE type = 'personal' AND owner_user_id = ? LIMIT 1`,
        [ownerId]
      );
      const personal = (personalRows as any[])[0];
      if (personal) {
        spaces.push({
          id: Number(personal.id),
          name: String(personal.name || ''),
          slug: String(personal.slug || ''),
          type: String(personal.type || ''),
        });
      }
    }

    // Spaces where user has publish permissions
    const [spaceRows] = await db.query(
      `SELECT s.id, s.name, s.slug, s.type
         FROM spaces s
         JOIN user_space_roles usr ON usr.space_id = s.id
         JOIN roles r ON r.id = usr.role_id
         JOIN role_permissions rp ON rp.role_id = r.id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE usr.user_id = ? AND p.name IN ('video:publish_space', 'video:approve_space', 'space:post')
        GROUP BY s.id, s.name, s.slug, s.type
        ORDER BY s.type, s.name`,
      [currentUserId]
    );

    for (const row of spaceRows as any[]) {
      const spaceId = Number(row.id);
      if (spaces.some((s) => s.id === spaceId)) continue;
      spaces.push({
        id: spaceId,
        name: String(row.name || ''),
        slug: String(row.slug || ''),
        type: String(row.type || ''),
      });
    }

    res.json({
      uploadId,
      spaces: spaces.map((s) => ({
        id: Number(s.id),
        name: String(s.name || ''),
        slug: String(s.slug || ''),
        type: String(s.type || ''),
      })),
    });
  } catch (err: any) {
    console.error('publish options failed', err);
    res.status(500).json({ error: 'failed_to_fetch_options', detail: String(err?.message || err) });
  }
});

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
