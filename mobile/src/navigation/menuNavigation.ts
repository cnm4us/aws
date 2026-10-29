export type MenuOrigin={name:string;key:string;generation:number;feedKey?:string;entryKey?:string;destination?:string};
export const menuCurrent=(origin:MenuOrigin)=>origin.destination??(origin.name==='Spaces'?'YourSpaces':origin.name);
const transient=new Set(['Menu','Report','Comments','LaunchSpaces','Spaces','SpaceEntry','ReadinessCheck','ReadinessCover','AggregateEntry','CreationSources']);

/** Keep real source route keys on Close; destinations discard only workflows being left. */
export function menuDestinationRoutes(routes:readonly {name:string;key?:string;params?:object}[],destination:string,params?:object) {
  if(destination==='Home')return [{...routes.find(r=>r.name==='Home'),name:'Home'}];
  const kept=routes.filter(r=>!transient.has(r.name));
  const existing=kept.findIndex(r=>r.name===destination);
  return existing>=0?kept.slice(0,existing+1):[...kept,{name:destination,...(params===undefined?{}:{params})}];
}
