export function settledIndex(offset: number, height: number, lastIndex: number) {
  if (!Number.isFinite(offset) || !Number.isFinite(height) || height <= 0) return 0;
  return Math.max(0, Math.min(lastIndex, Math.round(offset / height)));
}

type Schedule = (callback: () => void) => () => void;
const scheduleDefault: Schedule = callback => {
  const timer = setTimeout(callback, 150);
  return () => clearTimeout(timer);
};

// Momentum callbacks settle immediately; a scroll debounce handles drags with no momentum.
export class PagingController {
  private dragging = false;
  private momentum = false;
  private offset = 0;
  private height = 0;
  private lastIndex = 0;
  private cancelPending: (() => void) | null = null;

  constructor(private readonly moving: () => void, private readonly settled: (index: number) => void,
    private readonly schedule: Schedule = scheduleDefault) {}

  configure(height: number, lastIndex: number) { this.height = height; this.lastIndex = lastIndex; }
  private cancel() { this.cancelPending?.(); this.cancelPending = null; }
  private commit() {
    this.cancel();
    this.settled(settledIndex(this.offset, this.height, this.lastIndex));
  }
  private afterScroll() { this.cancel(); this.cancelPending = this.schedule(() => this.commit()); }
  beginDrag = () => { this.cancel(); this.dragging = true; this.momentum = false; this.moving(); };
  scroll = (offset: number) => {
    this.offset = offset;
    if (!this.dragging && !this.momentum) this.afterScroll();
  };
  endDrag = (offset: number) => { this.offset = offset; this.dragging = false; this.afterScroll(); };
  beginMomentum = () => { this.cancel(); this.momentum = true; this.moving(); };
  endMomentum = (offset: number) => { this.offset = offset; this.momentum = false; this.dragging = false; this.commit(); };
  beginProgrammatic = () => { this.moving(); this.afterScroll(); };
  dispose = () => this.cancel();
}
