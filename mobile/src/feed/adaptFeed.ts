import { ApiError } from '../api/client';
import type { FeedPage, FeedVideoItem } from './types';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function positiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function id(value: unknown): number | null {
  const number = positiveNumber(value);
  return number !== null && Number.isSafeInteger(number) ? number : null;
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) || null : null;
}

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? value : null;
  } catch { return null; }
}

export function adaptFeedPage(value: unknown): FeedPage {
  const page = record(value);
  if (!page || !Array.isArray(page.items) ||
    !(page.nextCursor === null || typeof page.nextCursor === 'string')) {
    throw new ApiError('The server returned an unexpected feed. Please try again.');
  }

  const items: FeedVideoItem[] = [];
  const seen = new Set<number>();
  for (const entry of page.items) {
    const row = record(entry);
    const publication = record(row?.publication);
    const publicationId = id(publication?.id);
    if (!publicationId || seen.has(publicationId)) continue;
    seen.add(publicationId);
    const upload = record(row?.upload);
    const owner = record(row?.owner);
    const orientationPoster = upload?.orientation === 'portrait'
      ? upload.poster_portrait_cdn
      : upload?.orientation === 'landscape' ? upload.poster_landscape_cdn : null;
    items.push({
      publicationId,
      uploadId: id(upload?.id),
      productionUlid: text(publication?.production_ulid, 26),
      spaceId: id(publication?.space_id),
      playbackUrl: httpsUrl(upload?.cdn_master),
      posterUrl: httpsUrl(upload?.poster_cdn) ?? httpsUrl(orientationPoster),
      creator: {
        id: id(owner?.id),
        displayName: text(owner?.displayName, 120) ?? 'Creator',
        avatarUrl: httpsUrl(owner?.avatarUrl),
      },
      description: text(upload?.description, 2000),
      width: positiveNumber(upload?.width),
      height: positiveNumber(upload?.height),
      durationSeconds: positiveNumber(upload?.duration_seconds),
    });
  }
  return { items, nextCursor: page.nextCursor || null };
}
