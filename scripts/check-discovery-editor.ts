import {assertDiscoveryQaIsolated} from './discovery-qa-isolation';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {parse} from 'dotenv';
import {once} from 'node:events';
import {getPool} from '../src/db';
import {buildServer} from '../src/app';
async function main(){
 await assertDiscoveryQaIsolated();
 const f=JSON.parse(fs.readFileSync('.codex-local/plan175-fixtures.json','utf8')),profile=parse(fs.readFileSync(process.env.DISCOVERY_AUTH_PROFILE||'.codex-local/auth_profiles.env'));
 assert.ok(profile.SUPER_EMAIL&&profile.SUPER_PASSWORD,'Existing curator test credentials required');
 const db=getPool(),[original]:any=await db.query('SELECT * FROM discovery_spaces WHERE space_id=?',[f.spaces.group]),[flags]:any=await db.query('SELECT root_home,native_home FROM discovery_state WHERE id=1');
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1280,height:1000}}),page=await context.newPage();
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;
 await context.route('**/*',async route=>{const headers={...route.request().headers()};delete headers.origin;await route.continue({headers});});
 const eq=(a:any,b:any)=>{assert.deepEqual(a,b,`Editor check ${++checks}`)},slug=`plan184-qa-${Date.now()}`;
 try {
  await page.goto(base+'/login');await page.fill('#email',profile.SUPER_EMAIL);await page.fill('#password',profile.SUPER_PASSWORD);await page.locator('button[type=submit]').click();await page.waitForURL(u=>u.pathname!=='/login');
  await page.goto(base+`/spaces/${f.spaces.group}/admin/discovery`);await page.getByRole('heading',{name:'Discovery and welcome: Launch test group',exact:true}).waitFor();
  eq(await page.locator('video').count(),0);eq(await page.getByLabel('Welcome text').inputValue(),original[0].draft);
  await page.getByRole('button',{name:'Preview welcome',exact:true}).click();eq(await page.locator('.discovery-policy').count(),1);
  await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByRole('status').filter({hasText:'Draft saved.'}).waitFor();checks++;
  await page.getByRole('button',{name:'Publish welcome',exact:true}).click();await page.getByRole('status').filter({hasText:'Welcome published.'}).waitFor();checks++;
  const listed=page.getByLabel('Listed in public discovery');await listed.uncheck();await page.getByRole('button',{name:'Save directory placement',exact:true}).click();await page.getByRole('status').filter({hasText:'Directory placement saved.'}).waitFor();eq((await(await page.request.get(base+'/api/viewer/v1/discovery/directory?genre=travel')).json()).items.some((s:any)=>s.id===f.spaces.group),false);
  await listed.check();await page.getByRole('button',{name:'Save directory placement',exact:true}).click();await page.getByRole('status').filter({hasText:'Directory placement saved.'}).waitFor();checks++;
  await page.getByLabel('Name',{exact:true}).fill('Plan184 QA genre');await page.getByLabel('Slug',{exact:true}).fill(slug);await page.getByLabel('Published genre',{exact:true}).uncheck();await page.getByRole('button',{name:'Save genre',exact:true}).click();await page.getByRole('status').filter({hasText:'Genre saved.'}).waitFor();checks++;
  eq((await page.request.get(base+`/api/viewer/v1/discovery/directory?genre=${slug}`)).status(),404);
  const native=page.getByLabel('Use Home on supported iPhone builds');await native.check();await page.getByRole('button',{name:'Save Home rollout',exact:true}).click();await page.getByRole('status').filter({hasText:'Home rollout saved.'}).waitFor();eq((await(await page.request.get(base+'/api/viewer/v1/discovery/config')).json()).nativeHomeEnabled,true);
  await native.uncheck();await page.getByRole('button',{name:'Save Home rollout',exact:true}).click();await page.getByRole('status').filter({hasText:'Home rollout saved.'}).waitFor();eq((await(await page.request.get(base+'/api/viewer/v1/discovery/config')).json()).nativeHomeEnabled,false);
  eq(errors,[]);fs.mkdirSync('tests/runs/playwright/plan_184',{recursive:true});await page.screenshot({path:'tests/runs/playwright/plan_184/editor.png',fullPage:true});console.log(JSON.stringify({status:'passed',checks,scope:'Actual curator editor, safe preview, draft/publish, listing, unpublished genre, Home rollout toggles; restored metadata/flags.'}));
 }finally {
  const cookies=(await context.cookies()).map(c=>`${c.name}=${c.value}`).join('; ');if(cookies)await fetch(base+'/logout',{headers:{cookie:cookies},redirect:'manual'}).catch(()=>{});
  await context.close();await browser.close();await db.query('UPDATE discovery_spaces SET ? WHERE space_id=?',[original[0],f.spaces.group]);await db.query('DELETE FROM discovery_genres WHERE slug=? AND name=?',[slug,'Plan184 QA genre']);await db.query('UPDATE discovery_state SET root_home=?,native_home=? WHERE id=1',[flags[0].root_home,flags[0].native_home]);await new Promise<void>(r=>server.close(()=>r()));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
