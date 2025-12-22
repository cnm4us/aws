import { DomainError } from '../core/errors'

const RESERVED_USER_SLUGS: ReadonlySet<string> = new Set([
  // System & navigation
  'me',
  'settings',
  'account',
  'accounts',
  'admin',
  'moderator',
  'mod',
  'support',
  'help',
  'login',
  'logout',
  'signup',
  'signin',
  'auth',
  'api',
  'global',
  'global-feed',
  'feed',
  'channels',
  'groups',
  'users',
  'profile',
  'profiles',
  // Ambiguous / dangerous
  'root',
  'system',
  'null',
  'undefined',
  'true',
  'false',
]);

export type UserSlugErrorCode = 'bad_slug_format' | 'slug_too_short' | 'slug_reserved';

export type UserSlugValidationResult =
  | { ok: true; slug: string }
  | { ok: false; errorCode: UserSlugErrorCode };

/**
 * Normalize and validate a user-editable slug according to plan_07 rules:
 * - first char: a–z
 * - subsequent chars: a–z, 0–9, '-'
 * - no leading/trailing hyphen, no `--`
 * - ASCII only, 3–32 chars
 * - must not be in RESERVED_USER_SLUGS
 *
 * On error, throws a DomainError with code: bad_slug_format, slug_too_short, or slug_reserved.
 */
export function requireValidUserSlug(input: string): string {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) {
    throw new DomainError('bad_slug_format', 'bad_slug_format', 400);
  }

  if (raw.length < 3) {
    throw new DomainError('slug_too_short', 'slug_too_short', 400);
  }
  if (raw.length > 32) {
    throw new DomainError('bad_slug_format', 'bad_slug_format', 400);
  }

  // Must start with a letter; subsequent chars a–z, 0–9, or hyphen.
  if (!/^[a-z][a-z0-9-]*$/.test(raw)) {
    throw new DomainError('bad_slug_format', 'bad_slug_format', 400);
  }

  // No consecutive hyphens, and no trailing hyphen.
  if (raw.includes('--') || raw.endsWith('-')) {
    throw new DomainError('bad_slug_format', 'bad_slug_format', 400);
  }

  if (RESERVED_USER_SLUGS.has(raw)) {
    throw new DomainError('slug_reserved', 'slug_reserved', 400);
  }

  return raw;
}

export function isReservedUserSlug(slug: string): boolean {
  return RESERVED_USER_SLUGS.has(String(slug ?? '').trim().toLowerCase());
}

