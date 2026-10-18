import { ApiError } from '../api/client';

export type AccessSnapshot={authorized:boolean;checking:boolean;error:string|null};
// A late response from an earlier foreground/context cannot grant current playback.
export class AccessGuard {
  private state:AccessSnapshot={authorized:false,checking:false,error:null};
  private active=false;
  private generation=0;
  private controller:AbortController|null=null;
  private pending:Promise<boolean>|null=null;
  private listeners=new Set<()=>void>();
  constructor(private readonly verify:(signal:AbortSignal)=>Promise<void>,private readonly onDenied:(error:ApiError)=>void) {}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<AccessSnapshot>){this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  setActive=(active:boolean)=>{
    if(this.active===active)return;
    this.active=active;
    if(active)void this.check();
    else {this.generation++;this.controller?.abort();this.pending=null;this.publish({authorized:false,checking:false});}
  };
  check=():Promise<boolean>=>{
    if(this.pending)return this.pending;
    if(!this.active)return Promise.resolve(false);
    const generation=++this.generation;const controller=new AbortController();this.controller=controller;
    this.publish({authorized:false,checking:true,error:null});
    let pending!:Promise<boolean>;
    pending=(async()=>{
      await Promise.resolve();
      try{
        await this.verify(controller.signal);
        if(generation!==this.generation || !this.active)return false;
        this.publish({authorized:true,checking:false});return true;
      }catch(e){
        if(generation!==this.generation || !this.active)return false;
        this.publish({authorized:false,checking:false,error:e instanceof ApiError?e.message:'Cannot verify access. Reconnect and try again.'});
        if(e instanceof ApiError && [401,403,404].includes(e.status??0))this.onDenied(e);
        return false;
      }finally{if(this.pending===pending)this.pending=null;}
    })();this.pending=pending;return pending;
  };
  dispose=()=>{this.setActive(false);this.listeners.clear();};
}
