import type {ApiClient} from '../api/client';
import {ApiError} from '../api/client';
import type {FeedContext} from '../feed/context';
export const discoveryPrefix='/api/viewer/v1/discovery';
export type SpaceCard={id:number;name:string;slug:string;type:'group'|'channel'|'personal';global:boolean;path:string;description:string|null;artworkUrl:string|null;saved:boolean;requiresSignIn:boolean};
export type PolicyDocument={name:string;welcome:string;purpose:string|null;cultures:{id:number;name:string;summary:string|null;expectations:string[];boundaries:string[];configured:boolean}[];rules:{id:number;slug:string;title:string;description:string;body:string;allowed:string;disallowed:string}[]};
export type Entry={schemaVersion:1;space:SpaceCard;document:PolicyDocument;revision:string;canView:boolean;requiresSignIn:boolean;requiresAcknowledgment:boolean;acknowledgmentEnabled:boolean;accepted:boolean};
const fail=()=>{throw new ApiError('The server returned unexpected discovery information.');};
const text=(v:unknown,max=12000):string=>typeof v==='string'&&v.length<=max?v:fail();
const id=(v:unknown):number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0?v:fail();
const flag=(v:unknown):boolean=>typeof v==='boolean'?v:fail();
const list=<T>(v:unknown,adapt:(x:any)=>T,max=200):T[]=>Array.isArray(v)&&v.length<=max?v.map(adapt):fail();
export function adaptCard(raw:unknown):SpaceCard {
  const v=raw as SpaceCard;if(!v||!['group','channel','personal'].includes(v.type))return fail();
  const path=text(v.path,300);if(!/^\/(?:global|personal|(?:groups|channels)\/[^/?#]+)$/.test(path))return fail();
  const artwork=v.artworkUrl===null?null:text(v.artworkUrl,1024);if(artwork&&!/^\/(?:images|assets)\/[a-zA-Z0-9/_\-.]+$/.test(artwork))return fail();
  return {id:id(v.id),name:text(v.name,255),slug:text(v.slug,255),type:v.type,global:flag(v.global),path,description:v.description===null?null:text(v.description,500),artworkUrl:artwork,saved:flag(v.saved),requiresSignIn:flag(v.requiresSignIn)};
}
export function adaptEntry(raw:unknown):Entry {
  const v=raw as Entry;if(!v||v.schemaVersion!==1||!v.document||!/^[a-f0-9]{64}$/.test(v.revision))return fail();
  const d=v.document;
  return {schemaVersion:1,space:adaptCard(v.space),revision:v.revision,canView:flag(v.canView),requiresSignIn:flag(v.requiresSignIn),requiresAcknowledgment:flag(v.requiresAcknowledgment),acknowledgmentEnabled:flag(v.acknowledgmentEnabled),accepted:flag(v.accepted),
    document:{name:text(d.name,255),welcome:text(d.welcome),purpose:d.purpose===null?null:text(d.purpose,500),cultures:list(d.cultures,c=>({id:id(c.id),name:text(c.name,255),summary:c.summary===null?null:text(c.summary),expectations:list(c.expectations,x=>text(x,100),30),boundaries:list(c.boundaries,x=>text(x,100),30),configured:flag(c.configured)}),50),
      rules:list(d.rules,r=>({id:id(r.id),slug:text(r.slug,255),title:text(r.title,255),description:text(r.description),body:text(r.body,100000),allowed:text(r.allowed,100000),disallowed:text(r.disallowed,100000)}),200)}};
}
export type Directory={items:SpaceCard[];nextCursor:string|null;genre:{slug:string;name:string}|null};
export function adaptDirectory(raw:unknown):Directory {
  const v=raw as Directory;if(!v)return fail();
  return {items:list(v.items,adaptCard),nextCursor:v.nextCursor===null||v.nextCursor===undefined?null:text(v.nextCursor,20),genre:v.genre?{slug:text(v.genre.slug,80),name:text(v.genre.name,100)}:null};
}
export function toContext(space:SpaceCard):FeedContext{return space.global?{kind:'global'}:{kind:'space',spaceId:space.id,name:space.name,type:space.type};}
export function contextEntryKey(context:FeedContext):string {return context.kind==='global'?'global':String(context.spaceId);}
export async function getEntry(client:Pick<ApiClient,'getJson'>,key:string,signal?:AbortSignal){return adaptEntry(await client.getJson(`${discoveryPrefix}/spaces/${encodeURIComponent(key)}/entry`,signal));}
export type ResumeState={revision:number;outcome:'new'|'restored'|'unavailable';checkpoint:{publicationId:number;productionUlid:string;positionSeconds:number;userPaused:boolean}|null};
export function adaptResume(raw:unknown):ResumeState {
  const v=raw as ResumeState;if(!v||!Number.isSafeInteger(v.revision)||v.revision<0||!['new','restored','unavailable'].includes(v.outcome))return fail();
  const c=v.checkpoint;
  if(c&&(!Number.isFinite(c.positionSeconds)||c.positionSeconds<0||c.positionSeconds>86400*30||!/^[0-9A-HJKMNP-TV-Z]{26}$/i.test(c.productionUlid)))return fail();
  return {revision:v.revision,outcome:v.outcome,checkpoint:c?{publicationId:id(c.publicationId),productionUlid:c.productionUlid,positionSeconds:c.positionSeconds,userPaused:flag(c.userPaused)}:null};
}
