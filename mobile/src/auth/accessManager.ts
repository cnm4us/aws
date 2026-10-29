import type { AccessDiagnostic } from '../diagnostics/playbackDiagnostics';
import { ApiError } from '../api/client';
import { itemKey,type AccessProof,type RequestEvidence } from './accessProof';
import type { FeedPage,FeedVideoItem } from '../feed/types';
type Lease={until:number;startedAt:number;wallStartedAt:number};
type Job={spaceId:number;items:FeedVideoItem[];load:(signal:AbortSignal)=>Promise<FeedPage>;users:number;next:number;pending?:Promise<boolean>;pendingAt?:number;request?:AbortController;error:Error|null};
export class AccessManager {
 private revision=0;private version=0;private listeners=new Set<()=>void>();private leases=new Map<string,Lease>();private jobs=new Map<string,Job>();
 private reads=new Set<{at:number}>();
 private timer:ReturnType<typeof setTimeout>|undefined;private active=true;
 constructor(private viewer:()=>number|null,private readonly options:{now?:()=>number;wallNow?:()=>number;onDiagnostic?:(event:AccessDiagnostic)=>void;onIdentity?:(id:number)=>void;onDenied?:(e:ApiError)=>void}={}){}
 private diagnostic=(event:AccessDiagnostic)=>this.options.onDiagnostic?.(event);
 now=()=>this.options.now?.()??performance.now();private wall=()=>this.options.wallNow?.()??Date.now();
 epoch=()=>this.revision;ticket=():RequestEvidence=>({epoch:this.revision,startedAt:this.now(),wallStartedAt:this.wall()});
 getSnapshot=()=>this.version;subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private publish(){this.version++;this.listeners.forEach(fn=>fn());this.schedule();}
 private fresh(l:Lease|undefined){return !!l&&this.now()>=l.startedAt&&this.wall()>=l.wallStartedAt&&Math.max(this.now()-l.startedAt,this.wall()-l.wallStartedAt)<l.until-l.startedAt;}
 valid=(key:string)=>this.fresh(this.leases.get(key));
 reading=()=>{const read={at:this.now()};this.reads.add(read);return()=>this.reads.delete(read);};
 hasPendingReads=()=>Array.from(this.reads).some(read=>this.now()-read.at<15000);
 hasActiveJobs=()=>this.jobs.size>0;
 identityDue=()=>{const l=this.leases.get('identity');return !this.fresh(l)||!!l&&this.now()-l.startedAt>=50000;};
 identityValid=()=>this.valid('identity');spaceValid=(id:number)=>this.identityValid()&&this.valid(`space:${id}`);
 canView=(item:FeedVideoItem)=>this.spaceValid(item.spaceId!)&&this.valid(itemKey(item));
 publicValid=(item:FeedVideoItem)=>this.valid(`public:${itemKey(item)}`);
 aggregateValid=(kind:string,item:FeedVideoItem)=>this.identityValid()&&this.valid(`aggregate:${kind}:${itemKey(item)}`)&&(item.sourceContext?.kind==='global'?this.publicValid(item):this.canView(item));
 private put(key:string,until:number,p:RequestEvidence){if((this.leases.get(key)?.startedAt??-Infinity)>p.startedAt)return;
  const normalized=key.startsWith('public:')?key.slice(7):key;
  if(normalized.startsWith('[')){const tuple=JSON.parse(normalized);
    for(const [old,lease]of this.leases){const candidate=old.startsWith('public:')?old.slice(7):old;if(!candidate.startsWith('[')||candidate===normalized)continue;
      const previous=JSON.parse(candidate);if(previous[0]===tuple[0]&&previous[1]===tuple[1]){
        if(lease.startedAt>p.startedAt)return;this.leases.delete(old);
      }
    }
  }
  this.leases.delete(key);this.leases.set(key,{until,startedAt:p.startedAt,wallStartedAt:p.wallStartedAt});}
 seed=(proof:AccessProof|undefined)=>{
  if(!proof||proof.epoch!==this.revision)return false;
  if(proof.viewerId!==undefined&&proof.viewerId!==this.viewer())return false;
  if(proof.viewerId!==undefined&&proof.identityUntil!==undefined){this.put('identity',proof.identityUntil,proof);if(this.identityValid())this.options.onIdentity?.(proof.viewerId);}
  if(proof.spaceId!==undefined&&proof.spaceUntil!==undefined)this.put(`space:${proof.spaceId}`,proof.spaceUntil,proof);
  for(const p of proof.publications)this.put(itemKey(p.item),p.until,proof);
  // Public items are attached separately because Global has no protected grants.
  this.trim();this.publish();return true;
 };
 seedPage=(page:FeedPage)=>{
  for(const proof of page.sourceProofs??[])this.seedPage({items:page.items.filter(i=>proof.publicIds.includes(i.publicationId)||proof.publications.some(p=>p.item.publicationId===i.publicationId)),nextCursor:null,access:proof});
  if(!this.seed(page.access))return false;
  const p=page.access!;
  if(p.publicUntil!==undefined)for(const item of page.items)if(p.publicIds.includes(item.publicationId))this.put(`public:${itemKey(item)}`,p.publicUntil,p);
  if(page.aggregateAccess)for(const item of page.aggregateAccess.publications)this.put(`aggregate:${page.aggregateAccess.kind}:${itemKey(item)}`,page.aggregateAccess.until,p);
  this.trim();this.publish();return true;
 };
 private trim(){if(this.leases.size<=128)return;const pinned=new Set(['identity',...Array.from(this.jobs.values()).flatMap(j=>[`space:${j.spaceId}`,...j.items.map(itemKey)])]);
  for(const key of this.leases.keys()){if(!pinned.has(key))this.leases.delete(key);if(this.leases.size<=128)break;}}
 invalidateAggregate=(kind:string,spaceId:number,creatorId:number)=>{for(const key of this.leases.keys())if(key.startsWith(`aggregate:${kind}:`)){try{const tuple=JSON.parse(key.slice(`aggregate:${kind}:`.length));if(tuple[0]===spaceId&&tuple[4]===creatorId)this.leases.delete(key);}catch{}}this.publish();};
 invalidatePublic=(publicationId:number)=>{for(const key of this.leases.keys())if(key.startsWith('public:')){
  try{if(JSON.parse(key.slice(7))[1]===publicationId)this.leases.delete(key);}catch{}
 }this.publish();};
 invalidate=(spaceId?:number,publicationId?:number)=>{
  this.revision++;
  if(spaceId===undefined)this.leases.clear();else for(const [key]of this.leases){let remove=key===`space:${spaceId}`&&!publicationId;
   for(const j of this.jobs.values())if(j.spaceId===spaceId)for(const i of j.items)if((!publicationId||i.publicationId===publicationId)&&key===itemKey(i))remove=true;
   if(key.startsWith('[')){try{const tuple=JSON.parse(key);if(tuple[0]===spaceId&&(!publicationId||tuple[1]===publicationId))remove=true;}catch{}}
   if(remove)this.leases.delete(key);
  }
  for(const j of this.jobs.values()){j.request?.abort();j.pending=undefined;j.request=undefined;}
  this.publish();
 };
 watch=(spaceId:number,items:FeedVideoItem[],load:Job['load'])=>{
  const key=`${spaceId}:${items.map(itemKey).join('|')}`;let job=this.jobs.get(key);
  if(!job){job={spaceId,items,load,users:0,next:0,error:null};this.jobs.set(key,job);}
  const lease=this.leases.get(items[0]?itemKey(items[0]):`space:${spaceId}`);
  this.diagnostic({event:this.usable(job)?'hit':'miss',scope:'publication',...(lease?{ageMs:Math.max(0,this.now()-lease.startedAt),remainingMs:Math.max(0,lease.until-this.now())}:{})});
  job.users++;this.schedule();if(!this.usable(job))void this.refresh(job);return()=>{if(--job!.users===0){job!.request?.abort();this.jobs.delete(key);this.schedule();}};
 };
 private usable(j:Job){return this.spaceValid(j.spaceId)&&(!j.items[0]||this.canView(j.items[0]));}
 error=(spaceId:number)=>Array.from(this.jobs.values()).find(j=>j.spaceId===spaceId)?.error??null;
 checking=(spaceId:number)=>Array.from(this.jobs.values()).some(j=>j.spaceId===spaceId&&!!j.pending);
 check=async(spaceId:number)=>{const jobs=Array.from(this.jobs.values()).filter(j=>j.spaceId===spaceId);return jobs.length?(await Promise.all(jobs.map(j=>this.refresh(j)))).every(Boolean):this.spaceValid(spaceId);};
 private refresh(j:Job):Promise<boolean>{
  if(j.pending){this.diagnostic({event:'coalesced',scope:'publication'});return j.pending;}
  const request=new AbortController();j.request=request;const epoch=this.revision;const startedAt=this.now();this.diagnostic({event:'renew_started',scope:'publication'});
  let pending!:Promise<boolean>;
  pending=(async()=>{await Promise.resolve();try{
   const page=await j.load(request.signal);
   if(request.signal.aborted||epoch!==this.revision)return false;
   const missing=j.items.filter(i=>!page.items.some(r=>itemKey(i)===itemKey(r)));
   this.seedPage(page);
   for(const item of missing)this.leases.delete(itemKey(item));
   if(missing.some(i=>i.publicationId===j.items[0]?.publicationId&&!page.items.some(row=>row.publicationId===i.publicationId))){throw new ApiError('This video is no longer available in this space.',404,'publication_not_found');}
   j.items=j.items.map(item=>page.items.find(row=>row.publicationId===item.publicationId)??item);
   if(!this.usable(j))throw new ApiError('Access confirmation expired. Reconnect and try again.');
   j.error=null;j.next=0;this.diagnostic({event:'renew_succeeded',scope:'publication',durationMs:this.now()-startedAt});return true;
  }catch(e){if(request.signal.aborted||epoch!==this.revision)return false;
   this.diagnostic({event:e instanceof ApiError&&[401,403,404].includes(e.status??0)?'denied':'renew_failed',scope:'publication',durationMs:this.now()-startedAt,httpStatus:e instanceof ApiError?e.status:undefined});
   j.error=e instanceof Error?e:Error('Cannot verify access.');
   if(e instanceof ApiError&&[401,403,404].includes(e.status??0)){
    this.invalidate(e.status===401?undefined:j.spaceId,e.code==='publication_not_found'?j.items[0]?.publicationId:undefined);this.options.onDenied?.(e);
   }else j.next=this.now()+Math.max(5000,e instanceof ApiError?(e.retryAfterSeconds??0)*1000:0);
   return false;
  }finally{if(j.pending===pending){j.pending=undefined;j.request=undefined;this.publish();}}})();
  j.pending=pending;j.pendingAt=this.now();this.publish();return pending;
 }
 setActive=(active:boolean)=>{this.active=active;if(!active){for(const j of this.jobs.values()){j.request?.abort();j.pending=undefined;}}this.publish();};
 private schedule(){clearTimeout(this.timer);if(!this.active)return;
  let next=Infinity;const now=this.now();
  // Mixed feeds have independent renewal owners; still publish at every source expiry.
  if(Array.from(this.leases.keys()).some(key=>key.startsWith('aggregate:')))for(const lease of this.leases.values()){
   const left=lease.until-lease.startedAt-Math.max(now-lease.startedAt,this.wall()-lease.wallStartedAt);if(left>0)next=Math.min(next,now+left);
  }
  for(const j of this.jobs.values()){
   const leases=['identity',`space:${j.spaceId}`,...j.items.map(itemKey)].map(k=>this.leases.get(k)).filter((l):l is Lease=>!!l);
   for(const l of leases){const age=Math.max(now-l.startedAt,this.wall()-l.wallStartedAt);const expiry=l.until-l.startedAt-age;if(expiry>0)next=Math.min(next,now+expiry);}
   if(j.pending){next=Math.min(next,(j.pendingAt??now)+15000);continue;}
   if(j.error){if(this.usable(j))next=Math.min(next,j.next);continue;}
   const renew=leases.length?Math.min(...leases.map(l=>l.startedAt+Math.min(45000,Math.max(0,(l.until-l.startedAt)*.75)))):now;
   next=Math.min(next,Math.max(now,renew));
  }
  if(Number.isFinite(next)){this.timer=setTimeout(()=>{
   for(const j of this.jobs.values())if(j.pending&&(!this.usable(j)||this.now()-(j.pendingAt??this.now())>=15000)){
     this.diagnostic({event:'expired',scope:'publication'});j.request?.abort();j.request=undefined;j.pending=undefined;
     j.error=new ApiError('Cannot verify access. Reconnect and try again.');j.next=this.now()+5000;
   }
   this.version++;this.listeners.forEach(fn=>fn());
   for(const j of this.jobs.values())if(!j.pending&&(!j.error||this.usable(j)&&this.now()>=j.next))void this.refresh(j);this.schedule();
  },Math.max(1,next-now));(this.timer as ReturnType<typeof setTimeout>&{unref?:()=>void}).unref?.();}
 }
 clear=()=>{this.revision++;clearTimeout(this.timer);for(const j of this.jobs.values())j.request?.abort();this.jobs.clear();this.reads.clear();this.leases.clear();this.publish();};
 dispose=()=>{this.active=false;this.clear();this.listeners.clear();};
}
