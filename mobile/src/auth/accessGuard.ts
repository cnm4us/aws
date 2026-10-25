import { ApiError } from '../api/client';
import { VerifiedRefresh, verificationClock } from './verifiedRefresh';

export type AccessSnapshot = { authorized: boolean; checking: boolean; error: string | null };
// Context/foreground replacement and deadline expiry discard late responses.
export class AccessGuard {
  private state: AccessSnapshot = { authorized: false, checking: false, error: null };
  private refresh: VerifiedRefresh<boolean>;
  constructor(verify: (signal: AbortSignal) => Promise<void|{verifiedAt:number}>, onDenied: (error: ApiError) => void,
    now = verificationClock) {
    this.refresh = new VerifiedRefresh(async signal => {
      const startedAt = now(),result=await verify(signal); return { value: true, verifiedAt:result?.verifiedAt??startedAt };
    }, { protected: true, now, onError: error => {
      if (error instanceof ApiError && [401, 403, 404].includes(error.status ?? 0)) onDenied(error);
    } });
    this.refresh.subscribe(() => {
      const current = this.refresh.getSnapshot();
      this.state = { authorized: current.value === true, checking: current.checking, error: current.error?.message ?? null };
    });
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => this.refresh.subscribe(listener);
  setActive = (active: boolean) => this.refresh.setActive(active, true);
  check = () => this.refresh.refresh();
  dispose = () => this.refresh.dispose();
}
