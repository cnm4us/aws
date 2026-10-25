import type { FeedVideoItem } from '../feed/types';
import type { PlaybackDiagnosticEvent } from '../diagnostics/playbackDiagnostics';
import type { PlayerPort } from './coordinator';

// A single paused lease, consumed once by a freshly loaded, authorized feed.
// It never grants access and never substitutes a URL or creator on a production match.
export class PlayerHandoff<P extends PlayerPort> {
  private player:P|null;
  private timer:ReturnType<typeof setTimeout>;
  private unsubscribe:()=>void;
  constructor(readonly item:FeedVideoItem,player:P,private diagnostic:(event:PlaybackDiagnosticEvent)=>void) {
    this.player=player;player.pause();player.setMuted(true);
    this.unsubscribe=player.subscribePlaying?.(playing=>{if(playing){player.pause();this.diagnostic({type:'unexpected_playback',publicationId:item.publicationId,reason:'ineligible'});}})??(()=>{});
    this.timer=setTimeout(this.dispose,15_000);
    (this.timer as ReturnType<typeof setTimeout>&{unref?:()=>void}).unref?.();
  }
  take=(item:FeedVideoItem):P|null=>{
    const player=this.player;
    if(!player)return null;
    if(!item.productionUlid || item.productionUlid!==this.item.productionUlid || !item.creator.id || item.creator.id!==this.item.creator.id
      || !item.playbackUrl || item.playbackUrl!==this.item.playbackUrl || player.status()!=='readyToPlay') {this.dispose();return null;}
    this.player=null;clearTimeout(this.timer);this.unsubscribe();
    this.diagnostic({type:'transfer_out',publicationId:this.item.publicationId,livePlayers:0});
    return player;
  };
  dispose=()=>{
    const player=this.player;if(!player)return;
    this.player=null;clearTimeout(this.timer);this.unsubscribe();player.pause();player.release();
    this.diagnostic({type:'release',publicationId:this.item.publicationId,livePlayers:0});
  };
}
