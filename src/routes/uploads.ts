import { Router } from 'express';
import { getPool } from '../db';
import { enhanceUploadRow } from '../utils/enhance';

export const uploadsRouter = Router();

uploadsRouter.get('/api/uploads', async (req, res) => {
  try {
    const db = getPool();
    const { status, limit } = req.query as any;
    const lim = Math.min(Number(limit || 50), 500);
    if (status) {
      const [rows] = await db.query(`SELECT * FROM uploads WHERE status = ? ORDER BY id DESC LIMIT ?`, [String(status), lim]);
      return res.json((rows as any[]).map(enhanceUploadRow));
    }
    const [rows] = await db.query(`SELECT * FROM uploads ORDER BY id DESC LIMIT ?`, [lim]);
    res.json((rows as any[]).map(enhanceUploadRow));
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

