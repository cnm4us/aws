export type Checkpoint={publicationId:number;productionUlid:string;positionSeconds:number;userPaused:boolean};
type Transport=(path:string,body?:unknown,signal?:AbortSignal)=>Promise<any>;
/** One serialized revision stream per space; a late response cannot write another space's state. */
export class ResumePersistence {
  private revisions=new Map<string,number>();
  private pending=new Map<string,Checkpoint>();
  private running=new Map<string,Promise<void>>();
  constructor(private transport:Transport){}
  async read(key:string,signal?:AbortSignal){const state=await this.transport(`/spaces/${encodeURIComponent(key)}/resume`,undefined,signal);this.revisions.set(key,state.revision);return state;}
  save(key:string,checkpoint:Checkpoint):Promise<void>{
    this.pending.set(key,{...checkpoint});
    if(this.running.has(key))return this.running.get(key)!;
    const write=this.drain(key).finally(()=>{this.running.delete(key);if(this.pending.has(key))void this.save(key,this.pending.get(key)!);});
    this.running.set(key,write);return write;
  }
  private async drain(key:string){
    if(!this.revisions.has(key))try{await this.read(key);}catch{this.pending.delete(key);return;}
    const checkpoint=this.pending.get(key);this.pending.delete(key);if(!checkpoint)return;
    try{const result=await this.transport(`/spaces/${encodeURIComponent(key)}/visit`,{revision:this.revisions.get(key),checkpoint});this.revisions.set(key,result.revision);}
    catch(error:any){this.pending.delete(key);if(error.status===409)try{await this.read(key);}catch{}}
    while(this.revisions.size>30){const first=this.revisions.keys().next().value!;if(this.running.has(first))break;this.revisions.delete(first);}
  }
}
