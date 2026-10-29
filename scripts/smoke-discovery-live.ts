/** Read-only production-host verification. No flags, acknowledgments, reports or relationships are changed. */
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
async function main(){
 const base=process.env.DISCOVERY_SMOKE_BASE_URL||'https://aws.bawebtech.com';let checks=0;const eq=(a:any,b:any)=>{assert.deepEqual(a,b,`Live smoke ${++checks}`)};
 const cards=process.env.DISCOVERY_SMOKE_CARDS==='1';
 for(const path of [...(cards?['/personal/about']:[]),'/global','/discover','/genres/travel','/global/about','/help'])eq((await fetch(base+path)).status,200);
 const expectedHome=process.env.DISCOVERY_SMOKE_HOME_ENABLED!=='0';
 const config=await(await fetch(base+'/api/viewer/v1/discovery/config')).json() as any;eq(config.homeEnabled,expectedHome);eq(config.nativeHomeEnabled,true);
 const response=await fetch(base+'/api/viewer/v1/discovery/home',{headers:{Origin:new URL(base).origin}});eq(response.status,200);eq(response.headers.get('access-control-allow-origin'),new URL(base).origin);
 const home=await response.json() as any;eq(home.genres.map((g:any)=>g.name),['Travel','Cooking','Technology','Arts']);eq(new Set(home.genres.flatMap((g:any)=>g.items.map((s:any)=>s.name))).size,2);
 eq((await fetch(base+'/api/feed/global')).status,200);eq((await fetch(base+'/api/viewer/v1/feed/global')).status,200);
 eq((await fetch(base+'/channels/global-feed',{redirect:'manual'})).headers.get('location'),'/global');
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:440,height:956}}),page=await context.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 try {
  // Exercise the installed-mode bootstrap while preserving explicit routes; this is not an installed-PWA claim.
  await context.addInitScript(()=>{const win=(globalThis as any).window;const original=win.matchMedia.bind(win);win.matchMedia=(query:string)=>{const result=original(query);if(query.includes('display-mode: standalone'))Object.defineProperty(result,'matches',{value:true});return result;};});
  await page.goto(base+'/discover');await page.getByRole('heading',{name:'Find your next space',level:1}).waitFor();eq(await page.locator('video').count(),0);
  if(cards){
   const geometry=await page.evaluate(()=>{const doc=(globalThis as any).document;const feature=doc.querySelector('.discovery-featured').getBoundingClientRect(),row=doc.querySelector('[data-space-row="travel"]').getBoundingClientRect(),card=doc.querySelector('[data-space-row="travel"] .discovery-tile').getBoundingClientRect();return {feature:feature.width,row:row.width,card:card.width,left:feature.left,right:440-feature.right};});
   eq(Math.abs(geometry.left-geometry.right)<1,true);eq(Math.abs(geometry.feature-geometry.row)<1,true);eq(Math.abs(geometry.card-geometry.row*.84)<1,true);
   eq(await page.getByRole('checkbox',{name:'Save Launch test group to Your Spaces',exact:true}).count(),2);
   await page.getByRole('link',{name:'About and rules for Launch test group',exact:true}).first().click();await page.getByRole('heading',{name:'Launch test group',level:1}).waitFor();
   eq(new URL(page.url()).pathname.endsWith('/about'),true);eq(await page.locator('video').count(),0);
   await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('heading',{name:'Find your next space',level:1}).waitFor();
  }
  await page.getByRole('link',{name:/Launch test group/}).first().click();await page.getByRole('heading',{name:'Launch test group',level:1}).waitFor();eq(await page.locator('video').count(),0);eq(await page.getByRole('link',{name:'Sign in to enter',exact:true}).count(),1);
  await page.goto('data:text/html,<title>Prior page</title>');await page.goto(base+'/');
  if(expectedHome){await page.getByRole('heading',{name:'Find your next space',level:1}).waitFor();eq(new URL(page.url()).pathname,'/');eq(await page.locator('video').count(),0);}
  else{await page.waitForURL(u=>u.pathname==='/global');await page.locator('video').first().waitFor({state:'attached'});checks++;}
  await page.goBack();eq(page.url().startsWith('data:text/html,'),true);
  await page.goto(base+'/?publication_id=730&t=0&t_end=7#kept');await page.waitForURL(u=>u.pathname==='/global');eq(new URL(page.url()).searchParams.get('publication_id'),'730');await page.locator('video').first().waitFor({state:'attached'});eq(new URL(page.url()).searchParams.get('t_end'),'7');eq(new URL(page.url()).hash,'#kept');
  await page.goto(base+'/help');eq(new URL(page.url()).pathname,'/help');eq(errors,[]);
  const result={status:'passed',checks,homeEnabled:expectedHome,scope:'Actual HTTPS host and allowed Origin, legacy/new anonymous Global APIs, discovery preview, no private feed before sign-in, canonical aliases, root Home/legacy-intent history, deep-link range/fragment and standalone bootstrap route preservation.',physicalAudio:'not observed'};
  const dir=`tests/runs/playwright/${cards?'plan_185':'plan_184'}`;fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(dir+'/live-smoke.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await context.close();await browser.close();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
