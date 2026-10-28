import {chromium} from '@playwright/test';
import {parse as parseEnv} from 'dotenv';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {once} from 'node:events';
import {buildServer} from '../src/app';
import {getPool} from '../src/db';
import * as reports from '../src/features/reports/repo';
import {reportingFixtures} from './native-reporting-fixtures';
async function main(){
 process.env.NATIVE_SESSIONS_ENABLED='1';process.env.NATIVE_ALLOW_INSECURE_LOOPBACK='1';
 const f=await reportingFixtures(),db=getPool(),dir='tests/runs/api-curl/plan_182_reporting';fs.mkdirSync(dir,{recursive:true});
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const tokens:string[]=[],sessions:string[]=[],reportIds:number[]=[];let checks=0,passed=false;
 const eq=(a:unknown,b:unknown)=>assert.deepEqual(a,b,`reporting check ${++checks}`);
 const request=async(path:string,headers:Record<string,string>={},method='GET',body?:unknown)=>{const r=await fetch(base+path,{method,headers:{...headers,...(body!==undefined?{'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});const raw=r.status===204?null:await r.json() as any;
  if(path.startsWith('/api/viewer/v1/')&&(path.includes('/reporting/')||path.endsWith('/report')))eq(r.headers.get('cache-control'),'no-store');
  return {status:r.status,body:raw};};
 const path=(label:string)=>label==='global'?`/api/viewer/v1/feed/global/publications/${f.publications.global}`:`/api/viewer/v1/spaces/${f.spaces[label]}/publications/${f.publications[label]}`;
 try{
  const auth:Record<string,Record<string,string>>={};
  for(const label of ['a','b']){const login=await request('/api/native/v1/session',{},'POST',f.users[label]);eq(login.status,201);tokens.push(login.body.token);auth[label]={authorization:`Bearer ${login.body.token}`};}
  eq((await request(path('global')+'/reporting/options')).status,401);
  const initial=await request(path('global')+'/reporting/options',auth.a);eq(initial.status,200);eq(initial.body.spaceId,f.spaces.global);eq(initial.body.reportedByMe,false);
  const webLogin=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.a)});eq(webLogin.status,200);
  const cookie=webLogin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; '),csrf=decodeURIComponent(/(?:^|; )csrf=([^;]+)/.exec(cookie)?.[1]||'');sessions.push(cookie);
  const web={cookie,'x-csrf-token':csrf};
  const legacy=await request(`/api/publications/${f.publications.global}/reporting/options`,web);eq(legacy.status,200);eq(initial.body.groups,legacy.body.allGroups);eq(initial.body.initialGroupIds,legacy.body.initialGroups.map((g:any)=>g.id));
  const group=initial.body.groups.find((g:any)=>g.rules.length);assert.ok(group);const rule=group.rules[0];
  const detail=await request(path('global')+`/reporting/groups/${group.id}/rules/${rule.id}`,auth.a);eq(detail.status,200);eq(detail.body.ruleId,rule.id);eq(Object.keys(detail.body).filter(k=>/guidance|history|moderator|agent/i.test(k)),[]);
  eq((await request(path('hidden')+'/reporting/options',auth.a)).status,403);eq((await request(path('hidden')+'/reporting/options',auth.b)).status,200);
  for(const label of ['group','channel','hidden'])eq((await request(`/api/viewer/v1/feed/global/publications/${f.publications[label]}/reporting/options`,auth.a)).status,404);
  eq((await request(`/api/viewer/v1/spaces/${f.spaces.group}/publications/${f.publications.global}/reporting/options`,auth.a)).status,404);
  eq((await request(path('global')+'/reporting/options?spaceId=1',auth.a)).status,400);
  eq((await request(path('global')+'/report',auth.a,'POST',{userFacingRuleId:group.id,userId:999})).status,400);
  eq((await request(path('global')+'/report',auth.a,'POST',{userFacingRuleId:group.id,reportedStartSeconds:8,reportedEndSeconds:7})).status,400);
  eq((await request(path('global')+'/report',{cookie},'POST',{userFacingRuleId:group.id})).status,403);
  eq((await request(path('global')+'/report',{...web,...auth.a},'POST',{userFacingRuleId:group.id})).status,400);
  const created=await request(path('global')+'/report',auth.a,'POST',{userFacingRuleId:group.id,reportedStartSeconds:0,reportedEndSeconds:7});eq(created.status,201);reportIds.push(created.body.reportId);eq(created.body.myReport.reportedStartSeconds,0);eq(created.body.myReport.reportedEndSeconds,7);
  eq((await request(path('group')+'/reporting/options',auth.a)).body.reportedByMe,false);eq((await request(path('global')+'/reporting/options',auth.b)).body.reportedByMe,false);
  eq((await request(path('global')+'/report',auth.a,'POST',{userFacingRuleId:group.id})).status,409);
  const globalStored=await reports.getReportById(created.body.reportId);eq(globalStored.rule_scope_at_submit,'global');eq(Number(globalStored.space_id),f.spaces.global);eq(Number(globalStored.production_id),f.productionId);eq(Number(globalStored.reporter_user_id),f.users.a.id);eq(Number(globalStored.rule_version_id)>0,true);eq(globalStored.user_facing_rule_label_at_submit,group.label);
  const review=await reports.listReportsForAdmin({spaceId:f.spaces.global,reporterUserId:f.users.a.id});eq(review.some((r:any)=>Number(r.id)===created.body.reportId),true);
  const race=await Promise.all([0,1,2].map(()=>request(path('group')+'/report',auth.a,'POST',{userFacingRuleId:group.id,ruleId:rule.id,reportedStartSeconds:0,reportedEndSeconds:0})));eq(race.map(r=>r.status).sort(),[201,409,409]);for(const r of race)if(r.status===201)reportIds.push(r.body.reportId);
  const spaceStored=await reports.getReportById(reportIds[1]);eq(spaceStored.rule_scope_at_submit,'space_culture');eq(Number(spaceStored.space_id),f.spaces.group);
  const ownerLogin=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(f.users.b)});eq(ownerLogin.status,200);
  const ownerCookie=ownerLogin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');sessions.push(ownerCookie);
  eq((await request(`/api/space/moderation/reports?space_id=${f.spaces.group}`,{cookie:ownerCookie})).status,403);
  const profile=parseEnv(fs.readFileSync('.codex-local/auth_profiles.env'));assert.ok(profile.SUPER_EMAIL&&profile.SUPER_PASSWORD,'Existing moderator credentials required for read-only review verification.');
  const adminLogin=await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:profile.SUPER_EMAIL,password:profile.SUPER_PASSWORD})});eq(adminLogin.status,200);
  const adminCookie=adminLogin.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');sessions.push(adminCookie);
  const inbox=await request(`/api/admin/reports?space_id=${f.spaces.global}&reporter_user_id=${f.users.a.id}`,{cookie:adminCookie});eq(inbox.status,200);eq(inbox.body.items.some((r:any)=>Number(r.id)===reportIds[0]),true);
  const reviewDetail=await request(`/api/admin/reports/${reportIds[0]}`,{cookie:adminCookie});eq(reviewDetail.status,200);eq(Number(reviewDetail.body.report.space_publication_id),f.publications.global);eq(reviewDetail.body.actions.length,0);
  eq((await request(`/api/admin/reports?space_id=${f.spaces.global}`,web)).status,403);
  const browser=await chromium.launch({headless:true}),context=await browser.newContext();
  try {
    await context.addCookies(adminLogin.headers.getSetCookie().map(value=>{const pair=value.split(';')[0],index=pair.indexOf('=');return {name:pair.slice(0,index),value:pair.slice(index+1),url:base};}));
    const page=await context.newPage();const response=await page.goto(base+`/admin/moderation/reports?space_id=${f.spaces.global}&reporter_user_id=${f.users.a.id}&report_id=${reportIds[0]}&view=inspect`);eq(response?.status(),200);
    await page.getByText(`Report #${reportIds[0]}`,{exact:true}).first().waitFor();checks++;
    fs.mkdirSync('tests/runs/playwright/plan_182_reporting',{recursive:true});await page.screenshot({path:'tests/runs/playwright/plan_182_reporting/native-report-review.png'});
  }finally{await context.close();await browser.close();}
  const legacyPost=await request(`/api/publications/${f.publications.channel}/report`,web,'POST',{userFacingRuleId:group.id,ruleId:rule.id,reported_start_seconds:0,reported_end_seconds:7});eq(legacyPost.status,200);reportIds.push(legacyPost.body.reportId);
  const echoed=await request(path('channel')+'/reporting/options',auth.a);eq(echoed.body.reportedByMe,true);eq(echoed.body.myReport.reportedEndSeconds,7);
  for(const scope of ['global','group']){const feed=await request(scope==='global'?'/api/viewer/v1/feed/global':`/api/viewer/v1/spaces/${f.spaces.group}/feed`,auth.a);eq(feed.status,200);eq(feed.body.items.find((i:any)=>i.publicationId===f.publications[scope])?.reportedByMe,true);}
  const globalFeed=await request('/api/viewer/v1/feed/global',auth.a);eq(globalFeed.body.items.some((i:any)=>i.publicationId===f.publications.hidden),false);
  passed=true;
 }finally{
  // Delete exactly these disposable reports and their downstream work, never prior/user reports.
  const [owned]:any=await db.query('SELECT id FROM space_publication_reports WHERE production_id=? AND reporter_user_id IN (?,?)',[f.productionId,f.users.a.id,f.users.b.id]);
  for(const row of owned){const id=Number(row.id);const [tables]:any=await db.query("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME='report_id'");for(const table of tables){const name=String(table.TABLE_NAME);if(!/^[a-z_]+$/.test(name))throw Error('invalid_cleanup_table');await db.query(`DELETE FROM ${name} WHERE report_id=?`,[id]);}await db.query('DELETE FROM space_publication_reports WHERE id=? AND production_id=?',[id,f.productionId]);}
  for(const token of tokens)await request('/api/native/v1/session',{authorization:`Bearer ${token}`},'DELETE').catch(()=>{});
  for(const cookie of sessions)await fetch(base+'/logout',{headers:{cookie}}).catch(()=>{});
  const [left]:any=await db.query('SELECT COUNT(*) AS n FROM space_publication_reports WHERE production_id=?',[f.productionId]);eq(Number(left[0].n),0);
  server.close();server.closeAllConnections();
  const result={result:passed?'passed':'failed',checks,scope:'Actual mounted bearer/cookie API, destination identity, restricted-copy independence, curated catalog parity, safe detail, integer times, duplicates/races, stored attribution and existing review visibility',ownedReportsCleaned:true,fixturePublicationsRetainedForPhone:f.publications};fs.writeFileSync(dir+'/summary.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
