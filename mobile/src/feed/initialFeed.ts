import type { FeedPage } from './types';

// One mount-local request shared by feed rendering and the first access check.
// Refocus/renewal/retry never consume its authority again.
export class InitialFeed {
  private request=new AbortController();
  private pending:Promise<FeedPage>|null=null;
  private startedAt=0;
  constructor(private load:(signal:AbortSignal)=>Promise<FeedPage>){}
  get=()=>{if(!this.pending){this.startedAt=performance.now();this.pending=this.load(this.request.signal);}return this.pending;};
  verify=async(signal:AbortSignal)=>{
    if(signal.aborted)throw Error('Cancelled');
    await new Promise<void>((resolve,reject)=>{
      const cancel=()=>reject(Error('Cancelled'));
      signal.addEventListener('abort',cancel,{once:true});
      void this.get().then(()=>{if(!signal.aborted)resolve();},reject).finally(()=>signal.removeEventListener('abort',cancel));
    });
    return {verifiedAt:this.startedAt};
  };
  dispose=()=>this.request.abort();
}
