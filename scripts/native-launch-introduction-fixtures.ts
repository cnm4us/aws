/** Owned Plan175 introduction fixture. Only a new labeled public-safe test publication is broadcast. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { getPool } from '../src/db';
import { ulidMonotonic } from '../src/utils/ulid';
import { seedFollowFixtures } from './native-follow-fixtures';
export async function seedIntroductionFixtures() {
  const base=await seedFollowFixtures(),db=getPool(),file='.codex-local/plan175-introduction-fixtures.json';
  const [uploads]:any=await db.query(`SELECT sp.upload_id,sp.production_id,u.user_id,u.s3_key FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id WHERE sp.id=? AND sp.space_id=?`,[base.publications.group,base.spaces.group]);
  assert.equal(uploads.length,1);assert.equal(Number(uploads[0].user_id),base.users.b.id);assert.match(uploads[0].s3_key,/^native-fixtures\/plan173\//);
  const prior=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  let publicationId=prior?.introductionSource?.publicationId, sourceSpaceId=prior?.introductionSource?.spaceId;
  if(publicationId){
    const [rows]:any=await db.query('SELECT upload_id,space_id,owner_user_id,visible_in_global,story_text FROM space_publications WHERE id=?',[publicationId]);
    assert.equal(rows.length,1);assert.equal(Number(rows[0].upload_id),Number(uploads[0].upload_id));assert.equal(Number(rows[0].space_id),sourceSpaceId);
    assert.equal(Number(rows[0].owner_user_id),base.users.b.id);assert.equal(Number(rows[0].visible_in_global),1);assert.match(rows[0].story_text,/Plan175 introduction fixture/);
  }else{
    const [space]:any=await db.query('INSERT INTO spaces(type,owner_user_id,ulid,name,slug,settings) VALUES(?,?,?,?,?,?)',['channel',base.users.b.id,ulidMonotonic(),'Launch test source',`native-plan175-source-${base.users.b.id}`,JSON.stringify({visibility:'public',global:true})]);
    sourceSpaceId=Number(space.insertId);
    const [row]:any=await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at,story_text)
      VALUES(?,?,?,'published',?,'inherit',0,1,NOW(),?)`,[uploads[0].upload_id,uploads[0].production_id,sourceSpaceId,base.users.b.id,'Plan175 introduction fixture: disposable Launch creator B; reused already-public test media.']);
    publicationId=Number(row.insertId);
  }
  const result={...base,introductionSource:{publicationId,spaceId:sourceSpaceId,productionId:Number(uploads[0].production_id),productionUlid:base.source.productionUlid,creatorId:base.users.b.id},note:'New owned labeled Global fixture only; ordinary Global source/creator untouched. Retire only this test publication during final cleanup.'};
  fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
}
if(require.main===module)seedIntroductionFixtures().then(f=>console.log(JSON.stringify({sourcePublicationId:f.introductionSource.publicationId,creatorId:f.introductionSource.creatorId,privateFixtureFile:'ignored; no credentials printed'})))
  .catch(()=>{console.error('introduction_fixture_guard_failed');process.exitCode=1;}).finally(()=>getPool().end());
