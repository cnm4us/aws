import { submitAuthorizedPublicationReport } from '../../src/features/reports/service';
import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { createViewerReporting, createReportingRouter, reportBody, reportDocument } from '../../src/features/reports/viewer';
import { ViewerApiError, readBearer } from '../../src/features/native-sessions/service';
import { DomainError } from '../../src/core/errors';
import { csrfProtect } from '../../src/middleware/csrf';

const target = { context: { kind: 'global' as const }, publicationId: 10, userId: 4 };
function fixture() {
  let slug = 'global-feed', allowed = true, visible = true, found = true;
  const events: string[] = [], db: any = { query: async () => [] };
  const pub = { id: 10, space_id: 29, space_slug: 'global-feed', production_id: 5, upload_duration_seconds: 20 };
  const own = { rule_id: 1, rule_title: 'Safe title', rule_slug: 'safe', user_facing_rule_id: 3, user_facing_rule_label_at_submit: 'Reason', reported_start_seconds: 0, reported_end_seconds: 7, created_at: '2026-10-27 00:00:00' };
  const deps: any = {
    publication: async (id: number, conn: any) => { if (conn) assert.equal(conn, db); return found ? { ...pub, id } : null; },
    loadSpace: async () => ({ id: 29, slug, type: 'channel' }),
    canView: async () => { events.push('space-view'); return allowed; },
    global: async (selection: any, conn: any) => { if (conn) assert.equal(conn, db); return visible ? [{ publication_id: selection.publicationId, space_id: pub.space_id }] : []; },
    space: async (id: number, selection: any) => visible ? [{ publication_id: selection.publicationId, space_id: id }] : [],
    options: async () => ({ reportedByMe: false, myReport: null, initialGroups: [{ id: 3 }], allGroups: [{ id: 3, rules: [] }] }),
    mapped: async () => ({ rule_id: 1, current_version_id: 2 }),
    detail: async () => ({ title: 'Rule', version: 2, markdown: '# Explanation\nHelpful text', guidance_html: 'PRIVATE', guidance_agents_markdown: 'SECRET' }),
    submit: async (_pub: any, _user: number, _input: any, conn: any) => { assert.equal(conn, db); events.push('insert'); return { reportId: 5 }; },
    lockConfiguration: async (_id: number, conn: any) => { assert.equal(conn, db); },
    own: async () => own,
    transaction: async (_id: number, work: any) => { events.push('lock'); return work(db); },
  };
  return { service: createViewerReporting(deps), deps, pub, events, db, setSlug: (s: string) => slug = s, deny: () => allowed = false, hide: () => visible = false, remove: () => found = false };
}
test('Global reporting belongs to its own destination and never needs another space permission', async () => {
  const f = fixture(); f.deny(); const result = await f.service.options(target);
  assert.equal(result.spaceId, 29); assert.equal(result.context.kind, 'global'); assert.deepEqual(f.events, []);
  f.setSlug('global'); assert.equal((await f.service.options(target)).publicationId, 10);
  f.setSlug('restricted-channel'); await assert.rejects(f.service.options(target), { code: 'publication_not_found' });
});
test('space destinations require exact space/publication and current viewing', async () => {
  const f = fixture(); f.setSlug('group-a');
  const t = { ...target, context: { kind: 'space' as const, spaceId: 29 } };
  assert.equal((await f.service.options(t)).spaceId, 29);
  await assert.rejects(f.service.options({ ...t, context: { kind: 'space', spaceId: 30 } }), { status: 404 });
  f.deny(); await assert.rejects(f.service.options(t), { status: 403 });
  const g = fixture(); await assert.rejects(g.service.options(t), { status: 404 });
});
test('hidden/unpublished and post-read authority loss cannot return options/detail', async () => {
  const f = fixture(); f.hide(); await assert.rejects(f.service.options(target), { status: 404 });
  const g = fixture(); g.deps.options = async () => { g.remove(); return { allGroups: [], initialGroups: [] }; }; await assert.rejects(g.service.options(target), { status: 404 });
  const h = fixture(); h.deps.detail = async () => { h.hide(); return { markdown: 'text' }; }; await assert.rejects(h.service.detail(target, 3, 1), { status: 404 });
});
test('rule detail whitelists current reporter content and revalidates mapping/version', async () => {
  const f = fixture(); const detail = await f.service.detail(target, 3, 1);
  assert.equal(detail.description[0].kind, 'heading'); assert.ok(!JSON.stringify(detail).includes('PRIVATE')); assert.ok(!JSON.stringify(detail).includes('SECRET'));
  f.deps.mapped = async () => null; await assert.rejects(f.service.detail(target, 3, 1), { code: 'report_rule_unavailable' });
  const g = fixture(); let calls = 0; g.deps.mapped = async () => ({ current_version_id: ++calls }); await assert.rejects(g.service.detail(target, 3, 1), { code: 'report_rule_unavailable' });
});
test('write rechecks inside publication transaction and reads its result before commit', async () => {
  const f = fixture(); const r = await f.service.submit(target, reportBody({ userFacingRuleId: 3 }));
  assert.equal(r.reportedByMe, true); assert.equal(r.myReport.reportedEndSeconds, 7); assert.deepEqual(f.events, ['lock', 'insert']);
  const g = fixture(); g.deps.transaction = async (_id: number, work: any) => { g.hide(); return work(g.db); };
  await assert.rejects(g.service.submit(target, reportBody({ userFacingRuleId: 3 })), {status:404,code:'publication_not_found'}); assert.ok(!g.events.includes('insert'));
});
test('strict report IDs, authority fields and integer time bounds', () => {
  for (const value of [null, [], {}, { userFacingRuleId: '3' }, { userFacingRuleId: 3, userId: 2 }, { userFacingRuleId: 3, ruleId: null }, { userFacingRuleId: 3, reportedStartSeconds: -1 }, { userFacingRuleId: 3, reportedStartSeconds: 1.5 }, { userFacingRuleId: 3, reportedEndSeconds: 2147483648 }, { userFacingRuleId: 3, reportedStartSeconds: 8, reportedEndSeconds: 7 }]) assert.throws(() => reportBody(value));
  assert.deepEqual(reportBody({ userFacingRuleId: 3, reportedStartSeconds: 0, reportedEndSeconds: 0 }), { userFacingRuleId: 3, reportedStartSeconds: 0, reportedEndSeconds: 0 });
});
test('bounded native documents retain readable lists/links and exclude executable content', () => {
  const blocks = reportDocument('# Title\n- Example\n[Read more](https://example.test/rule)', null);
  assert.equal(blocks[1].kind, 'list'); assert.equal(blocks[2].links[0].href, 'https://example.test/rule');
  assert.equal(reportDocument('', '<p>Legacy &amp; text</p><script>SECRET</script><img src="https://bad"/>')[0].text, 'Legacy & text');
  assert.ok(!JSON.stringify(reportDocument('', '<p><a href="javascript:alert(1)">Unsafe</a></p>')).includes('javascript'));
  assert.throws(() => reportDocument('x'.repeat(65537), null), { code: 'reporting_unavailable' });
});
test('mounted reports preserve cookie CSRF, bearer isolation, strict inputs and duplicate409', async () => {
  const f = fixture(); const app = express(); app.use(express.json({ limit: '16kb' }));
  app.use((req: any, _res, next) => { if (req.headers.cookie?.includes('sid=valid')) { req.user = { id: 4 }; req.session = { id: 1 }; } next(); }); app.use(csrfProtect);
  app.use('/api/viewer/v1', createReportingRouter({ service: f.service, resolveViewer: async req => {
    const token = readBearer(req, false); if (!token && !req.user) throw new ViewerApiError(401, 'unauthorized'); return { source: token ? 'native' : 'cookie', viewer: { id: 4, displayName: 'Viewer' } } as any;
  } }));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const base = `http://127.0.0.1:${(server.address() as any).port}/api/viewer/v1/feed/global/publications/10`;
  const auth = { authorization: 'Bearer nv1_' + 'a'.repeat(64), 'content-type': 'application/json' }, body = JSON.stringify({ userFacingRuleId: 3 });
  try {
    assert.equal((await fetch(base + '/reporting/options')).status, 401);
    const r = await fetch(base + '/reporting/options', { headers: auth }); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.equal((await fetch(base + '/reporting/options?userId=5', { headers: auth })).status, 400);
    assert.equal((await fetch(base + '/report', { method: 'POST', headers: { cookie: 'sid=valid; csrf=test', 'content-type': 'application/json' }, body })).status, 403);
    assert.equal((await fetch(base + '/report', { method: 'POST', headers: { ...auth, cookie: 'sid=valid; csrf=test', 'x-csrf-token': 'test' }, body })).status, 400);
    f.deps.submit = async () => { throw new DomainError('already_reported', 'already_reported', 409); };
    const duplicate = await fetch(base + '/report', { method: 'POST', headers: auth, body }); assert.equal(duplicate.status, 409); assert.deepEqual(await duplicate.json(), { error: 'already_reported' });
  } finally { server.close(); server.closeAllConnections(); }
});

test('shared submission preserves destination scope, current version/snapshots and authoritative time normalization', async () => {
  for (const slug of ['global', 'global-feed', 'group-a']) {
    let inserted: any[] = [];
    const db: any = { query: async (sql: string, params: any[]) => {
      if (sql.includes('FROM user_facing_rules ufr')) return [[{ rule_id: 1, current_version_id: 2 }]];
      if (sql.includes('FROM user_facing_rules')) return [[{ id: 3, label: 'General', group_key: 'general', group_label: 'General label' }]];
      if (sql.includes('INSERT INTO space_publication_reports')) { inserted = params; return [{ insertId: 8 }]; }
      throw Error('Unexpected query');
    } };
    const pub = { id: 10, space_id: 29, space_slug: slug, production_id: 5, upload_duration_seconds: 12.5 };
    const result = await submitAuthorizedPublicationReport(pub, 4, { userFacingRuleId: 3, reportedStartSeconds: 8.9, reportedEndSeconds: 100 }, db);
    assert.equal(result.reportedStartSeconds, 8); assert.equal(result.reportedEndSeconds, 12);
    assert.equal(inserted[5], 2); assert.equal(inserted[6], slug === 'group-a' ? 'space_culture' : 'global');
    assert.equal(inserted[8], 'General'); assert.deepEqual(inserted.slice(-2), [8, 12]);
    const unknown = await submitAuthorizedPublicationReport({ ...pub, upload_duration_seconds: null }, 4, { userFacingRuleId: 3, reportedStartSeconds: 0, reportedEndSeconds: 2147483647 }, db);
    assert.equal(unknown.reportedEndSeconds, 2147483647);
    await assert.rejects(submitAuthorizedPublicationReport(pub, 4, { userFacingRuleId: 3, reportedStartSeconds: Infinity }, db), { code: 'invalid_reported_time_seconds' });
    db.query = async (sql: string) => {
      if (sql.includes('FROM user_facing_rules ufr')) return [[{ rule_id: 1, current_version_id: 2 }]];
      if (sql.includes('FROM user_facing_rules')) return [[{ id: 3, label: 'General' }]];
      throw Object.assign(Error('duplicate'), { code: 'ER_DUP_ENTRY' });
    };
    await assert.rejects(submitAuthorizedPublicationReport(pub, 4, { userFacingRuleId: 3 }, db), { status: 409, code: 'already_reported' });
  }
});
