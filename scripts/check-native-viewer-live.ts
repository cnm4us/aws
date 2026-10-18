import assert from 'node:assert/strict';
import fs from 'node:fs';

async function main() {
  const fixtures=JSON.parse(fs.readFileSync('.codex-local/plan168-fixtures.json','utf8'));
  const base='https://aws.bawebtech.com';let token:string|undefined;let checks=0;
  const eq=(a:unknown,b:unknown)=>{assert.deepEqual(a,b);checks++;};
  try {
    eq((await fetch('http://127.0.0.1:3300/api/native/v1/session')).status,426);
    const malformed=await fetch(base+'/api/native/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:'{"password":"secret",'});
    eq(malformed.status,400);eq(await malformed.json(),{error:'invalid_body'});eq(malformed.headers.get('cache-control'),'no-store');
    const large=await fetch(base+'/api/native/v1/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'x',password:'x',extra:'x'.repeat(5000)})});eq(large.status,413);
    const login=await fetch(base+'/api/native/v1/session',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify(fixtures.users.a)});
    eq(login.status,201);eq(login.headers.get('set-cookie'),null);const session=await login.json() as any;token=session.token;
    const auth={authorization:`Bearer ${token}`};
    eq((await fetch(base+'/api/native/v1/session',{redirect:'error',headers:auth})).status,200);
    const list=await fetch(base+'/api/viewer/v1/me/spaces',{redirect:'error',headers:auth});eq(list.status,200);
    const data=await list.json() as any;eq(data.personal.id,fixtures.spaces.personalA);
    const page=await fetch(base+`/api/viewer/v1/spaces/${fixtures.spaces.groupA}/feed?limit=1`,{redirect:'error',headers:auth});eq(page.status,200);
    const item=(await page.json() as any).items[0];eq(item.spaceId,fixtures.spaces.groupA);
    const master=await fetch(item.playbackUrl);eq(master.status,200);
    const playlist=await master.text();const variant=new URL(playlist.split('\n').find(l=>l && !l.startsWith('#'))!,item.playbackUrl);
    const variantResponse=await fetch(variant);eq(variantResponse.status,200);const lines=await variantResponse.text();
    const segment=await fetch(new URL(lines.split('\n').find(l=>l && !l.startsWith('#'))!,variant),{headers:{Range:'bytes=0-511'}});eq(segment.status,206);await segment.arrayBuffer();
    const denied=await fetch(base+`/api/viewer/v1/spaces/${fixtures.spaces.groupB}/feed`,{headers:auth});eq(denied.status,403);eq(Object.keys(await denied.json()),['error']);
    console.log(JSON.stringify({liveNativeViewer:'passed',checks,base,credentialTransport:'HTTPS without redirects or cookies',media:'public fixture master/variant/segment passed'}));
  }finally {if(token)await fetch(base+'/api/native/v1/session',{method:'DELETE',headers:{authorization:`Bearer ${token}`}});}
}
main().catch(e=>{console.error(e.code||e.message);process.exitCode=1;});
