import { PlaybackDiagnostics } from './playbackDiagnostics';

// Excluded from release execution; never posted to the application API.
export const developmentDiagnostics = __DEV__ ? new PlaybackDiagnostics() : null;
