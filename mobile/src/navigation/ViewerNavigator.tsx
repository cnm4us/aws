import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NavigationContainer, DarkTheme, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { useAuth } from '../auth/useAuth';
import { AccountScreen } from '../auth/AccountScreen';
import { FeedScreen, type FeedPlaybackHandle } from '../feed/FeedScreen';
import { contextKey,type FeedContext } from '../feed/context';
import { SpacesScreen } from '../spaces/SpacesScreen';
import { Message,Action } from '../ui/Message';
import { PlaybackSettings } from '../preferences/PlaybackSettings';
import type { PlaybackPreferences,PlaybackPreferencesSnapshot } from '../preferences/playbackPreferences';
import { CreatorProfileScreen } from '../profiles/CreatorProfileScreen';
import { ViewerJourney, type FeedCheckpoint } from './viewerJourney';
import { returnToFeed } from './returnToFeed';
import { viewerIdentityKey } from './viewerIdentityKey';

type Routes={Feed:undefined;Spaces:undefined;Account:undefined;Settings:undefined;CreatorProfile:{creatorId:number;journeyGeneration:number}};
const Stack=createNativeStackNavigator<Routes>();
type Props={preferences:PlaybackPreferences;sound:PlaybackPreferencesSnapshot};
export function ViewerNavigator({preferences,sound}:Props) {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const journey=useMemo(()=>new ViewerJourney(),[baseUrl,snapshot.generation]);
  const visit=useSyncExternalStore(journey.subscribe,journey.getSnapshot);
  const [selection,setSelection]=useState<{generation:number;context:FeedContext;visitId:number;restore?:FeedCheckpoint}>(
    {generation:snapshot.generation,context:{kind:'global'},visitId:0});
  const serial=useRef(0),playback=useRef<FeedPlaybackHandle|null>(null),lastRoute=useRef('Feed');
  const liveIdentity=useRef({auth,baseUrl,generation:snapshot.generation});liveIdentity.current={auth,baseUrl,generation:snapshot.generation};
  const current=selection.generation===snapshot.generation?selection:{generation:snapshot.generation,context:{kind:'global'} as FeedContext,visitId:0,restore:undefined};
  const context=current.context;
  const isCurrent=()=>liveIdentity.current.auth===auth && liveIdentity.current.baseUrl===baseUrl
    && liveIdentity.current.generation===snapshot.generation && auth.getSnapshot().generation===snapshot.generation;
  const registerPlayback=useCallback((handle:FeedPlaybackHandle)=>{
    playback.current=handle;return()=>{if(playback.current===handle)playback.current=null;};
  },[]);
  const transition=(context:FeedContext,restore?:FeedCheckpoint)=>{
    if(!isCurrent())return;
    playback.current?.release();
    setSelection({generation:snapshot.generation,context,restore,visitId:++serial.current});
  };
  const select=(context:FeedContext)=>{journey.reset();transition(context);};
  const originName=visit.origin?.context.kind==='space'?visit.origin.context.name:'Global';
  if(snapshot.status==='restoring' || snapshot.status==='signingOut')return <Message title={snapshot.status==='restoring'?'Restoring sign-in':'Signing out'} busy/>;
  return <NavigationContainer theme={DarkTheme} onStateChange={state=>{
    const name=state?.routes[state.index??0]?.name??'Feed';
    if(name==='Feed' && lastRoute.current==='CreatorProfile' && !journey.getSnapshot().destinationActive)journey.reset();
    lastRoute.current=name;
  }}>
    <Stack.Navigator screenOptions={{contentStyle:{backgroundColor:'#000'}}}>
      <Stack.Group navigationKey={viewerIdentityKey(baseUrl,snapshot.viewer?.id)}>
      <Stack.Screen name="Feed" options={{headerShown:false}}>
        {props=><FeedRoute {...props} key={`${snapshot.generation}:${contextKey(context)}:${current.visitId}`} context={context} select={select} preferences={preferences} sound={sound}
          restore={current.restore} registerPlayback={registerPlayback}
          onCreator={id=>{
            if(!isCurrent())return;
            const saved=playback.current?.capture();if(!saved)return;
            const priorOrigin=journey.originFor(baseUrl,snapshot.generation);
            journey.open(id,{...saved,context,apiOrigin:baseUrl,authGeneration:snapshot.generation});
            if(priorOrigin)transition(priorOrigin.context,priorOrigin);
            props.navigation.navigate('CreatorProfile',{creatorId:id,journeyGeneration:journey.getSnapshot().generation});
          }}
          onBackProfile={visit.destinationActive?()=>{
            if(!isCurrent())return;
            const origin=journey.originFor(baseUrl,snapshot.generation),creatorId=journey.getSnapshot().creatorId;
            if(!origin || !creatorId)return;
            journey.backToProfile();transition(origin.context,origin);
            props.navigation.navigate('CreatorProfile',{creatorId,journeyGeneration:journey.getSnapshot().generation});
          }:undefined}/>}
      </Stack.Screen>
      <Stack.Screen name="CreatorProfile" options={{title:'Creator profile',headerBackTitle:originName}}>
        {({navigation,route})=><CreatorProfileScreen creatorId={route.params.creatorId} returnName={originName}
          onAccount={()=>navigation.navigate('Account')} onSettings={()=>navigation.navigate('Settings')}
          onEnter={destination=>{
            if(liveIdentity.current.auth!==auth || liveIdentity.current.baseUrl!==baseUrl || auth.getSnapshot().generation!==snapshot.generation
              || auth.getSnapshot().status!=='authenticated' || !navigation.isFocused())return;
            if(!journey.enter(route.params.creatorId,route.params.journeyGeneration))return;
            transition(destination);returnToFeed(navigation);
          }}/>}
      </Stack.Screen>
      <Stack.Screen name="Spaces">{({navigation})=><SpacesScreen selected={context} onSelect={c=>{select(c);returnToFeed(navigation);}} onSignIn={()=>navigation.navigate('Account')}/>}</Stack.Screen>
      <Stack.Screen name="Account">{({navigation})=><AccountScreen onDone={()=>{if(navigation.isFocused() && navigation.canGoBack())navigation.goBack();}}/>}</Stack.Screen>
      <Stack.Screen name="Settings" options={{headerShown:false}}>{({navigation})=><PlaybackSettings visible preferences={preferences} snapshot={sound} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      </Stack.Group>
    </Stack.Navigator>
  </NavigationContainer>;
}
function FeedRoute({navigation,context,select,preferences,sound,restore,onCreator,onBackProfile,registerPlayback}:NativeStackScreenProps<Routes,'Feed'> & Props & {
  context:FeedContext;select:(c:FeedContext)=>void;restore?:FeedCheckpoint;onCreator:(id:number)=>void;onBackProfile?:()=>void;
  registerPlayback:(handle:FeedPlaybackHandle)=>()=>void;
}) {
  const focused=useIsFocused();const {store:auth,snapshot}=useAuth();
  const goGlobal=()=>{if(snapshot.status==='unavailable')auth.browseAnonymously();select({kind:'global'});};
  if(snapshot.status==='unavailable' && !snapshot.viewer)return <View style={{flex:1,padding:24,gap:12}}>
    <Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>
    <Action label="Browse Global" onPress={goGlobal}/><Action label="Account" onPress={()=>navigation.navigate('Account')}/>
  </View>;
  return <FeedScreen context={context} preferences={preferences} sound={sound} focused={focused} restore={restore}
    onCreator={onCreator} onBackProfile={onBackProfile} registerPlayback={registerPlayback}
    onSpaces={()=>navigation.navigate('Spaces')} onAccount={()=>navigation.navigate('Account')} onSettings={()=>navigation.navigate('Settings')} onGlobal={goGlobal}/>;
}
