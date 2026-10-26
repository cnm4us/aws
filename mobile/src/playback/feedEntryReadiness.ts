import type { NativeReadinessEvidence } from './readinessEvidence';
import { matchesReadinessEvidence } from './readinessContract';

export type FeedEntryInput<P>={key:string;player:P|null;seconds:number;duration:number;sourceReady:boolean;hasFrame:boolean;failed:boolean;error?:string|null;empty:boolean;enabled:boolean};
let serial=0;
// Owns readiness of one feed session, never its player pool. After presentation
// normal swipes bypass this gate and keep the existing coordinator window.
export class FeedEntryReadiness<P>{
  private state={phase:'waiting' as 'waiting'|'preparing'|'ready'|'presented'|'failed',error:null as string|null};
  private listeners=new Set<()=>void>();private input:FeedEntryInput<P>|undefined;
  private attempt:string|undefined;private prepared=false;private timer:ReturnType<typeof setTimeout>|undefined;private disposed=false;
  constructor(private deps:{valid():boolean;active?():boolean;prepare(player:P,attempt:string,seconds:number):Promise<NativeReadinessEvidence>;cancel(attempt:string):void}){}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<typeof this.state>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private cancel(){const attempt=this.attempt;this.attempt=undefined;clearTimeout(this.timer);this.timer=undefined;this.prepared=false;if(attempt)this.deps.cancel(attempt);}
  private fail(error:string){this.cancel();this.publish({phase:'failed',error});}
  suspend=()=>{if(this.disposed||this.state.phase==='presented')return;this.cancel();this.input=undefined;this.publish({phase:'waiting',error:null});};
  update=(input:FeedEntryInput<P>)=>{
    if(this.disposed||this.state.phase==='presented')return;
    if(!input.enabled||this.deps.active?.()===false){this.suspend();return;}
    if(!this.deps.valid()){this.fail('Cannot verify video access. Reconnect and try again.');return;}
    if(this.input?.key!==input.key){this.cancel();this.publish({phase:'waiting',error:null});}
    this.input=input;
    if(this.state.phase==='failed')return;
    if(input.empty){this.cancel();this.publish({phase:'ready',error:null});return;}
    if(input.failed||input.error){this.fail('Cannot prepare this video. Try again.');return;}
    if(!this.timer){this.timer=setTimeout(()=>this.fail('Video preparation timed out. Try again.'),20000);(this.timer as ReturnType<typeof setTimeout>&{unref?:()=>void}).unref?.();}
    if(this.prepared&&input.hasFrame&&input.sourceReady){this.publish({phase:'ready'});return;}
    if(this.attempt||!input.player||!input.sourceReady)return;
    const attempt=`feed-entry-${++serial}`,key=input.key;this.attempt=attempt;this.publish({phase:'preparing'});
    const seconds=Number.isFinite(input.seconds)?Math.max(0,input.seconds):0;
    const target=input.duration>0&&Number.isFinite(input.duration)?Math.min(seconds,Math.max(0,input.duration-.1)):seconds;
    let work:Promise<NativeReadinessEvidence>;
    try{work=this.deps.prepare(input.player,attempt,target);}catch{this.fail('Cannot prepare this video. Try again.');return;}
    const invalid=()=>{if(this.deps.active?.()===false)this.suspend();else this.fail('Cannot verify video access. Reconnect and try again.');};
    void work.then(evidence=>{
      if(this.disposed||this.attempt!==attempt||this.input?.key!==key)return;
      if(!this.deps.valid()){invalid();return;}
      if(!matchesReadinessEvidence(evidence,attempt,target)){this.fail('Cannot confirm the requested video frame. Try again.');return;}
      this.prepared=true;
      if(this.input.hasFrame&&this.input.sourceReady)this.publish({phase:'ready'});
    }).catch(()=>{if(!this.disposed&&this.attempt===attempt){if(this.deps.valid())this.fail('Cannot prepare this video. Try again.');else invalid();}});
  };
  present=()=>{if(this.disposed||this.state.phase!=='ready')return false;if(!this.deps.valid()){if(this.deps.active?.()===false)this.suspend();else this.fail('Cannot verify video access. Reconnect and try again.');return false;}clearTimeout(this.timer);this.timer=undefined;this.publish({phase:'presented'});return true;};
  dispose=()=>{this.disposed=true;this.cancel();this.listeners.clear();};
}
