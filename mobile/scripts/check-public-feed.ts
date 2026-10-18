import assert from 'node:assert/strict';
import { createApiClient } from '../src/api/client';
import { fetchGlobalFeed } from '../src/api/feed';
import { readEnvironment } from '../src/config/environment';

async function main() {
  const environment = readEnvironment();
  if (!environment.ok) throw new Error(environment.message);
  const client = createApiClient(environment.value.apiBaseUrl);
  const health = await client.getJson('/health');
  assert.deepEqual(health, { ok: true });
  console.log(JSON.stringify({ check: 'health', ok: true }));
  const page = await fetchGlobalFeed(client);
  const item = page.items.find(candidate => candidate.playbackUrl);
  assert.ok(item?.playbackUrl, 'Public feed must contain a video for device validation');
  console.log(JSON.stringify({ check: 'anonymous_feed', ok: true, count: page.items.length, publicationId: item.publicationId }));
  if (page.nextCursor) {
    const secondPage = await fetchGlobalFeed(client, undefined, page.nextCursor);
    const firstIds = new Set(page.items.map(row => row.publicationId));
    assert.ok(secondPage.items.every(row => !firstIds.has(row.publicationId)), 'Cursor pages must not overlap in the live feed');
    assert.notEqual(secondPage.nextCursor, page.nextCursor, 'Cursor must advance or reach the end');
    console.log(JSON.stringify({ check: 'anonymous_pagination', ok: true, secondPageCount: secondPage.items.length }));
  }

  async function playlist(url: string, kind: string) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    assert.equal(response.status, 200, `${kind} must be reachable`);
    const body = await response.text();
    assert.ok(body.trimStart().startsWith('#EXTM3U'), `${kind} must be an HLS playlist`);
    console.log(JSON.stringify({ check: kind, ok: true, contentType: response.headers.get('content-type') }));
    return body;
  }
  const master = await playlist(item.playbackUrl, 'hls_master');
  const variantPath = master.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
  assert.ok(variantPath, 'Master must reference a variant playlist');
  const variantUrl = new URL(variantPath, item.playbackUrl).toString();
  const variant = await playlist(variantUrl, 'hls_variant');
  const segmentPath = variant.split(/\r?\n/).map(line => line.trim()).find(line => line && !line.startsWith('#'));
  assert.ok(segmentPath, 'Variant must reference a media segment');
  const segment = await fetch(new URL(segmentPath, variantUrl), {
    headers: { Range: 'bytes=0-1023' }, signal: AbortSignal.timeout(15_000),
  });
  assert.ok(segment.ok, 'Media segment must be reachable');
  const reader = segment.body?.getReader();
  assert.ok(reader, 'Media segment must have a body');
  const firstChunk = await reader.read();
  await reader.cancel();
  assert.ok(firstChunk.value?.byteLength, 'Media segment must contain data');
  console.log(JSON.stringify({ check: 'media_segment', ok: true, status: segment.status }));
  if (item.posterUrl) {
    const poster = await fetch(item.posterUrl, { method: 'HEAD', signal: AbortSignal.timeout(15_000) });
    assert.ok(poster.ok, 'Poster must be reachable');
    console.log(JSON.stringify({ check: 'poster', ok: true, contentType: poster.headers.get('content-type') }));
  } else {
    console.log(JSON.stringify({ check: 'poster', skipped: 'Feed item has no poster URL' }));
  }
  console.log(JSON.stringify({ note: 'Host-side connectivity only; physical iPhone playback still requires device verification.' }));
}

void main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Connectivity check failed');
  process.exitCode = 1;
});
