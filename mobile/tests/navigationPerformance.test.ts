import test from 'node:test';
import assert from 'node:assert/strict';
import { AccessGuard } from '../src/auth/accessGuard';
import { InitialFeed } from '../src/feed/initialFeed';
import { PlaybackCoordinator, type PlayerPort } from '../src/playback/coordinator';
import { PlayerBudget } from '../src/playback/playerBudget';
import { PlaybackDiagnostics } from '../src/diagnostics/playbackDiagnostics';
import { LaunchPreparation } from '../src/spaces/launchPreparation';
import type { FeedVideoItem } from '../src/feed/types';
const production='01ARZ3NDEKTSV4RRFFQ69G5FAV';
const item=(publicationId:number):FeedVideoItem=>({publicationId,productionUlid:production,uploadId:1,spaceId:1,playbackUrl:'https://media.test/same',posterUrl:null,
 creator:{id:2,displayName:'Creator',avatarUrl:null},description:null,width:null,height:null,durationSeconds:20});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
class Player implements PlayerPort {
 playing=false;muted=true;released=false;seconds=7;loads=0;seeks=0;
 listeners=new Set<(playing:boolean)=>void>();
 load=async()=>{this.loads++;};status=()=> 'readyToPlay' as const;subscribe=()=>()=>{};
 play=()=>{assert.equal(this.released,false);this.playing=true;this.listeners.forEach(fn=>fn(true));};
 pause=()=>{assert.equal(this.released,false);this.playing=false;this.listeners.forEach(fn=>fn(false));};
 setMuted=(v:boolean)=>{this.muted=v;};seekToStart=()=>{this.seconds=0;};currentTime=()=>this.seconds;
 seekTo=async(seconds:number)=>{this.seeks++;this.seconds=seconds;};bufferedSeconds=()=>5;isPlaying=()=>this.playing;
 subscribePlaying=(fn:(playing:boolean)=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 release=()=>{assert.equal(this.released,false);this.released=true;};
}
test('exact media transfer keeps one selected native lease and accounts real allocations/releases across diagnostic sessions',async()=>{
 const budget=new PlayerBudget(3),players:Player[]=[],d=new PlaybackDiagnostics();
 const make=()=>{const lease=budget.acquire(()=>new Player(),p=>p.release());const p=lease.value,port={...p,release:lease.release};players.push(p);return port;};
 const a=new PlaybackCoordinator(make,d.session(),false);a.setAppActive(true);a.selectAt([item(1),{...item(2),playbackUrl:'https://media.test/next'}],0);await flush();
 a.togglePause();const saved=a.capture(),lease=a.handOff();assert.ok(lease);assert.equal(budget.count,1);assert.equal(players[0].playing,false);
 const b=new PlaybackCoordinator(make,d.session(),false,lease);b.setAppActive(true);b.setScreenEligible(false);
 b.restoreAt([{...item(3),spaceId:4}],0,saved);await flush();
 assert.equal(players.length,2);assert.equal(players[0].loads,1);assert.equal(players[0].seeks,0);assert.equal(players[0].muted,false);assert.equal(players[0].playing,false);
 b.setScreenEligible(true);assert.equal(players[0].playing,false);b.togglePause();assert.equal(players[0].playing,true);
 lease.dispose();assert.equal(players[0].released,false);a.select(item(9));assert.equal(players.length,2);
 b.dispose();assert.equal(budget.count,0);const report=d.report();assert.equal(report.resources.allocations,2);assert.equal(report.resources.releases,2);assert.equal(report.resources.livePlayers,0);assert.ok(report.resources.peakPlayers<=3);
 assert.equal(report.resources.unexpectedPlayback,0);
});
for(const mismatch of ['creator','url','production','missing production'])test(`prepared player rejected on ${mismatch} mismatch`,async()=>{
 const original=new Player(),a=new PlaybackCoordinator(()=>original);a.setAppActive(true);a.select(item(1));await flush();const lease=a.handOff();assert.ok(lease);
 const target={...item(2),...(mismatch==='creator'?{creator:{...item(2).creator,id:3}}:mismatch==='url'?{playbackUrl:'https://media.test/different'}:mismatch==='production'?{productionUlid:'01ARZ3NDEKTSV4RRFFQ69G5FAW'}:{productionUlid:null})};
 const replacement=new Player(),b=new PlaybackCoordinator(()=>replacement,undefined,true,lease);b.setAppActive(true);b.restoreAt([target],0,{positionSeconds:7,userPaused:true});await flush();
 assert.equal(original.released,true);assert.equal(original.playing,false);assert.equal(replacement.loads,1);assert.equal(replacement.seeks,1);assert.equal(replacement.playing,false);b.dispose();
});
test('unconsumed transfer expires, suppresses parked audio, and is released only once',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});const p=new Player(),d=new PlaybackDiagnostics(),a=new PlaybackCoordinator(()=>p,d.session());
 a.setAppActive(true);a.select(item(1));await flush();const lease=a.handOff();assert.ok(lease);p.play();assert.equal(p.playing,false);assert.equal(d.report().resources.unexpectedPlayback,1);
 t.mock.timers.tick(15_000);assert.equal(p.released,true);lease.dispose();assert.equal(d.report().resources.livePlayers,0);t.mock.timers.reset();
});
test('initial feed and first access consumer share a single request while cancellation discards only the old authority',async()=>{
 let finish!:(value:any)=>void,calls=0;const first=new InitialFeed(()=>{calls++;return new Promise(resolve=>{finish=resolve;});});
 const c=new AbortController(),verify=first.verify(c.signal);const feed=first.get();c.abort();await assert.rejects(verify,/Cancelled/);
 finish({items:[],nextCursor:null});await feed;assert.equal(calls,1);first.dispose();
});
test('selected-only Launch preparation is bounded, canceled on replacement, expires, and ignores late responses',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let reads=0,finish!:(value:any)=>void;
 const page=(source:number)=>({sourcePublicationId:source,productionUlid:production,creator:{id:2,displayName:'Creator',avatarUrl:null,bio:null},items:[],nextCursor:null});
 const prepare=new LaunchPreparation({getJson:async path=>{reads++;return path.includes('/1/spaces')?new Promise(resolve=>{finish=resolve;}):page(2);}},()=>{});
 prepare.prepare(item(1));const old=prepare.get(1,production,2);prepare.prepare(item(2));await flush();finish(page(1));await flush();assert.equal(old.getSnapshot().creator,null);
 const current=prepare.get(2,production,2);assert.equal(current.getSnapshot().creator?.id,2);await current.ensureFresh();assert.equal(reads,2);
 t.mock.timers.tick(30_000);assert.equal(current.getSnapshot().creator,null);await current.ensureFresh();assert.equal(reads,3);prepare.clear();assert.equal(current.getSnapshot().creator,null);t.mock.timers.reset();
});
test('navigation stages include pre-selection waits and retain bounded failure/interruption records independently from frame metrics',()=>{
 let now=0;const d=new PlaybackDiagnostics(()=>now),trace=d.navigationStart('space');now=10;trace.mark('destination_resolved');now=30;trace.mark('feed_ready');now=80;trace.mark('first_frame');trace.mark('restore_ready');trace.finish('ready');
 assert.deepEqual(d.report().navigation[0].stages,{destination_resolved:10,feed_ready:30,first_frame:80,restore_ready:80});assert.equal(d.report().summary.transitions,0);
 for(let n=0;n<60;n++)d.navigationStart('launch').finish('interrupted');assert.equal(d.report().navigation.length,50);assert.equal(d.shareReport().navigation.length,5);d.reset();assert.equal(d.report().navigation.length,0);
});

test('a prepared feed cannot acquire a new access lease after its original request has aged out',async t=>{
 let now=0;t.mock.method(performance,'now',()=>now);const initial=new InitialFeed(async()=>({items:[],nextCursor:null}));await initial.get();
 now=60_001;const guard=new AccessGuard(initial.verify,()=>{},()=>now);guard.setActive(true);assert.equal(await guard.check(),false);assert.equal(guard.getSnapshot().authorized,false);assert.match(guard.getSnapshot().error??'',/expired/);guard.dispose();initial.dispose();
});
