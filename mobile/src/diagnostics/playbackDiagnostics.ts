export type PlaybackDiagnosticEvent = {
  type: 'allocation' | 'release' | 'selection' | 'ready' | 'first_frame' | 'error' | 'playing' | 'progress' | 'unexpected_playback' | 'lifecycle';
  publicationId?: number | null;
  activation?: number;
  prepared?: boolean;
  bufferedSeconds?: number;
  livePlayers?: number;
  playing?: boolean;
  currentTime?: number;
  active?: boolean;
  selectedPublicationId?: number | null;
  appActive?: boolean;
  scrolling?: boolean;
  userPaused?: boolean;
  reason?: 'nonselected' | 'ineligible';
  failureKind?: 'native_error' | 'source_load' | 'startup_timeout' | 'unavailable_media';
};

type EventRecord = PlaybackDiagnosticEvent & { atMs: number; session: number };
type Transition = {
  session: number; activation: number; publicationId: number;
  initial: boolean;
  selectedAtMs: number; prepared: boolean; bufferedSeconds: number;
  firstFrameMs: number | null; progressMs: number | null; error: boolean;
  playingObserved: boolean; interrupted: boolean;
};

function timings(values: number[]) {
  if (!values.length) return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, medianMs: sorted[Math.ceil(sorted.length / 2) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted[sorted.length - 1] };
}

// No network transport: counters and a bounded event history live only on the development device.
export class PlaybackDiagnostics {
  private events: EventRecord[] = [];
  private transitions: Transition[] = [];
  private liveBySession = new Map<number, number>();
  private allocations = 0;
  private releases = 0;
  private peakPlayers = 0;
  private nextSession = 0;
  private droppedEvents = 0;
  private droppedTransitions = 0;
  private unexpectedPlayback = 0;
  private issues: EventRecord[] = [];
  private droppedIssues = 0;

  constructor(private readonly clock: () => number = () => performance.now()) {}

  session() {
    const session = ++this.nextSession;
    return (event: PlaybackDiagnosticEvent) => this.record(session, event);
  }

  private record(session: number, event: PlaybackDiagnosticEvent) {
    const atMs = this.clock();
    this.events.push({ ...event, session, atMs });
    if (this.events.length > 1000) { this.events.shift(); this.droppedEvents++; }
    // Preserve errors and ownership violations even when frequent progress events roll out.
    if (event.type === 'error' || event.type === 'unexpected_playback') {
      this.issues.push({ ...event, session, atMs });
      if (this.issues.length > 10) { this.issues.shift(); this.droppedIssues++; }
    }
    if (event.type === 'allocation') this.allocations++;
    if (event.type === 'release') this.releases++;
    if (event.livePlayers !== undefined) {
      if (event.livePlayers === 0) this.liveBySession.delete(session);
      else this.liveBySession.set(session, event.livePlayers);
    }
    this.peakPlayers = Math.max(this.peakPlayers, [...this.liveBySession.values()].reduce((a, b) => a + b, 0));
    if (event.type === 'unexpected_playback') this.unexpectedPlayback++;
    if (event.type === 'selection' && event.publicationId != null && event.activation !== undefined) {
      this.transitions.push({ session, activation: event.activation, publicationId: event.publicationId,
        initial: !this.transitions.some(row => row.session === session),
        selectedAtMs: atMs, prepared: Boolean(event.prepared), bufferedSeconds: event.bufferedSeconds ?? 0,
        firstFrameMs: null, progressMs: null, error: false, playingObserved: false, interrupted: false });
      if (this.transitions.length > 200) { this.transitions.shift(); this.droppedTransitions++; }
    }
    const transition = this.transitions.findLast(row => row.session === session && row.activation === event.activation);
    if (!transition) return;
    if (event.type === 'first_frame' && transition.firstFrameMs === null) transition.firstFrameMs = atMs - transition.selectedAtMs;
    if (event.type === 'progress' && transition.progressMs === null) transition.progressMs = atMs - transition.selectedAtMs;
    if (event.type === 'error') transition.error = true;
    if (event.type === 'playing' && event.playing) transition.playingObserved = true;
    if (event.type === 'lifecycle' && !event.active) transition.interrupted = true;
  }

  report() {
    const framed = this.transitions.filter(row => row.firstFrameMs !== null);
    const normal = this.transitions.filter(row => !row.initial);
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      clock: 'monotonic milliseconds',
      note: 'First frame measures presentation readiness. Review progress and playing evidence separately. Interrupted, incomplete, and failed transitions remain in the records.',
      resources: { allocations: this.allocations, releases: this.releases,
        livePlayers: [...this.liveBySession.values()].reduce((a, b) => a + b, 0), peakPlayers: this.peakPlayers,
        unexpectedPlayback: this.unexpectedPlayback },
      issues: this.issues.map(row => ({ ...row })), droppedIssues: this.droppedIssues,
      summary: { transitions: this.transitions.length, firstFrames: framed.length,
        incomplete: this.transitions.filter(row => row.firstFrameMs === null).length,
        errors: this.transitions.filter(row => row.error).length,
        prepared: this.transitions.filter(row => row.prepared).length,
        preparationRate: this.transitions.length ? this.transitions.filter(row => row.prepared).length / this.transitions.length : null,
        normalPreparationRate: normal.length ? normal.filter(row => row.prepared).length / normal.length : null,
        initialFrames: timings(framed.filter(row => row.initial).map(row => row.firstFrameMs!)),
        normalFrames: timings(framed.filter(row => !row.initial).map(row => row.firstFrameMs!)),
        all: timings(framed.map(row => row.firstFrameMs!)),
        preparedFrames: timings(framed.filter(row => row.prepared).map(row => row.firstFrameMs!)),
        coldFrames: timings(framed.filter(row => !row.prepared).map(row => row.firstFrameMs!)) },
      droppedEvents: this.droppedEvents, droppedTransitions: this.droppedTransitions,
      transitions: this.transitions.map(row => ({ ...row })), events: this.events.map(row => ({ ...row })),
    };
  }

  shareReport() {
    const { transitions, events, ...report } = this.report();
    return { ...report, reportKind: 'compact',
      note: `${report.note} Compact export includes only the latest five transition details; use Share full report for the complete retained history.`,
      omittedTransitionDetails: Math.max(0, transitions.length - 5),
      omittedEventDetails: events.length,
      recentTransitions: transitions.slice(-5) };
  }
}
