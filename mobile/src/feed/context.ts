export type FeedContext = { kind:'global' } | { kind:'space';spaceId:number;name:string;type:'personal'|'group'|'channel' };
export const contextKey=(context:FeedContext)=>context.kind==='global'?'global':`space:${context.spaceId}`;
