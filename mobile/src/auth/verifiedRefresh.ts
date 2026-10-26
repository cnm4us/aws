import { ApiError } from '../api/client';
export type Verified<T> = { value: T; verifiedAt: number };
export type RefreshSnapshot<T> = { value: T | undefined; checking: boolean; error: Error | null };
export const verificationClock = () => performance.now();

// Renew before the deadline without discarding current authority. A pending or
// late response cannot extend that authority; foreground/retry starts afresh.
export class VerifiedRefresh<T> {
  private state: RefreshSnapshot<T> = { value: undefined, checking: false, error: null };
  private active = false;
  private generation = 0;
  private request: AbortController | null = null;
  private pending: Promise<boolean> | null = null;
  private renewTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  private deadline: number | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly load: (signal: AbortSignal, force: boolean) => Promise<Verified<T>>,
    private readonly options: { protected: boolean; retainOnTransientError?:boolean; now?: () => number; onError?: (error: Error) => void }) {}
  private now = () => (this.options.now ?? verificationClock)();
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: RefreshSnapshot<T>) { this.state = state; this.listeners.forEach(listener => listener()); }
  private clearTimers() { clearTimeout(this.renewTimer); clearTimeout(this.expiryTimer); this.deadline = null; }
  private cancel() { this.generation++; this.request?.abort(); this.pending = null; this.clearTimers(); }
  private fail(error: Error) {
    this.cancel(); this.publish({ value: undefined, checking: false, error }); this.options.onError?.(error);
  }
  private expire = () => this.fail(new Error('Access verification expired. Reconnect and try again.'));
  private setDeadline(at: number) {
    clearTimeout(this.expiryTimer); this.deadline = at;
    this.expiryTimer = setTimeout(this.expire, Math.max(0, at - this.now()));
  }
  setActive = (active: boolean, force = false) => {
    if (this.active === active) return;
    this.active = active;
    if (active) void this.refresh(false, force);
    else { this.cancel(); this.publish({ value: undefined, checking: false, error: null }); }
  };
  refresh = (quiet = false, force = true): Promise<boolean> => {
    if (!this.active) return Promise.resolve(false);
    // Explicit Refresh/Retry also blocks when a routine renewal is in flight.
    if (this.pending) {
      if (!quiet) this.publish({ value: undefined, checking: true, error: null });
      return this.pending;
    }
    if (quiet && this.deadline !== null && this.now() >= this.deadline) {
      this.expire(); return Promise.resolve(false);
    }
    const generation = ++this.generation, request = new AbortController(), startedAt = this.now();
    this.request = request; clearTimeout(this.renewTimer);
    const retain = quiet && this.state.value !== undefined;
    if (!retain && this.options.protected) this.setDeadline(startedAt + 60_000);
    this.publish({ value: retain ? this.state.value : undefined, checking: true, error: null });
    let pending!: Promise<boolean>;
    pending = (async () => {
      await Promise.resolve();
      try {
        const result = await this.load(request.signal, force);
        if (generation !== this.generation || !this.active || request.signal.aborted) return false;
        // Check age again on completion in case the event loop delayed expiry.
        const now = this.now();
        if (this.options.protected && (now >= (this.deadline ?? Infinity) || now - result.verifiedAt >= 60_000 || result.verifiedAt > now)) {
          this.expire(); return false;
        }
        this.clearTimers();
        if (this.options.protected) this.setDeadline(result.verifiedAt + 60_000);
        this.publish({ value: result.value, checking: false, error: null });
        this.renewTimer = setTimeout(() => { void this.refresh(true); },
          this.options.protected ? Math.max(0, result.verifiedAt + 45_000 - now) : 60_000);
        return true;
      } catch (error) {
        if (generation !== this.generation || !this.active || request.signal.aborted) return false;
        const failure=error instanceof Error?error:new Error('Cannot verify access. Reconnect and try again.');
        const definite=error instanceof ApiError&&[401,403,404].includes(error.status??0);
        if(this.options.retainOnTransientError&&quiet&&this.state.value!==undefined&&!definite&&this.deadline!==null&&this.now()<this.deadline){
          this.publish({...this.state,checking:false,error:null});
          const retry=error instanceof ApiError?(error.retryAfterSeconds??0)*1000:0;
          this.renewTimer=setTimeout(()=>{void this.refresh(true);},Math.max(5000,retry));
        }else this.fail(failure);
        return false;
      } finally { if (this.pending === pending) this.pending = null; }
    })();
    this.pending = pending; return pending;
  };
  dispose = () => { this.setActive(false); this.listeners.clear(); };
}
