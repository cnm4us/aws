import { ApiError } from '../api/client';
import type { NativeSessionApi, SessionStorage, StoredSession, Viewer } from './types';

export type AuthSnapshot = {
  status:'restoring'|'anonymous'|'signingIn'|'authenticated'|'unavailable'|'signingOut';
  generation:number; viewer:Viewer|null; validating:boolean; message:string|null; hasSavedSession:boolean;
};
export class AuthStore {
  private state: AuthSnapshot={status:'restoring',generation:0,viewer:null,validating:false,message:null,hasSavedSession:false};
  private credential: StoredSession|null=null;
  private listeners=new Set<()=>void>();
  private request: AbortController|null=null;
  private writes: Promise<unknown>=Promise.resolve();
  private validation: Promise<boolean>|null=null;
  private routineOwners=new Set<object>();
  constructor(private readonly origin:string,private readonly api:NativeSessionApi,private readonly storage:SessionStorage) {}
  getSnapshot=()=>this.state;
  subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
  private publish(patch:Partial<AuthSnapshot>) {this.state={...this.state,...patch};this.listeners.forEach(fn=>fn());}
  private write<T>(job:()=>Promise<T>):Promise<T> {const next=this.writes.then(job);this.writes=next.catch(()=>{});return next;}
  private next(status:AuthSnapshot['status']) {
    this.request?.abort();this.request=new AbortController();this.validation=null;
    const generation=this.state.generation+1;
    this.publish({generation,status,viewer:null,validating:false,message:null});
    return {generation,signal:this.request.signal};
  }
  token=()=>this.state.status==='authenticated' ? this.credential?.token : undefined;
  // Keep a stable transport for an already-mounted, hidden feed during retryable validation failure.
  credentialFor=(generation:number)=>this.state.generation===generation && this.state.viewer
    && ['authenticated','unavailable'].includes(this.state.status) ? this.credential?.token : undefined;
  retryValidation=()=>this.credential ? this.validate() : this.restore();
  // An active protected feed renews account + space together on its own clock.
  // The provider keeps its fallback cadence for Global and non-feed screens.
  claimRoutineValidation=()=>{const owner={};this.routineOwners.add(owner);return()=>{this.routineOwners.delete(owner);};};
  validateRoutine=()=>this.routineOwners.size ? Promise.resolve(false) : this.validate();
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
    const controller=new AbortController();this.request=controller;this.publish({validating:true});
    let pending!:Promise<boolean>;
    pending=(async()=>{
      await Promise.resolve();
      try {
        const result=await this.api.validate(record.token,controller.signal);
        if(this.state.generation!==generation || this.credential!==record)return false;
        this.publish({status:'authenticated',viewer:result.viewer,validating:false,message:null});return true;
      }catch(e){
        if(this.state.generation!==generation)return false;
        if(e instanceof ApiError && e.status===401) await this.invalidate(generation);
        else this.publish({status:'unavailable',validating:false,message:'Cannot verify access. Reconnect and try again.'});
        return false;
      }finally {if(this.validation===pending)this.validation=null;}
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
  dispose=()=>{this.request?.abort();this.routineOwners.clear();this.state={...this.state,generation:this.state.generation+1};this.listeners.clear();};
}
