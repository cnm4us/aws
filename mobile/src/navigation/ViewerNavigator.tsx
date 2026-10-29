import {CreationSourcesScreen,type CreationSource} from '../discovery/CreationSourcesScreen';
import {DestinationEntryScreen} from '../discovery/DestinationEntryScreen';
import {isAggregate,contextName,type AggregateKind,type SourceContext} from '../feed/context';
import {DiscoveryScreen} from '../discovery/DiscoveryScreen';
import {EntryScreen} from '../discovery/EntryScreen';
import {contextEntryKey,toContext,type SpaceCard,discoveryPrefix,getEntry} from '../discovery/api';
import {ResumeWriter} from '../discovery/resumeWriter';
import { ReportScreen } from '../reporting/ReportScreen';
import { ReportMemory } from '../reporting/reportMemory';
import type { ReportTarget } from '../reporting/api';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { NavigationContainer, DarkTheme, CommonActions, useIsFocused } from '@react-navigation/native';
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
import {FeedCheckpoints} from './feedCheckpoints';
import { ViewerMenu } from './ViewerMenu';
import {menuCurrent,menuDestinationRoutes,type MenuOrigin} from './menuNavigation';
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

type Routes={Home:undefined;CreationSources:{publicationId:number};YourGroups:undefined;YourChannels:undefined;AggregateEntry:{kind:AggregateKind};YourSpaces:undefined;Recent:undefined;Genre:{slug:string;name:string};SpaceEntry:{entryKey:string;about?:boolean;launch?:{sourceId:number;productionUlid:string|null;creatorId:number|null;generation:number};creatorJourney?:{creatorId:number;generation:number};aggregateReview?:AggregateKind;exact?:CreationSource};Feed:undefined;Report:{target:ReportTarget;generation:number;feedKey:string;capturedSeconds:number};ReadinessCheck:undefined;ReadinessCover:undefined;Comments:{spaceId:number;publicationId:number;generation:number;feedKey:string};LaunchSpaces:{sourceId:number;productionUlid:string|null;creatorId:number|null;generation:number};Menu:MenuOrigin;Spaces:undefined;Account:undefined;Settings:undefined;CreatorProfile:{creatorId:number;journeyGeneration:number;followProof?:FollowProof}};
const Stack=createNativeStackNavigator<Routes>();
type FeedVisit={identityKey:string;generation:number;context:FeedContext;visitId:number;restore?:FeedCheckpoint;entry?:LaunchEntry;trace?:NavigationTrace};
type Props={preferences:PlaybackPreferences;sound:PlaybackPreferencesSnapshot;captionPreferences:CaptionPreferences;captions:ReturnType<CaptionPreferences['getSnapshot']>};
export function ViewerNavigator({preferences,sound,captionPreferences,captions}:Props) {
  const {store:auth,snapshot,baseUrl}=useAuth();
  const {client}=useViewerClient();
  const [startup,setStartup]=useState<{client:typeof client;enabled:boolean;destinations:boolean}|null>(null);
  const [feedMounted,setFeedMounted]=useState(true);
  const [entryReviewRequired,setEntryReviewRequired]=useState(false);
  useEffect(()=>{const controller=new AbortController();void client.getJson(`${discoveryPrefix}/config`,controller.signal).then((data:any)=>{if(!controller.signal.aborted)setStartup({client,enabled:data?.nativeHomeEnabled===true,destinations:data?.nativeDestinationsEnabled===true});}).catch(()=>{if(!controller.signal.aborted)setStartup({client,enabled:false,destinations:false});});return()=>controller.abort();},[client]);
  const discoveryEnabled=startup?.client===client&&startup.enabled;
  const destinationsEnabled=discoveryEnabled&&startup?.destinations===true;
  const durable=useMemo(()=>new ResumeWriter(client,()=>auth.getSnapshot().generation===snapshot.generation&&auth.getSnapshot().status==='authenticated'),[client,auth,snapshot.generation]);
  useEffect(()=>()=>durable.dispose(),[durable]);
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
    if(!discoveryEnabled&&auth.getSnapshot().generation===snapshot.generation && auth.getSnapshot().status==='authenticated' && AppState.currentState==='active')resources.preparation.prepare(item);
  },[resources,auth,snapshot.generation,discoveryEnabled]);
  const reportMemory=useMemo(()=>new ReportMemory(),[auth,baseUrl,snapshot.generation]);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state!=='active')reportMemory.clearDrafts();});return()=>{sub.remove();reportMemory.clear();};},[reportMemory]);
  const checkpoints=useMemo(()=>new FeedCheckpoints(baseUrl,snapshot.generation),[auth,baseUrl,snapshot.generation]);
  const launch=useMemo(()=>new GlobalLaunchJourney(),[baseUrl,snapshot.generation]);
  const launchVisit=useSyncExternalStore(launch.subscribe,launch.getSnapshot);
  const aggregateRequest=useRef<AbortController|null>(null);
  useEffect(()=>{const sub=AppState.addEventListener('change',state=>{if(state!=='active')aggregateRequest.current?.abort();});return()=>{sub.remove();aggregateRequest.current?.abort();};},[baseUrl,snapshot.generation]);
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
  const persist=()=>{
    if(!isCurrent())return;
    const saved=playback.current?.checkpoint?.();
    if(saved){checkpoints.save({...saved,context:current.context,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:current.visitId});
      if(discoveryEnabled&&saved.publicationId&&saved.productionUlid&&auth.getSnapshot().status==='authenticated')void durable.write(contextEntryKey(current.context),{publicationId:saved.publicationId,productionUlid:saved.productionUlid,positionSeconds:saved.positionSeconds,userPaused:saved.userPaused,...(saved.spaceId?{spaceId:saved.spaceId}:{})});}
  };
  const persistLive=useRef(persist);persistLive.current=persist;
  useEffect(()=>{if(!discoveryEnabled)return;const timer=setInterval(()=>persistLive.current(),15000);const sub=AppState.addEventListener('change',state=>{if(state!=='active')persistLive.current();});return()=>{clearInterval(timer);sub.remove();};},[durable,discoveryEnabled]);
  const enterDiscovery=async(space:SpaceCard,navigation:any,target?:Routes['SpaceEntry']['launch'],creatorJourney?:Routes['SpaceEntry']['creatorJourney'],fromStart=false,exact?:CreationSource)=>{
    if(!isCurrent()||!navigation.isFocused())return;
    if(target){
      const result=await resolveLaunch(client,target.sourceId,target.productionUlid,space.id,undefined,target.creatorId,true);
      if(!isCurrent()||!navigation.isFocused())return;
      const next=launch.enter(result,target.generation);if(!next)throw Error('This launch has changed. Go back and select the space again.');
      journey.reset();transition(next.context,undefined,next.entry);setFeedMounted(true);navigation.popTo('Feed');return;
    }
    const next=toContext(space),memory=checkpoints.take(next);
    let restore:FeedCheckpoint|undefined=fromStart?undefined:memory;
    if(fromStart)checkpoints.clear(next);
    if(auth.getSnapshot().status==='authenticated') {
      try{const state=await durable.read(contextEntryKey(next));if(!isCurrent()||!navigation.isFocused())return;
        if(!fromStart&&!memory&&state.outcome==='unavailable')throw new ApiError('The saved video or position is no longer available. You can start with the current feed.',409,'resume_unavailable');
        if(!fromStart&&!restore&&state.checkpoint)restore={...state.checkpoint,context:next,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:serial.current+1};
      }catch(error){if(error instanceof ApiError&&[401,403,404,409,428].includes(error.status??0))throw error;}
    }
    if(!isCurrent()||!navigation.isFocused())return;
    if(exact)restore={publicationId:exact.publicationId,productionUlid:exact.productionUlid,positionSeconds:0,userPaused:false,context:next,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:serial.current+1};
    if(creatorJourney){if(!journey.enter(creatorJourney.creatorId,creatorJourney.generation))throw Error('This creator visit has changed. Go back and try again.');}else journey.reset();
    launch.reset();transition(next,restore);setFeedMounted(true);
    navigation.popTo('Feed');
  };
  const transition=(context:FeedContext,restore?:FeedCheckpoint,entry?:LaunchEntry,trace?:NavigationTrace)=>{
    if(!isCurrent())return;
    persist();
    setEntryReviewRequired(false);
    retryRequest.current?.abort();
    // Each actual feed change starts a fresh native pool. Scalar checkpoints
    // and authorized JSON may survive; no decoder survives another feed.
    const saved=playback.current?.checkpoint?.();
    if(saved)checkpoints.save({...saved,context:current.context,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:current.visitId});
    playback.current?.retainOrigin?.();
    playback.current?.release();
    setSelection({identityKey,generation:snapshot.generation,context,restore,entry,trace,visitId:++serial.current});
  };
  const select=(next:FeedContext)=>{if(!isCurrent() || contextKey(next)===contextKey(context))return;const saved=checkpoints.take(next);
    const trace=playbackDiagnostics?.navigationStart(next.kind==='global'?'global_return':'space');trace?.mark('destination_resolved');
    journey.reset();launch.reset();transition(next,saved,undefined,trace);};
  const openMenu=(navigation:any,route:{name:string;key:string},extra:Pick<MenuOrigin,'feedKey'|'entryKey'|'destination'>={})=>{
    if(!isCurrent()||!navigation.isFocused()||AppState.currentState!=='active'||route.name==='Menu')return;
    persist();navigation.navigate('Menu',{name:route.name,key:route.key,generation:snapshot.generation,...extra});
  };
  const menuValid=(navigation:any,origin:MenuOrigin)=>isCurrent()&&navigation.isFocused()&&AppState.currentState==='active'&&origin.generation===snapshot.generation
    &&navigation.getState().routes.some((r:any)=>r.key===origin.key&&r.name===origin.name)
    &&(origin.name!=='Feed'||origin.feedKey===liveFeedKey.current);
  const menuSelect=(navigation:any,origin:MenuOrigin,destination:string,params?:object)=>{
    if(!menuValid(navigation,origin)||(['Home','YourSpaces'].includes(destination)&&!discoveryEnabled))return;
    if(menuCurrent(origin)===destination){navigation.goBack();return;}
    if(origin.name==='Account')auth.cancelSignIn();
    persist();
    if(destination==='Home'){resources.preparation.clear();playback.current?.release();setFeedMounted(false);journey.reset();launch.reset();}
    else if(['LaunchSpaces','SpaceEntry'].includes(origin.name)){resources.preparation.clear();launch.reset();}
    const routes=menuDestinationRoutes(navigation.getState().routes,destination,params);
    navigation.dispatch(CommonActions.reset({index:routes.length-1,routes}));
  };
  const enterAggregate=async(kind:AggregateKind,navigation:any,fresh=false)=>{
    if(!isCurrent()||!navigation.isFocused()||AppState.currentState!=='active'||!destinationsEnabled||auth.getSnapshot().status!=='authenticated')return;
    const request=new AbortController();aggregateRequest.current?.abort();aggregateRequest.current=request;
    const next:FeedContext={kind},memory=fresh?undefined:checkpoints.take(next);let restore:FeedCheckpoint|undefined=memory;
    const state=await durable.read(kind,request.signal);if(request.signal.aborted||aggregateRequest.current!==request||!isCurrent()||!navigation.isFocused()||AppState.currentState!=='active')return;
    if(!fresh&&!memory&&state.outcome==='unavailable')throw new ApiError('The saved video is no longer available in this feed. Start from the current feed to continue.',409,'resume_unavailable');
    if(fresh)checkpoints.clear(next);
    if(!fresh&&!restore&&state.checkpoint)restore={...state.checkpoint,context:next,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:serial.current+1};
    journey.reset();launch.reset();transition(next,restore);setFeedMounted(true);returnToFeed(navigation);
  };
  const aggregateMenu=(navigation:any,origin:MenuOrigin,kind:AggregateKind)=>{
    if(!menuValid(navigation,origin))return;
    if(origin.name==='Feed'&&context.kind===kind){navigation.goBack();return;}
    menuSelect(navigation,origin,'AggregateEntry',{kind});
  };
  const aggregateProps=(navigation:any)=>destinationsEnabled?{onAggregate:(kind:AggregateKind)=>navigation.navigate('AggregateEntry',{kind})}:{};
  const originName=visit.origin?contextName(visit.origin.context):'Global';
  if(startup?.client!==client)return <Message title="Loading" busy/>;
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
    <Stack.Navigator initialRouteName={discoveryEnabled?'Home':'Feed'} screenOptions={{contentStyle:{backgroundColor:'#000'}}}>
      <Stack.Group navigationKey={viewerIdentityKey(baseUrl,snapshot.viewer?.id)}>
      {discoveryEnabled&&<>
      <Stack.Screen name="Home" options={{headerShown:false}}>{({navigation,route})=><DiscoveryScreen {...aggregateProps(navigation)} onMenu={()=>openMenu(navigation,route)} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')}/>}</Stack.Screen>
      <Stack.Screen name="YourSpaces" options={{headerShown:false}}>{({navigation,route})=><DiscoveryScreen {...aggregateProps(navigation)} mode="saved" onMenu={()=>openMenu(navigation,route)} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      {destinationsEnabled&&<>
      <Stack.Screen name="YourGroups" options={{headerShown:false}}>{({navigation,route})=><DiscoveryScreen {...aggregateProps(navigation)} mode="groups" onMenu={()=>openMenu(navigation,route)} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      <Stack.Screen name="YourChannels" options={{headerShown:false}}>{({navigation,route})=><DiscoveryScreen {...aggregateProps(navigation)} mode="channels" onMenu={()=>openMenu(navigation,route)} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      <Stack.Screen name="CreationSources" options={{headerShown:false}}>{({navigation,route})=><CreationSourcesScreen publicationId={route.params.publicationId} onMenu={()=>openMenu(navigation,route)} onClose={()=>navigation.goBack()} onSelect={source=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(source.sourceContext),about:false,exact:source,launch:undefined,creatorJourney:undefined,aggregateReview:undefined})} onAbout={source=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(source.sourceContext),about:true,exact:source,launch:undefined,creatorJourney:undefined,aggregateReview:undefined})}/>}</Stack.Screen>
      <Stack.Screen name="AggregateEntry" options={{headerShown:false,gestureEnabled:false}}>{({navigation,route})=><DestinationEntryScreen kind={route.params.kind} onEnter={fresh=>enterAggregate(route.params.kind,navigation,fresh)} onMenu={()=>openMenu(navigation,route)} onClose={()=>navigation.goBack()} onAccount={()=>navigation.replace('Account')}/>}</Stack.Screen>
      </>}
      <Stack.Screen name="Recent" options={{headerShown:false}}>{({navigation,route})=><DiscoveryScreen {...aggregateProps(navigation)} mode="recent" onMenu={()=>openMenu(navigation,route)} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      <Stack.Screen name="Genre" options={{headerShown:false}}>{({navigation,route})=><DiscoveryScreen {...aggregateProps(navigation)} mode="genre" onMenu={()=>openMenu(navigation,route)} genre={route.params} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')} onClose={()=>navigation.goBack()}/>}</Stack.Screen>
      <Stack.Screen name="SpaceEntry" options={{headerShown:false,gestureEnabled:false}}>{({navigation,route})=><EntryScreen onMenu={()=>openMenu(navigation,route,{entryKey:route.params.entryKey})} entryKey={route.params.entryKey} about={route.params.about} onEnter={(space,fromStart)=>route.params.aggregateReview?enterAggregate(route.params.aggregateReview,navigation,false):enterDiscovery(space,navigation,route.params.launch,route.params.creatorJourney,fromStart,route.params.exact)} onClose={()=>navigation.goBack()} onAccount={()=>navigation.navigate('Account')}/>}</Stack.Screen>
      </>}
      <Stack.Screen name="Feed" options={{headerShown:false}}>
        {props=>!feedMounted&&discoveryEnabled?<View style={{flex:1,backgroundColor:'#000'}}/>:<FeedRoute {...props} onOpenMenu={()=>{const source=playback.current?.source?.();openMenu(props.navigation,props.route,{feedKey,entryKey:source?contextEntryKey(source):isAggregate(context)?undefined:contextEntryKey(context),destination:destinationsEnabled?(context.kind==='global'?'Global':context.kind==='following'?'Following':context.kind==='creations'?'YourCreations':undefined):undefined});}} key={`${snapshot.generation}:${current.visitId}`} visitId={current.visitId} context={context} select={select} preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions}
          onShowSources={()=>{const id=playback.current?.capture().publicationId;if(id&&context.kind==='creations')props.navigation.navigate('CreationSources',{publicationId:id});}}
          onReviewSource={space=>{if(isAggregate(context))props.navigation.navigate('SpaceEntry',{entryKey:String(space.id),about:true,aggregateReview:context.kind});}}
          onForgetCheckpoint={()=>{if(isCurrent()&&liveFeedKey.current===feedKey)checkpoints.clear(context);}} restore={current.restore} entry={current.entry} trace={current.trace} onPrepareLaunch={prepareLaunch} blocked={context.kind==='global' && launchVisit.sourceUnavailable} registerPlayback={registerPlayback} registerCommands={registerCommands} feedKey={feedKey}
          reportMemory={reportMemory}
          onPersist={discoveryEnabled?()=>persistLive.current():undefined}
          entryReviewRequired={entryReviewRequired}
          onReviewRequired={discoveryEnabled&&!isAggregate(context)?()=>{persist();setEntryReviewRequired(true);props.navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(context),about:true});}:undefined}
          onAbout={discoveryEnabled?()=>{const source=playback.current?.source?.()??(!isAggregate(context)?context:undefined);if(!source)return;persist();props.navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(source),about:true});}:undefined}
          onSelectEntry={discoveryEnabled?next=>props.navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(next)}):undefined}
          onReport={publicationId=>{
            if(!isCurrent()||!props.navigation.isFocused())return;
            const saved=playback.current?.capture();if(!saved||saved.publicationId!==publicationId)return;
            const source=playback.current?.source?.()??(!isAggregate(context)?context:undefined);if(!source)return;
            const target:ReportTarget={context:source.kind==='global'?{kind:'global'}:{kind:'space',spaceId:source.spaceId},publicationId};
            props.navigation.navigate('Report',{target,generation:snapshot.generation,feedKey,capturedSeconds:saved.positionSeconds});
          }}
          onComments={publicationId=>{
            const source=playback.current?.source?.()??(!isAggregate(context)?context:undefined);if(!isCurrent() || !props.navigation.isFocused() || source?.kind!=='space' || auth.getSnapshot().status!=='authenticated')return;
            if(playback.current?.capture().publicationId!==publicationId)return;
            props.navigation.navigate('Comments',{spaceId:source.spaceId,publicationId,generation:snapshot.generation,feedKey});
          }}
          onLaunch={item=>{
            playback.current?.retainOrigin?.();
            if(!isCurrent() || !props.navigation.isFocused() || context.kind!=='global')return;
            const saved=playback.current?.capture();if(!saved?.publicationId || saved.publicationId!==item.publicationId)return;
            chooserTrace.current=playbackDiagnostics?.navigationStart('launch');
            const generation=launch.open({...saved,context,apiOrigin:baseUrl,authGeneration:snapshot.generation,journeyGeneration:launch.getSnapshot().generation+1,productionUlid:item.productionUlid,creatorId:item.creator.id});
            props.navigation.navigate('LaunchSpaces',{sourceId:item.publicationId,productionUlid:item.productionUlid,creatorId:item.creator.id,generation});
          }}
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
            const source=playback.current?.source?.()??(!isAggregate(context)?context:undefined);
            const followProof=source?.kind==='space' && ['group','channel'].includes(source.type) && saved.publicationId && auth.getSnapshot().status==='authenticated'
              ?{spaceId:source.spaceId,publicationId:saved.publicationId,creatorId:id,generation:snapshot.generation,visitId:++followVisits.current}:undefined;
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
      <Stack.Screen name="Report" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=><ReportScreen key={`${route.params.feedKey}:${route.params.target.publicationId}`}
        {...route.params} onMenu={()=>openMenu(navigation,route)} memory={reportMemory}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onSignIn={()=>{if(isCurrent()&&navigation.isFocused()){reportMemory.clearDrafts();navigation.replace('Account');}}}
        onDenied={error=>{if(isCurrent()&&liveFeedKey.current===route.params.feedKey&&error instanceof ApiError){if(route.params.target.context.kind==='global'){auth.globalFeed.clear();auth.access.invalidatePublic(route.params.target.publicationId);}commands.current?.denyAccess?.(error);}}}/>}
      </Stack.Screen>
      <Stack.Screen name="Comments" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=><CommentsScreen key={route.params.feedKey}
        {...route.params} onMenu={()=>openMenu(navigation,route)} onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onDenied={error=>{if(isCurrent() && liveFeedKey.current===route.params.feedKey && error instanceof ApiError)commands.current?.denyAccess?.(error);}}/>}</Stack.Screen>
      <Stack.Screen name="LaunchSpaces" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=><LaunchSpacesScreen onMenu={()=>openMenu(navigation,route)}
        onChoose={discoveryEnabled?destination=>{if(isCurrent()&&navigation.isFocused())navigation.navigate('SpaceEntry',{entryKey:String(destination.space.id),launch:{...route.params}});}:undefined}
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
      <Stack.Screen name="CreatorProfile" options={({navigation,route})=>({title:'Creator profile',headerBackTitle:originName,
        headerRight:()=> <IconButton icon="menu" label="Open menu" onPress={()=>openMenu(navigation,route)}/>})}>
        {({navigation,route})=><CreatorProfileScreen creatorId={route.params.creatorId} returnName={originName} followProof={route.params.followProof}
          onFollowDenied={error=>{if(isCurrent() && route.params.followProof?.spaceId===(context.kind==='space'?context.spaceId:null) && error instanceof ApiError && error.status===403)commands.current?.denyAccess?.(error);}}
          onAccount={()=>{if(navigation.isFocused())navigation.navigate('Account');}}
          onEnter={destination=>{
            if(liveIdentity.current.auth!==auth || liveIdentity.current.baseUrl!==baseUrl || auth.getSnapshot().generation!==snapshot.generation
              || auth.getSnapshot().status!=='authenticated' || !navigation.isFocused())return;
            if(discoveryEnabled){navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(destination),creatorJourney:{creatorId:route.params.creatorId,generation:route.params.journeyGeneration}});return;}
            if(!journey.enter(route.params.creatorId,route.params.journeyGeneration))return;
            transition(destination);returnToFeed(navigation);
          }}/>}
      </Stack.Screen>
      <Stack.Screen name="Spaces" options={{headerShown:false,presentation:'transparentModal',animation:'fade',gestureEnabled:false,contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=>discoveryEnabled?<DiscoveryScreen {...aggregateProps(navigation)} onMenu={()=>openMenu(navigation,route,{destination:destinationsEnabled?'Chooser':undefined})} overlay mode={destinationsEnabled?'chooser':'saved'} onSelect={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:false,launch:undefined,creatorJourney:undefined})} onAbout={space=>navigation.navigate('SpaceEntry',{entryKey:contextEntryKey(toContext(space)),about:true,launch:undefined,creatorJourney:undefined})} onRecent={()=>navigation.navigate('Recent')} onGenre={genre=>navigation.navigate('Genre',genre)} onAccount={()=>navigation.navigate('Account')} onClose={()=>navigation.goBack()}/>:<SpacesScreen onMenu={()=>openMenu(navigation,route)} selected={context}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onSelect={c=>{if(!navigation.isFocused() || !isCurrent())return;select(c);returnToFeed(navigation);}}
        onSignIn={()=>{if(navigation.isFocused()&&isCurrent())navigation.replace('Account');}}/>}</Stack.Screen>
      <Stack.Screen name="Menu" options={{headerShown:false,presentation:'fullScreenModal'}}>{({navigation,route})=><ViewerMenu current={menuCurrent(route.params)}
        onHome={discoveryEnabled?()=>menuSelect(navigation,route.params,'Home'):undefined}
        onFollowing={destinationsEnabled?()=>aggregateMenu(navigation,route.params,'following'):undefined}
        onCreations={destinationsEnabled?()=>aggregateMenu(navigation,route.params,'creations'):undefined}
        onGlobal={destinationsEnabled?()=>{if(!menuValid(navigation,route.params))return;if(route.params.name==='Feed'&&context.kind==='global'){navigation.goBack();return;}menuSelect(navigation,route.params,'SpaceEntry',{entryKey:'global'});}:undefined}
        onGroups={destinationsEnabled?()=>menuSelect(navigation,route.params,'YourGroups'):undefined}
        onChannels={destinationsEnabled?()=>menuSelect(navigation,route.params,'YourChannels'):undefined}
        onSaved={discoveryEnabled&&!destinationsEnabled?()=>menuSelect(navigation,route.params,'YourSpaces'):undefined}
        onAbout={discoveryEnabled&&route.params.entryKey&&['Feed','SpaceEntry'].includes(route.params.name)?()=>menuSelect(navigation,route.params,'SpaceEntry',{entryKey:route.params.entryKey,about:true}):undefined}
        onReadiness={playbackDiagnostics&&context.kind==='global'&&route.params.name==='Feed'&&route.params.entryKey==='global'?()=>{
          if(menuValid(navigation,route.params))navigation.navigate('ReadinessCheck');
        }:undefined}
        onClose={()=>{if(navigation.isFocused())navigation.goBack();}}
        onAccount={()=>menuSelect(navigation,route.params,'Account')}
        onSettings={()=>menuSelect(navigation,route.params,'Settings')}
        onRefresh={route.params.name==='Feed'?()=>{
          if(!menuValid(navigation,route.params))return;
          checkpoints.clear(context);commands.current?.requestRefresh();returnToFeed(navigation);
        }:undefined}/>}</Stack.Screen>
      <Stack.Screen name="Account" options={{headerShown:false}}>{({navigation,route})=><AccountScreen onMenu={()=>openMenu(navigation,route)} onDone={()=>{if(navigation.isFocused()&&navigation.canGoBack())navigation.goBack();}}/>}</Stack.Screen>
      <Stack.Screen name="Settings" options={{headerShown:false,presentation:'transparentModal',contentStyle:{backgroundColor:'transparent'}}}>{({navigation,route})=><PlaybackSettings visible onMenu={()=>openMenu(navigation,route)} preferences={preferences} snapshot={sound} captionPreferences={captionPreferences} captions={captions} onClose={()=>{if(navigation.isFocused())navigation.goBack();}}/>}</Stack.Screen>
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
function FeedRoute({navigation,context,select,preferences,sound,captionPreferences,captions,restore,onCreator,onBackProfile,onLaunch,onComments,onReport,reportMemory,onRetryEntry,onChooseLaunch,entry,blocked,registerPlayback,registerCommands,feedKey,onPrepareLaunch,trace,visitId,onForgetCheckpoint,onAbout,onSelectEntry,onPersist,onReviewRequired,entryReviewRequired,onOpenMenu,onReviewSource,onShowSources}:NativeStackScreenProps<Routes,'Feed'> & Props & {
  onShowSources?:()=>void;onReviewSource?:(space:{id:number;name:string;type:string})=>void;onOpenMenu?:()=>void;onPersist?:()=>void;onReviewRequired?:()=>void;entryReviewRequired?:boolean;
  onAbout?:()=>void;onSelectEntry?:(next:FeedContext)=>void;
  visitId:number;onForgetCheckpoint:()=>void;
  onPrepareLaunch?:(item:FeedVideoItem)=>void;trace?:NavigationTrace;
  context:FeedContext;select:(c:FeedContext)=>void;restore?:FeedCheckpoint;entry?:LaunchEntry;blocked?:boolean;onLaunch:(item:FeedVideoItem)=>void;onComments:(publicationId:number)=>void;onReport:(publicationId:number)=>void;reportMemory:ReportMemory;onRetryEntry:()=>Promise<void>;onChooseLaunch:()=>void;onCreator:(id:number)=>void;onBackProfile?:()=>void;
  registerPlayback:(visitId:number,handle:FeedPlaybackHandle)=>()=>void;registerCommands:(visitId:number,handle:FeedCommands)=>()=>void;feedKey:string;
}) {
  const focused=useIsFocused();const {store:auth,snapshot}=useAuth();
  const {client}=useViewerClient();
  const registerMedia=useCallback((handle:FeedPlaybackHandle)=>registerPlayback(visitId,handle),[registerPlayback,visitId]);
  const registerActions=useCallback((handle:FeedCommands)=>registerCommands(visitId,handle),[registerCommands,visitId]);
  const liveRole=useRef(focused);liveRole.current=focused;
  useLayoutEffect(()=>()=>{liveRole.current=false;},[]);
  const guard=<T extends unknown[]>(fn:((...args:T)=>void)|undefined)=>(...args:T)=>{if(liveRole.current)fn?.(...args);};
  useEffect(()=>navigation.addListener?.('beforeRemove',()=>onPersist?.()),[navigation,onPersist]);
  const reviewLive=useRef(onReviewRequired);reviewLive.current=onReviewRequired;
  useEffect(()=>{if(!focused||!onReviewRequired)return;const controller=new AbortController();
    const verify=()=>{if(AppState.currentState!=='active')return;void getEntry(client,contextEntryKey(context),controller.signal).then(value=>{if(liveRole.current&&!controller.signal.aborted&&(value.requiresAcknowledgment||!value.canView))reviewLive.current?.();}).catch(error=>{if(liveRole.current&&!controller.signal.aborted&&error instanceof ApiError&&[401,403,404,428].includes(error.status??0))reviewLive.current?.();});};
    const timer=setInterval(verify,60000),sub=AppState.addEventListener('change',state=>{if(state==='active')verify();});
    return()=>{clearInterval(timer);sub.remove();controller.abort();};
  },[focused,client,contextKey(context),!!onReviewRequired]);
  const goGlobal=()=>{if(!liveRole.current)return;if(snapshot.status==='unavailable')auth.browseAnonymously();if(onSelectEntry)onSelectEntry({kind:'global'});else select({kind:'global'});};
  if(snapshot.status==='unavailable' && !snapshot.viewer)return <View style={{flex:1,padding:24,gap:12}}>
    <Message title="Cannot verify sign-in" message={snapshot.message??undefined} onRetry={()=>{void auth.retryValidation();}}/>
    <Action label="Browse Global" onPress={goGlobal}/><Action label="Account" onPress={()=>navigation.navigate('Account')}/>
  </View>;
  return <View style={{position:'absolute',top:0,left:0,right:0,bottom:0}} pointerEvents={focused?'auto':'none'} accessibilityElementsHidden={!focused} importantForAccessibility={focused?'auto':'no-hide-descendants'}><FeedScreen onShowSources={onShowSources?guard(onShowSources):undefined} onReviewSource={onReviewSource?guard(onReviewSource):undefined} onPersist={onPersist} entryReviewRequired={entryReviewRequired} onAbout={onAbout?guard(onAbout):undefined} context={context} preferences={preferences} sound={sound} captionPreferences={captionPreferences} captions={captions} focused={focused} restore={restore} entry={entry} trace={trace} onPrepareLaunch={onPrepareLaunch} blocked={blocked} onForgetCheckpoint={onForgetCheckpoint} onLaunch={guard(onLaunch)} onComments={guard(onComments)} onReport={guard(onReport)} reportMemory={reportMemory} onRetryEntry={onRetryEntry} onChooseLaunch={onChooseLaunch}
    onCreator={guard(onCreator)} onBackProfile={onBackProfile?guard(onBackProfile):undefined} registerPlayback={registerMedia} registerCommands={registerActions}
    onSpaces={()=>{if(liveRole.current&&navigation.isFocused())navigation.navigate('Spaces');}} onMenu={()=>{if(liveRole.current&&navigation.isFocused())onOpenMenu?.();}} onGlobal={goGlobal}/></View>;
}
