import type { FeedVideoItem } from '../feed/types';
import type { PlaybackDiagnosticEvent } from '../diagnostics/playbackDiagnostics';

export type PlaybackStatus = 'idle' | 'loading' | 'readyToPlay' | 'error';
export interface PlayerPort {
  load(url: string): Promise<void>;
  play(): void;
  pause(): void;
  setMuted(muted: boolean): void;
  seekToStart(): void;
  release(): void;
  status(): PlaybackStatus;
  bufferedSeconds?(): number;
  isPlaying?(): boolean;
  subscribe(listener: (status: PlaybackStatus) => void): () => void;
  subscribePlaying?(listener: (playing: boolean) => void): () => void;
  subscribeProgress?(listener: (seconds: number) => void): () => void;
}

export type PlaybackSnapshot<P> = {
  publicationId: number | null;
  activation: number;
  player: P | null;
  status: PlaybackStatus;
  hasFrame: boolean;
  failed: boolean;
  userPaused: boolean;
  muted: boolean;
  appActive: boolean;
  scrolling: boolean;
  livePlayers: number;
  prepared: boolean;
};

type Entry<P> = {
  item: FeedVideoItem; player: P; unsubscribe: () => void;
  status: PlaybackStatus; failed: boolean; selectedBefore: boolean;
  readyOnce: boolean; playRequested: boolean;
};

// Owns at most previous/current/next. Only the selected entry may play.
export class PlaybackCoordinator<P extends PlayerPort> {
  private state: PlaybackSnapshot<P> = {
    publicationId: null, activation: 0, player: null, status: 'idle', hasFrame: false,
    failed: false, userPaused: false, muted: true, appActive: false, scrolling: false,
    livePlayers: 0, prepared: false,
  };
  private item: FeedVideoItem | null = null;
  private desired: FeedVideoItem[] = [];
  private entries = new Map<number, Entry<P>>();
  private listeners = new Set<() => void>();

  constructor(private readonly createPlayer: () => P,
    private readonly diagnostic: (event: PlaybackDiagnosticEvent) => void = () => {}, initialMuted = true) {
    this.state = { ...this.state, muted: initialMuted };
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
    return this.state.appActive && !this.state.scrolling && !this.state.userPaused && !this.state.failed;
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
    entry.player.pause();
    entry.player.release();
    this.diagnostic({ type: 'release', publicationId: entry.item.publicationId, livePlayers: this.entries.size });
  }

  private reconcile() {
    for (const entry of this.entries.values()) {
      const active = this.isActive(entry);
      entry.player.setMuted(active ? this.state.muted : true);
      // iOS also reports loading while seeking/rebuffering. Pausing then cancels
      // playback intent and can strand the selected source waiting for readiness.
      const canPlay = entry.status === 'readyToPlay' || (entry.readyOnce && entry.status === 'loading');
      this.requestPlayback(entry, active && this.eligible() && canPlay);
    }
  }

  private syncActive() {
    const entry = this.current();
    this.publish({
      player: entry?.player ?? null,
      status: entry?.status ?? (this.item?.playbackUrl ? 'error' : 'idle'),
      failed: entry?.failed ?? Boolean(this.item?.playbackUrl),
      livePlayers: this.entries.size,
    });
    this.reconcile();
  }

  private statusChanged(entry: Entry<P>, status: PlaybackStatus,
    failureKind: 'native_error' | 'source_load' = 'native_error') {
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
    });
    if (this.isActive(entry)) {
      this.syncActive();
      if (changed && status === 'readyToPlay') this.fillWindow();
    }
  }

  private createEntry(item: FeedVideoItem) {
    let player: P;
    try { player = this.createPlayer(); }
    catch { return; }
    const entry: Entry<P> = { item, player, unsubscribe: () => {}, status: 'loading', failed: false,
      selectedBefore: false, readyOnce: false, playRequested: false };
    this.entries.set(item.publicationId, entry);
    const subscriptions = [player.subscribe(status => this.statusChanged(entry, status))];
    if (player.subscribePlaying) subscriptions.push(player.subscribePlaying(playing => {
      if (!this.owns(entry)) return;
      if (playing && (!this.isActive(entry) || !this.eligible())) {
        const actuallyPlaying = player.isPlaying?.() ?? true;
        entry.playRequested = false;
        player.pause();
        if (actuallyPlaying) this.diagnostic({ type: 'unexpected_playback', publicationId: item.publicationId,
          activation: this.state.activation, selectedPublicationId: this.state.publicationId,
          appActive: this.state.appActive, scrolling: this.state.scrolling, userPaused: this.state.userPaused,
          reason: this.isActive(entry) ? 'ineligible' : 'nonselected' });
        return;
      }
      if (this.isActive(entry)) this.diagnostic({ type: 'playing', activation: this.state.activation,
        publicationId: item.publicationId, playing });
    }));
    if (player.subscribeProgress) subscriptions.push(player.subscribeProgress(currentTime => {
      if (this.isActive(entry) && this.eligible() && this.state.hasFrame && currentTime > 0) {
        this.diagnostic({ type: 'progress', activation: this.state.activation, publicationId: item.publicationId, currentTime });
      }
    }));
    entry.unsubscribe = () => subscriptions.forEach(unsubscribe => unsubscribe());
    this.diagnostic({ type: 'allocation', publicationId: item.publicationId, livePlayers: this.entries.size });
    void player.load(item.playbackUrl!).then(() => {
      if (this.owns(entry)) this.statusChanged(entry, player.status());
    }).catch(() => { this.statusChanged(entry, 'error', 'source_load'); });
  }

  private fillWindow() {
    const allowed = this.desired.filter(item => item.playbackUrl &&
      (this.state.appActive || item.publicationId === this.item?.publicationId));
    const desiredIds = new Map(allowed.map(item => [item.publicationId, item]));
    // Trim before allocation, including during a multi-item fling or source retry.
    for (const entry of [...this.entries.values()]) {
      if (desiredIds.get(entry.item.publicationId)?.playbackUrl !== entry.item.playbackUrl) this.drop(entry);
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
    this.desired = [...new Map(desired.map(row => [row.publicationId, row])).values()].slice(0, 3);
    if (!force && this.item?.publicationId === item?.publicationId && this.item?.playbackUrl === item?.playbackUrl) {
      this.fillWindow();
      return;
    }
    for (const entry of this.entries.values()) { this.requestPlayback(entry, false); entry.player.setMuted(true); }
    const existing = item ? this.entries.get(item.publicationId) : undefined;
    const reusable = existing?.item.playbackUrl === item?.playbackUrl ? existing : undefined;
    const bufferedSeconds = reusable?.player.bufferedSeconds?.() ?? 0;
    // Revisited videos seek to zero; classify them conservatively as cold.
    const prepared = !force && Boolean(reusable && !reusable.selectedBefore && !reusable.failed &&
      reusable.status === 'readyToPlay' && bufferedSeconds > 0);
    if (force && existing) this.drop(existing);
    this.item = item;
    const activation = this.state.activation + 1;
    this.publish({ publicationId: item?.publicationId ?? null, activation, player: null,
      status: 'idle', hasFrame: false, failed: false, userPaused: false, prepared });
    if (item) this.diagnostic({ type: 'selection', publicationId: item.publicationId, activation,
      prepared, bufferedSeconds: Math.max(0, bufferedSeconds) });
    if (!force && reusable?.selectedBefore) reusable.player.seekToStart();
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
  selectAt = (items: FeedVideoItem[], index: number) => {
    const item = items[index] ?? null;
    const desired = item ? [item, items[index + 1], items[index - 1]].filter((row): row is FeedVideoItem => Boolean(row)) : [];
    this.activate(item, desired);
  };
  setAppActive = (appActive: boolean) => {
    this.publish({ appActive });
    this.diagnostic({ type: 'lifecycle', activation: this.state.activation, active: appActive });
    this.fillWindow();
  };
  setScrolling = (scrolling: boolean) => {
    if (this.state.scrolling === scrolling) return;
    this.publish({ scrolling });
    this.reconcile();
  };
  togglePause = () => {
    this.publish({ userPaused: !this.state.userPaused });
    this.reconcile();
  };
  setMuted = (muted: boolean) => {
    this.publish({ muted });
    this.reconcile();
  };
  toggleMute = () => { this.setMuted(!this.state.muted); };
  firstFrame = (activation: number) => {
    if (this.state.activation === activation && !this.state.hasFrame && this.state.player) {
      this.publish({ hasFrame: true });
      this.diagnostic({ type: 'first_frame', publicationId: this.state.publicationId, activation });
    }
  };
  fail = (activation: number) => {
    if (this.state.activation !== activation) return;
    const entry = this.current();
    if (entry) { entry.failed = true; entry.status = 'error'; }
    this.publish({ failed: true, status: 'error' });
    this.diagnostic({ type: 'error', publicationId: this.state.publicationId, activation, failureKind: 'startup_timeout' });
    this.reconcile();
  };
  retry = () => { this.activate(this.item, this.desired, true); };
  dispose = () => {
    for (const entry of [...this.entries.values()]) this.drop(entry);
    this.item = null;
    this.desired = [];
    this.publish({ player: null, publicationId: null, activation: this.state.activation + 1,
      hasFrame: false, status: 'idle', failed: false, livePlayers: 0 });
  };
}
