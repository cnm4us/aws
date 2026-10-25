/** Reuse only owned Launch fixtures; credentials and exact snapshots stay ignored. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { getPool } from '../src/db';
import { seedLaunchFixtures } from './native-launch-fixtures';
export async function seedFollowFixtures(){
 const f=await seedLaunchFixtures(),db=getPool();
 const [actors]:any=await db.query('SELECT id,email,display_name FROM users WHERE id IN (?,?)',[f.users.a.id,f.users.b.id]);
 for(const label of ['a','b']){const actor=actors.find((r:any)=>Number(r.id)===f.users[label].id);assert.equal(actor?.email,f.users[label].email);assert.equal(actor.display_name,`Launch test ${label.toUpperCase()}`);}
 const [rows]:any=await db.query(`SELECT sp.id,sp.upload_id,sp.owner_user_id,u.user_id FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id
 WHERE sp.space_id=? AND sp.id<>? AND sp.status='published' AND sp.visible_in_space=1 AND u.s3_key LIKE 'native-fixtures/plan173/%' ORDER BY sp.id LIMIT 1`,[f.spaces.group,f.publications.group]);
 assert.equal(rows.length,1);assert.equal(Number(rows[0].user_id),f.users.b.id);assert.equal(Number(rows[0].owner_user_id),f.users.b.id);
 const result={...f,secondPublicationId:Number(rows[0].id),secondUploadId:Number(rows[0].upload_id)};
 fs.mkdirSync('.codex-local',{recursive:true});fs.writeFileSync('.codex-local/plan175-fixtures.json',JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
}
if(require.main===module)seedFollowFixtures().then(()=>console.log('Plan175 owned fixtures verified; credentials remain ignored.')).catch(()=>{console.error('owned_follow_fixture_check_failed');process.exitCode=1;}).finally(()=>getPool().end());
