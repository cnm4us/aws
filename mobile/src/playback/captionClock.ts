type ClockSource = {
  currentTime: number;
  timeUpdateEventInterval: number;
  addListener(event: 'timeUpdate', listener: (payload: { currentTime: number }) => void): { remove(): void };
};
// The sole adapter owner of the event interval; independent of diagnostics/__DEV__.
export function createCaptionClock(source: ClockSource, diagnosticInterval: number) {
  const listeners = new Set<(time: number) => void>();
  let disposed = false, subscription: { remove(): void } | null = null;
  const close = () => { subscription?.remove(); subscription = null; };
  return {
    subscribe: (listener: (time: number) => void) => {
      if (disposed) return () => {};
      listeners.add(listener);
      try {
        if (!subscription) {
          source.timeUpdateEventInterval = .25;
          subscription = source.addListener('timeUpdate', ({ currentTime }) => {
            if (!disposed) for (const callback of listeners) callback(currentTime);
          });
        }
        listener(source.currentTime);
      } catch (error) {
        listeners.delete(listener);
        if (!listeners.size) { close(); if (!disposed) source.timeUpdateEventInterval = diagnosticInterval; }
        throw error;
      }
      return () => {
        listeners.delete(listener);
        if (!disposed && !listeners.size) { close(); source.timeUpdateEventInterval = diagnosticInterval; }
      };
    },
    dispose: () => { disposed = true; close(); listeners.clear(); },
  };
}
