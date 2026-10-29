/** User-approved preview placement only. Does not change cultures, permissions, publications, media or earlier fixtures. */
import fs from 'node:fs';
import {getPool} from '../src/db';
import {ensureDiscoverySchema} from '../src/features/discovery/schema';
export async function discoveryPreviewFixtures(){
 const file='.codex-local/plan184-discovery-fixtures.json';if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
 const prior=JSON.parse(fs.readFileSync('.codex-local/plan175-fixtures.json','utf8')),pool=getPool();await ensureDiscoverySchema(pool);
 const db=await pool.getConnection();
 try{await db.beginTransaction();const ids=[prior.spaces.group,prior.spaces.channel];
  const [spaces]:any=await db.query('SELECT id,name,type FROM spaces WHERE id IN (?,?)',ids);
  for(const label of ['group','channel'])if(!spaces.some((s:any)=>Number(s.id)===prior.spaces[label]&&s.name===`Launch test ${label}`&&s.type===label))throw Error('preview_fixture_identity_changed');
  const [existing]:any=await db.query('SELECT space_id FROM discovery_spaces WHERE space_id IN (?,?)',ids);if(existing.length)throw Error('preview_metadata_already_exists_without_manifest');
  for(const label of ['group','channel']) {
    const text=`Welcome to the Launch test ${label}. This is a temporary preview space for testing discovery, space entry and saved playback. It currently has no assigned culture-specific rules. Existing access, reporting and moderation behavior remain in place.`;
    await db.query('INSERT INTO discovery_spaces (space_id,listed,draft,welcome,entry_enabled) VALUES (?,1,?,?,0)',[prior.spaces[label],text,text]);
    const slugs=label==='group'?['travel','arts']:['cooking','technology'];
    for(const slug of slugs)await db.query('INSERT INTO discovery_placements (genre_id,space_id) SELECT id,? FROM discovery_genres WHERE slug=?',[prior.spaces[label],slug]);
  }
  const result={spaces:{group:prior.spaces.group,channel:prior.spaces.channel},note:'Only new discovery metadata/placements on user-approved Launch test spaces. Enforcement remains off for build39 compatibility. Culture assignments, memberships, publications, media and Plan183 fixtures unchanged.'};
  await db.commit();fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
 }catch(e){await db.rollback();throw e;}finally{db.release();}
}
if(require.main===module)discoveryPreviewFixtures().then(f=>console.log(JSON.stringify({spaces:f.spaces,enforcement:false,credentials:'none exported'}))).catch(e=>{console.error(e.code||e.message);process.exitCode=1}).finally(()=>getPool().end());
