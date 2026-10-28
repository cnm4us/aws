import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,createApiClient} from '../src/api/client';
import {adaptReportOptions,adaptReportDetail,parseReportTime,formatReportTime} from '../src/reporting/api';
import {ReportMemory,REPORT_DRAFT_LIFETIME_MS} from '../src/reporting/reportMemory';
import {ReportStore} from '../src/reporting/reportStore';
import {reportCards} from '../src/reporting/reportPresentation';
const target={context:{kind:'global' as const},publicationId:10};
const own={ruleId:1,ruleSlug:'rule',ruleTitle:'Rule',userFacingRuleId:3,userFacingRuleLabel:'Reason',reportedStartSeconds:0,reportedEndSeconds:7,createdAt:'2026-10-27 00:00:00'};
const payload=()=>({...target,spaceId:29,reportedByMe:false,myReport:null,groups:[{id:3,label:'Reason',shortDescription:null,rules:[{id:1,slug:'rule',title:'Rule',shortDescription:null,isDefault:true}]}],initialGroupIds:[3],durationSeconds:20});
const flush=()=>new Promise(resolve=>setTimeout(resolve,2));
test('strict reporting adapters bind context/publication and validate owned status/catalog',()=>{
 assert.equal(adaptReportOptions(payload(),target).groups[0].id,3);
 for(const data of [{...payload(),publicationId:11},{...payload(),reportedByMe:true},{...payload(),myReport:own},{...payload(),initialGroupIds:[4]},{...payload(),groups:[...payload().groups,...payload().groups]},{...payload(),durationSeconds:-1}])assert.throws(()=>adaptReportOptions(data,target));
 assert.throws(()=>adaptReportOptions(payload(),{context:{kind:'space',spaceId:2},publicationId:10}));
 assert.equal(adaptReportOptions({...payload(),reportedByMe:true,myReport:own},target).myReport?.reportedStartSeconds,0);
 const detail={...target,spaceId:29,groupId:3,ruleId:1,version:2,title:'Rule',description:[],allowed:[],disallowed:[]};
 assert.equal(adaptReportDetail(detail,target,3,1).version,2);
 assert.throws(()=>adaptReportDetail({...detail,description:[{kind:'paragraph',text:'Text',links:[{label:'bad',href:'javascript:bad'}]}]},target,3,1));
 assert.throws(()=>adaptReportDetail(detail,target,4,1));
});
test('time parser permits blank, zero/equal/one-sided and long times, rejects malformed bounds',()=>{
 assert.equal(parseReportTime(''),null);assert.equal(parseReportTime('0:00'),0);assert.equal(parseReportTime('1:02:03'),3723);assert.equal(parseReportTime('120:00'),7200);assert.equal(formatReportTime(7.9),'0:07');
 for(const value of ['7','1:60','1:60:00','-1:00','1:2','Infinity','9999999999:59'])assert.throws(()=>parseReportTime(value));
});
test('report memory isolates publication Sent, preserves original draft expiry, caps and clears',()=>{
 let now=0;const m=new ReportMemory(()=>now);m.seed(10,true);assert.equal(m.sent(10),true);assert.equal(m.sent(11),false);m.save('visit:10',{start:'0:07',end:'',showAll:true},0);
 now=59000;m.save('visit:10',{...m.draft('visit:10'),end:'0:08'},59000);now=60000;assert.equal(m.draft('visit:10').start,'0:07');assert.equal(m.sent(10),false);assert.equal(m.draftDeadline('visit:10'),REPORT_DRAFT_LIFETIME_MS);
 now=REPORT_DRAFT_LIFETIME_MS-1;m.save('visit:10',m.draft('visit:10'),now);assert.equal(m.draftDeadline('visit:10'),REPORT_DRAFT_LIFETIME_MS);now++;assert.equal(m.draft('visit:10').start,'');
 m.save('visit:10',{start:'0:02',end:'',showAll:false},now-45000);assert.equal(m.draftDeadline('visit:10'),now+REPORT_DRAFT_LIFETIME_MS);
 m.save('stale',{start:'0:01',end:'',showAll:false},now-60000);assert.equal(m.draftDeadline('stale'),null);
 m.markUncertain(10);m.clearDrafts();assert.equal(m.isUncertain(10),true);m.confirm(10,own);assert.equal(m.isUncertain(10),false);assert.equal(m.sent(10),true);
 const capped=new ReportMemory(()=>now);for(let n=1;n<=201;n++)capped.seed(n,true);assert.equal(capped.sent(1),false);m.clear();assert.equal(m.sent(10),false);
});
function fixture() {
 const memory=new ReportMemory();let reads=0,writes=0,reported=false,lose=false,failRead=false,denied=0,sent=0;
 const client:any={getJson:async(path:string)=>{if(path.includes('/rules/'))return {...target,spaceId:29,groupId:3,ruleId:1,version:2,title:'Rule',description:[],allowed:[],disallowed:[]};reads++;if(failRead)throw new ApiError('offline');return {...payload(),...(reported?{reportedByMe:true,myReport:own}:{})};},postJson:async()=>{writes++;reported=true;if(lose)throw new ApiError('lost response');return {...payload(),reportedByMe:true,myReport:own};}};
 const store=new ReportStore(client,target,memory,'visit:10',()=>denied++,()=>sent++);
 return {store,memory,client,counts:()=>({reads,writes,denied,sent}),lose:()=>lose=true,failRead:()=>failRead=true};
}
test('selected explicit rule submit is deliberate and normalized success marks only its publication',async()=>{
 const f=fixture();try{f.store.setActive(true);await flush();assert.equal(f.counts().writes,0);f.store.edit({start:'0:00',end:'0:07'});await f.store.detail(3,1);await f.store.send(3,1);assert.equal(f.counts().writes,1);assert.equal(f.counts().sent,1);assert.equal(f.memory.sent(10),true);assert.equal(f.memory.sent(11),false);await f.store.send(3,1);assert.equal(f.counts().writes,1);}finally{f.store.dispose();}
});
test('lost success response reconciles by read and never automatically resends',async()=>{
 const f=fixture();try{f.lose();f.store.setActive(true);await flush();await f.store.detail(3,1);await f.store.send(3,1);assert.equal(f.counts().writes,1);assert.equal(f.counts().reads,2);assert.equal(f.counts().sent,1);assert.equal(f.memory.sent(10),true);}finally{f.store.dispose();}
});
test('failed reconciliation remains uncertain through Close and blocks another write',async()=>{
 const f=fixture();try{f.lose();f.store.setActive(true);await flush();await f.store.detail(3,1);f.failRead();await f.store.send(3,1);assert.equal(f.counts().writes,1);assert.equal(f.memory.isUncertain(10),true);await f.store.send(3,1);assert.equal(f.counts().writes,1);f.store.setActive(false);assert.equal(f.memory.isUncertain(10),true);}finally{f.store.dispose();}
});
test('delayed writes cannot act after close, drafts stay visit-specific, background clears',async()=>{
 const f=fixture();let resolve!:(value:unknown)=>void;f.client.postJson=()=>new Promise(r=>resolve=r);
 try{f.store.setActive(true);await flush();f.store.edit({start:'0:07'});await f.store.detail(3,1);const sending=f.store.send(3,1);f.store.setActive(false);resolve({...payload(),reportedByMe:true,myReport:own});await sending;
 assert.equal(f.counts().sent,0);assert.equal(f.memory.isUncertain(10),true);assert.equal(f.memory.draft('visit:10').start,'0:07');assert.equal(f.memory.draft('other:10').start,'');f.memory.clearDrafts();assert.equal(f.memory.draft('visit:10').start,'');}finally{f.store.dispose();}
});
test('bad ranges do not write and unavailable rule detail does not deny feed',async()=>{
 const f=fixture();try{f.store.setActive(true);await flush();f.store.edit({start:'0:08',end:'0:07'});await f.store.detail(3,1);await f.store.send(3,1);assert.equal(f.counts().writes,0);
 f.client.getJson=async()=>{throw new ApiError('Rule unavailable',404,'report_rule_unavailable');};await f.store.detail(3,1);assert.equal(f.counts().denied,0);assert.equal(f.store.getSnapshot().authorized,true);assert.equal(f.store.getSnapshot().loadingDetail,false);}finally{f.store.dispose();}
});
test('report client bounds JSON before parsing, sanitizes errors and retains bearer path limits',async()=>{
 let request:any;const c=createApiClient('https://api.test',{getHeaders:()=>({Authorization:'Bearer secret'}),fetchImpl:async(url,options)=>{request=options;return new Response(JSON.stringify(payload()),{headers:{'content-type':'application/json'}});}});
 await c.getJson('/api/viewer/v1/feed/global/publications/10/reporting/options');assert.equal(request.credentials,'omit');await assert.rejects(c.getJson('/api/publications/10/reporting/options'));
 const huge=createApiClient('https://api.test',{fetchImpl:async()=>new Response('x'.repeat(1024*1024+1),{headers:{'content-type':'application/json'}})});await assert.rejects(huge.getJson('/api/viewer/v1/feed/global/publications/10/reporting/options'));
 const duplicate=createApiClient('https://api.test',{fetchImpl:async()=>new Response(JSON.stringify({error:'already_reported',private:'secret'}),{status:409})});await assert.rejects(duplicate.postJson('/api/viewer/v1/feed/global/publications/10/report',{}),{status:409,code:'already_reported'});
});
test('quiet renewal and Close/reopen cannot extend the original draft lifetime',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;t.mock.method(performance,'now',()=>now);
 const settle=async()=>{for(let n=0;n<25;n++)await Promise.resolve();};
 const memory=new ReportMemory(()=>now),client:any={getJson:async()=>payload()};
 let store=new ReportStore(client,target,memory,'visit:10',()=>{},()=>{},()=>now);
 try{
  store.setActive(true);await settle();store.edit({start:'0:07'});now=45000;t.mock.timers.tick(45000);await settle();assert.equal(store.getSnapshot().draft?.start,'0:07');store.dispose();
  store=new ReportStore(client,target,memory,'visit:10',()=>{},()=>{},()=>now);store.setActive(true);await settle();assert.equal(store.getSnapshot().draft?.start,'0:07');
  now=60000;t.mock.timers.tick(15000);await settle();assert.equal(store.getSnapshot().draft?.start,'0:07');
  while(now<REPORT_DRAFT_LIFETIME_MS){const step=Math.min(15000,REPORT_DRAFT_LIFETIME_MS-now);now+=step;t.mock.timers.tick(step);await settle();if(now<REPORT_DRAFT_LIFETIME_MS)assert.equal(store.getSnapshot().draft?.start,'0:07');}
  assert.equal(store.getSnapshot().draft?.start,'');assert.equal(memory.draft('visit:10').start,'');
 }finally{store.dispose();t.mock.timers.reset();}
});
test('open rule explanation renews independently and expires despite fresh choices when detail renewal stalls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;t.mock.method(performance,'now',()=>now);
 const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};let hold=false,detailReads=0;
 const detail={...target,spaceId:29,groupId:3,ruleId:1,version:2,title:'Rule',description:[{kind:'paragraph',text:'Private after revocation',links:[]}],allowed:[],disallowed:[]};
 const client:any={getJson:async(path:string)=>{if(path.endsWith('/options'))return payload();detailReads++;if(hold)return new Promise(()=>{});return detail;}};
 const store=new ReportStore(client,target,new ReportMemory(()=>now),'visit:10',()=>{},()=>{},()=>now);
 try{store.setActive(true);await settle();store.edit({start:'0:07'});await store.detail(3,1);assert.ok(store.getSnapshot().detail);hold=true;now=45000;t.mock.timers.tick(45000);await settle();assert.equal(detailReads,2);assert.equal(store.getSnapshot().authorized,true);assert.ok(store.getSnapshot().detail);
 now=60000;t.mock.timers.tick(15000);await settle();assert.equal(store.getSnapshot().authorized,true);assert.equal(store.getSnapshot().detail,null);assert.equal(store.getSnapshot().draft?.start,'0:07');assert.equal(store.canSubmit(),false);}finally{store.dispose();t.mock.timers.reset();}
});
test('a newly hidden rule clears its explanation during choices renewal without denying playable media',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;t.mock.method(performance,'now',()=>now);const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};let hidden=false,denied=0;
 const detail={...target,spaceId:29,groupId:3,ruleId:1,version:2,title:'Rule',description:[],allowed:[],disallowed:[]};
 const client:any={getJson:async(path:string)=>path.endsWith('/options')?{...payload(),...(hidden?{groups:[],initialGroupIds:[]}:{})}:detail};
 const store=new ReportStore(client,target,new ReportMemory(()=>now),'visit:10',()=>denied++,()=>{},()=>now);
 try{store.setActive(true);await settle();await store.detail(3,1);hidden=true;now=45000;t.mock.timers.tick(45000);await settle();assert.equal(store.getSnapshot().detail,null);assert.equal(store.getSnapshot().authorized,true);assert.equal(denied,0);}finally{store.dispose();t.mock.timers.reset();}
});

test('rule cards preserve ordered group/rule pairs, empty groups and duplicate attribution',()=>{
 const a=adaptReportOptions(payload(),target),rule=a.groups[0].rules[0];
 a.groups[0].rules.push({...rule,id:2,title:'Second',isDefault:false});
 a.groups.push({id:4,label:'Different reason',shortDescription:null,rules:[{...rule,shortDescription:'Canonical short text'}]}, {id:5,label:'Empty',shortDescription:null,rules:[]});
 const options=adaptReportOptions(a,target),initial=reportCards(options,false),all=reportCards(options,true);
 assert.deepEqual(initial.cards.map(c=>c.key),['3:1','3:2']);assert.equal(initial.hasHidden,true);
 assert.deepEqual(all.cards.map(c=>c.key),['3:1','3:2','4:1']);assert.equal(all.cards[2].contextLabel,'Different reason');assert.equal(all.cards[2].shortDescription,'Canonical short text');assert.equal(all.cards[1].contextLabel,null);
 options.initialGroupIds=[3,4];assert.equal(reportCards(options,false).hasHidden,false);
});
test('submission requires fresh selected detail and never accepts a different captured pair',async()=>{
 const f=fixture();try{f.store.setActive(true);await flush();await f.store.send(3,1);assert.equal(f.counts().writes,0);
 await f.store.detail(3,1);await f.store.send(4,1);assert.equal(f.counts().writes,0);f.store.back();await f.store.send(3,1);assert.equal(f.counts().writes,0);
 assert.equal(f.store.getSnapshot().selected,null);
 }finally{f.store.dispose();}
});
test('detail loading and optional failure preserve rule view; Back cancels late reads',async()=>{
 const f=fixture();let resolve!:(value:unknown)=>void;
 try{f.store.setActive(true);await flush();f.client.getJson=()=>new Promise(r=>resolve=r);const opening=f.store.detail(3,1);
 assert.equal(f.store.getSnapshot().selected?.ruleId,1);assert.equal(f.store.getSnapshot().loadingDetail,true);assert.equal(f.store.canSubmit(),false);
 f.store.back();resolve({...target,spaceId:29,groupId:3,ruleId:1,version:2,title:'Rule',description:[],allowed:[],disallowed:[]});await opening;assert.equal(f.store.getSnapshot().selected,null);assert.equal(f.store.getSnapshot().detail,null);
 f.client.getJson=async()=>{throw new ApiError('Unavailable',404,'report_rule_unavailable');};await f.store.detail(3,1);assert.equal(f.store.getSnapshot().selected?.ruleId,1);assert.equal(f.store.canSubmit(),false);assert.equal(f.counts().denied,0);
 }finally{f.store.dispose();}
});
test('expired range in an open rule requires Back/review, pending write retains its original range',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0;t.mock.method(performance,'now',()=>now);const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};let writes=0,resolve!:(value:unknown)=>void,body:any;
 const memory=new ReportMemory(()=>now),detail={...target,spaceId:29,groupId:3,ruleId:1,version:2,title:'Rule',description:[],allowed:[],disallowed:[]};
 const client:any={getJson:async(path:string)=>path.endsWith('/options')?payload():detail,postJson:(_path:string,input:any)=>{writes++;body=input;return new Promise(r=>resolve=r);}};
 const store=new ReportStore(client,target,memory,'visit:10',()=>{},()=>{},()=>now);
 try{store.setActive(true);await settle();store.edit({start:'0:00',end:'0:07'});await store.detail(3,1);
 while(now<REPORT_DRAFT_LIFETIME_MS){const step=Math.min(15000,REPORT_DRAFT_LIFETIME_MS-now);now+=step;t.mock.timers.tick(step);await settle();if(now<REPORT_DRAFT_LIFETIME_MS){assert.equal(store.getSnapshot().needsTimeReview,false);assert.equal(store.canSubmit(),true);}}assert.equal(store.getSnapshot().needsTimeReview,true);assert.equal(store.getSnapshot().selected?.ruleId,1);await store.sendSelected();assert.equal(writes,0);
 store.back();store.edit({start:'0:02',end:'0:08'});await store.detail(3,1);const sending=store.sendSelected();assert.equal(writes,1);
 const pendingDeadline=now+REPORT_DRAFT_LIFETIME_MS;while(now<pendingDeadline){const step=Math.min(45000,pendingDeadline-now);now+=step;t.mock.timers.tick(step);await settle();}assert.deepEqual(store.getSnapshot().pendingInput,body);assert.equal(body.reportedStartSeconds,2);assert.equal(body.reportedEndSeconds,8);
 store.setActive(false);resolve({...payload(),reportedByMe:true,myReport:own});await sending;
 }finally{store.dispose();t.mock.timers.reset();}
});

test('long-lived time edits still clear when reporting access renewal stalls',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let now=0,hold=false;const settle=async()=>{for(let n=0;n<30;n++)await Promise.resolve();};
 const memory=new ReportMemory(()=>now),client:any={getJson:async()=>hold?new Promise(()=>{}):payload()};
 const store=new ReportStore(client,target,memory,'visit:10',()=>{},()=>{},()=>now);
 try{store.setActive(true);await settle();store.edit({start:'0:07'});hold=true;now=45000;t.mock.timers.tick(45000);await settle();assert.equal(store.getSnapshot().draft?.start,'0:07');
 now=60000;t.mock.timers.tick(15000);await settle();assert.equal(store.getSnapshot().authorized,false);assert.equal(store.getSnapshot().draft,null);assert.equal(memory.draft('visit:10').start,'');assert.equal(store.canSubmit(),false);
 }finally{store.dispose();t.mock.timers.reset();}
});
