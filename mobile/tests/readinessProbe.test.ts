import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReadinessProbe } from '../src/playback/readinessProbe';
import type { NativeReadinessEvidence } from '../src/playback/readinessEvidence';
import type { FeedVideoItem } from '../src/feed/types';
const deferred = <T>() => { let resolve!: (value: T) => void, reject!: (error: Error) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i=0;i<8;i++) await Promise.resolve(); };
const item = { publicationId: 1, playbackUrl: 'https://public.test/media.m3u8' } as FeedVideoItem;
const options = { seconds: 7, paused: true, muted: false, mode: 'native-modal' as const };
function setup() {
  let current=true,authorized=true,now=0,live=0;
  const subjects:Array<ReturnType<typeof deferred<FeedVideoItem>>>=[],players:any[]=[],native:Array<{attempt:string;seconds:number;result:ReturnType<typeof deferred<NativeReadinessEvidence>>}>=[],cancelled:string[]=[];
  const probe = new ReadinessProbe({
    loadSubject: () => { const d=deferred<FeedVideoItem>(); subjects.push(d); return d.promise; },
    current:()=>current,authorized:()=>authorized,now:()=>now,
    create:()=>{
      const statusListeners=new Set<(status:any)=>void>(),playingListeners=new Set<(playing:boolean)=>void>();
      const load=deferred<void>();
      const p={seconds:0,muted:true,playing:false,released:0,statusValue:'loading' as any,loadResult:load,
        load:()=>load.promise,play(){this.playing=true;playingListeners.forEach(fn=>fn(true));},pause(){this.playing=false;playingListeners.forEach(fn=>fn(false));},
        setMuted(value:boolean){this.muted=value;},status:()=>p.statusValue,currentTime:()=>p.seconds,durationSeconds:()=>20,seekToStart:()=>{},
        subscribe(fn:(status:any)=>void){statusListeners.add(fn);return()=>{statusListeners.delete(fn);};},
        subscribePlaying(fn:(playing:boolean)=>void){playingListeners.add(fn);return()=>{playingListeners.delete(fn);};},
        ready(){this.statusValue='readyToPlay';statusListeners.forEach(fn=>fn(this.statusValue));load.resolve();},
        release(){this.released++;assert.equal(statusListeners.size,0);assert.equal(playingListeners.size,0);},
      };players.push(p);return p;
    },
    prepare:(_player,attempt,seconds)=>{const result=deferred<NativeReadinessEvidence>();native.push({attempt,seconds,result});return result.promise;},
    cancel:attempt=>{cancelled.push(attempt);},resource:delta=>{live+=delta;assert.ok(live>=0&&live<=1);},
  });
  const evidence=(index=0,patch:Partial<NativeReadinessEvidence>={})=>{
    const n=native[index];players[index].seconds=n.seconds;
    n.result.resolve({attempt:n.attempt,kind:'target_decoded',targetSeconds:n.seconds,timelineSeconds:n.seconds,decodedFrameSeconds:n.seconds,
      seekCompletedMs:30,decodedFrameMs:60,width:720,height:1280,muted:true,rate:0,...patch});
  };
  const begin=async(opts=options)=>{void probe.start(opts);subjects.at(-1)!.resolve(item);await flush();return players.at(-1);};
  return {probe,subjects,players,native,evidence,begin,cancelled,setCurrent:(value:boolean)=>{current=value;},setAuthorized:(value:boolean)=>{authorized=value;},setNow:(value:number)=>{now=value;},
    close(){probe.dispose();assert.equal(live,0);}};
}
test('covered first frame cannot open the gate before independent native target evidence; paused reveal never plays',async()=>{
  const h=setup();try{
    const player=await h.begin();h.probe.firstFrame(h.probe.getSnapshot().record!.attempt);
    assert.equal(h.probe.getSnapshot().phase,'preparing');assert.equal(player.playing,false);assert.equal(player.muted,true);
    player.ready();await flush();assert.equal(h.native.length,1);assert.equal(h.probe.getSnapshot().phase,'preparing');
    h.evidence();await flush();assert.equal(h.probe.getSnapshot().phase,'ready');assert.equal(player.playing,false);
    h.probe.reveal();assert.equal(player.muted,true);h.probe.present();assert.equal(player.muted,false);assert.equal(player.playing,false);assert.equal(player.seconds,7);
    h.probe.finish(true);assert.equal(player.released,1);assert.equal(h.probe.report().history[0].userConfirmed,true);
  }finally{h.close();}
});
test('playing intent is held until reveal has committed; decoded evidence still requires view first-frame evidence',async()=>{
  const h=setup();try{
    const player=await h.begin({...options,paused:false});player.ready();await flush();h.evidence();await flush();
    assert.equal(h.probe.getSnapshot().phase,'preparing');assert.equal(player.playing,false);
    h.probe.firstFrame(h.probe.getSnapshot().record!.attempt);assert.equal(h.probe.getSnapshot().phase,'ready');
    h.probe.present();assert.equal(player.playing,false);h.probe.reveal();assert.equal(player.playing,false);
    h.probe.present();assert.equal(player.playing,true);assert.equal(player.muted,false);assert.ok(h.probe.getSnapshot().record!.stages.playing!==undefined);
  }finally{h.close();}
});
test('Close during HTTP or seek ignores late data/native success and releases exactly once',async()=>{
  const h=setup();try{
    void h.probe.start(options);h.probe.cancel();h.subjects[0].resolve(item);await flush();assert.equal(h.players.length,0);
    const player=await h.begin();player.ready();await flush();const attempt=h.probe.getSnapshot().record!.attempt;
    h.probe.cancel();assert.equal(player.released,1);h.evidence();h.probe.firstFrame(attempt);await flush();
    assert.equal(h.probe.getSnapshot().phase,'cancelled');assert.equal(player.released,1);assert.equal(player.playing,false);assert.ok(h.cancelled.includes(attempt));
  }finally{h.close();}
});
test('cancelled attempt cannot supply evidence to a retry or dispose the retry player',async()=>{
  const h=setup();try{
    const first=await h.begin();first.ready();await flush();const stale=h.probe.getSnapshot().record!.attempt;
    const second=await h.begin();second.ready();await flush();h.evidence(0);h.probe.firstFrame(stale);await flush();
    assert.equal(first.released,1);assert.equal(second.released,0);assert.equal(h.probe.getSnapshot().phase,'preparing');
    h.evidence(1);h.probe.firstFrame(h.probe.getSnapshot().record!.attempt);await flush();assert.equal(h.probe.getSnapshot().phase,'ready');
  }finally{h.close();}
});
test('proof expiry at reveal and lifecycle/account invalidation cancel before audio',async()=>{
  for(const kind of ['expiry','account']){
    const h=setup();try{
      const player=await h.begin({...options,paused:false});player.ready();h.probe.firstFrame(h.probe.getSnapshot().record!.attempt);h.evidence();await flush();
      assert.equal(h.probe.getSnapshot().phase,'ready');if(kind==='expiry')h.setAuthorized(false);else h.setCurrent(false);
      h.probe.reveal();h.probe.present();assert.equal(h.probe.getSnapshot().phase,'cancelled');assert.equal(player.playing,false);assert.equal(player.released,1);
    }finally{h.close();}
  }
});
test('wrong attempt/time, nonfinite fields and unmuted native evidence fail closed',async()=>{
  for(const patch of [{attempt:'old'},{decodedFrameSeconds:0},{timelineSeconds:NaN},{decodedFrameMs:5},{width:NaN},{muted:false},{rate:1}] as Partial<NativeReadinessEvidence>[]){
    const h=setup();try{const player=await h.begin();player.ready();h.evidence(0,patch);await flush();assert.equal(h.probe.getSnapshot().phase,'failed');assert.equal(player.released,1);}finally{h.close();}
  }
});
test('overall timeout includes a hung subject request; failed native work releases resources',async t=>{
  t.mock.timers.enable({apis:['setInterval']});
  const h=setup();try{
    void h.probe.start(options);h.setNow(20000);t.mock.timers.tick(100);assert.equal(h.probe.getSnapshot().phase,'failed');
    const player=await h.begin();player.ready();h.native[0].result.reject(Error('private native details'));await flush();
    assert.equal(h.probe.getSnapshot().phase,'failed');assert.equal(player.released,1);assert.ok(!JSON.stringify(h.probe.report()).includes('private native details'));
  }finally{h.close();}
});
test('unexpected native playback while covered stops/releases; reports contain no source URL and retain only eight checks',async()=>{
  const h=setup();try{
    for(let i=0;i<10;i++){const p=await h.begin();p.play();assert.equal(h.probe.getSnapshot().phase,'failed');assert.equal(p.playing,false);assert.equal(p.released,1);}
    const report=h.probe.report();assert.equal(report.history.length,8);assert.equal(report.active,null);assert.ok(!JSON.stringify(report).includes('https://'));
  }finally{h.close();}
});
