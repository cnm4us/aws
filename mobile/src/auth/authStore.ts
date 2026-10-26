import type { AccessDiagnostic } from '../diagnostics/playbackDiagnostics';
import { GlobalFeedMemory } from '../feed/globalFeedMemory';
import { AccessManager } from './accessManager';
import { adaptIdentity } from './accessProof';
import { ApiError } from '../api/client';
import type { NativeSessionApi, SessionStorage, StoredSession, Viewer } from './types';

export type AuthSnapshot = {
  status:'restoring'|'anonymous'|'signingIn'|'authenticated'|'unavailable'|'signingOut';
  generation:number; recoveryRevision?:number; viewer:Viewer|null; validating:boolean; message:string|null; hasSavedSession:boolean;
};
export class AuthStore {
  private state: AuthSnapshot={status:'restoring',generation:0,viewer:null,validating:false,message:null,hasSavedSession:false};
  private credential: StoredSession|null=null;
  private listeners=new Set<()=>void>();
  private request: AbortController|null=null;
  private writes: Promise<unknown>=Promise.resolve();
  private validation: Promise<boolean>|null=null;
  readonly globalFeed=new GlobalFeedMemory();
  readonly access=new AccessManager(()=>this.state.viewer?.id??null,{
    onDiagnostic:event=>this.recordDiagnostic(event),
    onIdentity:id=>{if(this.state.viewer?.id===id&&this.state.status==='unavailable')this.publish({status:'authenticated',message:null});},
    onDenied:e=>{if(e.status===401)void this.invalidate(this.state.generation);},
  });
  observeResponse=(value:unknown,generation:number)=>{if(this.state.generation!==generation)return;this.access.seed(adaptIdentity(value));};
  constructor(private readonly origin:string,private readonly api:NativeSessionApi,private readonly storage:SessionStorage,private diagnostic?:(event:AccessDiagnostic)=>void) {}
  recordDiagnostic=(event:AccessDiagnostic)=>this.diagnostic?.(event);
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<AuthSnapshot>) {this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private write<T>(job:()=>Promise<T>):Promise<T> {const next=this.writes.then(job);this.writes=next.catch(()=>{});return next;}
  private next(status:AuthSnapshot['status']) {
    this.request?.abort();this.request=new AbortController();this.validation=null;this.access.clear();this.globalFeed.clear();
    const generation=this.state.generation+1;
    this.publish({generation,status,viewer:null,validating:false,message:null});
    return {generation,signal:this.request.signal};
  }
  token=()=>this.state.status==='authenticated' ? this.credential?.token : undefined;
  // Keep a stable transport for an already-mounted, hidden feed during retryable validation failure.
  credentialFor=(generation:number)=>this.state.generation===generation && this.state.viewer
    && ['authenticated','unavailable'].includes(this.state.status) ? this.credential?.token : undefined;
  retryValidation=async()=>{if(this.credential)await this.validate();else await this.restore();
    const ok=this.state.status==='authenticated';if(ok)this.publish({recoveryRevision:(this.state.recoveryRevision??0)+1});return ok;};
  restore=async()=>{
    const {generation}=this.next('restoring');
    try {
      const saved=await this.write(()=>this.storage.load());
      if(this.state.generation!==generation)return;
      this.credential=saved;
      if(!saved || saved.origin!==this.origin || Date.parse(saved.expiresAt)<=Date.now()) {
        if(saved)await this.write(()=>this.storage.clear());
        if(this.state.generation===generation)this.publish({status:'anonymous',hasSavedSession:false,message:saved?'Your session ended. Please sign in again.':null});
        return;
      }
      this.publish({hasSavedSession:true});await this.validate();
    }catch {if(this.state.generation===generation)this.publish({status:'unavailable',message:'Cannot restore sign-in. Try again or browse Global.',hasSavedSession:true});}
  };
  signIn=async(email:string,password:string)=>{
    const {generation,signal}=this.next('signingIn');const previous=this.credential;this.credential=null;
    try {
      try {await this.write(()=>this.storage.clear());}
      catch {throw new ApiError('Could not remove saved sign-in. Retry sign-out.',undefined,'storage');}
      if(previous)void this.api.revoke(previous.token).catch(()=>{});
      if(this.state.generation!==generation)return;
      const session=await this.api.login(email,password,signal);
      if(this.state.generation!==generation){void this.api.revoke(session.token).catch(()=>{});return;}
      const record:StoredSession={version:1,origin:this.origin,token:session.token,expiresAt:session.expiresAt};
      try {await this.write(async()=>{if(this.state.generation===generation)await this.storage.save(record);});}
      catch {
        void this.api.revoke(session.token).catch(()=>{});
        // A native write may have succeeded before reporting an error. Suppress that record too.
        let cleared=true;try{await this.write(()=>this.storage.clear());}catch{cleared=false;}
        throw new ApiError(cleared?'Could not save sign-in securely. Please try again.':'Could not remove saved sign-in. Retry sign-out.',undefined,cleared?'save_failed':'storage');
      }
      if(this.state.generation!==generation){void this.api.revoke(session.token).catch(()=>{});return;}
      this.credential=record;
      this.publish({status:'authenticated',viewer:session.viewer,hasSavedSession:true,validating:false,message:null});
      this.access.seed(session.confirmation?{...session.confirmation,epoch:this.access.epoch()}:undefined);
    }catch(e){if(this.state.generation===generation)this.publish({status:'anonymous',hasSavedSession:e instanceof ApiError && e.code==='storage',message:e instanceof Error?e.message:'Sign-in failed. Try again.'});}
  };
  cancelSignIn=()=>{if(this.state.status==='signingIn'){
    const {generation}=this.next('anonymous');this.publish({hasSavedSession:false});
    void this.write(()=>this.storage.clear()).catch(()=>{if(this.state.generation===generation)this.publish({hasSavedSession:true,message:'Retry sign-out to remove saved sign-in.'});});
  }};
  validate=():Promise<boolean>=>{
    if(this.validation)return this.validation;
    const record=this.credential,generation=this.state.generation;
    if(!record)return Promise.resolve(false);
    const controller=new AbortController();this.request=controller;this.publish({validating:true});const startedAt=performance.now();let httpStatus:number|undefined,outcome:'ok'|'failed'|'cancelled'='failed';
    let pending!:Promise<boolean>;
    pending=(async()=>{
      await Promise.resolve();
      try {
        const result=await this.api.validate(record.token,controller.signal);httpStatus=200;
        if(this.state.generation!==generation || this.credential!==record)return false;
        this.publish({status:'authenticated',viewer:result.viewer,validating:false,message:null});this.access.seed(result.confirmation?{...result.confirmation,epoch:this.access.epoch()}:undefined);outcome='ok';return true;
      }catch(e){
        httpStatus=e instanceof ApiError?e.status:undefined;
        if(this.state.generation!==generation)return false;
        if(e instanceof ApiError && e.status===401) await this.invalidate(generation);
        else this.publish({status:this.access.identityValid()?'authenticated':'unavailable',validating:false,message:'Cannot verify access. Reconnect and try again.'});
        return false;
      }finally {this.recordDiagnostic({event:'http',scope:'identity',httpStatus,durationMs:performance.now()-startedAt,outcome:controller.signal.aborted?'cancelled':outcome});if(this.validation===pending)this.validation=null;}
    })();
    this.validation=pending;return pending;
  };
  invalidate=async(generation:number)=>{
    if(this.state.generation!==generation)return;
    const next=this.next('anonymous');this.credential=null;
    this.publish({hasSavedSession:false,message:'Your session ended. Please sign in again.'});
    try {await this.write(()=>this.storage.clear());}
    catch {if(this.state.generation===next.generation)this.publish({hasSavedSession:true,message:'Your session ended. Retry sign-out to remove the saved credential.'});}
  };
  browseAnonymously=()=>{this.next('anonymous');this.publish({hasSavedSession:!!this.credential});};
  signOut=async()=>{
    const old=this.credential;const {generation}=this.next('signingOut');this.credential=null;
    let durable=true;try{await this.write(()=>this.storage.clear());}catch{durable=false;}
    if(this.state.generation!==generation)return;
    this.publish({status:'anonymous',hasSavedSession:!durable,message:durable?null:'Could not remove saved sign-in. Retry sign-out before closing the app.'});
    if(old){try{await this.api.revoke(old.token);}catch{if(this.state.generation===generation && durable)this.publish({message:'Signed out on this phone. The server could not be reached to revoke the session.'});}}
  };
  dispose=()=>{this.request?.abort();this.access.dispose();this.globalFeed.clear();this.state={...this.state,generation:this.state.generation+1};this.listeners.clear();};
}
