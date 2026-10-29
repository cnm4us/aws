import {assertDiscoveryQaIsolated} from './discovery-qa-isolation';
import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {once} from 'node:events';
import {buildServer} from '../src/app';
import {getPool} from '../src/db';
async function main(){
 await assertDiscoveryQaIsolated();
 const f=JSON.parse(fs.readFileSync('.codex-local/plan175-fixtures.json','utf8')),db=getPool();
 const tables=['viewer_saved_spaces','viewer_discovery_migrations','viewer_space_acknowledgments','viewer_recent_spaces'],backups:Record<string,any[]>={};
 for(const table of tables){const [rows]:any=await db.query(`SELECT * FROM ${table} WHERE user_id=?`,[f.users.a.id]);backups[table]=rows;}
 const [flags]:any=await db.query('SELECT root_home,native_home FROM discovery_state WHERE id=1');
 const server=buildServer().listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:440,height:956}}),page=await context.newPage();
 await context.route('**/*',async route=>{const request=route.request();if(new URL(request.url()).origin===base){const headers={...request.headers()};delete headers.origin;await route.continue({headers});}else await route.continue();});
 const errors:string[]=[],media:string[]=[],cookies:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\.m3u8(?:\?|$)/.test(r.url()))media.push('hls')});
 let checks=0;const eq=(a:any,b:any)=>{assert.deepEqual(a,b,`Browser check ${++checks}`)};
 const dir='tests/runs/playwright/plan_184';fs.mkdirSync(dir,{recursive:true});
 try {
  await page.goto(base+'/discover');await page.getByRole('heading',{name:'Find your next space'}).waitFor();eq(await page.locator('video').count(),0);eq(media.length,0);
  for(const name of ['Travel','Cooking','Technology','Arts'])eq(await page.getByRole('heading',{name:new RegExp('^'+name)}).count(),1);
  await page.screenshot({path:dir+'/home.png',fullPage:true});
  await page.getByRole('link',{name:'See all'}).first().click();await page.getByRole('heading',{name:'Travel',exact:true}).waitFor();eq(await page.locator('video').count(),0);
  await page.getByRole('link',{name:/Launch test group/}).first().click();await page.getByRole('heading',{name:'Launch test group',exact:true}).waitFor();eq(await page.locator('video').count(),0);
  await page.getByRole('link',{name:'Sign in to enter',exact:true}).click();await page.fill('#email',f.users.a.email);await page.fill('#password',f.users.a.password);await page.locator('button[type=submit]').click();
  await page.getByRole('heading',{name:'Launch test group',exact:true}).waitFor();eq(await page.locator('video').count(),0);
  const checkbox=page.getByRole('checkbox',{name:'I’ve read the space rules'});await checkbox.waitFor();eq(await page.getByRole('button',{name:'Enter space',exact:true}).isDisabled(),true);
  await page.screenshot({path:dir+'/welcome.png',fullPage:true});await checkbox.check();await page.getByRole('button',{name:'Enter space',exact:true}).click();await page.locator('video').first().waitFor({state:'attached'});checks++;
  await page.getByRole('button',{name:'Home',exact:true}).click();await page.getByRole('heading',{name:'Find your next space'}).waitFor();eq(await page.locator('video').count(),0);
  const requestsBefore=media.length;if(await page.getByRole('button',{name:'Remove Launch test group',exact:true}).count())await page.getByRole('button',{name:'Remove Launch test group',exact:true}).first().click();await page.getByRole('button',{name:'Save Launch test group',exact:true}).first().click();await page.getByRole('button',{name:'Remove Launch test group',exact:true}).first().waitFor();eq(media.length,requestsBefore);
  await page.getByRole('link',{name:'Your Spaces',exact:true}).click();await page.getByRole('heading',{name:'Your Spaces',exact:true}).waitFor();eq(await page.getByRole('heading',{name:'Launch test group',exact:true}).count(),1);
  await page.getByRole('button',{name:'Remove Launch test group',exact:true}).click();await page.reload();await page.getByRole('heading',{name:'Your Spaces',exact:true}).waitFor();eq(await page.getByRole('heading',{name:'Launch test group',exact:true}).count(),0);
  await page.goto(base+'/global');await page.locator('video').first().waitFor({state:'attached'});checks++;
  await page.getByRole('button',{name:'About / Rules',exact:true}).click();await page.getByRole('heading',{name:'Global',exact:true,level:1}).waitFor();eq(await page.locator('video').count(),0);await page.goBack();await page.locator('video').first().waitFor({state:'attached'});checks++;
  await page.goto(base+'/?publication_id=730&t=0&t_end=7#kept');await page.waitForURL(u=>u.pathname==='/global');eq(new URL(page.url()).searchParams.get('t_end'),'7');eq(new URL(page.url()).hash,'#kept');
  await db.query('UPDATE discovery_state SET root_home=1 WHERE id=1');await page.goto(base+'/');await page.getByRole('heading',{name:'Find your next space'}).waitFor();eq(await page.locator('video').count(),0);
  await page.goto(base+'/help');eq(new URL(page.url()).pathname,'/help');await page.goto(base+'/does-not-exist');eq((await page.request.get(base+'/does-not-exist')).status(),404);
  eq(errors,[]);const result={status:'passed',checks,scope:'Browser Home/genres, no hidden media, login preserves intended space, explicit acknowledgment, save/remove/migration, Global/About/Back, legacy query/fragment, gated root cutover, Help/404.'};fs.writeFileSync(dir+'/summary.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally {
  const all=await context.cookies();const cookie=all.map(c=>`${c.name}=${c.value}`).join('; ');if(cookie)await fetch(base+'/logout',{headers:{cookie},redirect:'manual'}).catch(()=>{});
  await context.close();await browser.close();
  for(const table of tables){await db.query(`DELETE FROM ${table} WHERE user_id=?`,[f.users.a.id]);for(const row of backups[table])await db.query(`INSERT INTO ${table} SET ?`,[row]);}
  await db.query('UPDATE discovery_state SET root_home=?,native_home=? WHERE id=1',[flags[0].root_home,flags[0].native_home]);
  await new Promise<void>(r=>server.close(()=>r()));await db.end();
 }
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
