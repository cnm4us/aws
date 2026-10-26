import type { FeedVideoItem } from '../feed/types';
import type { PlayerPort } from './coordinator';
import type { NativeReadinessEvidence } from './readinessEvidence';

export type ProbeOptions = { seconds: number; paused: boolean; muted: boolean; mode: 'inline' | 'native-modal'; automatic?:boolean };
type Phase = 'idle' | 'loading' | 'preparing' | 'ready' | 'revealed' | 'finished' | 'failed' | 'cancelled';
export type ProbeRecord = {
  attempt: string; options: ProbeOptions; publicationId?: number; targetSeconds?: number;
  stages: Partial<Record<'subject_ready' | 'source_ready' | 'first_frame' | 'target_decoded' | 'revealed' | 'playing' | 'advancing' | 'ended', number>>;
  native?: NativeReadinessEvidence; nativeFailureCode?: string; viewport?: {width: number; height: number}; outcome?: string; observedSeconds?: number; userConfirmed?: boolean;
};
type Dependencies<P> = {
  loadSubject(signal: AbortSignal): Promise<FeedVideoItem>;
  authorized(item: FeedVideoItem): boolean;
  current(): boolean;
  create(): P;
  prepare(player: P, attempt: string, seconds: number): Promise<NativeReadinessEvidence>;
  cancel(attempt: string): void;
  resource(delta: 1 | -1): void;
  now?: () => number;
};
let serial = 0;

// Internal diagnostic owner only. Main feed playback never uses this gate.
export class ReadinessProbe<P extends PlayerPort> {
  private state = { phase: 'idle' as Phase, player: null as P | null, record: null as ProbeRecord | null, error: null as string | null };
  private listeners = new Set<() => void>();
  private request: AbortController | null = null;
  private item: FeedVideoItem | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private unsubscribe: Array<() => void> = [];
  private started = 0;
  private preparing = false;
  private disposed = false;
  private presented = false;
  private history: ProbeRecord[] = [];
  constructor(private deps: Dependencies<P>) {}
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private now = () => this.deps.now?.() ?? performance.now();
  private publish(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  private stage(name: keyof ProbeRecord['stages']) {
    const record = this.state.record;
    if (record && record.stages[name] === undefined) this.publish({ record: { ...record, stages: { ...record.stages, [name]: this.now() - this.started } } });
  }
  private owns = (attempt: string) => !this.disposed && this.state.record?.attempt === attempt && !!this.request && !this.request.signal.aborted;
  private valid = () => this.deps.current() && !!this.item && this.deps.authorized(this.item);
  start = async (options: ProbeOptions) => {
    if (this.disposed || !this.deps.current()) return;
    if (!Number.isFinite(options.seconds) || options.seconds < 0) return;
    this.end('cancelled', 'superseded');
    const attempt = `readiness-${++serial}`, request = new AbortController();
    this.request = request; this.item = null; this.started = this.now(); this.preparing = false; this.presented = false;
    this.publish({ phase: 'loading', player: null, error: null, record: { attempt, options: { ...options }, stages: {} } });
    this.timer = setInterval(() => {
      if (!this.owns(attempt)) return;
      if (!this.deps.current() || this.item && !this.valid()) { this.end('cancelled', 'authority_or_lifecycle_changed'); return; }
      if (this.state.phase !== 'revealed' && this.now() - this.started >= 20000) { this.end('failed', 'Preparation timed out.'); return; }
      if (this.presented) {
        const seconds = this.state.player?.currentTime?.();
        if (seconds !== undefined && Number.isFinite(seconds)) {
          const target = this.state.record?.targetSeconds ?? 0;
          if (seconds - target > 0.1) this.stage('advancing');
        }
      }
    }, 100);
    try {
      const item = await this.deps.loadSubject(request.signal);
      if (!this.owns(attempt)) return;
      this.item = item;
      if (!this.valid() || !item.playbackUrl) { this.end('failed', 'Public video is no longer available.'); return; }
      this.publish({ record: { ...this.state.record!, publicationId: item.publicationId } }); this.stage('subject_ready');
      const player = this.deps.create(); this.publish({ player }); this.deps.resource(1);
      player.pause(); player.setMuted(true);
      this.unsubscribe.push(player.subscribe(status => {
        if (!this.owns(attempt)) return;
        if (status === 'error') this.end('failed', 'Cannot load the check video.');
        else if (status === 'readyToPlay') void this.prepare(attempt);
      }));
      if (player.subscribePlaying) this.unsubscribe.push(player.subscribePlaying(playing => {
        if (!this.owns(attempt) || !playing) return;
        if (!this.presented || this.state.record?.options.paused) { this.end('failed', 'Unexpected playback while covered or paused.'); return; }
        this.stage('playing');
      }));
      this.publish({ phase: 'preparing' });
      await player.load(item.playbackUrl);
      if (this.owns(attempt) && player.status() === 'readyToPlay') void this.prepare(attempt);
    } catch { if (this.owns(attempt)) this.end('failed', 'Cannot prepare the check video.'); }
  };
  private async prepare(attempt: string) {
    const player = this.state.player;
    if (this.preparing || !player || !this.owns(attempt)) return;
    if (!this.valid()) { this.end('cancelled', 'authority_changed'); return; }
    this.preparing = true; this.stage('source_ready');
    const duration = player.durationSeconds?.();
    const requested = this.state.record!.options.seconds;
    const target = duration && Number.isFinite(duration) && duration > 0 ? Math.min(requested, Math.max(0, duration - .1)) : requested;
    this.publish({ record: { ...this.state.record!, targetSeconds: target } });
    try {
      const native = await this.deps.prepare(player, attempt, target);
      if (!this.owns(attempt)) return;
      if (!this.valid()) { this.end('cancelled', 'authority_changed'); return; }
      // Never accept evidence for another seek or an old decoded frame.
      if (native.attempt !== attempt || native.kind !== 'target_decoded' || native.targetSeconds !== target ||
        ![native.timelineSeconds, native.decodedFrameSeconds, native.seekCompletedMs, native.decodedFrameMs].every(Number.isFinite) ||
        Math.abs(native.decodedFrameSeconds - target) > .1 || Math.abs(native.timelineSeconds - target) > .1 ||
        native.seekCompletedMs < 0 || native.decodedFrameMs < native.seekCompletedMs ||
        !Number.isSafeInteger(native.width) || !Number.isSafeInteger(native.height) || native.width <= 0 || native.height <= 0 || native.muted !== true || native.rate !== 0) {
        this.end('failed', 'Native evidence did not match the requested paused frame.'); return;
      }
      this.publish({ record: { ...this.state.record!, native } }); this.stage('target_decoded'); this.ready();
    } catch (error) {
      if (!this.owns(attempt)) return;
      const code = (error as {code?: unknown} | null)?.code;
      const allowed = ['PRECONDITION','SUPERSEDED','CANCELLED','BACKGROUND','DESTROYED','INVALIDATED','UNEXPECTED_PLAYBACK','SOURCE_FAILED','NATIVE_TIMEOUT','SEEK_INTERRUPTED'].map(value=>`ERR_READINESS_${value}`);
      this.publish({ record: { ...this.state.record!, nativeFailureCode: typeof code === 'string' && allowed.includes(code) ? code : 'native_adapter_error' } });
      this.end('failed', 'Native frame check failed or timed out.');
    }
  }
  firstFrame = (attempt: string) => {
    if (!this.owns(attempt) || !this.state.player) return;
    this.stage('first_frame'); this.ready();
  };
  viewport = (attempt: string, width: number, height: number) => {
    if (this.owns(attempt) && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
      this.publish({ record: { ...this.state.record!, viewport: {width,height} } });
  };
  private ready() {
    if (this.state.phase === 'preparing' && this.state.record?.native && this.state.record.stages.first_frame !== undefined && this.valid())
      this.publish({ phase: 'ready' });
  }
  reveal = () => {
    if (this.state.phase !== 'ready' || !this.valid()) { if (this.request) this.end('cancelled', 'authority_changed'); return; }
    this.publish({ phase: 'revealed' }); this.stage('revealed');
  };
  // Called by a layout effect only after the cover is gone and route focused.
  present = () => {
    if (this.state.phase !== 'revealed' || this.presented) return;
    if (!this.valid()) { this.end('cancelled', 'authority_changed'); return; }
    const player = this.state.player!; this.presented = true;
    player.setMuted(this.state.record!.options.muted);
    if (!this.state.record!.options.paused) player.play();
  };
  finish = (userConfirmed = false) => { this.end('finished', 'finished', userConfirmed); };
  cancel = () => { this.end('cancelled', 'cancelled'); };
  invalidate = () => { if (this.request && (!this.deps.current() || this.item && !this.valid())) this.end('cancelled', 'authority_or_lifecycle_changed'); };
  private end(phase: 'finished' | 'failed' | 'cancelled', reason: string, confirmed = false) {
    const request = this.request; if (!request) return;
    // Invalidate before touching promises/native state; no late result can reveal.
    this.request = null; request.abort();
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    const record = this.state.record!, player = this.state.player;
    this.deps.cancel(record.attempt);
    for (const fn of this.unsubscribe.splice(0)) fn();
    let seconds: number | undefined;
    try { seconds = player?.currentTime?.(); } catch {}
    if (player) { try { player.setMuted(true); player.pause(); } finally { player.release(); this.deps.resource(-1); } }
    const ended = { ...record, stages: { ...record.stages, ended: this.now() - this.started }, outcome: reason,
      ...(seconds !== undefined && Number.isFinite(seconds) ? { observedSeconds: seconds } : {}), userConfirmed: confirmed };
    this.history = [...this.history, ended].slice(-8);
    this.publish({ phase, player: null, record: ended, error: phase === 'failed' ? reason : null });
  }
  report = () => ({ schemaVersion: 1, kind: 'feed-readiness-feasibility', note: 'Native evidence proves seek completion and decoded target time, not pixels displayed by VideoView. Physical frame/audio confirmation is separate. Checks are excluded from ordinary playback transition performance.',
    history: [...this.history], active: this.request ? this.state.record : null });
  dispose = () => { this.end('cancelled', 'unmounted'); this.disposed = true; this.listeners.clear(); };
}
