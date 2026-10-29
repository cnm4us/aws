export type SourceContext={kind:'global'}|{kind:'space';spaceId:number;name:string;type:'personal'|'group'|'channel'};
export type AggregateKind='following'|'creations';
export type FeedContext=SourceContext|{kind:AggregateKind};
export const isAggregate=(context:FeedContext):context is {kind:AggregateKind}=>context.kind==='following'||context.kind==='creations';
export const contextKey=(context:FeedContext)=>context.kind==='space'?`space:${context.spaceId}`:context.kind;
export const contextName=(context:FeedContext)=>context.kind==='space'?context.name:context.kind==='global'?'Global':context.kind==='following'?'Following':'Your Creations';
