import { useMemo } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { readEnvironment } from './src/config/environment';
import { FeedScreen } from './src/feed/FeedScreen';
import { Message } from './src/ui/Message';
import { usePlaybackPreferences } from './src/preferences/usePlaybackPreferences';

export default function App() {
  const environment = useMemo(() => readEnvironment(), []);
  const { store: preferences, snapshot: sound } = usePlaybackPreferences();
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <SafeAreaView style={{ flex: 1, backgroundColor: '#000000' }}>
        {environment.ok ? (sound.ready ? (
          <FeedScreen baseUrl={environment.value.apiBaseUrl} preferences={preferences} sound={sound} />
        ) : <Message title="Loading preferences" busy />) : (
          <Message title="Configure your connection" message={environment.message} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
