import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
async function main(){
  const f=JSON.parse(fs.readFileSync('.codex-local/plan173-fixtures.json','utf8')),base=process.env.VIEWER_WEB_BASE_URL||'https://aws.bawebtech.com';
  const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
  const run='tests/runs/playwright/plan_173_launch';fs.mkdirSync(run,{recursive:true});let checks=0;
  const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`web launch check ${++checks}`);
  try{
    await page.goto(base+'/login');await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/');
    await page.locator('button[aria-label="Jump to space"]:visible').first().waitFor({timeout:20000});
    eq(await page.locator('button[aria-label="Like"]:visible').count(),0);eq(await page.locator('button[aria-label="Comments"]:visible').count(),0);
    const api=await page.request.get(base+`/api/viewer/v1/feed/global/publications/${f.source.publicationId}/spaces`);eq(api.status(),200);eq((await api.json()).items.some((x:any)=>x.space.id===f.spaces.group),true);
    await page.locator('button[aria-label="Jump to space"]:visible').first().click();
    const link=page.getByRole('link',{name:/Launch test group/});await link.waitFor();await link.click();
    await page.waitForURL(u=>u.pathname.startsWith('/groups/'));eq(new URL(page.url()).searchParams.get('pin'),f.source.productionUlid);
    await page.locator('button[aria-label="Comments"]:visible').first().waitFor({timeout:20000});eq(await page.locator('button[aria-label="Like"]:visible').count()>0,true);
    const creator=page.locator(`button[title="View Launch test B"]:visible`).first();await creator.waitFor();await creator.click();await page.getByRole('link',{name:'View full profile',exact:true}).waitFor();
    await page.screenshot({path:run+'/space-creator.png'});
    const summary={result:'passed',checks,scope:'Actual cookie login; Global Jump replaces Like/Comments; native-viewer destination read; legacy Jump pinned group navigation; group Like/Comments visible; Creator peek; logout. No engagement writes or frontend changes.'};
    fs.writeFileSync(run+'/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));
  }finally{await page.request.get(base+'/logout').catch(()=>{});await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
