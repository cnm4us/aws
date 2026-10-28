import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {getPool} from '../src/db';
import {reportingFixtures} from './native-reporting-fixtures';
async function main(){
 const f=await reportingFixtures(),db=getPool(),base=process.env.VIEWER_WEB_BASE_URL||'https://aws.bawebtech.com',dir='tests/runs/playwright/plan_182_reporting';fs.mkdirSync(dir,{recursive:true});
 const [rows]:any=await db.query('SELECT slug FROM spaces WHERE id=?',[f.spaces.group]);const slug=rows[0].slug;
 const [prior]:any=await db.query('SELECT id FROM space_publication_reports WHERE production_id=?',[f.productionId]);assert.equal(prior.length,0,'Reporting fixture already has reports; preserve them and stop.');
 const browser=await chromium.launch({headless:true}),context=await browser.newContext(),page=await context.newPage();let cookie='',checks=0,passed=false;
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`reporting browser check ${++checks}`);
 const status=async(id:number)=>{const r=await page.request.get(base+`/api/publications/${id}/reporting/options`);eq(r.status(),200);return r.json();};
 try{
  await page.goto(base+'/login');await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);await page.locator('button[type="submit"]').click();await page.waitForURL(u=>u.pathname==='/');
  cookie=(await context.cookies()).filter(c=>['sid','csrf'].includes(c.name)).map(c=>`${c.name}=${c.value}`).join('; ');
  await page.goto(base+`/?pin=${encodeURIComponent(f.productionUlid)}`);
  const flag=page.getByRole('button',{name:'Report',exact:true}).filter({visible:true}).first();await flag.waitFor({timeout:20000});
  const [options]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/publications/${f.publications.global}/reporting/options`),flag.click()]);eq(options.status(),200);
  const choices=await options.json();eq(choices.spaceId,f.spaces.global);eq(choices.reportedByMe,false);
  const showAll=page.getByRole('button',{name:/Show All User Groups/});if(await showAll.count()){await showAll.click();eq(await showAll.count(),0);}
  const drill=page.getByRole('button',{name:'Drill down',exact:true}).first();await drill.click();await page.getByRole('button',{name:'More details',exact:true}).first().click();await page.getByRole('button',{name:'Long',exact:true}).waitFor();
  for(const name of ['Allowed','Disallowed','Long']){await page.getByRole('button',{name,exact:true}).click();checks++;}
  await page.screenshot({path:dir+'/report-rule.png'});
  const [sent]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/publications/${f.publications.global}/report`&&r.request().method()==='POST'),page.getByRole('button',{name:'Submit',exact:true}).click()]);eq(sent.status(),200);
  await page.getByRole('button',{name:'Close report modal'}).waitFor({state:'hidden'});eq((await status(f.publications.global)).reportedByMe,true);eq((await status(f.publications.group)).reportedByMe,false);
  await page.getByRole('button',{name:'Reported',exact:true}).filter({visible:true}).first().click();await page.getByText(/You already reported this post/).waitFor();for(const button of await page.getByRole('button',{name:'Submit',exact:true}).all())eq(await button.isDisabled(),true);await page.getByRole('button',{name:'Close report modal'}).click();
  await page.goto(base+`/groups/${slug}?pin=${encodeURIComponent(f.productionUlid)}`);await page.getByRole('button',{name:'Report',exact:true}).filter({visible:true}).first().waitFor({timeout:20000});
  await page.getByRole('button',{name:'Report',exact:true}).filter({visible:true}).first().click();await page.getByRole('button',{name:'Submit',exact:true}).first().waitFor();
  const [groupReport]=await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname===`/api/publications/${f.publications.group}/report`&&r.request().method()==='POST'),page.getByRole('button',{name:'Submit',exact:true}).first().click()]);eq(groupReport.status(),200);eq((await status(f.publications.group)).reportedByMe,true);
  await page.screenshot({path:dir+'/group-sent.png'});passed=true;
 }finally{
  await page.request.get(base+'/logout').catch(()=>{});await context.close();await browser.close();
  const [owned]:any=await db.query('SELECT id FROM space_publication_reports WHERE production_id=? AND reporter_user_id=?',[f.productionId,f.users.a.id]);
  const [tables]:any=await db.query("SELECT TABLE_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='report_id'");
  for(const row of owned){for(const table of tables){const name=String(table.TABLE_NAME);assert.match(name,/^[a-z_]+$/);await db.query(`DELETE FROM ${name} WHERE report_id=?`,[row.id]);}await db.query('DELETE FROM space_publication_reports WHERE id=? AND production_id=?',[row.id,f.productionId]);}
  const sid=/(?:^|; )sid=([^;]+)/.exec(cookie)?.[1];if(sid)await db.query('UPDATE sessions SET revoked_at=NOW() WHERE token=? AND user_id=? AND revoked_at IS NULL',[sid,f.users.a.id]);
  const [remaining]:any=await db.query('SELECT COUNT(*) AS n FROM space_publication_reports WHERE production_id=?',[f.productionId]);eq(Number(remaining[0].n),0);
  const result={result:passed?'passed':'failed',checks,scope:'Actual web Report overlay, initial/Show All, mapped rule Long/Allowed/Disallowed, specific/global and general/space submission, own Sent reopen and publication independence',ownedReportsCleaned:true};fs.writeFileSync(dir+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
