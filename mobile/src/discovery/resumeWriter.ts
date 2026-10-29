import type {ApiClient} from '../api/client';
import {ApiError} from '../api/client';
import {adaptResume,discoveryPrefix,type ResumeState} from './api';
export type DurableCheckpoint=NonNullable<ResumeState['checkpoint']>;
/** Sparse serialized CAS writes. Conflicts reconcile once and never replay an obsolete checkpoint. */
export class ResumeWriter {
  private revisions=new Map<string,number>();
  private inFlight=new Map<string,Promise<void>>();
  private pending=new Map<string,DurableCheckpoint>();
  private disposed=false;
  constructor(private client:Pick<ApiClient,'getJson'|'postJson'>,private valid:()=>boolean){}
  async read(key:string,signal?:AbortSignal) {
    const result=adaptResume(await this.client.getJson(`${discoveryPrefix}/spaces/${encodeURIComponent(key)}/resume`,signal));
    if(this.valid()&&!this.disposed)this.revisions.set(key,result.revision);
    return result;
  }
  write(key:string,checkpoint:DurableCheckpoint) {
    if(this.disposed||!this.valid())return Promise.resolve();
    this.pending.set(key,checkpoint);
    if(this.inFlight.has(key))return this.inFlight.get(key)!;
    const promise=this.drain(key).finally(()=>{this.inFlight.delete(key);if(this.pending.has(key)&&this.valid()&&!this.disposed)void this.write(key,this.pending.get(key)!);});
    this.inFlight.set(key,promise);return promise;
  }
  private async drain(key:string) {
    if(!this.revisions.has(key)) {try{await this.read(key)}catch{this.pending.delete(key);return;}}
    if(!this.valid()||this.disposed)return;
    const checkpoint=this.pending.get(key);this.pending.delete(key);if(!checkpoint)return;
    try {
      const result=await this.client.postJson(`${discoveryPrefix}/spaces/${encodeURIComponent(key)}/visit`,{revision:this.revisions.get(key),checkpoint}) as {revision:number};
      if(this.valid()&&!this.disposed&&Number.isSafeInteger(result.revision))this.revisions.set(key,result.revision);
    }catch(e) {
      this.pending.delete(key);
      if(e instanceof ApiError&&e.status===409&&this.valid()&&!this.disposed)try{await this.read(key)}catch{}
    }
  }
  dispose(){this.disposed=true;this.pending.clear();this.revisions.clear();}
}
