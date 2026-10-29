import * as feedRepo from '../feeds/repo';
import {getPool} from '../../db';
import {ViewerApiError,type Principal} from '../native-sessions/service';
import * as feeds from '../feeds/service';
import * as spaces from '../spaces/service';
import * as discovery from '../discovery/service';
import * as spaceRepo from '../spaces/repo';
import {serializeViewerFeedWithCreators} from '../feeds/viewer';
import {accessMetadata} from '../native-sessions/access';
import {orderCandidates,sessions,cursor,type Kind,type Candidate,type Source} from './model';
export async function candidateRows(userId:number,feed:Kind,after?:{time:string;id:number}|null,exact?:number|number[],production?:string):Promise<Candidate[]>{
 const args:any[]=[userId];
 const filter=feed==='creations'?'u.user_id=?':`EXISTS(SELECT 1 FROM space_user_follows f WHERE f.follower_user_id=? AND f.target_user_id=u.user_id AND f.space_id=sp.space_id) AND s.type IN ('group','channel') AND LOWER(s.slug) NOT IN ('global','global-feed') AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.global')),'')<>'true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.isGlobal')),'')<>'true' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.settings,'$.feed')),'')<>'global'`;
 let tail='';if(production){if(production.startsWith('production:')){tail+=' AND p.ulid=?';args.push(production.slice(11));}else if(production.startsWith('production-id:')){tail+=' AND sp.production_id=?';args.push(Number(production.slice(14)));}else{tail+=' AND sp.id=?';args.push(Number(production.slice(12)));}}if(exact){tail+=Array.isArray(exact)?' AND sp.id IN (?)':' AND sp.id=?';args.push(exact);}else if(after){tail+=' AND (sp.published_at<? OR (sp.published_at=? AND sp.id<?))';args.push(after.time,after.time,after.id);}
 const [rows]=await getPool().query(`SELECT sp.id,sp.space_id,u.user_id AS creator_id,sp.production_id,p.ulid,sp.published_at,s.type,s.owner_user_id FROM space_publications sp JOIN uploads u ON u.id=sp.upload_id JOIN users creator ON creator.id=u.user_id AND creator.deleted_at IS NULL JOIN spaces s ON s.id=sp.space_id LEFT JOIN productions p ON p.id=sp.production_id
 WHERE ${filter} AND sp.status='published' AND sp.published_at IS NOT NULL AND u.status='completed' AND (sp.visible_in_space=1 OR sp.visible_in_global=1) ${tail} ORDER BY sp.published_at DESC,sp.id DESC LIMIT 500`,args);
 return (rows as any[]).map(r=>({id:Number(r.id),spaceId:Number(r.space_id),creatorId:Number(r.creator_id),production:r.ulid?`production:${r.ulid}`:r.production_id?`production-id:${r.production_id}`:`publication:${r.id}`,publishedAt:r.published_at instanceof Date?r.published_at.toISOString():String(r.published_at).replace(' ','T')+'Z',personal:r.type==='personal'&&Number(r.owner_user_id)===userId}));
}
export async function sourcePage(spaceId:number,principal:Principal,startedAt:number,ids:number[],onlyCandidates=false):Promise<any>{
 const global=await spaceRepo.findGlobalSpaceCandidate();const isGlobal=Number(global?.id)===spaceId;
 const entry=await discovery.entry(isGlobal?'global':String(spaceId),principal.viewer.id);
 if(!entry.canView)return null;
 if(entry.requiresAcknowledgment)return {review:{id:spaceId,name:entry.space.name,type:entry.space.type}};
 const opts={publicationIds:ids,limit:100,userId:principal.viewer.id};
 const decision=isGlobal?null:await spaces.confirmedSpaceView(spaceId,principal.viewer.id);
 if(isGlobal&&await spaceRepo.isBannedFromSpace(spaceId,principal.viewer.id))return null;
 if(!ids.length)return {page:{items:[]},source:null};
 if(onlyCandidates){const rows=isGlobal?await feedRepo.listGlobalFeedRows(opts):await feedRepo.listSpaceFeedRows(spaceId,opts);return {page:{items:rows.map(row=>({publicationId:Number(row.publication_id),creator:{id:Number(row.owner_id)}}))},source:null};}
 const data=isGlobal?await feeds.getGlobalFeed(opts):await feeds.getSpaceFeed(spaceId,opts);
 const source:Source=isGlobal?{kind:'global'}:{kind:'space',spaceId,name:entry.space.name,type:entry.space.type};
 const context=isGlobal?{kind:'global'}:{kind:'space',space:{id:spaceId,name:entry.space.name,type:entry.space.type,slug:entry.space.slug}};
 const page=await serializeViewerFeedWithCreators(data,context);
 const access=accessMetadata(startedAt,principal,page.items,decision?{spaceId,...decision,membersOnlyIds:new Set(data.items.filter(i=>i.publication.visibility==='members').map(i=>i.publication.id))}:undefined,isGlobal);
 return {page:{...page,access},source};
}
async function allowed(rows:Candidate[],principal:Principal,startedAt:number,onlyCandidates=false,deps=dependencies){
 const bySpace=new Map<number,Candidate[]>();for(const row of rows){const list=bySpace.get(row.spaceId)||[];list.push(row);bySpace.set(row.spaceId,list);}
 const items:any[]=[],sources:any[]=[],eligible:Candidate[]=[],reviews:any[]=[];
 const groups=Array.from(bySpace);
 for(let index=0;index<groups.length;index+=4)await Promise.all(groups.slice(index,index+4).map(async([spaceId,candidates])=>{
  for(let n=0;n<candidates.length;n+=100){try{
   const response=await deps.source(spaceId,principal,startedAt,candidates.slice(n,n+100).map(c=>c.id),onlyCandidates);if(!response)continue;
   if('review'in response){reviews.push(response.review);break;}
   sources.push(response.page);
   for(const item of response.page.items){const candidate=candidates.find(c=>c.id===item.publicationId&&c.creatorId===item.creator.id);if(candidate){items.push({...item,sourceContext:response.source});eligible.push(candidate);}}
  }catch(e){if(![403,404,428].includes(Number((e as any)?.status)))throw e;}}
 }));return {items,sources,eligible,reviews};
}
const dependencies={candidates:candidateRows,source:sourcePage,sessions};
export async function aggregatePage(feed:Kind,principal:Principal,query:{cursor?:string;anchorPublicationId?:string;publicationIds?:string;limit?:string},startedAt:number,deps=dependencies){
 const userId=principal.viewer.id,limit=query.limit===undefined?20:Number(query.limit);
 if(query.limit!==undefined&&!/^[0-9]+$/.test(query.limit)||!Number.isInteger(limit)||limit<1||limit>50)throw new ViewerApiError(400,'invalid_query');
 const exactIds=query.publicationIds?.split(',').map(Number);
 if(exactIds&&(!/^[1-9]\d*(?:,[1-9]\d*){0,2}$/.test(query.publicationIds!)||new Set(exactIds).size!==exactIds.length||exactIds.some(id=>!Number.isSafeInteger(id))))throw new ViewerApiError(400,'invalid_query');
 const anchor=query.anchorPublicationId===undefined?undefined:Number(query.anchorPublicationId);
 if(anchor!==undefined&&(!/^[1-9]\d*$/.test(query.anchorPublicationId!)||!Number.isSafeInteger(anchor)||query.cursor!==undefined||exactIds))throw new ViewerApiError(400,'invalid_query');
 if(exactIds){const rows=await deps.candidates(userId,feed,null,exactIds);return envelope(feed,principal,await allowed(rows,principal,startedAt,false,deps),null,startedAt);}
 let token:string,batch:number,offset:number;if(query.cursor){const c=cursor(query.cursor);token=c.session;batch=c.batch;offset=c.offset;}else{token=deps.sessions.create(userId,feed);batch=0;offset=0;}
 const session=deps.sessions.get(token,userId,feed);
 const fill=async()=>{
  if(session.windows.has(batch))return;
  const pending=session.pending.get(batch);if(pending){await pending;return;}
  if(batch>0&&!session.scans.has(batch-1))throw new ViewerApiError(410,'feed_session_expired');
  const load=(async()=>{const after=batch?session.scans.get(batch-1):null;if(batch&&after===null){session.windows.set(batch,[]);session.scans.set(batch,null);return;}
   const raw=await deps.candidates(userId,feed,after),result=await allowed(raw,principal,startedAt,true,deps);for(const review of result.reviews)session.review.set(review.id,review);while(session.review.size>100)session.review.delete(session.review.keys().next().value!);
   let queue=orderCandidates(result.eligible.filter(r=>!session.seen.has(r.production)),feed,session.created);
   if(!batch&&anchor!==undefined){const selected=await allowed(await deps.candidates(userId,feed,null,anchor),principal,startedAt,true,deps),found=selected.eligible.find(r=>r.id===anchor);if(found)queue=[found,...queue.filter(r=>r.production!==found.production)].slice(0,500);}
   for(const row of queue)session.seen.add(row.production);session.windows.set(batch,queue);
   session.scans.set(batch,raw.length===500&&session.seen.size<10000?{time:raw.at(-1)!.publishedAt.replace('T',' ').replace('Z',''),id:raw.at(-1)!.id}:null);
   // Keep a bounded current queue and one previous window so response retries remain stable.
   for(const old of session.windows.keys())if(old<batch-1){session.windows.delete(old);session.scans.delete(old);}
  })();session.pending.set(batch,load);try{await load;}finally{session.pending.delete(batch);}
 };
 await fill();const queue=session.windows.get(batch)!;if(offset>queue.length)throw new ViewerApiError(400,'invalid_query');
 const window=queue.slice(offset,offset+limit),freshRows=window.length?await deps.candidates(userId,feed,null,window.map(r=>r.id)):[];
 const result=await allowed(freshRows,principal,startedAt,false,deps),ids=new Map(result.items.map(i=>[i.publicationId,i]));result.items=window.flatMap(r=>ids.has(r.id)?[ids.get(r.id)]:[]);
 const end=offset+window.length,next=end<queue.length?`${token}:${batch}:${end}`:session.scans.get(batch)?`${token}:${batch+1}:0`:null;
 const currentReviews:any[]=[];for(const review of Array.from(session.review.values())){try{const checked=await deps.source(review.id,principal,startedAt,[],true);if(checked?.review)currentReviews.push(checked.review);else session.review.delete(review.id);}catch(e){if([403,404,428].includes(Number((e as any)?.status)))session.review.delete(review.id);else throw e;}}
 return {...envelope(feed,principal,result,next,startedAt),reviewRequired:currentReviews,rankVersion:'freshness-variety-v1',...(anchor!==undefined?{resume:{requestedPublicationId:anchor,restoredPublicationId:result.items.some(i=>i.publicationId===anchor)?anchor:null,outcome:result.items.some(i=>i.publicationId===anchor)?'restored':'unavailable'}}:{})};
}
function envelope(feed:Kind,principal:Principal,result:Awaited<ReturnType<typeof allowed>>,nextCursor:string|null,startedAt:number){
 const identity=accessMetadata(startedAt,principal);return {context:{kind:feed},items:result.items,nextCursor,sourcePages:result.sources,access:identity,aggregateAccess:{version:1,kind:feed,viewerId:principal.viewer.id,publicationIds:result.items.map(i=>i.publicationId),remainingMs:identity.identity?.remainingMs??0}};
}

export async function creationContexts(publicationId:number,principal:Principal,startedAt:number){
 const [selected]=await candidateRows(principal.viewer.id,'creations',null,publicationId);if(!selected)throw new ViewerApiError(404,'publication_not_found');
 const rows=await candidateRows(principal.viewer.id,'creations',null,undefined,selected.production),result=await allowed(rows,principal,startedAt);
 if(!result.items.some(i=>i.publicationId===publicationId))throw new ViewerApiError(404,'publication_not_found');
 return {publicationId,items:result.items.map(item=>({publicationId:item.publicationId,spaceId:item.spaceId,productionUlid:item.productionUlid,sourceContext:item.sourceContext}))};
}
