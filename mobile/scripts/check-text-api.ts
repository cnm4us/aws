import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createApiClient } from '../src/api/client';
import { TextResources } from '../src/content/resources';
import { adaptViewerFeedPage } from '../src/feed/adaptFeed';
import { cueAt } from '../src/content/vtt';

async function main() {
  const fixtures = JSON.parse(fs.readFileSync('../.codex-local/plan170-fixtures.json', 'utf8'));
  const anonymous = createApiClient(process.env.EXPO_PUBLIC_API_BASE_URL || 'https://aws.bawebtech.com');
  const { email, password } = fixtures.users.a;
  const session = await anonymous.postJson('/api/native/v1/session', { email, password }) as { token: string };
  const client = createApiClient(process.env.EXPO_PUBLIC_API_BASE_URL || 'https://aws.bawebtech.com', { getHeaders: () => ({ Authorization: `Bearer ${session.token}` }) });
  let denied = 0, captioned = 0, cues = 0;
  const context = { kind: 'space', spaceId: fixtures.spaces.origin, name: 'Text test origin', type: 'group' } as const;
  const resources = new TextResources(client, context, () => { denied++; });
  try {
    const page = adaptViewerFeedPage(await client.getJson(`/api/viewer/v1/spaces/${context.spaceId}/feed`), context);
    assert.equal(page.items.length, fixtures.publications.length);
    for (const item of page.items) {
      if (item.hasStory) assert.match((await resources.story(item.publicationId, new AbortController().signal))!, /^Origin story/);
      if (item.hasCaptions) {
        const parsed = await resources.captions(item.publicationId, item.durationSeconds, new AbortController().signal);
        assert.ok(parsed.length); captioned++; cues += parsed.length;
        assert.equal(cueAt(parsed, parsed[0].startMs / 1000), parsed[0].text);
      }
    }
    assert.equal(denied, 0); assert.ok(captioned > 0);
    console.log(JSON.stringify({ mobileTextApi: 'passed', items: page.items.length, captioned, normalizedCues: cues, denied, scope: 'real HTTPS API and native client/adapter/resource store/parser; disposable session revoked' }));
  } finally { resources.clear(); await client.deleteJson('/api/native/v1/session'); }
}
main().catch(() => { console.error('Native text integration failed; inspect the fixture/server checks without printing credentials.'); process.exitCode = 1; });
