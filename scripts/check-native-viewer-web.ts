import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getPool } from '../src/db';

async function main() {
  const f=JSON.parse(fs.readFileSync('.codex-local/plan168-fixtures.json','utf8'));
  const base=process.env.VIEWER_WEB_BASE_URL || 'https://aws.bawebtech.com';
  const browser=await chromium.launch({headless:true});
  const context=await browser.newContext();const page=await context.newPage();
  const run='tests/runs/playwright/plan_168_phase_g';fs.mkdirSync(run,{recursive:true});
  let checks=0;const checked=(condition:boolean)=>{assert.ok(condition);checks++;};
  try {
    await page.goto(base);await page.getByRole('button',{name:'Open menu',exact:true}).waitFor();await page.locator('video').first().waitFor({state:'attached'});checked(await page.locator('video').count()>0);
    await page.goto(base+'/login');await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);
    await page.locator('button[type="submit"]').click();await page.waitForURL(url=>url.pathname==='/');
    const me=await page.request.get(base+'/api/me');checked((await me.json()).userId===f.users.a.id);
    await page.getByRole('button',{name:'Open menu',exact:true}).click();
    const group=page.getByRole('button',{name:'Native test groupA',exact:false});await group.waitFor();
    const feed=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/spaces/${f.spaces.groupA}/feed`);
    await group.click();checked((await feed).status()===200);await page.locator('video').first().waitFor({state:'attached'});
    checked(await page.locator('video').count()>0);await page.screenshot({path:run+'/space-feed.png'});
    const denied=await page.request.get(base+`/api/spaces/${f.spaces.groupB}/feed`);checked(denied.status()===403);
    const [before]=await getPool().query('SELECT slug FROM users WHERE id=?',[f.users.a.id]);
    try {
      const missing=await page.request.put(base+'/api/profile/slug',{data:{slug:`native-web-${f.users.a.id}`}});checked(missing.status()===403);
      const csrf=(await context.cookies()).find(c=>c.name==='csrf')!.value;
      const mutation=await page.request.put(base+'/api/profile/slug',{data:{slug:`native-web-${f.users.a.id}`},headers:{'x-csrf-token':csrf}});checked(mutation.status()===200);
    }finally {await getPool().query('UPDATE users SET slug=? WHERE id=?',[(before as any[])[0].slug,f.users.a.id]);}
    await page.goto(base+'/logout');await page.waitForURL(url=>url.pathname==='/');
    checked((await(await page.request.get(base+'/api/me')).json()).userId===null);
    await page.getByRole('button',{name:'Open menu',exact:true}).waitFor();
    const result={browserViewerRegression:'passed',checks,base,scope:'anonymous Global, UI login, actual space switch, denied space, CSRF mutation, logout'};
    fs.writeFileSync(run+'/summary.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
  }finally {await context.close();await browser.close();await getPool().end();}
}
main().catch(e=>{console.error(e.stack || e.message);process.exitCode=1;});
