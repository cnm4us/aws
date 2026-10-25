import { ViewerApiError } from '../native-sessions/service';
import * as feeds from '../feeds/repo';
import { canViewSpaceFeed } from '../spaces/service';
import { textId } from './viewerText';
import { loadCreators } from '../profiles/viewer';
import { discoveryDescription } from '../spaces/discoveryDescription';
import { listLaunchCandidates, type LaunchCandidate } from './viewerLaunchRepo';

export type LaunchDestination = { space:{id:number;name:string;type:'group'|'channel';description:string|null};publicationId:number };
const dependencies = { global:feeds.listGlobalFeedRows,space:feeds.listSpaceFeedRows,canView:canViewSpaceFeed,candidates:listLaunchCandidates,creators:loadCreators,now:Date.now };
export const validUlid = (v:unknown):string|null => typeof v==='string' && /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/i.test(v) ? v : null;
export function isLaunchSpace(space:LaunchCandidate['space']) {
  if (!['group','channel'].includes(space.type) || ['global','global-feed'].includes(String(space.slug).toLowerCase())) return false;
  const settings=typeof space.settings==='string'?JSON.parse(space.settings):space.settings;
  return !(settings?.global===true || settings?.isGlobal===true || settings?.feed==='global');
}
function decodeCursor(cursor:unknown,source:number,user:number) {
  if(cursor===undefined)return 0;
  try {
    if(typeof cursor!=='string' || cursor.length>512 || !/^[\w-]+$/.test(cursor))throw Error();
    const c=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));
    if(Object.keys(c).sort().join(',')!=='after,source,user,v' || c.v!==1 || c.source!==source || c.user!==user || !Number.isSafeInteger(c.after) || c.after<=0)throw Error();
    return c.after as number;
  } catch {throw new ViewerApiError(400,'invalid_query');}
}
export function parseLaunchQuery(query:Record<string,unknown>,source:number,user:number) {
  if(Object.keys(query).some(k=>!['limit','cursor'].includes(k)))throw new ViewerApiError(400,'invalid_query');
  const limit=query.limit===undefined?20:typeof query.limit==='string' && /^\d+$/.test(query.limit)?Number(query.limit):NaN;
  if(!Number.isInteger(limit)||limit<1||limit>50)throw new ViewerApiError(400,'invalid_query');
  return {limit,after:decodeCursor(query.cursor,source,user)};
}
export function createViewerLaunchService(deps=dependencies) {
  const source=async(publicationId:number,userId:number)=>{
    const row=(await deps.global({publicationId,userId,limit:1}))[0];
    if(!row || Number(row.publication_id)!==publicationId)throw new ViewerApiError(404,'publication_not_found');
    const id=row.production_id===null || row.production_id===undefined?null:Number(row.production_id);
    if(id!==null && (!Number.isSafeInteger(id)||id<=0))throw new ViewerApiError(503,'service_unavailable');
    const creatorId=Number(row.owner_id);
    const profile=(await deps.creators([creatorId])).get(creatorId);
    if(!Number.isSafeInteger(creatorId)||creatorId<=0||!profile)throw new ViewerApiError(404,'publication_not_found');
    const creator={id:profile.id,displayName:profile.displayName,avatarUrl:profile.avatarUrl,bio:profile.bio};
    return {id,ulid:validUlid(row.production_ulid),creator};
  };
  const eligible=async(candidate:LaunchCandidate,userId:number,creatorId:number):Promise<LaunchDestination|null>=>{
    if(!isLaunchSpace(candidate.space) || !await deps.canView(candidate.space,userId))return null;
    const row=(await deps.space(candidate.space.id,{publicationId:candidate.publicationId,userId,limit:1}))[0];
    if(!row || Number(row.publication_id)!==candidate.publicationId || Number(row.space_id)!==candidate.space.id || Number(row.production_id)!==candidate.productionId || Number(row.owner_id)!==creatorId)return null;
    return {space:{id:candidate.space.id,name:String(candidate.space.name||'Space').slice(0,200),type:candidate.space.type as 'group'|'channel',description:discoveryDescription(candidate.space.settings)},publicationId:Number(row.publication_id)};
  };
  const budget=(signal:AbortSignal|undefined,start:number,scanned:number)=>{
    if(signal?.aborted || deps.now()-start>10_000 || scanned>5000)throw new ViewerApiError(503,'service_unavailable');
  };
  return {
    list:async(publicationId:number,userId:number,query:Record<string,unknown>,signal?:AbortSignal)=>{
      const {limit,after:initialAfter}=parseLaunchQuery(query,publicationId,userId),start=deps.now();
      const production=await source(publicationId,userId);const items:LaunchDestination[]=[];
      let after=initialAfter,scanned=0,exhausted=!production.id;
      while(!exhausted && items.length<=limit) {
        budget(signal,start,scanned);
        const candidates=await deps.candidates(production.id!,after,50,undefined,production.creator.id);
        exhausted=candidates.length<50;
        for(const candidate of candidates) {
          budget(signal,start,++scanned);
          if(candidate.space.id<=after || candidate.productionId!==production.id)throw new ViewerApiError(503,'service_unavailable');
          after=candidate.space.id;
          const item=await eligible(candidate,userId,production.creator.id);if(item)items.push(item);
          if(items.length>limit)break;
        }
      }
      const fresh=await source(publicationId,userId);budget(signal,start,scanned);
      if(fresh.id!==production.id || fresh.ulid!==production.ulid || fresh.creator.id!==production.creator.id)throw new ViewerApiError(404,'publication_not_found');
      const page=items.slice(0,limit),nextCursor=items.length>limit?Buffer.from(JSON.stringify({v:1,source:publicationId,user:userId,after:page[page.length-1].space.id})).toString('base64url'):null;
      return {sourcePublicationId:publicationId,productionUlid:production.ulid,creator:fresh.creator,items:page,nextCursor};
    },
    resolve:async(publicationId:number,spaceId:number,userId:number,signal?:AbortSignal)=>{
      const start=deps.now(),production=await source(publicationId,userId);
      if(!production.id)throw new ViewerApiError(404,'launch_target_unavailable');
      const candidate=(await deps.candidates(production.id,0,1,spaceId,production.creator.id))[0];
      const item=candidate && candidate.space.id===spaceId && candidate.productionId===production.id?await eligible(candidate,userId,production.creator.id):null;
      if(!item)throw new ViewerApiError(404,'launch_target_unavailable');
      const fresh=await source(publicationId,userId);budget(signal,start,1);
      if(fresh.id!==production.id || fresh.ulid!==production.ulid || fresh.creator.id!==production.creator.id)throw new ViewerApiError(404,'publication_not_found');
      const current=await eligible(candidate!,userId,fresh.creator.id);
      if(!current)throw new ViewerApiError(404,'launch_target_unavailable');
      budget(signal,start,1);
      return {sourcePublicationId:publicationId,productionUlid:production.ulid,creator:fresh.creator,...current};
    },
  };
}
export const viewerLaunch=createViewerLaunchService();
export { textId as launchId };
