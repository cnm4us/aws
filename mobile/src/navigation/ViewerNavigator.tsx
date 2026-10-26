import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NavigationContainer, DarkTheme, useIsFocused } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { AppState, View } from 'react-native';
import { LaunchPreparation } from '../spaces/launchPreparation';
import { playbackDiagnostics } from '../diagnostics/development';
import type { NavigationTrace } from '../diagnostics/playbackDiagnostics';
import { useAuth } from '../auth/useAuth';
import { AccountScreen } from '../auth/AccountScreen';
import { FeedScreen, type FeedCommands, type FeedPlaybackHandle } from '../feed/FeedScreen';
import { contextKey,type FeedContext } from '../feed/context';
import { SpacesScreen } from '../spaces/SpacesScreen';
import { Message,Action } from '../ui/Message';
import { FeedLoadingSplash } from '../ui/FeedLoadingSplash';
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
import type { FollowProof } from '../follows/api';
import { CommentsScreen } from '../engagement/CommentsScreen';
import { IconButton } from '../ui/IconButton';
import { ReadinessCheckScreen, ReadinessCheckCover, type NativeReadinessProbe } from '../playback/ReadinessCheckScreen';

type Routes={Feed:undefined;ReadinessCheck:undefined;ReadinessCover:undefined;Comments:{spaceId:number;publicationId:number;generation:number;feedKey:string};LaunchSpaces:{sourceId:number;productionUlid:string|null;creatorId:number|null;generation:number};Menu:{source:'feed'|'profile';feedKey?:string};Spaces:undefined;Account:undefined;Settings:undefined;CreatorProfile:{creatorId:number;journeyGeneration:number;followProof?:FollowProof}};
const Stack=createNativeStackNavigator<Routes>();
type FeedVisit={identityKey:string;generation:number;context:FeedContext;visitId:number;restore?:FeedCheckpoint;entry?:LaunchEntry;trace?:NavigationTrace};
type Props={preferences:PlaybackPreferences;sound:PlaybackPreferencesSnapshot;captionPreferences:CaptionPreferences;captions:ReturnType<CaptionPreferences['getSnapshot']>};
export function ViewerNavigator({preferences,sound,captionPreferences,captions}:Props) {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const {client}=useViewerClient();
  const resources=useMemo(()=>({preparation:new LaunchPreparation(client,()=>{void auth.invalidate(snapshot.generation);},result=>{
    if(auth.getSnapshot().generation!==snapshot.generation||AppState.currentState!=='active'||!result.entry)return false;
    if(!auth.access.seedPage(result.entry))return false;const selected=result.entry.items.find(i=>i.publicationId===result.publicationId);
    return !!selected&&auth.access.canView(selected);
  })}),[client,auth,snapshot.generation]);
  const chooserTrace=useRef<NavigationTrace|undefined>(undefined),entryTrace=useRef<NavigationTrace|undefined>(undefined);
  useLayoutEffect(()=>{
    const clear=()=>{resources.preparation.clear();chooserTrace.current?.finish('interrupted');entryTrace.current?.finish('interrupted');};
    const sub=AppState.addEventListener('change',state=>{if(state!=='active')clear();});
    const unsubscribe=auth.subscribe(()=>{if(auth.getSnapshot().generation!==snapshot.generation || auth.getSnapshot().status!=='authenticated')clear();});
    return()=>{sub.remove();unsubscribe();clear();};
  },[resources,auth]);
  const prepareLaunch=useCallback((item:FeedVideoItem)=>{
    if(auth.getSnapshot().generation===snapshot.generation && auth.getSnapshot().status==='authenticated' && AppState.currentState==='active')resources.preparation.prepare(item);
  },[resources,auth,snapshot.generation]);
  const launch=useMemo(()=>new GlobalLaunchJourney(),[baseUrl,snapshot.generation]);
  const launchVisit=useSyncExternalStore(launch.subscribe,launch.getSnapshot);
  const retryRequest=useRef<AbortController|null>(null);
  const readinessCheck=useRef<NativeReadinessProbe|null>(null);
  useEffect(()=>()=>retryRequest.current?.abort(),[baseUrl,snapshot.generation]);
  const journey=useMemo(()=>new ViewerJourney(),[baseUrl,snapshot.generation]);
  const visit=useSyncExternalStore(journey.subscribe,journey.getSnapshot);
  const identityKey=viewerIdentityKey(baseUrl,snapshot.viewer?.id);
  const [selection,setSelection]=useState<FeedVisit>(
    {identityKey,generation:snapshot.generation,context:{kind:'global'},visitId:0});
  const handles=useRef(new Map<number,FeedPlaybackHandle>()),commandHandles=useRef(new Map<number,FeedCommands>());
  const activeVisit=useRef(0);
  const followVisits=useRef(0),profileFollow=useRef<FollowProof|undefined>(undefined);
  const serial=useRef(0),playback=useRef<FeedPlaybackHandle|null>(null),lastRoute=useRef('Feed'),commands=useRef<FeedCommands|null>(null);
  const registerCommands=useCallback((visitId:number,handle:FeedCommands)=>{
    commandHandles.current.set(visitId,handle);if(activeVisit.current===visitId)commands.current=handle;
    return()=>{if(commandHandles.current.get(visitId)===handle)commandHandles.current.delete(visitId);if(commands.current===handle)commands.current=null;};
  },[]);
  const liveIdentity=useRef({auth,baseUrl,generation:snapshot.generation});liveIdentity.current={auth,baseUrl,generation:snapshot.generation};
  const current=selection.identityKey===identityKey && selection.generation===snapshot.generation?selection:{identityKey,generation:snapshot.generation,context:{kind:'global'} as FeedContext,visitId:0,restore:undefined,entry:undefined};
  activeVisit.current=current.visitId;
  playback.current=handles.current.get(current.visitId)??null;commands.current=commandHandles.current.get(current.visitId)??null;
  const context=current.context;
  const feedKey=`${snapshot.generation}:${contextKey(context)}:${current.visitId}`;
  const liveFeedKey=useRef(feedKey);liveFeedKey.current=feedKey;
  const isCurrent=()=>liveIdentity.current.auth===auth && liveIdentity.current.baseUrl===baseUrl
    && liveIdentity.current.generation===snapshot.generation && auth.getSnapshot().generation===snapshot.generation;
  const registerPlayback=useCallback((visitId:number,handle:FeedPlaybackHandle)=>{
    handles.current.set(visitId,handle);if(activeVisit.current===visitId)playback.current=handle;
    return()=>{if(handles.current.get(visitId)===handle)handles.current.delete(visitId);if(playback.current===handle)playback.current=null;};
  },[]);
  const transition=(context:FeedContext,restore?:FeedCheckpoint,entry?:LaunchEntry,trace?:NavigationTrace)=>{
    if(!isCurrent())return;
    retryRequest.current?.abort();
    // Each actual feed change starts a fresh native pool. Scalar checkpoints
    // and authorized JSON may survive; no decoder survives another feed.
    playback.current?.release();
    setSelection({identityKey,generation:snapshot.generation,context,restore,entry,trace,visitId:++serial.current});
  };
  const select=(next:FeedContext)=>{if(!isCurrent() || contextKey(next)===contextKey(context))return;journey.reset();launch.reset();transition(next);};
  const originName=visit.origin?.context.kind==='space'?visit.origin.context.name:'Global';
  if(snapshot.status==='restoring')return <FeedLoadingSplash feedName="Global"/>;
  if(snapshot.status==='signingOut')return <Message title="Signing out" busy/>;
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
        {props=><FeedRoute {...props} key={`${snapshot.generation}:${current.visitId}`} visitId={current.visitId} context={context} select={select} preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions}
          restore={current.restore} entry={current.entry} trace={current.trace} onPrepareLaunch={prepareLaunch} blocked={context.kind==='global' && launchVisit.sourceUnavailable} registerPlayback={registerPlayback} registerCommands={registerCommands} feedKey={feedKey}
          onComments={publicationId=>{
            if(!isCurrent() || !props.navigation.isFocused() || context.kind!=='space' || auth.getSnapshot().status!=='authenticated')return;
            if(playback.current?.capture().publicationId!==publicationId)return;
            props.navigation.navigate('Comments',{spaceId:context.spaceId,publicationId,generation:snapshot.generation,feedKey});
          }}
          onLaunch={item=>{
            playback.current?.retainOrigin?.();
            if(!isCurrent() || !props.navigation.isFocused() || context.kind!=='global')return;
            const saved=playback.current?.capture();if(!saved?.publicationId || saved.publicationId!==item.publicationId)return;
            chooserTrace.current=playbackDiagnostics?.navigationStart('launch');
            const generation=launch.open({...saved,context,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:launch.getSnapshot().generation+1,productionUlid:item.productionUlid,creatorId:item.creator.id});
            props.navigation.navigate('LaunchSpaces',{sourceId:item.publicationId,productionUlid:item.productionUlid,creatorId:item.creator.id,generation});
          }}
          onBackGlobal={launchVisit.destination?()=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const origin=launch.originFor(baseUrl,snapshot.generation);if(!origin)return;
            journey.reset();transition(origin.context,origin,undefined,playbackDiagnostics?.navigationStart('global_return'));launch.reset();
          }:undefined}
          onChooseLaunch={()=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const origin=launch.originFor(baseUrl,snapshot.generation);if(!origin?.publicationId)return;
            journey.reset();const generation=launch.open(origin);transition(origin.context,origin,undefined);chooserTrace.current=playbackDiagnostics?.navigationStart('launch');
            props.navigation.navigate('LaunchSpaces',{sourceId:origin.publicationId,productionUlid:origin.productionUlid,creatorId:origin.creatorId??null,generation});
          }}
          onRetryEntry={async()=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const before=launch.getSnapshot(),origin=launch.originFor(baseUrl,snapshot.generation);if(!origin?.publicationId || !before.destination)return;
            const key=liveFeedKey.current,request=new AbortController();retryRequest.current?.abort();retryRequest.current=request;
            try{
              const result=await resolveLaunch(client,origin.publicationId,origin.productionUlid,before.destination.space.id,request.signal,origin.creatorId,true);
              if(!isCurrent() || !props.navigation.isFocused() || key!==liveFeedKey.current || request.signal.aborted)return;
              const next=launch.enter(result,before.generation);if(next)transition(next.context,undefined,next.entry);
            }catch(e){if(isCurrent() && !request.signal.aborted){if(e instanceof ApiError && e.status===401)void auth.invalidate(snapshot.generation);throw e;}}
            finally{if(retryRequest.current===request)retryRequest.current=null;}
          }}
          onCreator={id=>{
            if(!isCurrent() || !props.navigation.isFocused())return;
            const saved=playback.current?.capture();if(!saved)return;
            const priorOrigin=journey.originFor(baseUrl,snapshot.generation);
            const followProof=context.kind==='space' && ['group','channel'].includes(context.type) && saved.publicationId && auth.getSnapshot().status==='authenticated'
              ?{spaceId:context.spaceId,publicationId:saved.publicationId,creatorId:id,generation:snapshot.generation,visitId:++followVisits.current}:undefined;
            profileFollow.current=followProof;
            journey.open(id,{...saved,context,apiOrigin:baseUrl,authGeneration:snapshot.generation});
            if(priorOrigin)transition(priorOrigin.context,priorOrigin);
            props.navigation.navigate('CreatorProfile',{creatorId:id,journeyGeneration:journey.getSnapshot().generation,followProof});
          }}
          onBackProfile={visit.destinationActive?()=>{
            if(!isCurrent())return;
            const origin=journey.originFor(baseUrl,snapshot.generation),creatorId=journey.getSnapshot().creatorId;
            if(!origin || !creatorId)return;
            journey.backToProfile();transition(origin.context,origin);
            props.navigation.navigate('CreatorProfile',{creatorId,journeyGeneration:journey.getSnapshot().generation,followProof:profileFollow.current});
          }:undefined}/>}
      </Stack.Screen>
      <Stack.Screen name="Comments" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=><CommentsScreen key={route.params.feedKey}
        {...route.params} onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onDenied={error=>{if(isCurrent() && liveFeedKey.current===route.params.feedKey && error instanceof ApiError)commands.current?.denyAccess?.(error);}}/>}</Stack.Screen>
      <Stack.Screen name="LaunchSpaces" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=><LaunchSpacesScreen
        sourceId={route.params.sourceId} productionUlid={route.params.productionUlid} creatorId={route.params.creatorId}
        preparation={resources.preparation} trace={chooserTrace.current} onEntryTrace={trace=>{entryTrace.current=trace;}}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onSignIn={()=>{if(isCurrent() && navigation.isFocused())navigation.replace('Account');}}
        onSourceUnavailable={()=>{if(isCurrent() && navigation.isFocused()){auth.globalFeed.clear();auth.access.invalidatePublic(route.params.sourceId);launch.missing(route.params.generation);}}}
        onEnter={result=>{
          if(!isCurrent() || !navigation.isFocused() || auth.getSnapshot().status!=='authenticated')return;
          const next=launch.enter(result,route.params.generation);if(!next)return;
          journey.reset();transition(next.context,undefined,next.entry,entryTrace.current);returnToFeed(navigation);
        }}/>}</Stack.Screen>
      <Stack.Screen name="CreatorProfile" options={({navigation})=>({title:'Creator profile',headerBackTitle:originName,
        headerRight:()=> <IconButton icon="menu" label="Open menu" onPress={()=>{if(navigation.isFocused())navigation.navigate('Menu',{source:'profile'});}}/>})}>
        {({navigation,route})=><CreatorProfileScreen creatorId={route.params.creatorId} returnName={originName} followProof={route.params.followProof}
          onFollowDenied={error=>{if(isCurrent() && route.params.followProof?.spaceId===(context.kind==='space'?context.spaceId:null) && error instanceof ApiError && error.status===403)commands.current?.denyAccess?.(error);}}
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
        onReadiness={playbackDiagnostics && context.kind==='global' && route.params.source==='feed'?()=>{
          if(isCurrent() && navigation.isFocused() && route.params.feedKey===liveFeedKey.current)navigation.navigate('ReadinessCheck');
        }:undefined}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onAccount={()=>{if(isCurrent() && navigation.isFocused())navigation.replace('Account');}}
        onSettings={()=>{if(isCurrent() && navigation.isFocused())navigation.replace('Settings');}}
        onRefresh={route.params.source==='feed'?()=>{
          if(!isCurrent() || !navigation.isFocused() || route.params.feedKey!==liveFeedKey.current)return;
          commands.current?.requestRefresh();returnToFeed(navigation);
        }:undefined}/>}</Stack.Screen>
      <Stack.Screen name="Account">{({navigation})=><AccountScreen onDone={()=>{if(navigation.isFocused() && navigation.canGoBack())navigation.goBack();}}/>}</Stack.Screen>
      <Stack.Screen name="Settings" options={{headerShown:false}}>{({navigation})=><PlaybackSettings visible preferences={preferences} snapshot={sound} captionPreferences={captionPreferences} captions={captions} onClose={()=>{if(navigation.isFocused())navigation.goBack();}}/>}</Stack.Screen>
      {playbackDiagnostics && <Stack.Screen name="ReadinessCheck" options={{headerShown:false,gestureEnabled:false}}>{({navigation})=><ReadinessCheckScreen muted={sound.muted}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onModal={probe=>{if(isCurrent() && navigation.isFocused()){readinessCheck.current=probe;navigation.navigate('ReadinessCover');}}}/>}</Stack.Screen>}
      {playbackDiagnostics && <Stack.Screen name="ReadinessCover" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation})=>readinessCheck.current?<ReadinessCheckCover probe={readinessCheck.current}
        onReveal={()=>{if(!navigation.isFocused() || !isCurrent())return;readinessCheck.current?.reveal();navigation.goBack();}}
        onCancel={()=>{if(!navigation.isFocused())return;readinessCheck.current?.cancel();navigation.goBack();}}/>:<Message title="Check unavailable" onRetry={()=>navigation.goBack()}/>}</Stack.Screen>}
      </Stack.Group>
    </Stack.Navigator>
  </NavigationContainer>;
}
function FeedRoute({navigation,context,select,preferences,sound,captionPreferences,captions,restore,onCreator,onBackProfile,onBackGlobal,onLaunch,onComments,onRetryEntry,onChooseLaunch,entry,blocked,registerPlayback,registerCommands,feedKey,onPrepareLaunch,trace,visitId}:NativeStackScreenProps<Routes,'Feed'> & Props & {
  visitId:number;
  onPrepareLaunch?:(item:FeedVideoItem)=>void;trace?:NavigationTrace;
  context:FeedContext;select:(c:FeedContext)=>void;restore?:FeedCheckpoint;entry?:LaunchEntry;blocked?:boolean;onLaunch:(item:FeedVideoItem)=>void;onComments:(publicationId:number)=>void;onBackGlobal?:()=>void;onRetryEntry:()=>Promise<void>;onChooseLaunch:()=>void;onCreator:(id:number)=>void;onBackProfile?:()=>void;
  registerPlayback:(visitId:number,handle:FeedPlaybackHandle)=>()=>void;registerCommands:(visitId:number,handle:FeedCommands)=>()=>void;feedKey:string;
}) {
  const focused=useIsFocused();const {store:auth,snapshot}=useAuth();
  const registerMedia=useCallback((handle:FeedPlaybackHandle)=>registerPlayback(visitId,handle),[registerPlayback,visitId]);
  const registerActions=useCallback((handle:FeedCommands)=>registerCommands(visitId,handle),[registerCommands,visitId]);
  const liveRole=useRef(focused);liveRole.current=focused;
  useLayoutEffect(()=>()=>{liveRole.current=false;},[]);
  const guard=<T extends unknown[]>(fn:((...args:T)=>void)|undefined)=>(...args:T)=>{if(liveRole.current)fn?.(...args);};
  const goGlobal=()=>{if(!liveRole.current)return;if(snapshot.status==='unavailable')auth.browseAnonymously();select({kind:'global'});};
  if(snapshot.status==='unavailable' && !snapshot.viewer)return <View style={{flex:1,padding:24,gap:12}}>
    <Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>
    <Action label="Browse Global" onPress={goGlobal}/><Action label="Account" onPress={()=>navigation.navigate('Account')}/>
  </View>;
  return <View style={{position:'absolute',top:0,left:0,right:0,bottom:0}} pointerEvents={focused?'auto':'none'} accessibilityElementsHidden={!focused} importantForAccessibility={focused?'auto':'no-hide-descendants'}><FeedScreen context={context} preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions} focused={focused} restore={restore} entry={entry} trace={trace} onPrepareLaunch={onPrepareLaunch} blocked={blocked} onLaunch={guard(onLaunch)} onComments={guard(onComments)} onBackGlobal={onBackGlobal?guard(onBackGlobal):undefined} onRetryEntry={onRetryEntry} onChooseLaunch={onChooseLaunch}
    onCreator={guard(onCreator)} onBackProfile={onBackProfile?guard(onBackProfile):undefined} registerPlayback={registerMedia} registerCommands={registerActions}
    onSpaces={()=>{if(liveRole.current&&navigation.isFocused())navigation.navigate('Spaces');}} onMenu={()=>{if(liveRole.current&&navigation.isFocused())navigation.navigate('Menu',{source:'feed',feedKey});}} onGlobal={goGlobal}/></View>;
}
