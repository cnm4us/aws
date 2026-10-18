export const PLAYBACK_PREFERENCES_KEY = 'video-feed-poc:playback-preferences:v1';

export interface PreferenceStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export type PlaybackPreferencesSnapshot = {
  ready: boolean;
  startMuted: boolean;
  muted: boolean;
  saving: boolean;
  error: string | null;
};

// Owned above refresh-created feed sessions. Only the startup default is persisted.
export class PlaybackPreferences {
  private state: PlaybackPreferencesSnapshot = {
    ready: false, startMuted: false, muted: false, saving: false, error: null,
  };
  private listeners = new Set<() => void>();
  private loading: Promise<void> | null = null;

  constructor(private readonly storage: PreferenceStorage) {}

  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  private publish(patch: Partial<PlaybackPreferencesSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach(listener => listener());
  }

  hydrate = () => {
    if (!this.loading) this.loading = this.read();
    return this.loading;
  };

  private async read() {
    try {
      const raw = await this.storage.getItem(PLAYBACK_PREFERENCES_KEY);
      let startMuted = false;
      if (raw !== null) {
        const saved: unknown = JSON.parse(raw);
        if (!saved || typeof saved !== 'object' ||
          !('version' in saved) || saved.version !== 1 ||
          !('startMuted' in saved) || typeof saved.startMuted !== 'boolean') {
          throw new Error('Invalid preference');
        }
        startMuted = saved.startMuted;
      }
      this.publish({ ready: true, startMuted, muted: startMuted });
    } catch {
      this.publish({ ready: true, error: 'Your saved sound preference could not be loaded. Videos will start unmuted.' });
    }
  }

  toggleMute = () => {
    if (this.state.ready) this.publish({ muted: !this.state.muted });
  };

  setStartMuted = async (startMuted: boolean) => {
    if (!this.state.ready || this.state.saving) return false;
    this.publish({ saving: true, error: null });
    try {
      await this.storage.setItem(PLAYBACK_PREFERENCES_KEY, JSON.stringify({ version: 1, startMuted }));
      this.publish({ startMuted, saving: false });
      return true;
    } catch {
      this.publish({ saving: false, error: 'Your sound preference could not be saved. Please try again.' });
      return false;
    }
  };
}
