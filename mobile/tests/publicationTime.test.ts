import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationTime, formatPublicationTime } from '../src/content/publicationTime';
import { adaptFeedPage, adaptViewerFeedPage } from '../src/feed/adaptFeed';

test('publication instant adaptation tolerates old responses and never treats bare SQL as phone-local', () => {
  const page = (publishedAt?: unknown) => adaptViewerFeedPage({ context: { kind: 'global' },
    items: [{ publicationId: 1, publishedAt }], nextCursor: null }, { kind: 'global' }).items[0];
  for (const value of [undefined, null, '2026-10-26 10:00:00', '2026-02-29T00:00:00Z', '2026-04-31T00:00:00Z', '2026-10-26T24:00:00Z'])
    assert.equal(page(value).publishedAt, null);
  assert.equal(page('2026-10-26T10:00:00+02:00').publishedAt, '2026-10-26T08:00:00.000Z');
  assert.equal(adaptFeedPage({items:[{publication:{id:1,published_at:'2026-10-26 10:00:00'}}],nextCursor:null}).items[0].publishedAt,'2026-10-26T10:00:00.000Z');
  assert.equal(publicationTime('0000-01-01T00:00:00Z'), null);
});

test('publishing display uses local date/year and minute precision across offsets and daylight saving', () => {
  const options = { locale: 'en-US', timeZone: 'America/Los_Angeles' };
  assert.match(formatPublicationTime('2026-01-01T01:15:00Z', options), /Dec 31, 2025.*5:15\s?PM/);
  assert.match(formatPublicationTime('2026-03-08T09:59:00Z', options), /1:59\s?AM/);
  assert.match(formatPublicationTime('2026-03-08T10:01:00Z', options), /3:01\s?AM/);
  const british = formatPublicationTime('2026-01-01T01:15:00Z', {locale:'en-GB',timeZone:'UTC'});
  assert.match(british, /1:15/); assert.doesNotMatch(british, /AM|PM/);
  for (const value of [undefined, null, 'bad', '2026-02-30T00:00:00Z']) assert.equal(formatPublicationTime(value), 'Publishing time unavailable');
  assert.equal(formatPublicationTime('2026-01-01T01:15:00Z', {timeZone:'Invalid'}), 'Publishing time unavailable');
});
