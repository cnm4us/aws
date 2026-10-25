import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { getPool } from '../src/db';
import { assignDefaultAdminRoles } from '../src/services/spaceMembership';
import { seedIntroductionFixtures } from './native-launch-introduction-fixtures';
async function main(){
 const f=await seedIntroductionFixtures(),db=getPool(),spaceId=f.spaces.group,owner=f.users.b.id,base=process.env.VIEWER_WEB_BASE_URL||'https://aws.bawebtech.com';
 const [rows]:any=await db.query('SELECT settings FROM spaces WHERE id=?',[spaceId]);
 const [roles]:any=await db.query('SELECT user_id,space_id,role_id FROM user_space_roles WHERE user_id=? AND space_id=?',[owner,spaceId]);
 await assignDefaultAdminRoles(db,{id:spaceId,type:'group',owner_user_id:owner},owner);
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();let sessionId:number|undefined,checks=0,passed=false;
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`space introduction browser check ${++checks}`);
 const directory='tests/runs/playwright/plan_175_introductions';fs.mkdirSync(directory,{recursive:true});
 try{
  await page.goto(base+'/login');await page.fill('#email',f.users.b.email);await page.fill('#password',f.users.b.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/');
  const sid=(await context.cookies()).find(c=>c.name==='sid')?.value;
  const [sessions]:any=await db.query('SELECT id FROM sessions WHERE token=? AND user_id=?',[sid,owner]);sessionId=Number(sessions[0]?.id);assert.ok(sessionId);
  const r=await page.goto(base+`/spaces/${spaceId}/admin/settings`);eq(r?.status(),200);
  const description=page.getByRole('textbox',{name:'Space introduction'});await description.waitFor();eq(await description.getAttribute('maxlength'),'500');
  const text='Disposable browser fixture: community discussion with clear local moderation.';await description.fill(text);
  const saved=page.waitForResponse(r=>r.url().endsWith(`/api/spaces/${spaceId}/settings`)&&r.request().method()==='PUT');await page.getByRole('button',{name:'Save',exact:true}).click();eq((await saved).status(),200);
  await page.reload();await description.waitFor();eq(await description.inputValue(),text);
  const [current]:any=await db.query('SELECT settings FROM spaces WHERE id=?',[spaceId]);const old=typeof rows[0].settings==='string'?JSON.parse(rows[0].settings):rows[0].settings,newSettings=typeof current[0].settings==='string'?JSON.parse(current[0].settings):current[0].settings;
  eq(newSettings.discoveryDescription,text);eq(newSettings.visibility,old.visibility);eq(newSettings.membership,old.membership);
  // The UI does not expose any private moderation setting in the introduction.
  await page.screenshot({path:directory+'/space-introduction-settings.png'});passed=true;
 }finally{
  await page.request.get(base+'/logout').catch(()=>{});if(sessionId)await db.query('UPDATE sessions SET revoked_at=NOW() WHERE id=? AND user_id=? AND revoked_at IS NULL',[sessionId,owner]);
  await context.close();await browser.close();await db.query('UPDATE spaces SET settings=? WHERE id=?',[typeof rows[0].settings==='string'?rows[0].settings:JSON.stringify(rows[0].settings),spaceId]);
  await db.query('DELETE FROM user_space_roles WHERE user_id=? AND space_id=?',[owner,spaceId]);for(const row of roles)await db.query('INSERT INTO user_space_roles(user_id,space_id,role_id) VALUES(?,?,?)',[row.user_id,row.space_id,row.role_id]);
  const result={result:passed?'passed':'failed',checks,scope:'Actual authenticated owner/admin space settings form, bounded introduction edit/save/reload with live API, exact fixture settings/roles restored and browser session revoked.'};fs.writeFileSync(directory+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await db.end();
 }
}
main().catch(async e=>{console.error(e.message);process.exitCode=1;await getPool().end().catch(()=>{});});
