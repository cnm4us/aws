/** Actual browser geometry/actions with an in-memory discovery transport; no shared database mutations. */
import express from 'express';
import {chromium} from '@playwright/test';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
declare const document:any;
declare const window:any;
async function main(){
 const card=(id:number,type='group',description:string|null=null)=>({id,name:id===90?'Global':`Space ${id}`,slug:`space-${id}`,type,global:id===90,path:id===90?'/global':type==='personal'?'/personal':`/${type==='group'?'groups':'channels'}/space-${id}`,description,artworkUrl:`/images/discovery/${id===90?'global':type}-v1.jpg`,saved:false,requiresSignIn:false});
 const global=card(90,'channel'),personal=card(91,'personal'),items=[card(1),card(2,'channel','A longer description that takes several lines to read, while the card remains the same width.'),card(3),card(4)];
 const saved=new Set<number>(),accepted=new Set<number>();let posts=0,pending:(()=>void)|null=null,fail=false,delay=false;
 const fresh=(c:any)=>({...c,saved:saved.has(c.id)}),home=()=>({global,recent:items.map(fresh),genres:[{slug:'travel',name:'Travel',items:items.map(fresh)},{slug:'technology',name:'Technology',items:items.map(fresh)}]});
 const app=express();app.use(express.json());
 app.use('/api/viewer/v1/discovery',async(req,res)=>{
  const p=req.path;
  if(p==='/config')return res.json({homeEnabled:true,nativeHomeEnabled:true});
  if(p==='/home')return res.json(home());
  if(p==='/saved')return res.json({global,personal,items:items.filter(i=>saved.has(i.id)).map(fresh),nextCursor:null});
  if(p==='/directory')return res.json({items:items.map(fresh),genre:{slug:req.query.genre,name:'Travel'},nextCursor:null});
  if(p==='/recent')return res.json({items:items.map(fresh),nextCursor:null});
  const match=/^\/spaces\/(.+)\/(entry|save|accept|resume)$/.exec(p);
  if(match){const key=decodeURIComponent(match[1]),c=key==='global'?global:key==='personal'?personal:items.find(i=>i.id===Number(key.match(/\d+$/)?.[0]));if(!c)return res.status(404).json({error:'space_not_found'});
   if(match[2]==='entry')return res.json({schemaVersion:1,signedIn:true,space:fresh(c),document:{name:c.type==='personal'?'My Space':c.name,welcome:'Read the space introduction.',purpose:c.description,cultures:[],rules:[]},revision:'a'.repeat(64),canView:true,requiresSignIn:false,requiresAcknowledgment:!accepted.has(c.id),acknowledgmentEnabled:true,accepted:accepted.has(c.id)});
   if(match[2]==='resume')return res.json({revision:0,outcome:'new',checkpoint:null});
   posts++;if(match[2]==='accept'){accepted.add(c.id);return res.json({ok:true});}
   if(delay)await new Promise<void>(r=>{pending=r;});if(fail)return res.status(503).json({error:'offline'});
   req.body.saved?saved.add(c.id):saved.delete(c.id);return res.json({ok:true,saved:req.body.saved});
  }
  return res.status(404).json({error:'unexpected_test_request'});
 });
 app.use(express.static(path.resolve('public')));app.use((_req,res)=>res.sendFile(path.resolve('public/app/index.html')));
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const base=`http://127.0.0.1:${(server.address() as any).port}`;
 const browser=await chromium.launch({headless:true}),page=await browser.newPage({viewport:{width:440,height:956}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));let checks=0;const eq=(a:any,b:any)=>{assert.deepEqual(a,b,`Card check ${++checks}`)},ok=(v:any)=>{assert.ok(v,`Card check ${++checks}`)};
 const dir='tests/runs/playwright/plan_185';fs.mkdirSync(dir,{recursive:true});
 try{
  const geometry=[];
  for(const width of [320,375,390,440,639,640,959,960,1024,1280]){
   await page.setViewportSize({width,height:956});await page.goto(base+'/');await page.getByRole('heading',{name:'Find your next space'}).waitFor();
   const bounds=await page.evaluate(()=>{const box=(el:any)=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,width:b.width,top:b.top,bottom:b.bottom}};const row=document.querySelector('[data-space-row="travel"]');return {body:document.documentElement.scrollWidth,viewport:window.innerWidth,global:box(document.querySelector('.discovery-featured')),row:box(row),cards:[...row.querySelectorAll('.discovery-tile')].map(box),footers:[...row.querySelectorAll('.discovery-card-footer')].map(box),heading:box(row.previousElementSibling),checkbox:box(row.querySelector('.discovery-save')),launch:box(row.querySelector('.discovery-launch'))};});
   ok(bounds.body<=bounds.viewport);ok(Math.abs(bounds.global.left-(width-bounds.global.right))<=1);ok(Math.abs(bounds.global.width-bounds.row.width)<=1);ok(bounds.cards.every((c:any)=>Math.abs(c.width-bounds.cards[0].width)<1));ok(bounds.footers.every((c:any)=>Math.abs(c.bottom-bounds.footers[0].bottom)<1));ok(bounds.heading.right<=bounds.row.right+1);ok(bounds.checkbox.width>=44&&bounds.checkbox.bottom-bounds.checkbox.top>=44);ok(bounds.launch.width>=44);
   const c=bounds.row.width,expected=c<600?c*.84:c<920?(c-16)/2:(c-32)/3;ok(Math.abs(bounds.cards[0].width-expected)<1);if(c<600)ok(bounds.cards[1].left<bounds.row.right);
   geometry.push({viewport:width,content:c,card:bounds.cards[0].width});
  }
  await page.setViewportSize({width:440,height:956});await page.goto(base+'/');await page.getByRole('heading',{name:'Find your next space'}).waitFor();
  delay=true;const save=page.getByRole('checkbox',{name:'Save Space 1 to Your Spaces'});await save.first().click();await page.waitForFunction(()=>[...document.querySelectorAll('input[aria-label="Save Space 1 to Your Spaces"]')].every((e:any)=>e.disabled));eq(posts,1);eq(await save.first().isChecked(),false);eq(await page.getByRole('checkbox',{name:'Save Space 2 to Your Spaces'}).first().isDisabled(),false);delay=false;(pending as unknown as ()=>void)();await page.waitForFunction(()=>[...document.querySelectorAll('input[aria-label="Save Space 1 to Your Spaces"]')].every((e:any)=>e.checked&&!e.disabled));eq(await save.count(),3);eq(new URL(page.url()).pathname,'/');
  await page.locator('[data-space-row="travel"]').evaluate((el:any)=>{el.scrollLeft=240;});const scroll=await page.locator('[data-space-row="travel"]').evaluate((el:any)=>el.scrollLeft);
  const about=page.locator('[data-space-row="travel"]').getByRole('link',{name:'About and rules for Space 2'});await about.focus();await about.click();await page.getByRole('heading',{name:'Space 2',exact:true}).waitFor();eq(await page.locator('video').count(),0);eq(posts,1);await page.getByRole('button',{name:'Back',exact:true}).click();await page.getByRole('heading',{name:'Find your next space'}).waitFor();const restored=await page.locator('[data-space-row="travel"]').evaluate((el:any)=>el.scrollLeft);assert.ok(Math.abs(restored-scroll)<1,`Row restoration expected ${scroll}, got ${restored}`);checks++;eq(await page.evaluate(()=>document.activeElement?.getAttribute('data-card-focus')),'about-2');
  fail=true;await page.getByRole('checkbox',{name:'Save Space 2 to Your Spaces'}).first().click();await page.getByRole('alert').first().waitFor();eq(await page.getByRole('checkbox',{name:'Save Space 2 to Your Spaces'}).first().isChecked(),false);fail=false;
  await page.goto(base+'/your-spaces');await page.getByRole('heading',{name:'Your Spaces',exact:true}).waitFor();eq(await page.getByRole('checkbox').count(),1);eq(await page.getByRole('checkbox',{name:'Save My Space to Your Spaces'}).count(),0);await page.getByRole('checkbox',{name:'Save Space 1 to Your Spaces'}).click();await page.getByText('Save spaces here for quick access.').waitFor();eq(await page.getByRole('checkbox').count(),0);eq(await page.evaluate(()=>document.activeElement?.tagName),'H1');
  accepted.add(91);await page.goto(base+'/personal/about');await page.getByRole('heading',{name:'My Space',exact:true}).waitFor();eq(await page.locator('video').count(),0);eq(await page.getByRole('button',{name:'Enter space',exact:true}).count(),1);
  await page.goto(base+'/');await page.getByRole('link',{name:'Launch Space 3',exact:true}).first().click();await page.getByRole('heading',{name:'Space 3',exact:true}).waitFor();eq(await page.getByRole('button',{name:'Enter space',exact:true}).isDisabled(),true);
  await page.goto(base+'/');await page.getByRole('heading',{name:'Find your next space'}).waitFor();await page.screenshot({path:dir+'/home-cards.png',fullPage:true});eq(errors,[]);
  const result={status:'passed',checks,geometry,scope:'Real rendered web geometry and actions with an isolated in-memory transport. No shared DB or rollout mutations; not an API authority or physical iPhone claim.'};fs.writeFileSync(dir+'/cards.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 }finally{await browser.close();await new Promise<void>(r=>server.close(()=>r()));}
}
main().catch(e=>{console.error(e.message);process.exitCode=1});
