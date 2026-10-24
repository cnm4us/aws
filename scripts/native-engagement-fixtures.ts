/** Reuse only the work-created, restored Plan173 actors/content. No Global writes. */
import fs from 'node:fs';
import { getPool } from '../src/db';
import { seedLaunchFixtures } from './native-launch-fixtures';
export async function seedEngagementFixtures() {
 const f=await seedLaunchFixtures(),db=getPool();
 const [rows]:any=await db.query('SELECT id,space_id,owner_user_id FROM space_publications WHERE id IN (?,?)',[f.publications.group,f.publications.channel]);
 if(rows.length!==2||rows.some((r:any)=>Number(r.owner_user_id)!==f.users.b.id))throw Error('owned_fixture_required');
 fs.mkdirSync('.codex-local',{recursive:true});fs.writeFileSync('.codex-local/plan174-fixtures.json',JSON.stringify(f,null,2)+'\n',{mode:0o600});return f;
}
if(require.main===module)seedEngagementFixtures().then(()=>console.log('Plan174 disposable fixtures ready; private credentials remain ignored.'))
 .catch(()=>{console.error('fixture_preparation_failed');process.exitCode=1;}).finally(()=>getPool().end());
