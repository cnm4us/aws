import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NavigationContainer, DarkTheme, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { View } from 'react-native';
import { useAuth } from '../auth/useAuth';
import { AccountScreen } from '../auth/AccountScreen';
import { FeedScreen, type FeedCommands, type FeedPlaybackHandle } from '../feed/FeedScreen';
import { contextKey,type FeedContext } from '../feed/context';
import { SpacesScreen } from '../spaces/SpacesScreen';
import { Message,Action } from '../ui/Message';
import { PlaybackSettings } from '../preferences/PlaybackSettings';
import type { PlaybackPreferences,PlaybackPreferencesSnapshot } from '../preferences/playbackPreferences';
import { CreatorProfileScreen } from '../profiles/CreatorProfileScreen';
import { ViewerJourney, type FeedCheckpoint } from './viewerJourney';
import { returnToFeed } from './returnToFeed';
import type { CaptionPreferences } from '../preferences/captionPreferences';
import { viewerIdentityKey } from './viewerIdentityKey';
import { ViewerMenu } from './ViewerMenu';
import { LaunchSpacesScreen } from '../spaces/LaunchSpacesScreen';
import { GlobalLaunchJourney, type LaunchEntry } from './globalLaunchJourney';
import { resolveLaunch } from '../spaces/launchApi';
import { useViewerClient } from '../feed/useViewerFeed';
import { ApiError } from '../api/client';
import type { FeedVideoItem } from '../feed/types';
import { IconButton } from '../ui/IconButton';

type Routes={Feed:undefined;LaunchSpaces:{sourceId:number;productionUlid:string|null;generation:number};Menu:{source:'feed'|'profile';feedKey?:string};Spaces:undefined;Account:undefined;Settings:undefined;CreatorProfile:{creatorId:number;journeyGeneration:number}};
const Stack=createNativeStackNavigator<Routes>();
type Props={preferences:PlaybackPreferences;sound:PlaybackPreferencesSnapshot;captionPreferences:CaptionPreferences;captions:ReturnType<CaptionPreferences['getSnapshot']>};
export function ViewerNavigator({preferences,sound,captionPreferences,captions}:Props) {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const {client}=useViewerClient();
  const launch=useMemo(()=>new GlobalLaunchJourney(),[baseUrl,snapshot.generation]);
  const launchVisit=useSyncExternalStore(launch.subscribe,launch.getSnapshot);
  const retryRequest=useRef<AbortController|null>(null);
  useEffect(()=>()=>retryRequest.current?.abort(),[baseUrl,snapshot.generation]);
  const journey=useMemo(()=>new ViewerJourney(),[baseUrl,snapshot.generation]);
  const visit=useSyncExternalStore(journey.subscribe,journey.getSnapshot);
  const identityKey=viewerIdentityKey(baseUrl,snapshot.viewer?.id);
  const [selection,setSelection]=useState<{identityKey:string;generation:number;context:FeedContext;visitId:number;restore?:FeedCheckpoint;entry?:LaunchEntry}>(
    {identityKey,generation:snapshot.generation,context:{kind:'global'},visitId:0});
  const serial=useRef(0),playback=useRef<FeedPlaybackHandle|null>(null),lastRoute=useRef('Feed'),commands=useRef<FeedCommands|null>(null);
  const registerCommands=useCallback((handle:FeedCommands)=>{
    commands.current=handle;return()=>{if(commands.current===handle)commands.current=null;};
  },[]);
  const liveIdentity=useRef({auth,baseUrl,generation:snapshot.generation});liveIdentity.current={auth,baseUrl,generation:snapshot.generation};
  const current=selection.identityKey===identityKey && selection.generation===snapshot.generation?selection:{identityKey,generation:snapshot.generation,context:{kind:'global'} as FeedContext,visitId:0,restore:undefined,entry:undefined};
  const context=current.context;
  const feedKey=`${snapshot.generation}:${contextKey(context)}:${current.visitId}`;
  const liveFeedKey=useRef(feedKey);liveFeedKey.current=feedKey;
  const isCurrent=()=>liveIdentity.current.auth===auth && liveIdentity.current.baseUrl===baseUrl
    && liveIdentity.current.generation===snapshot.generation && auth.getSnapshot().generation===snapshot.generation;
  const registerPlayback=useCallback((handle:FeedPlaybackHandle)=>{
    playback.current=handle;return()=>{if(playback.current===handle)playback.current=null;};
  },[]);
  const transition=(context:FeedContext,restore?:FeedCheckpoint,entry?:LaunchEntry)=>{
    if(!isCurrent())return;
    retryRequest.current?.abort();
    playback.current?.release();
    setSelection({identityKey,generation:snapshot.generation,context,restore,entry,visitId:++serial.current});
  };
  const select=(next:FeedContext)=>{if(!isCurrent() || contextKey(next)===contextKey(context))return;journey.reset();launch.reset();transition(next);};
  const originName=visit.origin?.context.kind==='space'?visit.origin.context.name:'Global';
  if(snapshot.status==='restoring' || snapshot.status==='signingOut')return <Message title={snapshot.status==='restoring'?'Restoring sign-in':'Signing out'} busy/>;
  return <NavigationContainer theme={DarkTheme} onStateChange={state=>{
    const name=state?.routes[state.index??0]?.name??'Feed';
    if(name==='Feed' && ['LaunchSpaces','Account'].includes(lastRoute.current) && !launch.getSnapshot().destination && launch.getSnapshot().origin){
      const origin=launch.originFor(baseUrl,snapshot.generation);
      if(origin && launch.getSnapshot().sourceUnavailable)transition(origin.context,origin);
      launch.reset();
    }
    if(name==='Feed' && lastRoute.current==='CreatorProfile' && !journey.getSnapshot().destinationActive)journey.reset();
    lastRoute.current=name;
  }}>
    <Stack.Navigator screenOptions={{contentStyle:{backgroundColor:'#000'}}}>
      <Stack.Group navigationKey={viewerIdentityKey(baseUrl,snapshot.viewer?.id)}>
      <Stack.Screen name="Feed" options={{headerShown:false}}>
        {props=><FeedRoute {...props} key={`${snapshot.generation}:${contextKey(context)}:${current.visitId}`} context={context} select={select} preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions}
          restore={current.restore} entry={current.entry} blocked={context.kind==='global' && launchVisit.sourceUnavailable} registerPlayback={registerPlayback} registerCommands={registerCommands} feedKey={feedKey}
          onLaunch={item=>{
            if(!isCurrent() || !props.navigation.isFocused() || context.kind!=='global')return;
            const saved=playback.current?.capture();if(!saved?.publicationId || saved.publicationId!==item.publicationId)return;
            const generation=launch.open({...saved,context,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:launch.getSnapshot().generation+1,productionUlid:item.productionUlid});
            props.navigation.navigate('LaunchSpaces',{sourceId:item.publicationId,productionUlid:item.productionUlid,generation});
          }}
          onBackGlobal={launchVisit.destination?()=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const origin=launch.originFor(baseUrl,snapshot.generation);if(!origin)return;
            journey.reset();transition(origin.context,origin);launch.reset();
          }:undefined}
          onChooseLaunch={()=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const origin=launch.originFor(baseUrl,snapshot.generation);if(!origin?.publicationId)return;
            journey.reset();const generation=launch.open(origin);transition(origin.context,origin);
            props.navigation.navigate('LaunchSpaces',{sourceId:origin.publicationId,productionUlid:origin.productionUlid,generation});
          }}
          onRetryEntry={async()=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const before=launch.getSnapshot(),origin=launch.originFor(baseUrl,snapshot.generation);if(!origin?.publicationId || !before.destination)return;
            const key=liveFeedKey.current,request=new AbortController();retryRequest.current?.abort();retryRequest.current=request;
            try{
              const result=await resolveLaunch(client,origin.publicationId,origin.productionUlid,before.destination.space.id,request.signal);
              if(!isCurrent() || !props.navigation.isFocused() || key!==liveFeedKey.current || request.signal.aborted)return;
              const next=launch.enter(result,before.generation);if(next)transition(next.context,undefined,next.entry);
            }catch(e){if(isCurrent() && !request.signal.aborted){if(e instanceof ApiError && e.status===401)void auth.invalidate(snapshot.generation);throw e;}}
            finally{if(retryRequest.current===request)retryRequest.current=null;}
          }}
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
      <Stack.Screen name="LaunchSpaces" options={{title:'Open in a space'}}>{({navigation,route})=><LaunchSpacesScreen
        sourceId={route.params.sourceId} productionUlid={route.params.productionUlid}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onSignIn={()=>{if(isCurrent() && navigation.isFocused())navigation.replace('Account');}}
        onSourceUnavailable={()=>{if(isCurrent() && navigation.isFocused())launch.missing(route.params.generation);}}
        onEnter={result=>{
          if(!isCurrent() || !navigation.isFocused() || auth.getSnapshot().status!=='authenticated')return;
          const next=launch.enter(result,route.params.generation);if(!next)return;
          journey.reset();transition(next.context,undefined,next.entry);returnToFeed(navigation);
        }}/>}</Stack.Screen>
      <Stack.Screen name="CreatorProfile" options={({navigation})=>({title:'Creator profile',headerBackTitle:originName,
        headerRight:()=> <IconButton icon="menu" label="Open menu" onPress={()=>{if(navigation.isFocused())navigation.navigate('Menu',{source:'profile'});}}/>})}>
        {({navigation,route})=><CreatorProfileScreen creatorId={route.params.creatorId} returnName={originName}
          onAccount={()=>{if(navigation.isFocused())navigation.navigate('Account');}}
          onEnter={destination=>{
            if(liveIdentity.current.auth!==auth || liveIdentity.current.baseUrl!==baseUrl || auth.getSnapshot().generation!==snapshot.generation
              || auth.getSnapshot().status!=='authenticated' || !navigation.isFocused())return;
            if(!journey.enter(route.params.creatorId,route.params.journeyGeneration))return;
            transition(destination);returnToFeed(navigation);
          }}/>}
      </Stack.Screen>
      <Stack.Screen name="Spaces">{({navigation})=><SpacesScreen selected={context} onSelect={c=>{if(!navigation.isFocused() || !isCurrent())return;select(c);returnToFeed(navigation);}} onSignIn={()=>navigation.navigate('Account')}/>}</Stack.Screen>
      <Stack.Screen name="Menu" options={{title:'Menu'}}>{({navigation,route})=><ViewerMenu
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onAccount={()=>{if(isCurrent() && navigation.isFocused())navigation.replace('Account');}}
        onSettings={()=>{if(isCurrent() && navigation.isFocused())navigation.replace('Settings');}}
        onRefresh={route.params.source==='feed'?()=>{
          if(!isCurrent() || !navigation.isFocused() || route.params.feedKey!==liveFeedKey.current)return;
          commands.current?.requestRefresh();returnToFeed(navigation);
        }:undefined}/>}</Stack.Screen>
      <Stack.Screen name="Account">{({navigation})=><AccountScreen onDone={()=>{if(navigation.isFocused() && navigation.canGoBack())navigation.goBack();}}/>}</Stack.Screen>
      <Stack.Screen name="Settings" options={{headerShown:false}}>{({navigation})=><PlaybackSettings visible preferences={preferences} snapshot={sound} captionPreferences={captionPreferences} captions={captions} onClose={()=>{if(navigation.isFocused())navigation.goBack();}}/>}</Stack.Screen>
      </Stack.Group>
    </Stack.Navigator>
  </NavigationContainer>;
}
function FeedRoute({navigation,context,select,preferences,sound,captionPreferences,captions,restore,onCreator,onBackProfile,onBackGlobal,onLaunch,onRetryEntry,onChooseLaunch,entry,blocked,registerPlayback,registerCommands,feedKey}:NativeStackScreenProps<Routes,'Feed'> & Props & {
  context:FeedContext;select:(c:FeedContext)=>void;restore?:FeedCheckpoint;entry?:LaunchEntry;blocked?:boolean;onLaunch:(item:FeedVideoItem)=>void;onBackGlobal?:()=>void;onRetryEntry:()=>Promise<void>;onChooseLaunch:()=>void;onCreator:(id:number)=>void;onBackProfile?:()=>void;
  registerPlayback:(handle:FeedPlaybackHandle)=>()=>void;registerCommands:(handle:FeedCommands)=>()=>void;feedKey:string;
}) {
  const focused=useIsFocused();const {store:auth,snapshot}=useAuth();
  const goGlobal=()=>{if(snapshot.status==='unavailable')auth.browseAnonymously();select({kind:'global'});};
  if(snapshot.status==='unavailable' && !snapshot.viewer)return <View style={{flex:1,padding:24,gap:12}}>
    <Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>
    <Action label="Browse Global" onPress={goGlobal}/><Action label="Account" onPress={()=>navigation.navigate('Account')}/>
  </View>;
  return <FeedScreen context={context} preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions} focused={focused} restore={restore} entry={entry} blocked={blocked} onLaunch={onLaunch} onBackGlobal={onBackGlobal} onRetryEntry={onRetryEntry} onChooseLaunch={onChooseLaunch}
    onCreator={onCreator} onBackProfile={onBackProfile} registerPlayback={registerPlayback} registerCommands={registerCommands}
    onSpaces={()=>{if(navigation.isFocused())navigation.navigate('Spaces');}} onMenu={()=>{if(navigation.isFocused())navigation.navigate('Menu',{source:'feed',feedKey});}} onGlobal={goGlobal}/>;
}
