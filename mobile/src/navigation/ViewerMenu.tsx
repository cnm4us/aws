import { ScrollView, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../auth/useAuth';
import { accountPresentation } from '../auth/accountPresentation';
import { Action } from '../ui/Message';
import { playbackDiagnostics } from '../diagnostics/development';
import { sharePlaybackDiagnostics } from '../diagnostics/share';

export function ViewerMenu({ onAccount, onSettings, onClose, onRefresh, onReadiness }: {
  onAccount: () => void; onSettings: () => void; onClose: () => void; onRefresh?: () => void; onReadiness?: () => void;
}) {
  const { store, snapshot } = useAuth();
  const { mode, busy, canSignOut } = accountPresentation(snapshot);
  return <SafeAreaView style={styles.screen} edges={['bottom']}>
    <ScrollView contentContainerStyle={styles.content}>
      {snapshot.viewer && <Text style={styles.text}>Signed in as {snapshot.viewer.displayName || 'Viewer'}</Text>}
      <Action label={mode === 'signIn' ? 'Sign in' : mode === 'savedSession' ? 'Account / Retry sign-in' : 'Account'}
        disabled={busy} onPress={onAccount}/>
      {canSignOut && <Action label={mode === 'signedIn' ? 'Sign out' : 'Sign out on this phone'} disabled={busy}
        onPress={()=>{if(store.getSnapshot().generation===snapshot.generation && !accountPresentation(store.getSnapshot()).busy)void store.signOut();}}/>}
      <Action label="Settings" onPress={onSettings}/>
      {onRefresh && <Action label="Refresh feed" disabled={busy} onPress={onRefresh}/>}
      {playbackDiagnostics && <Action label="Playback diagnostics" onPress={sharePlaybackDiagnostics}/>}
      {playbackDiagnostics && onReadiness && <Action label="Feed readiness check" onPress={onReadiness}/>}
      {snapshot.message && <Text style={styles.message} accessibilityRole="alert">{snapshot.message}</Text>}
      <Action label="Close menu" onPress={onClose}/>
    </ScrollView>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  content: { padding: 24, gap: 16 },
  text: { color: '#fff', fontSize: 18 },
  message: { color: '#ffb4b4', fontSize: 16 },
});
