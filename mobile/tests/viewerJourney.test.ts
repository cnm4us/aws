import assert from 'node:assert/strict';
import test from 'node:test';
import { ViewerJourney } from '../src/navigation/viewerJourney';
import { PlaybackCoordinator, type PlayerPort, type PlaybackStatus } from '../src/playback/coordinator';
import { PlayerBudget } from '../src/playback/playerBudget';
import type { FeedVideoItem } from '../src/feed/types';
import { adaptViewerFeedPage } from '../src/feed/adaptFeed';
import { FeedStore } from '../src/feed/feedStore';

const item:FeedVideoItem={publicationId:9,uploadId:1,productionUlid:'same',spaceId:1,playbackUrl:'https://media.test/video.m3u8',posterUrl:null,
  creator:{id:2,displayName:'Creator',avatarUrl:null},description:null,width:null,height:null,durationSeconds:30};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
class Player implements PlayerPort {
  seconds=8;playing=false;released=false;seeks:number[]=[];
  load=async()=>{};status=():PlaybackStatus=>'readyToPlay';subscribe=()=>()=>{};
  play=()=>{assert.equal(this.released,false);this.playing=true;};pause=()=>{this.playing=false;};setMuted=(_v:boolean)=>{};
  seekToStart=()=>{this.seconds=0;};currentTime=()=>this.seconds;
  seekTo=async(seconds:number)=>{this.seeks.push(seconds);this.seconds=seconds;};
  release=()=>{this.released=true;};
}
test('bounded creator detours keep one original context and reject obsolete entry',()=>{
  const journey=new ViewerJourney();
  const origin={apiOrigin:'https://api.test',authGeneration:2,context:{kind:'global' as const},publicationId:9,positionSeconds:8,userPaused:true};
  journey.open(2,origin);const first=journey.getSnapshot();
  assert.equal(journey.enter(2,first.generation),true);
  journey.open(3,{...origin,publicationId:20,context:{kind:'space',spaceId:10,type:'personal',name:'Other'}});
  assert.equal(journey.getSnapshot().origin?.publicationId,9);
  assert.equal(journey.enter(2,first.generation),false);
  assert.equal(journey.originFor('https://api.test',3),null);
  journey.reset();assert.equal(journey.getSnapshot().origin,null);
});
test('capture pauses, restore seeks before play and preserves intentional pause',async()=>{
  const players:Player[]=[];const c=new PlaybackCoordinator(()=>{const p=new Player();players.push(p);return p;});
  try {
    c.setAppActive(true);c.selectAt([item],0);await tick();assert.equal(players[0].playing,true);
    c.togglePause();const saved=c.capture();assert.deepEqual(saved,{publicationId:9,positionSeconds:8,userPaused:true});
    c.restoreAt([item],0,saved);c.setScreenEligible(true);assert.equal(players[0].playing,false);await tick();
    assert.deepEqual(players[0].seeks,[8]);assert.equal(c.getSnapshot().userPaused,true);assert.equal(players[0].playing,false);
    c.togglePause();assert.equal(players[0].playing,true);
  }finally{c.dispose();}
});
test('late seek completion cannot resume a changed selection or disposed player',async()=>{
  let resolve!:()=>void;const p=new Player();p.seekTo=()=>new Promise<void>(done=>{resolve=done;});
  const c=new PlaybackCoordinator(()=>p);c.setAppActive(true);c.restoreAt([item],0,{positionSeconds:8,userPaused:false});await tick();
  assert.equal(c.getSnapshot().restoring,true);assert.equal(p.playing,false);
  c.dispose();resolve();await tick();assert.equal(p.playing,false);assert.equal(p.released,true);
});
test('restore timeout leaves a usable escape and late seek completion stays ignored',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  let resolve!:()=>void;const p=new Player();p.seekTo=()=>new Promise<void>(done=>{resolve=done;});
  const c=new PlaybackCoordinator(()=>p);
  try{
    c.setAppActive(true);c.restoreAt([item],0,{positionSeconds:8,userPaused:false});await tick();
    t.mock.timers.tick(10_001);assert.ok(c.getSnapshot().restoreError);assert.equal(p.playing,false);
    resolve();await tick();assert.ok(c.getSnapshot().restoreError);assert.equal(p.playing,false);
    c.retryRestore();assert.equal(c.getSnapshot().restoreError,null);assert.equal(p.playing,true);
  }finally{c.dispose();t.mock.timers.reset();}
});
test('seek failure stays recoverable and clamped without auto-playing',async()=>{
  const p=new Player();p.seekTo=async seconds=>{p.seeks.push(seconds);throw Error('native seek');};
  const c=new PlaybackCoordinator(()=>p);try{
    c.setAppActive(true);c.restoreAt([item],0,{positionSeconds:99,userPaused:false});await tick();
    assert.equal(p.seeks[0],29.9);assert.ok(c.getSnapshot().restoreError);assert.equal(p.playing,false);
    c.retryRestore();assert.equal(c.getSnapshot().restoreError,null);assert.equal(p.seconds,0);assert.equal(p.playing,true);
  }finally{c.dispose();}
});
test('leaving a failed restore for the next video clears the old failure',async()=>{
  const c=new PlaybackCoordinator(()=>{const p=new Player();p.seekTo=async()=>{throw Error('failed');};return p;});
  try{
    c.setAppActive(true);c.restoreAt([item],0,{positionSeconds:8,userPaused:false});await tick();assert.ok(c.getSnapshot().restoreError);
    c.selectAt([{...item,publicationId:10}],0);await tick();assert.equal(c.getSnapshot().restoreError,null);assert.equal(c.getSnapshot().player?.playing,true);
  }finally{c.dispose();}
});
test('feed restoration rejects a missing/wrong anchor and preserves fresh resume metadata',async()=>{
  const raw={context:{kind:'global'},items:[item],nextCursor:null,resume:{requestedPublicationId:9,restoredPublicationId:9,outcome:'restored'}};
  const page=adaptViewerFeedPage(raw,{kind:'global'},9);assert.equal(page.resume?.restoredPublicationId,9);
  assert.throws(()=>adaptViewerFeedPage({...raw,items:[]},{kind:'global'},9));
  assert.throws(()=>adaptViewerFeedPage({...raw,resume:{...raw.resume,restoredPublicationId:10}},{kind:'global'},9));
  const store=new FeedStore(async()=>page);await store.refresh();assert.equal(store.getSnapshot().resume?.restoredPublicationId,9);
});
test('a retained unavailable card does not start an impossible time restore',()=>{
  const c=new PlaybackCoordinator(()=>new Player());try{
    c.setAppActive(true);c.restoreAt([item],0,{positionSeconds:8,userPaused:false});
    assert.equal(c.getSnapshot().restoring,true);
    c.restoreAt([{...item,playbackUrl:null}],0,{positionSeconds:8,userPaused:true});
    assert.equal(c.getSnapshot().restoring,false);assert.equal(c.getSnapshot().userPaused,true);assert.equal(c.getSnapshot().livePlayers,0);
  }finally{c.dispose();}
});
test('release-before-replacement leaves the global player budget available',async()=>{
  const budget=new PlayerBudget(3);const create=()=>{const lease=budget.acquire(()=>new Player(),p=>p.release());const p=lease.value;const release=p.release;p.release=()=>{p.release=release;lease.release();};return p;};
  for(let i=0;i<20;i++){
    const c=new PlaybackCoordinator(create);c.setAppActive(true);c.selectAt([item,{...item,publicationId:10},{...item,publicationId:11}],1);await tick();
    assert.ok(budget.count<=3);c.capture();c.dispose();assert.equal(budget.count,0);
  }
});
