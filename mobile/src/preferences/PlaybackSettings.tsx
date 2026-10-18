import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action } from '../ui/Message';
import type { PlaybackPreferences, PlaybackPreferencesSnapshot } from './playbackPreferences';

export function PlaybackSettings({ visible, onClose, preferences, snapshot }: {
  visible: boolean;
  onClose: () => void;
  preferences: PlaybackPreferences;
  snapshot: PlaybackPreferencesSnapshot;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <SafeAreaView edges={['bottom']} style={styles.panel} accessibilityViewIsModal>
          <View style={styles.header}>
            <Text style={styles.title} accessibilityRole="header">Playback settings</Text>
            <Action label="Done" onPress={onClose} />
          </View>
          <Text style={styles.label}>Start videos</Text>
          <View style={styles.choices} accessibilityRole="radiogroup">
            {[false, true].map(muted => (
              <Pressable key={String(muted)} accessibilityRole="radio"
                accessibilityState={{ checked: snapshot.startMuted === muted, disabled: snapshot.saving }}
                disabled={snapshot.saving} onPress={() => { void preferences.setStartMuted(muted); }}
                style={[styles.choice, snapshot.startMuted === muted && styles.selected]}>
                <Text style={styles.choiceText}>{muted ? 'Muted' : 'Unmuted'}</Text>
                {snapshot.startMuted === muted && <Text style={styles.choiceText} accessibilityElementsHidden>✓</Text>}
              </Pressable>
            ))}
          </View>
          <Text style={styles.body}>Applies the next time you open the app. Use Mute or Unmute to change sound while browsing.</Text>
          {snapshot.saving && <View style={styles.saving}><ActivityIndicator color="#ffffff" /><Text style={styles.body}>Saving…</Text></View>}
          {snapshot.error && <Text style={styles.error} accessibilityRole="alert">{snapshot.error}</Text>}
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  panel: { backgroundColor: '#18181c', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, gap: 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700', flexShrink: 1 },
  label: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  choices: { flexDirection: 'row', gap: 12 },
  choice: { flex: 1, minHeight: 52, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#62626b', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selected: { borderColor: '#ffffff', backgroundColor: '#33333c' },
  choiceText: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  body: { color: '#c7c7ce', fontSize: 16, lineHeight: 23 },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { color: '#ffb4b4', fontSize: 16, lineHeight: 23 },
});
