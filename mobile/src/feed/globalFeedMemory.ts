import type { FeedPage,FeedVideoItem } from './types';
import type { AccessManager } from '../auth/accessManager';
// A single public origin window, no native players and no durable data.
export class GlobalFeedMemory {
 private page:FeedPage|null=null;
 save=(items:FeedVideoItem[],index:number,nextCursor:string|null,access:AccessManager)=>{
  const selected=items[index];if(!selected||!access.publicValid(selected)){this.clear();return;}
  const start=Math.max(0,index-6),window=items.slice(start,start+20).filter(access.publicValid);
  this.page={items:window,nextCursor:window.length===items.length-start?nextCursor:null,
   resume:{requestedPublicationId:selected.publicationId,restoredPublicationId:selected.publicationId,outcome:'restored'}};
 };
 take=(publicationId:number,access:AccessManager):FeedPage|undefined=>{
  const p=this.page;if(!p||p.resume?.restoredPublicationId!==publicationId)return;
  const items=p.items.filter(access.publicValid);if(!items.some(i=>i.publicationId===publicationId)){this.clear();return;}
  return {...p,items};
 };
 clear=()=>{this.page=null;};
}
