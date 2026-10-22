import type { PlayerErrorDetails } from '../playback/playerError';
import { sanitizeBuildIdentity, type ViewerBuildIdentity } from '../config/buildPolicy';

export type PlaybackDiagnosticEvent = PlayerErrorDetails & {
  type: 'allocation' | 'release' | 'load_started' | 'load_resolved' | 'selection' | 'ready' | 'first_frame' | 'error' | 'playing' | 'progress' | 'unexpected_playback' | 'lifecycle' | 'eligibility' | 'context' | 'restore';
  restoreOutcome?:'restored'|'failed';
  positionDeltaSeconds?:number;
  journeyGeneration?:number;
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
  screenEligible?: boolean;
  feedContext?: string;
  authGeneration?: number;
  scrolling?: boolean;
  userPaused?: boolean;
  reason?: 'nonselected' | 'ineligible';
  failureKind?: 'native_error' | 'source_load' | 'startup_timeout' | 'unavailable_media' | 'player_allocation' | 'position_restore';
  allocationFailure?: 'budget_exhausted' | 'native_creation';
};

type EventRecord = PlaybackDiagnosticEvent & { atMs: number; session: number };
type SourceLoad = { startedAtMs: number; replaceResolvedMs: number | null; readyMs: number | null };
type Transition = {
  session: number; activation: number; publicationId: number;
  feedContext?: string; authGeneration?: number;
  initial: boolean;
  selectedAtMs: number; prepared: boolean; bufferedSeconds: number;
  firstFrameMs: number | null; progressMs: number | null; error: boolean;
  playingObserved: boolean; interrupted: boolean;
  sourceLoad?: SourceLoad;
};

function timings(values: number[]) {
  if (!values.length) return { count: 0, medianMs: null, p95Ms: null, maxMs: null };
  const sorted = [...values].sort((a, b) => a - b);
  return { count: values.length, medianMs: sorted[Math.ceil(sorted.length / 2) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted[sorted.length - 1] };
}

// No network transport: counters and a bounded event history live only on the device.
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
  private contexts = new Map<number, Pick<PlaybackDiagnosticEvent, 'feedContext' | 'authGeneration'>>();
  // Only live loads stay in this map. Retained transitions keep their own load's
  // timings even after release and progress-event rollover (at most 200 rows).
  private activeLoads = new Map<string, SourceLoad>();
  private selectedSessions = new Set<number>();
  private resetCount = 0;
  private carriedPlayers = 0;
  private sampleStartedAtMs: number;
  private readonly build: ViewerBuildIdentity | undefined;

  constructor(private readonly clock: () => number = () => performance.now(), build?: unknown) {
    this.build = sanitizeBuildIdentity(build);
    this.sampleStartedAtMs = clock();
  }

  // Begin a new measurement epoch without touching a coordinator or native player.
  // Keep in-flight/preloaded source timings and current ownership. Events for the
  // old activation cannot manufacture a partial transition in the new epoch.
  reset() {
    this.events = []; this.transitions = []; this.issues = [];
    this.allocations = 0; this.releases = 0; this.unexpectedPlayback = 0;
    this.droppedEvents = 0; this.droppedTransitions = 0; this.droppedIssues = 0;
    this.carriedPlayers = [...this.liveBySession.values()].reduce((a,b) => a+b,0);
    this.peakPlayers = this.carriedPlayers;
    this.selectedSessions = new Set([...this.selectedSessions].filter(session => this.liveBySession.has(session)));
    this.sampleStartedAtMs = this.clock(); this.resetCount++;
  }

  session() {
    const session = ++this.nextSession;
    return (event: PlaybackDiagnosticEvent) => this.record(session, event);
  }

  private record(session: number, event: PlaybackDiagnosticEvent) {
    if (event.type === 'context') {
      this.contexts.set(session, { feedContext: event.feedContext, authGeneration: event.authGeneration });
      if (this.contexts.size > 10) this.contexts.delete(this.contexts.keys().next().value!);
    }
    event = { ...this.contexts.get(session), ...event };
    const atMs = this.clock();
    this.events.push({ ...event, session, atMs });
    if (this.events.length > 1000) { this.events.shift(); this.droppedEvents++; }
    const loadKey = `${session}:${event.publicationId}`;
    if (event.publicationId != null) {
      if (event.type === 'load_started') {
        const load: SourceLoad = { startedAtMs: atMs, replaceResolvedMs: null, readyMs: null };
        this.activeLoads.set(loadKey, load);
        // Initial/cold selection precedes allocation; speculative loads precede
        // selection. Associate only the current selection, never an old revisit.
        const current = this.transitions.findLast(row => row.session === session);
        if (current?.publicationId === event.publicationId) current.sourceLoad = load;
      } else {
        const load = this.activeLoads.get(loadKey);
        if (load && event.type === 'load_resolved' && load.replaceResolvedMs === null) load.replaceResolvedMs = atMs - load.startedAtMs;
        if (load && event.type === 'ready' && load.readyMs === null) load.readyMs = atMs - load.startedAtMs;
        if (event.type === 'release') this.activeLoads.delete(loadKey);
      }
    }
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
        feedContext: event.feedContext, authGeneration: event.authGeneration,
        initial: !this.selectedSessions.has(session),
        selectedAtMs: atMs, prepared: Boolean(event.prepared), bufferedSeconds: event.bufferedSeconds ?? 0,
        firstFrameMs: null, progressMs: null, error: false, playingObserved: false, interrupted: false,
        sourceLoad: this.activeLoads.get(loadKey) });
      if (this.transitions.length > 200) { this.transitions.shift(); this.droppedTransitions++; }
      this.selectedSessions.add(session);
      if (this.selectedSessions.size > 200) this.selectedSessions.delete(this.selectedSessions.values().next().value!);
    }
    const transition = this.transitions.findLast(row => row.session === session && row.activation === event.activation);
    if (!transition) return;
    if (event.type === 'first_frame' && transition.firstFrameMs === null) transition.firstFrameMs = atMs - transition.selectedAtMs;
    if (event.type === 'progress' && transition.progressMs === null) transition.progressMs = atMs - transition.selectedAtMs;
    if (event.type === 'error') transition.error = true;
    if (event.type === 'playing' && event.playing) transition.playingObserved = true;
    if (event.type === 'lifecycle' && !event.active) transition.interrupted = true;
    if (event.type === 'eligibility' && !event.screenEligible) transition.interrupted = true;
  }

  report() {
    const framed = this.transitions.filter(row => row.firstFrameMs !== null);
    const normal = this.transitions.filter(row => !row.initial);
    return {
      schemaVersion: 1,
      ...(this.build ? { build: { ...this.build } } : {}),
      sample: { startedAtMs: this.sampleStartedAtMs, resetCount: this.resetCount },
      generatedAt: new Date().toISOString(),
      clock: 'monotonic milliseconds',
      note: 'First frame measures presentation readiness. Review progress and playing evidence separately. Interrupted, incomplete, and failed transitions remain in the records. sourceLoad times start at the load request; replaceResolvedMs measures source replacement completion, not buffered readiness.'
        + (this.resetCount ? ' Reset retains carriedPlayers and active source timings; carriedPlayers + allocations - releases equals livePlayers. New timings start at the next selection.' : ''),
      resources: { allocations: this.allocations, releases: this.releases,
        ...(this.resetCount ? { carriedPlayers: this.carriedPlayers } : {}),
        livePlayers: [...this.liveBySession.values()].reduce((a, b) => a + b, 0), peakPlayers: this.peakPlayers,
        unexpectedPlayback: this.unexpectedPlayback },
      issues: this.issues.map(row => ({ ...row })), droppedIssues: this.droppedIssues,
      recentRestores:this.events.filter(row=>row.type==='restore').slice(-10).map(row=>({...row})),
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
      transitions: this.transitions.map(row => ({ ...row, sourceLoad: row.sourceLoad ? { ...row.sourceLoad } : undefined })), events: this.events.map(row => ({ ...row })),
    };
  }

  shareReport() {
    const { transitions, events, ...report } = this.report();
    const slow = transitions.filter(row => !row.initial &&
      (!row.prepared || row.error || row.firstFrameMs === null || row.firstFrameMs >= 500))
      .sort((a, b) => (b.firstFrameMs ?? Infinity) - (a.firstFrameMs ?? Infinity));
    const recent = transitions.slice(-5), outliers = slow.slice(0, 5);
    const included = new Set([...recent, ...outliers].map(row => `${row.session}:${row.activation}`));
    return { ...report, reportKind: 'compact',
      note: `${report.note} Compact export includes the latest five transitions and up to five slow/cold/incomplete normal transitions; use Share full report for the complete retained history.`,
      omittedTransitionDetails: transitions.length - included.size,
      omittedEventDetails: events.length,
      omittedSlowTransitionDetails: Math.max(0, slow.length - 5),
      slowTransitions: outliers,
      recentTransitions: recent };
  }
}
