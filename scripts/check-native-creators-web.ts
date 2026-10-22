import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function main() {
  const f=JSON.parse(fs.readFileSync('.codex-local/plan169-fixtures.json','utf8'));
  const base=process.env.VIEWER_WEB_BASE_URL || 'https://aws.bawebtech.com';
  const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
  const run='tests/runs/playwright/plan_169_profiles';fs.mkdirSync(run,{recursive:true});
  let checks=0;const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b,`browser creator check ${++checks}`);};
  try {
    await page.goto(base+`/users/${f.users.b.id}`);await page.getByRole('heading',{name:'Profile test b',exact:true}).waitFor();
    eq(await page.getByText('Biography test b',{exact:true}).count(),1);
    await page.screenshot({path:run+'/public-profile.png'});
    await page.goto(base+`/users/${f.users.hidden.id}`);await page.getByText('Profile not found.',{exact:true}).waitFor();
    eq(await page.getByText('Biography test hidden',{exact:true}).count(),0);
    await page.goto(base+'/login');await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);
    await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/');
    eq((await(await page.request.get(base+'/api/me')).json()).userId,f.users.a.id);
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    const feed=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/spaces/${f.spaces.origin}/feed`);
    await page.getByRole('button',{name:'Creator test origin',exact:false}).click();eq((await feed).status(),200);
    await page.locator('video').first().waitFor({state:'attached'});
    await page.locator('button[title="View Creator test b"]:visible').first().waitFor({state:'visible',timeout:15000});
    await page.screenshot({path:run+'/before-peek.png'});
    const [peek]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/profile/${f.users.b.id}`),
      page.locator('button[title="View Creator test b"]:visible').first().click()]);eq(peek.status(),200);
    await page.getByRole('link',{name:'View full profile',exact:true}).waitFor();
    await page.getByText('Biography test b',{exact:true}).waitFor();
    eq((await page.request.get(base+`/api/viewer/v1/creators/${f.users.b.id}`)).status(),200);
    eq((await page.request.get(base+`/api/spaces/${f.spaces.personalB}/feed`)).status(),200);
    eq((await page.request.get(base+`/api/spaces/${f.spaces.personalA}/feed`)).status(),200);
    eq((await page.request.get(base+`/api/spaces/${f.spaces.origin}/feed`)).status(),200);
    await page.screenshot({path:run+'/profile-peek.png'});
    await page.goto(base+'/logout');await page.waitForURL(url=>url.pathname==='/');
    eq((await(await page.request.get(base+'/api/me')).json()).userId,null);
    await page.goto(base+'/login');await page.fill('#email',f.users.b.email);await page.fill('#password',f.users.b.password);
    await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/');
    eq((await page.request.get(base+`/api/spaces/${f.spaces.personalA}/feed`)).status(),403);
    eq((await page.request.get(base+`/api/spaces/${f.spaces.personalB}/feed`)).status(),200);
    await page.goto(base+'/logout');await page.waitForURL(url=>url.pathname==='/');
    const result={browserCreatorRegression:'passed',checks,base,scope:'legacy public/hidden profile, UI login, space playback, creator peek and shared feed reads, logout'};
    fs.writeFileSync(run+'/summary.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  } catch(error) {await page.screenshot({path:run+'/failed.png'});console.log(JSON.stringify({visibleVideos:await page.locator('video:visible').count(),buttons:await page.locator('button[title]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('title')))}));throw error;} finally {await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
