import { useState } from 'react';
import { NavigationContainer, DarkTheme, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { useAuth } from '../auth/useAuth';
import { AccountScreen } from '../auth/AccountScreen';
import { FeedScreen } from '../feed/FeedScreen';
import { contextKey,type FeedContext } from '../feed/context';
import { SpacesScreen } from '../spaces/SpacesScreen';
import { Message,Action } from '../ui/Message';
import { PlaybackSettings } from '../preferences/PlaybackSettings';
import type { PlaybackPreferences,PlaybackPreferencesSnapshot } from '../preferences/playbackPreferences';
import { returnToFeed } from './returnToFeed';

type Routes={Feed:undefined;Spaces:undefined;Account:undefined;Settings:undefined};
const Stack=createNativeStackNavigator<Routes>();
type Props={preferences:PlaybackPreferences;sound:PlaybackPreferencesSnapshot};
export function ViewerNavigator({preferences,sound}:Props) {
  const {store:auth,snapshot}=useAuth();
  const [selection,setSelection]=useState<{generation:number;context:FeedContext}>({generation:snapshot.generation,context:{kind:'global'}});
  const context:FeedContext=selection.generation===snapshot.generation?selection.context:{kind:'global'};
  const select=(context:FeedContext)=>setSelection({generation:snapshot.generation,context});
  if(snapshot.status==='restoring' || snapshot.status==='signingOut')return <Message title={snapshot.status==='restoring'?'Restoring sign-in':'Signing out'} busy/>;
  return <NavigationContainer theme={DarkTheme}>
    <Stack.Navigator screenOptions={{contentStyle:{backgroundColor:'#000'}}}>
      <Stack.Group navigationKey={String(snapshot.viewer?.id??'guest')}>
      <Stack.Screen name="Feed" options={{headerShown:false}}>
        {props=><FeedRoute {...props} key={`${snapshot.generation}:${contextKey(context)}`} context={context} select={select} preferences={preferences} sound={sound}/>}
      </Stack.Screen>
      <Stack.Screen name="Spaces">{({navigation})=><SpacesScreen selected={context} onSelect={c=>{select(c);returnToFeed(navigation);}} onSignIn={()=>navigation.navigate('Account')}/>}</Stack.Screen>
      <Stack.Screen name="Account">{({navigation})=><AccountScreen onDone={()=>returnToFeed(navigation)}/>}</Stack.Screen>
      <Stack.Screen name="Settings" options={{headerShown:false}}>{({navigation})=><PlaybackSettings visible preferences={preferences} snapshot={sound} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      </Stack.Group>
    </Stack.Navigator>
  </NavigationContainer>;
}
function FeedRoute({navigation,context,select,preferences,sound}:NativeStackScreenProps<Routes,'Feed'> & Props & {context:FeedContext;select:(c:FeedContext)=>void}) {
  const focused=useIsFocused();const {store:auth,snapshot}=useAuth();
  const goGlobal=()=>{if(snapshot.status==='unavailable')auth.browseAnonymously();select({kind:'global'});};
  if(snapshot.status==='unavailable' && !snapshot.viewer)return <View style={{flex:1,padding:24,gap:12}}>
    <Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>
    <Action label="Browse Global" onPress={goGlobal}/><Action label="Account" onPress={()=>navigation.navigate('Account')}/>
  </View>;
  return <FeedScreen context={context} preferences={preferences} sound={sound} focused={focused}
    onSpaces={()=>navigation.navigate('Spaces')} onAccount={()=>navigation.navigate('Account')} onSettings={()=>navigation.navigate('Settings')} onGlobal={goGlobal}/>;
}
