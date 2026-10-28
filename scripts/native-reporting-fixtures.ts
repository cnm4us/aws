/** Plan-scoped destination publications; shares fixture media, never creates media/jobs or changes prior fixtures. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {getPool} from '../src/db';
import {ulidMonotonic} from '../src/utils/ulid';
export async function reportingFixtures(plan:'plan182'|'plan183'='plan182') {
 const file=`.codex-local/${plan}-fixtures.json`;
 const fixtureLabel=plan==='plan183'?'Plan183':'Plan182';
 if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
 const prior=JSON.parse(fs.readFileSync('.codex-local/plan175-fixtures.json','utf8')),db=await getPool().getConnection();
 try{
  await db.beginTransaction();
  const [actors]:any=await db.query('SELECT id,email FROM users WHERE id IN (?,?)',[prior.users.a.id,prior.users.b.id]);
  for(const label of ['a','b'])assert.equal(actors.find((r:any)=>Number(r.id)===prior.users[label].id)?.email,prior.users[label].email);
  const [rows]:any=await db.query(`SELECT sp.upload_id,sp.production_id,u.user_id,p.output_prefix,p.config FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id JOIN productions p ON p.id=sp.production_id WHERE sp.id=? AND sp.owner_user_id=? AND u.s3_key LIKE 'native-fixtures/plan173/%'`,[prior.publications.group,prior.users.b.id]);
  assert.equal(rows.length,1);assert.equal(Number(rows[0].user_id),prior.users.b.id);
  const [global]:any=await db.query("SELECT id FROM spaces WHERE slug='global-feed'");assert.equal(global.length,1);
  const productionUlid=ulidMonotonic(),[production]:any=await db.query(`INSERT INTO productions(upload_id,user_id,status,config,output_prefix,ulid,name,completed_at) VALUES(?,?,'completed',?,?,?,?,NOW())`,[rows[0].upload_id,prior.users.b.id,rows[0].config,rows[0].output_prefix,productionUlid,`${fixtureLabel} reporting fixture`]);
  const spaces={global:Number(global[0].id),group:prior.spaces.group,channel:prior.spaces.channel,hidden:prior.spaces.hidden},publications:Record<string,number>={};
  for(const [label,spaceId] of Object.entries(spaces)){
   const [insert]:any=await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at,story_text) VALUES(?,?,?,'published',?,'inherit',1,?,NOW(),?)`,[rows[0].upload_id,production.insertId,spaceId,prior.users.b.id,label==='global'?1:0,`${fixtureLabel} reporting test video.`]);
   publications[label]=Number(insert.insertId);
  }
  const result={users:prior.users,spaces,publications,productionId:Number(production.insertId),productionUlid,uploadId:Number(rows[0].upload_id),note:`Only ${fixtureLabel} production/publication metadata; prior fixtures/media untouched. Retain until phone checks, then remove exactly owned rows.`};
  await db.commit();fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
 }catch(e){await db.rollback();throw e;}finally{db.release();}
}
if(require.main===module)reportingFixtures(process.argv.includes('--plan183')?'plan183':'plan182').then(f=>console.log(JSON.stringify({publications:f.publications,spaces:f.spaces,credentials:'ignored only'}))).catch(e=>{console.error(e.code||e.message);process.exitCode=1;}).finally(()=>getPool().end());
