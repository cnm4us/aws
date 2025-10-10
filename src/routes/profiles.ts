import { Router } from 'express';
import fs from 'fs';
import path from 'path';

export const profilesRouter = Router();

profilesRouter.get('/api/profiles', async (_req, res) => {
  try {
    const dir = path.resolve(process.cwd(), 'jobs', 'profiles');
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => f.replace(/\.json$/, ''))
        .sort();
    } catch {}
    res.json({ profiles: names });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_list_profiles', detail: String(err?.message || err) });
  }
});

