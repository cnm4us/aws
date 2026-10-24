import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { getPool } from '../src/db';
import { seedEngagementFixtures } from './native-engagement-fixtures';
async function main(){
 const f=await seedEngagementFixtures(),db=getPool(),base=process.env.VIEWER_WEB_BASE_URL||'https://aws.bawebtech.com',pub=f.publications.group;
 const [spaces]:any=await db.query('SELECT slug FROM spaces WHERE id=?',[f.spaces.group]);
 const [initial]:any=await db.query('SELECT likes_count,comments_count FROM space_publications WHERE id=?',[pub]);
 const [existing]:any=await db.query('SELECT 1 FROM publication_likes WHERE publication_id=? AND user_id=?',[pub,f.users.a.id]);
 if(existing.length){await db.end();throw Error('fixture likes must start empty');}
 const body=`Plan174 browser ${crypto.randomBytes(10).toString('hex')}`,browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();
 const dir='tests/runs/playwright/plan_174_engagement';fs.mkdirSync(dir,{recursive:true});let checks=0,passed=false,browserSessionId:number|null=null;
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`web engagement check ${++checks}`);
 const requests:string[]=[];page.on('request',r=>{if(/\/api\/publications\/\d+\/(likes|comments)/.test(r.url()))requests.push(r.url());});
 const matching=(suffix:string,method='GET')=>(r:any)=>new URL(r.url()).pathname===`/api/publications/${pub}/${suffix}`&&r.request().method()===method;
 try{
  await page.goto(base+'/login');await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/');
  const sid=(await context.cookies()).find(c=>c.name==='sid')?.value;
  if(sid){const [sessions]:any=await db.query('SELECT id FROM sessions WHERE token=? AND user_id=?',[sid,f.users.a.id]);browserSessionId=sessions[0]?Number(sessions[0].id):null;}
  await page.locator('button[aria-label="Jump to space"]:visible').first().waitFor({timeout:20000});
  eq(await page.locator('button[aria-label="Like"]:visible').count(),0);eq(await page.locator('button[aria-label="Comments"]:visible').count(),0);eq(requests.length,0);
  await page.goto(base+`/groups/${spaces[0].slug}?pin=${encodeURIComponent(f.source.productionUlid)}`);
  const like=page.locator('button[aria-label="Like"]:visible').first();await like.waitFor({timeout:20000});
  const [liked]=await Promise.all([page.waitForResponse(matching('likes','POST')),like.click()]);eq(liked.status(),200);
  const unlike=page.locator('button[aria-label="Unlike"]:visible').first();await unlike.waitFor();
  const [unliked]=await Promise.all([page.waitForResponse(matching('likes','DELETE')),unlike.click()]);eq(unliked.status(),200);
  const [list]=await Promise.all([page.waitForResponse(matching('comments')),page.locator('button[aria-label="Comments"]:visible').first().click()]);eq(list.status(),200);eq(JSON.stringify(await list.json()).includes('email'),false);
  await page.locator('textarea[placeholder="Write a comment…"]').fill(body);
  const [posted]=await Promise.all([page.waitForResponse(matching('comments','POST')),page.getByRole('button',{name:'Post',exact:true}).click()]);eq(posted.status(),201);
  await page.getByText(body,{exact:true}).waitFor();eq(await page.getByText(body,{exact:true}).count(),1);
  await page.getByRole('button',{name:'Sort comments',exact:true}).click();
  const [sorted]=await Promise.all([page.waitForResponse(r=>matching('comments')(r)&&new URL(r.url()).searchParams.get('order')==='oldest'),page.getByRole('button',{name:'Oldest',exact:false}).click()]);eq(sorted.status(),200);await page.getByText(body,{exact:true}).waitFor();
  eq(requests.every(url=>new URL(url).searchParams.get('spaceId')===String(f.spaces.group)),true);
  await page.screenshot({path:dir+'/comments.png'});passed=true;
 }finally{
  await page.request.get(base+'/logout').catch(()=>{});
  if(browserSessionId)await db.query('UPDATE sessions SET revoked_at=NOW() WHERE id=? AND user_id=? AND revoked_at IS NULL',[browserSessionId,f.users.a.id]);
  await context.close();await browser.close();
  const conn=await db.getConnection();try{await conn.beginTransaction();await conn.query('SELECT id FROM space_publications WHERE id=? FOR UPDATE',[pub]);
   const [comments]:any=await conn.query("SELECT COUNT(*) n FROM publication_comments WHERE publication_id=? AND user_id=? AND body=? AND status='visible' AND deleted_at IS NULL",[pub,f.users.a.id,body]);
   await conn.query('DELETE FROM publication_comments WHERE publication_id=? AND user_id=? AND body=?',[pub,f.users.a.id,body]);
   const [likes]:any=await conn.query('DELETE FROM publication_likes WHERE publication_id=? AND user_id=?',[pub,f.users.a.id]);
   await conn.query('UPDATE space_publications SET comments_count=GREATEST(comments_count-?,0),likes_count=GREATEST(likes_count-?,0) WHERE id=?',[Number(comments[0].n),likes.affectedRows,pub]);await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  const [final]:any=await db.query('SELECT likes_count,comments_count FROM space_publications WHERE id=?',[pub]);eq(final,initial);
  const summary={result:passed?'passed':'failed',checks,scope:'Actual browser cookie login, Global no engagement, pinned group Like/unlike, comment read/post/sort, explicit space requests and safe identity. Exact test body/Like changes removed; counters restored; browser logged out.',fixtureStateRestored:true};
  fs.writeFileSync(dir+'/summary.json',JSON.stringify(summary,null,2)+'\n');console.log(JSON.stringify(summary));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
