import {randomBytes} from 'node:crypto';
import {ViewerApiError} from '../native-sessions/service';
export type Kind='following'|'creations';
export type Source={kind:'global'}|{kind:'space';spaceId:number;name:string;type:'personal'|'group'|'channel'};
export type Candidate={id:number;spaceId:number;creatorId:number;production:string;publishedAt:string;personal:boolean};
export const kind=(v:unknown):Kind=>{if(v!=='following'&&v!=='creations')throw new ViewerApiError(400,'invalid_query');return v;};
export function orderCandidates(rows:Candidate[],feed:Kind,now:number):Candidate[]{
 const groups=new Map<string,Candidate[]>();for(const row of rows){const list=groups.get(row.production)||[];list.push(row);groups.set(row.production,list);}
 const latest=(a:Candidate,b:Candidate)=>Date.parse(b.publishedAt)-Date.parse(a.publishedAt)||b.id-a.id;
 const unique=Array.from(groups.values()).map(list=>list.sort((a,b)=>(feed==='creations'?Number(b.personal)-Number(a.personal):0)||latest(a,b))[0]);
 if(feed==='creations')return unique.sort((a,b)=>Math.max(...groups.get(b.production)!.map(r=>Date.parse(r.publishedAt)))-Math.max(...groups.get(a.production)!.map(r=>Date.parse(r.publishedAt)))||latest(a,b));
 const result:Candidate[]=[];
 for(const age of [86400000,604800000,Infinity]){
  const prior=age===86400000?0:age===604800000?86400000:604800000;
  const bucket=unique.filter(r=>{const delta=Math.max(0,now-Date.parse(r.publishedAt));return delta>=prior&&delta<age;}).sort(latest);
  const creators=new Map<number,Candidate[]>();for(const row of bucket){const stream=creators.get(row.creatorId)||[];stream.push(row);creators.set(row.creatorId,stream);}
  while(creators.size){for(const [id,stream]of creators){result.push(stream.shift()!);if(!stream.length)creators.delete(id);}}
 }
 return result;
}
type Session={userId:number;kind:Kind;created:number;windows:Map<number,Candidate[]>;scans:Map<number,{time:string;id:number}|null>;pending:Map<number,Promise<void>>;seen:Set<string>;review:Map<number,{id:number;name:string;type:string}>};
export class FeedSessions{
 private sessions=new Map<string,Session>();
 constructor(private now=Date.now,private maximum=256){}
 create(userId:number,feed:Kind){this.trim();const id=randomBytes(18).toString('hex');this.sessions.set(id,{userId,kind:feed,created:this.now(),windows:new Map(),scans:new Map(),pending:new Map(),seen:new Set(),review:new Map()});this.trim();return id;}
 get(id:string,userId:number,feed:Kind){this.trim();const s=this.sessions.get(id);if(!s||s.userId!==userId||s.kind!==feed)throw new ViewerApiError(410,'feed_session_expired');return s;}
 private trim(){for(const [id,s]of this.sessions)if(this.now()-s.created>=86400000)this.sessions.delete(id);while(this.sessions.size>this.maximum)this.sessions.delete(this.sessions.keys().next().value!);}
}
export const sessions=new FeedSessions();
export function cursor(value:unknown){if(typeof value!=='string'||!/^([a-f0-9]{36}):([0-9]{1,3}):([0-9]{1,3})$/.test(value))throw new ViewerApiError(400,'invalid_query');const [session,batch,offset]=value.split(':');return {session,batch:Number(batch),offset:Number(offset)};}
