import type {ReportOptions} from './api';
export type ReportCard={key:string;groupId:number;ruleId:number;title:string;shortDescription:string|null;contextLabel:string|null};
// Preserve ordered mapping pairs: one canonical rule may have different reason attribution.
export function reportCards(options:ReportOptions,showAll:boolean) {
 const counts=new Map<number,number>();
 for(const group of options.groups)for(const rule of group.rules)counts.set(rule.id,(counts.get(rule.id)??0)+1);
 const all=options.groups.flatMap(group=>group.rules.map(rule=>({key:`${group.id}:${rule.id}`,groupId:group.id,ruleId:rule.id,title:rule.title,shortDescription:rule.shortDescription,contextLabel:counts.get(rule.id)!>1?group.label:null})));
 const initial=all.filter(card=>options.initialGroupIds.includes(card.groupId));
 return {cards:showAll?all:initial,hasHidden:!showAll&&all.length>initial.length};
}
