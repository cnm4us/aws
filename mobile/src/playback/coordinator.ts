import type { FeedVideoItem } from '../feed/types';
import type { NavigationTrace, PlaybackDiagnosticEvent } from '../diagnostics/playbackDiagnostics';
import { playerErrorDetails } from './playerError';
import {clampTime,validDuration} from './seekMath';
import { PlayerBudgetError } from './playerBudget';
import { PlayerHandoff } from './playerHandoff';
import type { NativeReadinessEvidence } from './readinessEvidence';

export type PlaybackStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';
export interface PlayerPort {
  prepareEntry?(attempt:string,seconds:number):Promise<NativeReadinessEvidence>;
  cancelEntry?(attempt:string):void;
  load(url: string): Promise<void>;
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
  seekToStart(): void;
  currentTime?(): number;
  durationSeconds?(): number;
  seekTo?(seconds: number): Promise<void>;
  seekInteractive?(seconds:number,attempt:string):Promise<number>;
  cancelInteractiveSeek?(attempt:string):void|Promise<void>;
  release(): void;
  status(): PlaybackStatus;
  bufferedSeconds?(): number;
  isPlaying?(): boolean;
  subscribe(listener: (status: PlaybackStatus, error?: unknown) => void): () => void;
  subscribePlaying?(listener: (playing: boolean) => void): () => void;
  subscribeProgress?(listener: (seconds: number) => void): () => void;
}

export type PlaybackSnapshot<P> = {
  seekPhase:'idle'|'dragging'|'seeking'|'error';
  seekRevision:number;
  entryPresented:boolean;
  sourceLoaded:boolean;
  publicationId: number | null;
  activation: number;
  player: P | null;
  status: PlaybackStatus;
  hasFrame: boolean;
  playbackStarted: boolean;
  failed: boolean;
  userPaused: boolean;
  muted: boolean;
  appActive: boolean;
  screenEligible: boolean;
  scrolling: boolean;
  livePlayers: number;
  prepared: boolean;
  restoring: boolean;
  restoreError: string | null;
};

type Entry<P> = {
  item: FeedVideoItem; player: P; unsubscribe: () => void;
  status: PlaybackStatus; failed: boolean; selectedBefore: boolean;
  retained:boolean; readyOnce: boolean; loadResolved: boolean; playRequested: boolean;
};

// Owns at most previous/current/next. Only the selected entry may play.
function sameSource(a:FeedVideoItem|undefined|null,b:FeedVideoItem|undefined|null) {
  if(!a||!b)return !a&&!b;
  return a.publicationId===b.publicationId&&a.playbackUrl===b.playbackUrl&&a.uploadId===b.uploadId
    &&a.productionUlid===b.productionUlid&&a.creator.id===b.creator.id;
}

let seekOwnerSequence=0;
export class PlaybackCoordinator<P extends PlayerPort> {
  private readonly seekOwner=++seekOwnerSequence;
  private state: PlaybackSnapshot<P> = {
    seekPhase:'idle',seekRevision:0,entryPresented:true,sourceLoaded:false,
    publicationId: null, activation: 0, player: null, status: 'idle', hasFrame: false, playbackStarted: false,
    failed: false, userPaused: false, muted: true, appActive: false, scrolling: false,
    livePlayers: 0, prepared: false, screenEligible:true, restoring:false, restoreError:null,
  };
  private item: FeedVideoItem | null = null;
  private desired: FeedVideoItem[] = [];
  private entries = new Map<number, Entry<P>>();
  private listeners = new Set<() => void>();
  // Scroll/tap callbacks may already be queued when an account/feed unmounts.
  // Disposal is terminal: those callbacks must never acquire another player.
  private disposed = false;
  private startupTimer: { activation: number; timer: ReturnType<typeof setTimeout> } | null = null;
  private pendingRestore: { publicationId:number; seconds:number; userPaused:boolean; started:boolean; journeyGeneration?:number; timer?:ReturnType<typeof setTimeout> } | null = null;

  private seek: {entry:Entry<P>;activation:number;origin:number;target:number;attempt:string;rollback:boolean;committed:boolean;timer?:ReturnType<typeof setTimeout>} | null = null;
  private seekSequence=0;

  constructor(private readonly createPlayer: () => P,
    private readonly diagnostic: (event: PlaybackDiagnosticEvent) => void = () => {}, initialMuted = true, private handoff?:PlayerHandoff<P>,private trace?:NavigationTrace,requireEntryReadiness=false) {
    this.state = { ...this.state, muted: initialMuted,entryPresented:!requireEntryReadiness };
  }

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(patch: Partial<PlaybackSnapshot<P>>) {
    if (Object.entries(patch).every(([key, value]) => this.state[key as keyof PlaybackSnapshot<P>] === value)) return;
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  private owns(entry: Entry<P>) { return this.entries.get(entry.item.publicationId) === entry; }
  private isActive(entry: Entry<P>) {
    return this.owns(entry) && this.state.player === entry.player && this.item?.publicationId === entry.item.publicationId;
  }
  private eligible() {
    return this.state.entryPresented && this.state.appActive && this.state.screenEligible && !this.state.scrolling && !this.state.userPaused && !this.state.failed
      && !this.state.restoring && !this.state.restoreError && this.state.seekPhase==='idle';
  }
  private current() { return this.item ? this.entries.get(this.item.publicationId) : undefined; }

  private requestPlayback(entry: Entry<P>, playing: boolean) {
    if (entry.playRequested === playing) return;
    // Set intent first: native commands may synchronously emit status/playing callbacks.
    entry.playRequested = playing;
    if (playing) entry.player.play();
    else entry.player.pause();
  }

  private drop(entry: Entry<P>) {
    if (!this.owns(entry)) return;
    this.entries.delete(entry.item.publicationId);
    entry.unsubscribe();
    entry.player.setMuted(true);
    entry.player.pause();
    entry.player.release();
    this.diagnostic({ type: 'release', publicationId: entry.item.publicationId, livePlayers: this.entries.size });
  }

  private reconcile() {
    if (this.disposed) return;
    this.watchStartup();
    for (const entry of this.entries.values()) {
      const active = this.isActive(entry);
      // Mute before cancelling play intent. Native playingChange may arrive
      // after a new drag/cover has already made a queued play ineligible.
      entry.player.setMuted(active && this.eligible() ? this.state.muted : true);
      // iOS also reports loading while seeking/rebuffering. Pausing then cancels
      // playback intent and can strand the selected source waiting for readiness.
      // Once replaceAsync resolves, queue the selected player's play intent and
      // let AVPlayer wait for data. Waiting for readyToPlay before requesting play
      // can leave a cold selected source loading with no native play request.
      const canPlay = entry.status !== 'error' && (entry.loadResolved || entry.status === 'readyToPlay' || entry.readyOnce);
      this.requestPlayback(entry, active && this.eligible() && canPlay);
    }
  }

  private clearStartupTimer() {
    if (this.startupTimer) clearTimeout(this.startupTimer.timer);
    this.startupTimer = null;
  }

  private watchStartup() {
    if (!this.current() || !this.eligible() || (this.state.hasFrame && this.state.playbackStarted)) {
      this.clearStartupTimer(); return;
    }
    if (this.startupTimer?.activation === this.state.activation) return;
    this.clearStartupTimer();
    const activation = this.state.activation;
    const timer = setTimeout(() => {
      if (!this.disposed && this.state.activation === activation && this.eligible()
        && !(this.state.hasFrame && this.state.playbackStarted)) this.fail(activation);
    }, 10_000);
    // Node test processes need not stay alive solely for an unused native player.
    (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
    this.startupTimer = { activation, timer };
  }

  private observedPlayback() {
    if (this.state.playbackStarted) return;
    this.publish({ playbackStarted: true });
    if (this.state.hasFrame) this.clearStartupTimer();
  }

  private syncActive() {
    const entry = this.current();
    this.publish({
      player: entry?.player ?? null,
      status: entry?.status ?? (this.item?.playbackUrl ? 'error' : 'idle'),
      failed: entry?.failed ?? Boolean(this.item?.playbackUrl),
      livePlayers: this.entries.size,
      sourceLoaded:!!entry?.loadResolved,
    });
    this.applyRestore();
    this.resumeInterruptedSeek();
    this.reconcile();
  }

  private clearRestore() {
    if(this.pendingRestore?.timer)clearTimeout(this.pendingRestore.timer);
    this.pendingRestore=null;
  }
  private applyRestore() {
    const pending=this.pendingRestore,entry=this.current();
    if(!pending || pending.started || !entry || !this.isActive(entry) || entry.status!=='readyToPlay')return;
    pending.started=true;
    const finish=(error?:unknown)=>{
      if(this.disposed || this.pendingRestore!==pending || !this.isActive(entry))return;
      this.clearRestore();
      if(!error){this.trace?.mark('restore_ready');if(this.state.hasFrame&&this.state.entryPresented)this.trace?.finish('ready');}else this.trace?.finish('failed');
      this.publish({restoring:false,restoreError:error?'Cannot restore playback position. Try again or start from the beginning.':null});
      let delta:number|undefined;
      try{const time=entry.player.currentTime?.();if(time!==undefined && Number.isFinite(time))delta=Math.abs(time-pending.seconds);}catch{}
      this.diagnostic({type:'restore',publicationId:entry.item.publicationId,activation:this.state.activation,restoreOutcome:error?'failed':'restored',positionDeltaSeconds:delta,journeyGeneration:pending.journeyGeneration});
      if(error)this.diagnostic({type:'error',publicationId:entry.item.publicationId,activation:this.state.activation,failureKind:'position_restore'});
      this.reconcile();
    };
    try {
      if(!entry.player.seekTo)throw Error('Time restoration unavailable');
      // A publication may play an edited production with a different duration than its upload.
      const duration = entry.player.durationSeconds ? entry.player.durationSeconds() : entry.item.durationSeconds;
      if (duration && Number.isFinite(duration) && duration > 0) pending.seconds = Math.min(pending.seconds, Math.max(0, duration - .1));
      if(entry.retained && Math.abs((entry.player.currentTime?.()??Infinity)-pending.seconds)<.025)finish();
      else void entry.player.seekTo(pending.seconds).then(()=>finish(),finish);
    }catch(error){finish(error);}
  }

  private seekEligible() {
    return !this.disposed&&this.state.entryPresented&&this.state.appActive&&this.state.screenEligible&&!this.state.scrolling
      &&!this.state.failed&&!this.state.restoring&&!this.state.restoreError&&this.state.status!=='error';
  }
  beginSeek = () => {
    const entry=this.current(),duration=entry?.player.durationSeconds?.();
    if(this.seek||!this.seekEligible()||this.state.status!=='readyToPlay'||!entry||!validDuration(duration))return false;
    const origin=entry.player.currentTime?.();if(origin===undefined||!Number.isFinite(origin))return false;
    this.seek={entry,activation:this.state.activation,origin:Math.max(0,origin),target:Math.max(0,origin),attempt:'',rollback:false,committed:false};
    this.publish({seekPhase:'dragging'});this.reconcile();return true;
  };
  private seekCurrent(operation:NonNullable<typeof this.seek>,attempt:string) {
    return !this.disposed&&this.seek===operation&&operation.attempt===attempt&&this.state.activation===operation.activation&&this.isActive(operation.entry);
  }
  private stopSeekRequest(operation:NonNullable<typeof this.seek>) {
    if(operation.timer)clearTimeout(operation.timer);operation.timer=undefined;
    const attempt=operation.attempt;operation.attempt='';
    try{return Promise.resolve(attempt?operation.entry.player.cancelInteractiveSeek?.(attempt):undefined).catch(()=>{});}catch{return Promise.resolve();}
  }
  private runSeek(operation:NonNullable<typeof this.seek>,target:number) {
    const stopped=this.stopSeekRequest(operation),attempt=`scrub-${this.seekOwner}-${this.state.activation}-${++this.seekSequence}`;
    operation.attempt=attempt;operation.committed=true;this.publish({seekPhase:'seeking'});this.reconcile();
    const failed=()=>{if(!this.seekCurrent(operation,attempt))return;void this.stopSeekRequest(operation);this.publish({seekPhase:'error'});this.reconcile();};
    operation.timer=setTimeout(failed,8500);
    void stopped.then(async()=>{
      if(!this.seekCurrent(operation,attempt)||!this.seekEligible())return;
      const player=operation.entry.player;
      if(player.seekInteractive)return player.seekInteractive(target,attempt);
      if(!player.seekTo)throw Error('Seeking unavailable');
      await player.seekTo(target);return player.currentTime?.();
    }).then(actual=>{
      if(!this.seekCurrent(operation,attempt))return;
      if(!this.seekEligible()||actual===undefined||!Number.isFinite(actual)||Math.abs(actual-target)>1){failed();return;}
      if(operation.timer)clearTimeout(operation.timer);this.seek=null;
      this.publish({seekPhase:'idle',seekRevision:this.state.seekRevision+1});this.reconcile();
    }).catch(failed);
  }
  commitSeek = (seconds:number) => {
    const operation=this.seek,duration=operation?.entry.player.durationSeconds?.();
    if(!operation||this.state.seekPhase!=='dragging'||!this.seekEligible()||!validDuration(duration)||!Number.isFinite(seconds))return false;
    operation.target=clampTime(seconds,duration);this.runSeek(operation,operation.target);return true;
  };
  retrySeek = () => {const operation=this.seek;if(operation&&this.state.seekPhase==='error'&&this.seekEligible())this.runSeek(operation,operation.rollback?operation.origin:operation.target);};
  cancelSeek = () => {
    const operation=this.seek;if(!operation)return;
    if(!operation.committed){this.abandonSeek();this.reconcile();return;}
    void this.stopSeekRequest(operation);operation.rollback=true;this.publish({seekPhase:'seeking'});this.resumeInterruptedSeek();this.reconcile();
  };
  private resumeInterruptedSeek() {
    const operation=this.seek;
    if(operation?.rollback&&!operation.attempt&&this.seekEligible())this.runSeek(operation,operation.origin);
  }
  private interruptSeek() {
    const operation=this.seek;if(!operation)return;
    if(!operation.committed){this.abandonSeek();return;}
    void this.stopSeekRequest(operation);operation.rollback=true;this.publish({seekPhase:'seeking'});
  }
  private abandonSeek() {
    if(this.seek)void this.stopSeekRequest(this.seek);this.seek=null;this.publish({seekPhase:'idle'});
  }

  // Persistence observes scalar state without changing decoder/audio eligibility.
  checkpoint = () => {
    let seconds=0;
    try {seconds=this.seek?.origin??this.current()?.player.currentTime?.()??0;}catch{}
    return {publicationId:this.state.publicationId,positionSeconds:Number.isFinite(seconds)?Math.max(0,seconds):0,userPaused:this.state.userPaused};
  };
  // Detours explicitly pause before handing ownership to another screen.
  capture = () => {
    const saved=this.checkpoint();
    this.setScreenEligible(false);
    return saved;
  };

  restoreAt = (items:FeedVideoItem[],index:number,restore:{positionSeconds:number;userPaused:boolean;journeyGeneration?:number},canLoad?:(item:FeedVideoItem)=>boolean) => {
    const item=items[index];if(!item || this.disposed)return;
    this.clearRestore();
    if(!item.playbackUrl){this.publish({restoring:false,restoreError:null});this.selectAt(items,index,canLoad);this.publish({userPaused:restore.userPaused});return;}
    const seconds=Number.isFinite(restore.positionSeconds)?Math.max(0,restore.positionSeconds):0;
    this.pendingRestore={publicationId:item.publicationId,seconds,userPaused:restore.userPaused,started:false,journeyGeneration:restore.journeyGeneration};
    const pending=this.pendingRestore;
    pending.timer=setTimeout(()=>{
      if(this.pendingRestore!==pending || this.disposed)return;
      this.clearRestore();this.publish({restoring:false,restoreError:'Cannot restore playback position. Refresh or start from the beginning.'});this.reconcile();
      this.diagnostic({type:'restore',publicationId:pending.publicationId,activation:this.state.activation,restoreOutcome:'failed',journeyGeneration:pending.journeyGeneration});
      this.diagnostic({type:'error',publicationId:pending.publicationId,activation:this.state.activation,failureKind:'position_restore'});
    },10_000);
    this.publish({restoring:true,restoreError:null,userPaused:restore.userPaused});
    this.selectAt(items,index,canLoad);
    this.publish({userPaused:restore.userPaused});
    this.applyRestore();
  };
  retryRestore = () => {
    // The pending seek has already been abandoned after an error. Retry through
    // an authorized feed reload; starting over is the local safe escape.
    if(this.disposed)return;
    try{this.current()?.player.seekToStart();this.publish({restoreError:null,restoring:false});this.reconcile();}
    catch{this.publish({restoreError:'Cannot start this video. Refresh to try again.'});}
  };

  private statusChanged(entry: Entry<P>, status: PlaybackStatus,
    failureKind: 'native_error' | 'source_load' = 'native_error', error?: unknown) {
    if (!this.owns(entry)) return;
    const changed = entry.status !== status;
    entry.status = status;
    entry.readyOnce ||= status === 'readyToPlay';
    entry.failed ||= status === 'error';
    if (changed && status === 'readyToPlay') this.diagnostic({ type: 'ready', publicationId: entry.item.publicationId });
    if (changed && status === 'error') this.diagnostic({
      type: 'error', publicationId: entry.item.publicationId,
      activation: this.isActive(entry) ? this.state.activation : undefined,
      failureKind,
      ...playerErrorDetails(error),
    });
    if (this.isActive(entry)) {
      this.syncActive();
      if (changed && status === 'readyToPlay') this.fillWindow();
    }
  }

  private createEntry(item: FeedVideoItem) {
    let player: P;
    const carried=this.pendingRestore?.publicationId===item.publicationId?this.handoff?.take(item):undefined;
    this.handoff?.dispose();this.handoff=undefined;
    try { player = carried??this.createPlayer(); }
    catch (error) {
      this.diagnostic({ type: 'error', publicationId: item.publicationId,
        activation: this.item?.publicationId === item.publicationId ? this.state.activation : undefined,
        failureKind: 'player_allocation', allocationFailure: error instanceof PlayerBudgetError ? 'budget_exhausted' : 'native_creation',
        ...playerErrorDetails(error) });
      return;
    }
    const entry: Entry<P> = { item, player, unsubscribe: () => {}, status: carried?'readyToPlay':'loading', failed: false,
      selectedBefore: false, retained:!!carried, readyOnce: !!carried, loadResolved: !!carried, playRequested: false };
    this.entries.set(item.publicationId, entry);
    const subscriptions: (() => void)[] = [];
    entry.unsubscribe = () => subscriptions.forEach(unsubscribe => unsubscribe());
    this.diagnostic({ type: carried?'transfer_in':'allocation', publicationId: item.publicationId, livePlayers: this.entries.size });
    try {
      subscriptions.push(player.subscribe((status, error) => this.statusChanged(entry, status, 'native_error', error)));
      if (player.subscribePlaying) subscriptions.push(player.subscribePlaying(playing => {
        if (!this.owns(entry)) return;
        if (playing && (!this.isActive(entry) || !this.eligible())) {
          const actuallyPlaying = player.isPlaying?.() ?? true;
          entry.playRequested = false;
          player.setMuted(true);
          player.pause();
          if (actuallyPlaying) this.diagnostic({ type: 'unexpected_playback', publicationId: item.publicationId,
            activation: this.state.activation, selectedPublicationId: this.state.publicationId,
            appActive: this.state.appActive, screenEligible:this.state.screenEligible, scrolling: this.state.scrolling, userPaused: this.state.userPaused,
            reason: this.isActive(entry) ? 'ineligible' : 'nonselected' });
          return;
        }
        if (this.isActive(entry)) {
          if (playing) this.observedPlayback();
          this.diagnostic({ type: 'playing', activation: this.state.activation,
            publicationId: item.publicationId, playing });
        }
      }));
      if (player.subscribeProgress) subscriptions.push(player.subscribeProgress(currentTime => {
        // Keep clock advancement independent of the view's first-frame callback:
        // a missing presentation event must not hide otherwise-running playback.
        if (this.isActive(entry) && this.eligible() && currentTime > 0) {
          if (currentTime >= 0.05) this.observedPlayback();
          this.diagnostic({ type: 'progress', activation: this.state.activation, publicationId: item.publicationId, currentTime });
        }
      }));
    } catch (error) {
      this.drop(entry);
      this.diagnostic({ type: 'error', publicationId: item.publicationId,
        activation: this.item?.publicationId === item.publicationId ? this.state.activation : undefined,
        failureKind: 'player_allocation', allocationFailure: 'native_creation', ...playerErrorDetails(error) });
      return;
    }
    if(carried)return;
    // A native bridge call may throw before returning its promise.
    try {
      this.diagnostic({ type: 'load_started', publicationId: item.publicationId });
      void player.load(item.playbackUrl!).then(() => {
        if (this.owns(entry)) {
          entry.loadResolved = true;
          this.diagnostic({ type: 'load_resolved', publicationId: item.publicationId });
          this.statusChanged(entry, player.status());
        }
      }).catch(error => { this.statusChanged(entry, 'error', 'source_load', error); });
    } catch (error) { this.statusChanged(entry, 'error', 'source_load', error); }
  }

  private fillWindow() {
    if (this.disposed) return;
    const allowed = this.desired.filter(item => item.playbackUrl &&
      ((this.state.appActive && this.state.screenEligible) || item.publicationId === this.item?.publicationId));
    const desiredIds = new Map(allowed.map(item => [item.publicationId, item]));
    // Trim before allocation, including during a multi-item fling or source retry.
    for (const entry of [...this.entries.values()]) {
      if (!sameSource(desiredIds.get(entry.item.publicationId),entry.item)) this.drop(entry);
    }
    const active = this.current();
    for (const item of allowed) {
      if (this.entries.has(item.publicationId)) continue;
      if (item.publicationId !== this.item?.publicationId && this.item?.playbackUrl &&
        (active?.status ?? this.current()?.status) !== 'readyToPlay') continue;
      if (this.entries.size >= 3) break;
      this.createEntry(item);
    }
    this.syncActive();
  }

  private activate(item: FeedVideoItem | null, desired: FeedVideoItem[], force = false) {
    if (this.disposed) return;
    if(this.pendingRestore && this.pendingRestore.publicationId!==item?.publicationId) {
      this.clearRestore();this.publish({restoring:false,restoreError:null});
    }
    if(!this.pendingRestore && (this.state.publicationId!==item?.publicationId || force))this.publish({restoring:false,restoreError:null});
    this.desired = [...new Map(desired.map(row => [row.publicationId, row])).values()].slice(0, 3);
    if (!force && sameSource(this.item,item)) {
      this.fillWindow();
      return;
    }
    this.abandonSeek();
    for (const entry of this.entries.values()) { this.requestPlayback(entry, false); entry.player.setMuted(true); }
    const existing = item ? this.entries.get(item.publicationId) : undefined;
    const reusable = sameSource(existing?.item,item) ? existing : undefined;
    const bufferedSeconds = reusable?.player.bufferedSeconds?.() ?? 0;
    // Revisited videos seek to zero; classify them conservatively as cold.
    const prepared = !force && Boolean(reusable && !reusable.selectedBefore && !reusable.failed &&
      reusable.status === 'readyToPlay' && bufferedSeconds > 0);
    if (force && existing) this.drop(existing);
    this.item = item;
    const activation = this.state.activation + 1;
    this.publish({ publicationId: item?.publicationId ?? null, activation, player: null,
      status: 'idle', hasFrame: false, playbackStarted: false, failed: false, userPaused: this.pendingRestore?.userPaused??false, prepared });
    if (item) this.diagnostic({ type: 'selection', publicationId: item.publicationId, activation,
      prepared, bufferedSeconds: Math.max(0, bufferedSeconds) });
    if (!force && reusable?.selectedBefore && !this.pendingRestore) reusable.player.seekToStart();
    this.fillWindow();
    const selected = this.current();
    if (selected) selected.selectedBefore = true;
    if (this.state.failed || (item && !item.playbackUrl)) {
      this.diagnostic({ type: 'error', publicationId: this.state.publicationId, activation,
        failureKind: item && !item.playbackUrl ? 'unavailable_media' : 'source_load' });
    }
  }

  select = (item: FeedVideoItem | null, force = false) => {
    this.activate(item, item ? [item] : [], force);
  };
  selectAt = (items: FeedVideoItem[], index: number,canLoad?:(item:FeedVideoItem)=>boolean) => {
    const item = items[index] ?? null;
    const desired = item ? [item, items[index + 1], items[index - 1]].filter((row): row is FeedVideoItem => Boolean(row)&&(!canLoad||canLoad(row))) : [];
    this.activate(item, desired);
  };
  setAppActive = (appActive: boolean) => {
    if (this.disposed) return;
    this.publish({ appActive });
    if(!appActive)this.interruptSeek();
    this.diagnostic({ type: 'lifecycle', activation: this.state.activation, active: appActive });
    this.fillWindow();
  };
  setScreenEligible = (screenEligible: boolean) => {
    if (this.disposed) return;
    if(this.state.screenEligible===screenEligible)return;
    this.publish({screenEligible});
    if(!screenEligible)this.interruptSeek();
    this.diagnostic({type:'eligibility',activation:this.state.activation,screenEligible});
    this.fillWindow();
  };
  setScrolling = (scrolling: boolean) => {
    if (this.disposed) return;
    if (this.state.scrolling === scrolling) return;
    this.publish({ scrolling });
    if(scrolling)this.interruptSeek();
    this.reconcile();
  };
  togglePause = () => {
    if (this.disposed||this.state.seekPhase!=='idle') return;
    this.publish({ userPaused: !this.state.userPaused });
    this.reconcile();
  };
  setMuted = (muted: boolean) => {
    if (this.disposed) return;
    this.publish({ muted });
    this.reconcile();
  };
  toggleMute = () => { this.setMuted(!this.state.muted); };
  firstFrame = (activation: number) => {
    if (this.disposed) return;
    if (this.state.activation === activation && !this.state.hasFrame && this.state.player) {
      this.publish({ hasFrame: true });
      this.trace?.mark('first_frame');if(!this.state.restoring&&this.state.entryPresented)this.trace?.finish('ready');
      this.watchStartup();
      this.diagnostic({ type: 'first_frame', publicationId: this.state.publicationId, activation });
    }
  };
  fail = (activation: number) => {
    if (this.disposed) return;
    if (this.state.activation !== activation) return;
    const entry = this.current();
    if (entry) { entry.failed = true; entry.status = 'error'; }
    this.publish({ failed: true, status: 'error' });
    this.diagnostic({ type: 'error', publicationId: this.state.publicationId, activation, failureKind: 'startup_timeout' });
    this.reconcile();
  };
  presentEntry = () => {if(this.disposed||this.state.entryPresented)return;this.publish({entryPresented:true});this.trace?.mark('entry_revealed');this.trace?.finish('ready');this.reconcile();};
  failEntry = () => {
    if(this.disposed||this.state.entryPresented||this.state.failed)return;
    const entry=this.current();if(entry){entry.failed=true;entry.status='error';}
    this.publish({failed:true,status:'error'});this.trace?.finish('failed');
    this.diagnostic({type:'error',publicationId:this.state.publicationId,activation:this.state.activation,failureKind:'entry_readiness'});this.reconcile();
  };
  recoverFailed = (canLoad?:(item:FeedVideoItem)=>boolean) => {
    if(this.disposed||!this.state.failed||!this.item)return false;
    const wasEligible=this.state.screenEligible,restore=this.capture(),items=this.desired.filter(i=>!canLoad||canLoad(i));
    this.activate(this.item,items,true);this.restoreAt(items,0,restore,canLoad);this.setScreenEligible(wasEligible);return true;
  };
  retry = () => { this.activate(this.item, this.desired, true); };
  handOff = ():PlayerHandoff<P>|undefined => {
    const entry=this.current();
    if(this.disposed || !entry || entry.failed || entry.status!=='readyToPlay' || !entry.loadResolved || this.state.restoring || this.state.restoreError || !entry.item.productionUlid)return;
    this.setScreenEligible(false);
    for(const other of [...this.entries.values()])if(other!==entry)this.drop(other);
    entry.unsubscribe();this.entries.delete(entry.item.publicationId);
    const handoff=new PlayerHandoff(entry.item,entry.player,this.diagnostic);
    // The parked lease still belongs to this diagnostic session until consumed/released.
    this.dispose();return handoff;
  };
  dispose = () => {
    if (this.disposed) return;
    this.disposed = true;this.trace?.finish('interrupted');
    this.clearStartupTimer();
    this.clearRestore();
    this.abandonSeek();
    this.handoff?.dispose();this.handoff=undefined;
    for (const entry of [...this.entries.values()]) this.drop(entry);
    this.item = null;
    this.desired = [];
    this.publish({ player: null, publicationId: null, activation: this.state.activation + 1,
      hasFrame: false, playbackStarted: false, status: 'idle', failed: false, livePlayers: 0 });
  };
}
