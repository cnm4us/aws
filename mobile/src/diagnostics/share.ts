import { Alert, Share } from 'react-native';
import { playbackDiagnostics } from './development';

export function sharePlaybackDiagnostics() {
  const diagnostics = playbackDiagnostics;
  if (!diagnostics) return;
  const report = diagnostics.report();
  const compactReport = diagnostics.shareReport();
  const p95 = report.summary.preparedFrames.p95Ms;
  const share = (full: boolean) => {
    const exported = full ? report : compactReport;
    void Share.share({ message: JSON.stringify(exported, null, full ? 2 : undefined), title: 'Video playback diagnostics' }).catch(() => {});
  };
  Alert.alert('Playback diagnostics',
    `${report.build?.kind ?? 'development'} ${report.build?.appVersion ?? ''} (${report.build?.appBuild ?? '?'})\nSource: ${report.build?.sourceId?.slice(0,12) ?? 'unprepared'}\nPlayers: ${report.resources.livePlayers} live, ${report.resources.peakPlayers} peak.\nTransitions: ${report.summary.transitions}; errors: ${report.summary.errors}.\nUnexpected playback: ${report.resources.unexpectedPlayback}.\nPrepared first-frame p95: ${p95 === null ? 'no samples yet' : `${Math.round(p95)} ms`}.`,
    [{ text: 'Close', style: 'cancel' },
      { text: 'Share report', onPress: () => share(false) },
      { text: 'Share full report', onPress: () => share(true) },
      { text: 'Reset diagnostics', onPress: () => {
        diagnostics.reset();
        Alert.alert('Diagnostics reset', 'The next video selection starts the new timing sample. Playback and settings are unchanged.');
      } }]);
};

