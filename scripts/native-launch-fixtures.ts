/** Opt-in, fixture-only metadata/grants; never publishes to or modifies Global. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { getPool } from '../src/db';
import { ulidMonotonic } from '../src/utils/ulid';
import { assignDefaultMemberRoles } from '../src/services/spaceMembership';
export async function seedLaunchFixtures() {
  const file=path.resolve('.codex-local/plan173-fixtures.json');
  if(fs.existsSync(file))return JSON.parse(fs.readFileSync(file,'utf8'));
  const db=await getPool().getConnection();await db.beginTransaction();
  try{
    const [media]:any=await db.query(`SELECT sp.id,sp.upload_id,sp.production_id,p.ulid FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id JOIN productions p ON p.id=sp.production_id
      WHERE sp.visible_in_global=1 AND sp.visibility<>'members' AND sp.status='published' AND sp.published_at IS NOT NULL AND u.status='completed' ORDER BY sp.published_at DESC,sp.id DESC LIMIT 8`);
    if(!media.length)throw Error('public_source_required');
    const users:any={},spaces:Record<string,number>={},publications:Record<string,number>={};
    for(const label of ['a','b']){
      const password=crypto.randomBytes(24).toString('base64url'),salt=crypto.randomBytes(16).toString('hex');
      const email=`native-plan173-${label}-${crypto.randomBytes(5).toString('hex')}@example.invalid`;
      const hash=crypto.scryptSync(password,salt,64,{N:16384}).toString('hex');
      const [r]:any=await db.query('INSERT INTO users(email,password_hash,display_name) VALUES(?,?,?)',[email,`s2$16384$${salt}$${hash}`,`Launch test ${label.toUpperCase()}`]);
      users[label]={id:Number(r.insertId),email,password};await db.query("INSERT INTO user_roles(user_id,role_id) SELECT ?,id FROM roles WHERE name='site_member'",[r.insertId]);
      await db.query('INSERT INTO profiles(user_id,display_name,bio,is_public,show_bio) VALUES(?,?,?,1,1)',[r.insertId,`Launch creator ${label.toUpperCase()}`,'Native launch fixture creator']);
    }
    const source=media[0],copies=new Map<number,number>();
    const copy=async(row:any)=>{
      if(copies.has(Number(row.production_id)))return copies.get(Number(row.production_id))!;
      const [r]:any=await db.query(`INSERT INTO uploads(user_id,s3_bucket,s3_key,original_filename,content_type,size_bytes,status,output_prefix,asset_uuid,date_ymd,profile,orientation,width,height,duration_seconds,description)
        SELECT ?,s3_bucket,CONCAT(?,SUBSTRING_INDEX(s3_key,'/',-1)),original_filename,content_type,size_bytes,status,output_prefix,asset_uuid,date_ymd,profile,orientation,width,height,duration_seconds,description FROM uploads WHERE id=?`,
        [users.b.id,`native-fixtures/plan173/${crypto.randomBytes(12).toString('hex')}/`,row.upload_id]);copies.set(Number(row.production_id),Number(r.insertId));return Number(r.insertId);
    };
    for(const [label,type,visibility] of [['group','group','private'],['channel','channel','public'],['hidden','group','private'],['members','channel','public'],['banned','group','private'],['personal','personal','private'],['alias','channel','public'],['invisible','group','public'],['unpublished','group','public']]){
      const settings:any={visibility,membership:'invite',publishing:'owner_only'};if(label==='alias')settings.global=true;
      const [r]:any=await db.query('INSERT INTO spaces(type,owner_user_id,ulid,name,slug,settings) VALUES(?,?,?,?,?,?)',[type,users.b.id,ulidMonotonic(),`Launch test ${label}`,`native-plan173-${label}-${users.a.id}`,JSON.stringify(settings)]);
      spaces[label]=Number(r.insertId);await assignDefaultMemberRoles(db as any,{id:spaces[label],type:type as any,owner_user_id:users.b.id},users.b.id);
      if(['group','banned','personal'].includes(label))await assignDefaultMemberRoles(db as any,{id:spaces[label],type:type as any,owner_user_id:users.b.id},users.a.id);
      const [pub]:any=await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at,story_text)
        VALUES(?,?,?,?,?,?,?,0,NOW(),?)`,[await copy(source),source.production_id,spaces[label],label==='unpublished'?'unpublished':'published',users.b.id,label==='members'?'members':'inherit',label==='invisible'?0:1,`${label==='personal'?'Personal':'Destination'} story for launch ${label}`]);
      publications[label]=Number(pub.insertId);
    }
    const [ban]:any=await db.query("INSERT INTO suspensions(user_id,target_type,target_id,kind,degree,reason,created_by) VALUES(?,'space',?,'ban',1,'Plan173 fixture',?)",[users.a.id,spaces.banned,users.b.id]);
    const seen=new Set<number>([Number(source.production_id)]);
    for(const row of media){if(seen.has(Number(row.production_id)))continue;seen.add(Number(row.production_id));for(const label of ['group','personal'])await db.query(`INSERT INTO space_publications(upload_id,production_id,space_id,status,owner_user_id,visibility,visible_in_space,visible_in_global,published_at,story_text)
      VALUES(?,?,?,'published',?,'inherit',1,0,NOW(),?)`,[await copy(row),row.production_id,spaces[label],users.b.id,`${label} next video story`]);if(seen.size>=3)break;}
    const result={users,spaces,publications,source:{publicationId:Number(source.id),productionId:Number(source.production_id),productionUlid:source.ulid},banId:Number(ban.insertId),note:'Work-created fixture metadata/grants only; Global untouched; reused public media.'};
    await db.commit();fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
  }catch(e){await db.rollback();throw e;}finally{db.release();}
}
if(require.main===module)seedLaunchFixtures().then(f=>console.log(JSON.stringify({sourcePublicationId:f.source.publicationId,userIds:Object.values(f.users).map((u:any)=>u.id),spaces:f.spaces,credentials:'Ignored .codex-local/plan173-fixtures.json only'})))
  .catch(e=>{console.error(e.code||'fixture_creation_failed');process.exitCode=1;}).finally(()=>getPool().end());
