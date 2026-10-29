import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Action } from '../ui/Message';
import {ViewerHeader} from '../ui/ViewerHeader';
import {useIsFocused} from '@react-navigation/native';
import type { CaptionPreferences } from './captionPreferences';
import type { PlaybackPreferences, PlaybackPreferencesSnapshot } from './playbackPreferences';

export function PlaybackSettings({ visible, onClose, onMenu, preferences, snapshot, captionPreferences, captions }: {
  captionPreferences: CaptionPreferences; captions: ReturnType<CaptionPreferences['getSnapshot']>;
  visible: boolean;
  onClose: () => void; onMenu?:()=>void;
  preferences: PlaybackPreferences;
  snapshot: PlaybackPreferencesSnapshot;
}) {
  const { width, fontScale } = useWindowDimensions();
  const stacked = width / fontScale < 280;
  const focused=useIsFocused();
  if(!visible||!focused)return <View style={{flex:1,backgroundColor:'#000'}}/>;
  return (
      <View style={styles.backdrop}>
        <SafeAreaView edges={['bottom']} style={styles.panel} accessibilityViewIsModal>
          <ViewerHeader title="Playback settings" onMenu={onMenu} onBack={onClose} backLabel="Done"/>
          <ScrollView style={{flexShrink:1}} contentContainerStyle={{gap:20,padding:24}}>
          <Text style={styles.label}>Start videos</Text>
          <View style={[styles.choices, stacked && styles.stacked]} accessibilityRole="radiogroup">
            {[false, true].map(muted => (
              <Pressable key={String(muted)} accessibilityRole="radio"
                accessibilityState={{ checked: snapshot.startMuted === muted, disabled: snapshot.saving }}
                disabled={snapshot.saving} onPress={() => { void preferences.setStartMuted(muted); }}
                style={[styles.choice, stacked && styles.fullChoice, snapshot.startMuted === muted && styles.selected]}>
                <Text style={styles.choiceText}>{muted ? 'Muted' : 'Unmuted'}</Text>
                {snapshot.startMuted === muted && <Text style={styles.choiceText} accessibilityElementsHidden>✓</Text>}
              </Pressable>
            ))}
          </View>
          <Text style={styles.body}>Applies the next time you open the app. Use the sound button to change sound while browsing.</Text>
          {snapshot.saving && <View style={styles.saving}><Text style={[styles.body,{flexShrink:1}]}>Saving sound preference</Text></View>}
          {snapshot.error && <Text style={styles.error} accessibilityRole="alert">{snapshot.error}</Text>}
          <Text style={styles.label}>Captions</Text>
          <View style={[styles.choices, stacked && styles.stacked]} accessibilityRole="radiogroup">
            {[false, true].map(enabled => <Pressable key={String(enabled)} accessibilityRole="radio"
              accessibilityLabel={`Captions ${enabled ? 'On' : 'Off'}`} accessibilityState={{ checked: captions.enabled === enabled, disabled: !captions.ready }}
              disabled={!captions.ready} onPress={() => { void captionPreferences.setEnabled(enabled); }} style={[styles.choice, stacked && styles.fullChoice, captions.enabled === enabled && styles.selected]}>
              <Text style={styles.choiceText}>{enabled ? 'On' : 'Off'}</Text>
            </Pressable>)}
          </View>
          <Text style={styles.body}>Applies now and next time you open the app, where captions are available. Story expansion temporarily hides captions.</Text>
          {captions.saving && <Text style={styles.body}>Saving captions…</Text>}
          {captions.error && <View><Text accessibilityRole="alert" style={styles.error}>{captions.error}</Text><Action label="Retry saving captions" onPress={() => { void captionPreferences.retry(); }}/></View>}
          </ScrollView>
        </SafeAreaView>
      </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.65)' },
  panel: { maxHeight: '90%', backgroundColor: '#18181c', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 0, gap: 0 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: '700', flexShrink: 1 },
  label: { color: '#ffffff', fontSize: 18, fontWeight: '600' },
  choices: { flexDirection: 'row', gap: 12 },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  fullChoice: { flex: 0, width: '100%' },
  choice: { flex: 1, minHeight: 52, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: '#62626b', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selected: { borderColor: '#ffffff', backgroundColor: '#33333c' },
  choiceText: { color: '#ffffff', fontSize: 17, fontWeight: '600', flexShrink: 1 },
  body: { color: '#c7c7ce', fontSize: 16, lineHeight: 23 },
  saving: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  error: { color: '#ffb4b4', fontSize: 16, lineHeight: 23 },
});
