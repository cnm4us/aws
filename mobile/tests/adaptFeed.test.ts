import assert from 'node:assert/strict';
import test from 'node:test';
import { adaptFeedPage } from '../src/feed/adaptFeed';

function row(publicationId = 5) {
  return {
    publication: { id: publicationId, production_ulid: '01ARZ3NDEKTSV4RRFFQ69G5FAV', space_id: 2 },
    upload: {
      id: 10, cdn_master: 'https://media.example.com/landscape/video.m3u8',
      poster_cdn: 'https://media.example.com/poster.jpg?expires=123',
      description: ' A real description ', width: 1920, height: 1080,
      duration_seconds: 42, s3_key: 'private/source.mp4', mediaconvert_job_id: 'internal-job',
    },
    owner: { id: 3, displayName: ' Creator name ', email: 'private@example.com' },
  };
}

test('maps real API fields and discards creator email and internal fields', () => {
  const page = adaptFeedPage({ items: [row()], nextCursor: '2026-10-17 10:00:00|5' });
  assert.equal(page.nextCursor, '2026-10-17 10:00:00|5');
  assert.equal(page.items[0].publicationId, 5);
  assert.equal(page.items[0].uploadId, 10);
  assert.equal(page.items[0].playbackUrl, row().upload.cdn_master);
  assert.equal(page.items[0].posterUrl, row().upload.poster_cdn);
  assert.equal(page.items[0].creator.displayName, 'Creator name');
  assert.equal(page.items[0].description, 'A real description');
  assert.ok(!JSON.stringify(page).includes('private'));
  assert.ok(!JSON.stringify(page).includes('internal-job'));
});

test('does not confuse upload identity with publication identity or reorder rows', () => {
  const page = adaptFeedPage({ items: [row(9), row(8), row(9)], nextCursor: null });
  assert.deepEqual(page.items.map(item => item.publicationId), [9, 8]);
  assert.deepEqual(page.items.map(item => item.uploadId), [10, 10]);
});

test('keeps unavailable media as a card and skips rows without valid publication IDs', () => {
  const page = adaptFeedPage({
    items: [null, {}, { publication: { id: -1 } }, { publication: { id: 7 } }], nextCursor: null,
  });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].publicationId, 7);
  assert.equal(page.items[0].playbackUrl, null);
  assert.equal(page.items[0].creator.displayName, 'Creator');
});

test('rejects unsafe media URLs and never guesses an orientation or S3 rendition', () => {
  for (const url of ['http://media.example.com/video.m3u8', 'https://user:secret@example.com/video', 'javascript:alert(1)', '/video.m3u8']) {
    const input = row();
    input.upload.cdn_master = url;
    const page = adaptFeedPage({ items: [input], nextCursor: null });
    assert.equal(page.items[0].playbackUrl, null);
  }
});

test('uses only the matching supplied orientation poster when generic poster is absent', () => {
  const page = adaptFeedPage({ items: [{
    publication: { id: 1 },
    upload: { orientation: 'portrait', poster_landscape_cdn: 'https://media.example.com/landscape.jpg' },
    owner: { email: 'private@example.com' },
  }], nextCursor: null });
  assert.equal(page.items[0].posterUrl, null);
  assert.equal(page.items[0].creator.displayName, 'Creator');
});

test('malformed envelopes fail visibly rather than masquerading as an empty feed', () => {
  for (const value of [null, [], {}, { items: [] }, { items: 'wrong', nextCursor: null }, { items: [], nextCursor: 123 }]) {
    assert.throws(() => adaptFeedPage(value), { name: 'ApiError' });
  }
});
