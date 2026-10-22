import type { PreferenceStorage } from './playbackPreferences';
export const CAPTION_PREFERENCES_KEY = 'video-feed-poc:caption-preferences:v1';
export class CaptionPreferences {
  private state = { ready: false, enabled: false, saving: false, error: null as string | null };
  private listeners = new Set<() => void>();
  private hydration: Promise<void> | null = null;
  private serial = 0;
  private queue: Promise<void> = Promise.resolve();
  constructor(private readonly storage: PreferenceStorage) {}
  getSnapshot = () => this.state;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; };
  private publish(patch: Partial<typeof this.state>) { this.state = { ...this.state, ...patch }; this.listeners.forEach(fn => fn()); }
  hydrate = () => this.hydration ??= (async () => {
    try {
      const raw = await this.storage.getItem(CAPTION_PREFERENCES_KEY);
      const saved = raw === null ? { version: 1, enabled: false } : JSON.parse(raw);
      if (saved?.version !== 1 || typeof saved.enabled !== 'boolean') throw Error('invalid');
      this.publish({ ready: true, enabled: saved.enabled });
    } catch { this.publish({ ready: true, enabled: false, error: 'Saved captions could not be loaded. Captions start off.' }); }
  })();
  setEnabled = (enabled: boolean) => {
    if (!this.state.ready) return Promise.resolve();
    const serial = ++this.serial;
    this.publish({ enabled, saving: true, error: null });
    this.queue = this.queue.then(async () => {
      try {
        await this.storage.setItem(CAPTION_PREFERENCES_KEY, JSON.stringify({ version: 1, enabled }));
        if (serial === this.serial) this.publish({ saving: false });
      } catch { if (serial === this.serial) this.publish({ saving: false, error: 'Captions changed for this visit, but could not be saved. Try again.' }); }
    });
    return this.queue;
  };
  toggle = () => this.setEnabled(!this.state.enabled);
  retry = () => this.setEnabled(this.state.enabled);
}
