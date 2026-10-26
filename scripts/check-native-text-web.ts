import { getPool } from '../src/db';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

async function main() {
  const f = JSON.parse(fs.readFileSync('.codex-local/plan170-fixtures.json', 'utf8'));
  const base = process.env.VIEWER_WEB_BASE_URL || 'https://aws.bawebtech.com';
  const run = 'tests/runs/playwright/plan_170_text'; fs.mkdirSync(run, { recursive: true });
  const browser = await chromium.launch({ headless: true }), context = await browser.newContext(), page = await context.newPage();
  let checks = 0;
  const eq = (a: unknown, b: unknown) => assert.deepEqual(a, b, `browser text check ${++checks}`);
  try {
    await page.goto(base + '/login'); await page.fill('#email', f.users.a.email); await page.fill('#password', f.users.a.password);
    await page.locator('button[type="submit"]').click(); await page.waitForURL(url => url.pathname === '/');
    eq((await (await page.request.get(base + '/api/me')).json()).userId, f.users.a.id);
    // Pin the exact owned production rather than assume feed ordering still
    // puts the first fixture on screen after later fixture runs.
    const [rows]:any=await getPool().query('SELECT s.slug,p.ulid FROM spaces s JOIN productions p ON p.id=? WHERE s.id=?',[f.publications[0].productionId,f.spaces.origin]);
    assert.equal(rows.length,1);
    const feedResponse = page.waitForResponse(r => new URL(r.url()).pathname === `/api/spaces/${f.spaces.origin}/feed`);
    await page.goto(base+`/groups/${rows[0].slug}?pin=${encodeURIComponent(rows[0].ulid)}`);eq((await feedResponse).status(),200);
    const publicationId = f.publications[0].origin;
    const storyRead = page.waitForResponse(r => new URL(r.url()).pathname === `/api/publications/${publicationId}/story`);
    await page.getByRole('button', { name: 'Expand story', exact: true }).first().click();
    const story = await (await storyRead).json(); eq(story.storyText.startsWith('Origin story 1'), true);
    await page.getByText(story.storyText, { exact: true }).waitFor();
    await page.screenshot({ path: run + '/expanded-story.png' });
    await page.getByRole('button', { name: 'Collapse story', exact: true }).click();
    const captionRead = page.waitForResponse(r => new URL(r.url()).pathname === `/api/publications/${publicationId}/captions.vtt`);
    await page.getByRole('button', { name: 'Show captions', exact: true }).first().click();
    const captions = await captionRead; eq(captions.status(), 200); eq((await captions.text()).trimStart().startsWith('WEBVTT'), true);
    eq(await page.getByRole('button', { name: 'Hide captions', exact: true }).first().getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Hide captions', exact: true }).first().click();
    eq(await page.evaluate(() => localStorage.getItem('captions:enabled')), '0');
    eq((await page.request.get(base + `/api/viewer/v1/spaces/${f.spaces.origin}/publications/${publicationId}/story`)).status(), 200);
    await page.goto(base + '/logout'); await page.waitForURL(url => url.pathname === '/');
    eq((await (await page.request.get(base + '/api/me')).json()).userId, null);
    const result = { browserTextRegression: 'passed', checks, scope: 'actual web login/space/story expansion and collapse, legacy VTT request and CC state, cookie viewer-text read/logout; no frontend code change' };
    fs.writeFileSync(run + '/summary.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
  } finally { await page.request.get(base + '/logout'); await context.close(); await browser.close();await getPool().end(); }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
