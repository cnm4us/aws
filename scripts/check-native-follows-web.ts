import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getPool } from '../src/db';
import { seedFollowFixtures } from './native-follow-fixtures';
async function main(){
 const f=await seedFollowFixtures(),db=getPool(),base=process.env.VIEWER_WEB_BASE_URL||'https://aws.bawebtech.com';
 const tuple=[f.users.a.id,f.users.b.id,f.spaces.group];
 const [prior]:any=await db.query('SELECT created_at FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',tuple);
 const [spaces]:any=await db.query('SELECT id,slug,type FROM spaces WHERE id IN (?,?)',[f.spaces.group,f.spaces.personal]);
 const dir='tests/runs/playwright/plan_175_follows';fs.mkdirSync(dir,{recursive:true});let checks=0,passed=false,browserSessionIds:number[]=[],release:(()=>void)|undefined;
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`Follow browser check ${++checks}`);
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();const requests:{url:string;method:string}[]=[];
 page.on('request',r=>{if(/\/api\/spaces\/\d+\/users\/\d+\/follow/.test(r.url()))requests.push({url:r.url(),method:r.method()});});
 const matching=(method:string)=>(r:any)=>/\/api\/spaces\/\d+\/users\/\d+\/follow/.test(r.url())&&r.request().method()===method;
 const peek=()=>page.locator('button[title="View Launch test B"]:visible').first().click();
 try{
  await db.query('DELETE FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',tuple);
  await page.goto(base+'/login');await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/');
  const sid=(await context.cookies()).find(c=>c.name==='sid')?.value;if(sid){const [rows]:any=await db.query('SELECT id FROM sessions WHERE token=? AND user_id=?',[sid,f.users.a.id]);if(rows[0])browserSessionIds.push(Number(rows[0].id));}
  await page.locator('button[aria-label="Jump to space"]:visible').first().waitFor({timeout:20000});eq(requests.length,0);eq(await page.locator('button[aria-label="Follow author in this space"]:visible').count(),0);
  const group=spaces.find((s:any)=>Number(s.id)===f.spaces.group);
  await page.goto(base+`/groups/${group.slug}?pin=${encodeURIComponent(f.source.productionUlid)}`);
  const inline=page.locator('button[aria-label="Follow author in this space"]:visible').first();await inline.waitFor({timeout:20000});
  const [followed]=await Promise.all([page.waitForResponse(matching('POST')),inline.click()]);eq(followed.status(),200);eq((await followed.json()).following,true);
  await peek();await page.getByRole('button',{name:'Following',exact:true}).waitFor();
  const [unfollowed]=await Promise.all([page.waitForResponse(matching('DELETE')),page.getByRole('button',{name:'Following',exact:true}).click()]);eq(unfollowed.status(),200);eq((await unfollowed.json()).following,false);await page.getByRole('button',{name:'Follow',exact:true}).waitFor();
  await page.getByRole('button',{name:'Close',exact:true}).click();await peek();await page.getByRole('button',{name:'Follow',exact:true}).waitFor();eq(requests.every(r=>Number(new URL(r.url).searchParams.get('publicationId'))>0),true);
  await page.getByRole('button',{name:'Close',exact:true}).click();
  let fail=true;
  await page.route('**/api/spaces/*/users/*/follow?*',async route=>{if(fail&&route.request().method()==='GET')await route.fulfill({status:503,contentType:'application/json',body:'{"error":"service_unavailable"}'});else await route.continue();});
  await peek();await page.getByRole('alert').filter({hasText:'Cannot verify Follow status.'}).waitFor();await page.getByRole('button',{name:'Follow unavailable',exact:true}).waitFor();eq(await page.getByRole('button',{name:'Follow unavailable',exact:true}).isDisabled(),true);
  const before=requests.filter(r=>r.method!=='GET').length;eq(await page.getByText(/\d+ followers? in this space/).count(),0);
  fail=false;await page.getByRole('button',{name:'Refresh Follow status',exact:true}).click();await page.getByRole('button',{name:'Follow',exact:true}).waitFor();eq(requests.filter(r=>r.method!=='GET').length,before);
  await page.screenshot({path:dir+'/follow-peek.png'});await page.getByRole('button',{name:'Close',exact:true}).click();await page.unroute('**/api/spaces/*/users/*/follow?*');
  let captured:(()=>void)|undefined;const arrived=new Promise<void>(r=>captured=r);const held=new Promise<void>(r=>release=r);
  await page.route('**/api/spaces/*/users/*/follow?*',async route=>{if(route.request().method()!=='GET'){await route.continue();return;}const response=await route.fetch();captured?.();await held;await route.fulfill({response}).catch(()=>{});});
  await peek();await arrived;await page.getByRole('button',{name:'Close',exact:true}).click();release?.();await page.unroute('**/api/spaces/*/users/*/follow?*');
  eq(await page.getByRole('link',{name:'View full profile',exact:true}).count(),0); // late old peek cannot reopen
  const reads=requests.length;await page.goto(base+'/');await page.locator('button[aria-label="Jump to space"]:visible').first().waitFor({timeout:20000});eq(requests.length,reads);
  await page.goto(base+'/logout');await page.waitForURL(u=>u.pathname==='/');
  await page.goto(base+'/login');await page.fill('#email',f.users.b.email);await page.fill('#password',f.users.b.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/');
  const secondSid=(await context.cookies()).find(c=>c.name==='sid')?.value;
  if(secondSid){const [rows]:any=await db.query('SELECT id FROM sessions WHERE token=? AND user_id=?',[secondSid,f.users.b.id]);if(rows[0])browserSessionIds.push(Number(rows[0].id));}
  await page.getByRole('button',{name:'Open menu',exact:true}).click();
  const [personalFeed]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/spaces/${f.spaces.personal}/feed`),page.getByRole('button',{name:/Launch test personal/}).click()]);eq(personalFeed.status(),200);
  await page.locator('button[title="View Launch test B"]:visible').first().waitFor({timeout:20000});
  eq(await page.locator('button[aria-label="Follow author in this space"]:visible').count(),0);eq(requests.length,reads);
  await peek();await page.getByRole('link',{name:'View full profile',exact:true}).waitFor();eq(await page.getByRole('button',{name:'Follow',exact:true}).count(),0);eq(requests.length,reads);passed=true;
 }finally{
  release?.();await page.request.get(base+'/logout').catch(()=>{});for(const id of browserSessionIds)await db.query('UPDATE sessions SET revoked_at=NOW() WHERE id=? AND user_id IN (?,?) AND revoked_at IS NULL',[id,f.users.a.id,f.users.b.id]);
  await context.close();await browser.close();await db.query('DELETE FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',tuple);for(const row of prior)await db.query('INSERT INTO space_user_follows(follower_user_id,target_user_id,space_id,created_at) VALUES(?,?,?,?)',[...tuple,row.created_at]);
  const [after]:any=await db.query('SELECT created_at FROM space_user_follows WHERE follower_user_id=? AND target_user_id=? AND space_id=?',tuple);eq(after,prior);
  const result={result:passed?'passed':'failed',checks,scope:'Actual browser Global no Follow, selected-space inline/peek desired states, explicit publication proof, unknown-state disable/read retry, stale closed-peek response and personal absence; exact fixture tuple/session restored.',fixtureStateRestored:true};fs.writeFileSync(dir+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
