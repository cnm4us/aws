import type { AccessDiagnostic } from '../diagnostics/playbackDiagnostics';
// One explicit read/retry attempt, scoped to a mounted visible feed. Cancellation
// prevents a covered/replaced route from reloading media after reads complete.
export class RecoveryCoordinator {
 constructor(private diagnostic?:(event:AccessDiagnostic)=>void){}
 private epoch=0;private pending:Promise<boolean>|null=null;
 run=(read:()=>Promise<boolean>,retryMedia:()=>void):Promise<boolean>=>{
  if(this.pending)return this.pending;this.diagnostic?.({event:'recovery_started',scope:'recovery'});const epoch=this.epoch;let pending!:Promise<boolean>;
  pending=(async()=>{await Promise.resolve();try{if(!await read()||epoch!==this.epoch){this.diagnostic?.({event:'recovery_failed',scope:'recovery'});return false;}retryMedia();this.diagnostic?.({event:'recovery_succeeded',scope:'recovery'});return true;}
   finally{if(this.pending===pending)this.pending=null;}})();this.pending=pending;return pending;
 };
 cancel=()=>{this.epoch++;this.pending=null;};
}
