import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth } from '../middleware/auth';
import * as profileService from '../features/profiles/service';
import * as avatarService from '../features/profiles/avatar';
import { getPool } from '../db';
import { requireValidUserSlug } from '../utils/slug';
import { DomainError } from '../core/errors';

export const profilesRouter = Router();

// Existing MediaConvert profiles endpoint (unchanged)
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

// --- User Profile (identity) APIs ---

profilesRouter.get('/api/profile/me', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const profile = await profileService.getProfile(user.id);
    res.json({ profile });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_profile', detail: String(err?.message || err) });
  }
});

profilesRouter.post('/api/profile/me', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const body = (req.body || {}) as any;
    const profile = await profileService.upsertProfile(user.id, {
      displayName: body.displayName,
      avatarUrl: body.avatarUrl,
      bio: body.bio,
      isPublic: body.isPublic,
      showBio: body.showBio,
    });
    res.json({ ok: true, profile });
  } catch (err: any) {
    if (String(err?.message) === 'display_name_required') {
      return res.status(400).json({ error: 'display_name_required' });
    }
    res.status(500).json({ error: 'failed_to_save_profile', detail: String(err?.message || err) });
  }
});

profilesRouter.get('/api/profile/:userId', async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(400).json({ error: 'bad_user_id' });
    }
    const profile = await profileService.getProfile(userId);
    if (!profile || !profile.is_public) {
      return res.status(404).json({ error: 'profile_not_found' });
    }
    const result = {
      userId: profile.user_id,
      displayName: profile.display_name,
      avatarUrl: profile.avatar_url,
      bio: profile.show_bio ? profile.bio : null,
      memberSince: profile.created_at,
      slug: profile.slug ?? null,
    };
    res.json({ profile: result });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_get_profile', detail: String(err?.message || err) });
  }
});

// Resolve a public user slug to a user id (and echo slug)
profilesRouter.get('/api/users/slug/:slug', async (req, res) => {
  try {
    const rawSlug = String(req.params.slug || '');
    let slug: string;
    try {
      slug = requireValidUserSlug(rawSlug);
    } catch (err: any) {
      const code = (err as DomainError).code || String(err?.message || 'bad_slug_format');
      if (code === 'slug_reserved' || code === 'slug_too_short' || code === 'bad_slug_format') {
        return res.status(400).json({ error: code });
      }
      return res.status(400).json({ error: 'bad_slug_format' });
    }

    const db = getPool();
    const [rows] = await db.query(`SELECT id FROM users WHERE slug = ? LIMIT 1`, [slug]);
    const row = (rows as any[])[0];
    if (!row) {
      return res.status(404).json({ error: 'user_not_found' });
    }

    return res.json({ userId: Number(row.id), slug });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_resolve_slug', detail: String(err?.message || err) });
  }
});

// Update the current user's slug
profilesRouter.put('/api/profile/slug', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });

    const body = (req.body || {}) as any;
    const rawSlug = body.slug != null ? String(body.slug) : '';
    let slug: string;
    try {
      slug = requireValidUserSlug(rawSlug);
    } catch (err: any) {
      const code = (err as DomainError).code || String(err?.message || 'bad_slug_format');
      if (code === 'slug_reserved' || code === 'slug_too_short' || code === 'bad_slug_format') {
        return res.status(400).json({ error: code });
      }
      return res.status(400).json({ error: 'bad_slug_format' });
    }

    const db = getPool();
    try {
      await db.query(`UPDATE users SET slug = ? WHERE id = ?`, [slug, user.id]);
    } catch (err: any) {
      const msg = String(err?.message || err);
      // MySQL duplicate key error codes
      if (msg.includes('Duplicate') || msg.includes('uniq_users_slug')) {
        return res.status(409).json({ error: 'slug_taken' });
      }
      throw err;
    }

    return res.json({ ok: true, slug });
  } catch (err: any) {
    res.status(500).json({ error: 'failed_to_update_slug', detail: String(err?.message || err) });
  }
});

profilesRouter.post('/api/profile/avatar/sign', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const body = (req.body || {}) as any;
    const filename = String(body.filename || '').trim();
    const contentType = body.contentType ? String(body.contentType) : undefined;
    const sizeBytes = body.sizeBytes != null ? Number(body.sizeBytes) : undefined;
    const result = await avatarService.createSignedAvatarUpload(Number(user.id), { filename, contentType, sizeBytes });
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: 'failed_to_sign_avatar', detail: String(err?.message || err) });
  }
});

profilesRouter.post('/api/profile/avatar/complete', requireAuth, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: 'unauthorized' });
    const body = (req.body || {}) as any;
    const key = String(body.key || '').trim();
    if (!key) return res.status(400).json({ error: 'missing_key' });
    const fallbackName =
      (user.display_name && String(user.display_name).trim()) ||
      (user.email ? String(user.email).split('@')[0] : null) ||
      null;
    const result = await avatarService.finalizeAvatar(Number(user.id), key, fallbackName);
    res.json(result);
  } catch (err: any) {
    const msg = String(err?.message || err);
    if (msg === 'invalid_avatar_key') {
      return res.status(400).json({ error: 'invalid_avatar_key' });
    }
    res.status(500).json({ error: 'failed_to_complete_avatar', detail: msg });
  }
});
