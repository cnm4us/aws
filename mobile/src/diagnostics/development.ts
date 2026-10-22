import { PlaybackDiagnostics } from './playbackDiagnostics';
import { viewerBuildIdentity, viewerBuildPolicy } from '../config/build';

// Device-local, explicit internal preview opt-in; no application API transport.
export const playbackDiagnostics = viewerBuildPolicy.diagnostics
  ? new PlaybackDiagnostics(undefined, viewerBuildIdentity) : null;
