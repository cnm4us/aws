import { useMemo } from 'react';
import { StatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { readEnvironment } from './src/config/environment';
import { ViewerNavigator } from './src/navigation/ViewerNavigator';
import { AuthProvider } from './src/auth/useAuth';
import { Message } from './src/ui/Message';
import { usePlaybackPreferences } from './src/preferences/usePlaybackPreferences';

export default function App() {
  const environment = useMemo(() => readEnvironment(), []);
  const { store: preferences, snapshot: sound, captionPreferences, captions } = usePlaybackPreferences();
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
        {environment.ok ? (sound.ready ? (
          <AuthProvider baseUrl={environment.value.apiBaseUrl}>
            <ViewerNavigator preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions}/>
          </AuthProvider>
        ) : <Message title="Loading preferences" busy />) : (
          <Message title="Configure your connection" message={environment.message} />
        )}
    </SafeAreaProvider>
  );
}
