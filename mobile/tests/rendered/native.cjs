// Controlled native ports; actual product components, stores and coordinator are bundled.
const R = global.__viewerUi.React, e = global.__viewerUi;
for (const name of ['View','Text','Pressable','ScrollView','ActivityIndicator','Image','Modal','KeyboardAvoidingView','TextInput']) {
  exports[name] = ({ children, ...props }) => R.createElement(name, props, children);
}
exports.SafeAreaView = exports.View;
exports.useSafeAreaInsets = () => e.insets || {top:44,bottom:34,left:0,right:0};
exports.Platform = { OS: 'ios' };
exports.Keyboard = { dismiss: () => { e.keyboardDismissed = true; } };
exports.useWindowDimensions = () => e.dimensions || { width: 375, height: 812, fontScale: 1 };
const absoluteFill = {position:'absolute',left:0,right:0,top:0,bottom:0};
exports.StyleSheet = { create: value => value, absoluteFill, absoluteFillObject: absoluteFill };
exports.Share = { share: async value => { e.shared = value; } };
exports.Alert = { alert: (...args) => { e.alert = args; } };
exports.FlatList = R.forwardRef((props, ref) => {
  R.useImperativeHandle(ref, () => ({ scrollToOffset: value => e.scrolls.push(value) }));
  const content = value => typeof value === 'function' ? R.createElement(value) : value;
  return R.createElement('FlatList', props, content(props.ListHeaderComponent),
    ...(props.data.length ? props.data.map((item, index) => R.createElement(R.Fragment, { key: props.keyExtractor?.(item,index) ?? item.publicationId ?? item.id }, props.renderItem({ item, index }))) : [content(props.ListEmptyComponent)]),content(props.ListFooterComponent));
});
exports.AppState = { get currentState() { return e.state; }, addEventListener: (name, fn) => {
  const listeners=name==='memoryWarning'?(e.memoryListeners??=new Set()):e.listeners;
  listeners.add(fn); return { remove: () => listeners.delete(fn) };
} };
exports.VideoView = ({ player, ...props }) => {
  const callback=R.useRef(props.onFirstFrameRender);callback.current=props.onFirstFrameRender;
  R.useLayoutEffect(() => {
    e.frames ||= new Map();e.frames.set(player,()=>callback.current?.());
    if(!e.manualFrames)callback.current?.();
    return()=>e.frames.delete(player);
  }, [player]);
  return R.createElement('VideoView', {player,...props});
};
const defaultReadiness={prepareAsync:async(player,attempt,seconds)=>{player.currentTime=seconds;return {attempt,kind:'target_decoded',targetSeconds:seconds,timelineSeconds:seconds,decodedFrameSeconds:seconds,seekCompletedMs:1,decodedFrameMs:2,width:720,height:1280,muted:player.muted,rate:player.playing?1:0};},cancelAsync:async()=>{}};
exports.requireOptionalNativeModule = name => name==='ViewerReadiness'?{
 presentationSizeAsync:player=>e.presentationSize?e.presentationSize(player):Promise.resolve(player.displaySize??{width:720,height:1280}),
 prepareAsync:(player,attempt,seconds)=>(attempt.startsWith('feed-entry-')?e.entryReadiness??defaultReadiness:e.readiness??defaultReadiness).prepareAsync(player,attempt,seconds),
 cancelAsync:attempt=>(attempt.startsWith('feed-entry-')?e.entryReadiness??defaultReadiness:e.readiness??defaultReadiness).cancelAsync(attempt)
}:null;
exports.AccessibilityInfo = {
  isReduceMotionEnabled:async()=>true,
  addEventListener:()=>({remove:()=>{}}),
};
exports.Easing = { linear: value=>value };
exports.Animated = { View:exports.View, Value:class {setValue(){} interpolate(){return 0;}},
  timing:()=>({start(){},stop(){}}),loop:()=>({start(){},stop(){}}) };
exports.createVideoPlayer = () => {
  const events = new Map();
  const player = { loop: true, muted: true, playing: false, status: 'idle', currentTime: 0, duration: 10, bufferedPosition: 6, timeUpdateEventInterval: 0,
    addListener: (event, fn) => { const set = events.get(event) || new Set(); events.set(event, set); set.add(fn); return { remove: () => set.delete(fn) }; },
    emit: (event, value) => { for (const fn of events.get(event) || []) fn(value); },
    loads:0, replaceAsync: async () => { player.loads++;await Promise.resolve(); player.status = 'readyToPlay'; player.emit('statusChange', { status: player.status }); },
    play: () => { player.playing = true; player.emit('playingChange', { isPlaying: true }); },
    pause: () => { player.playing = false; player.emit('playingChange', { isPlaying: false }); },
    release: () => { player.released = true; player.playing = false; events.clear(); },
    count: () => [...events.values()].reduce((n, set) => n + set.size, 0) };
  e.players.push(player); return player;
};
exports.useAuth = () => ({ store: e.auth, snapshot: e.auth ? R.useSyncExternalStore(e.auth.subscribe, e.auth.getSnapshot) : e.snapshot, baseUrl: e.baseUrl || 'https://api.test' });
exports.usePublicationAccess = () => true;
exports.useSpaceAccess = () => ({ authorized: true, checking: false, error: null, check: async () => true });
exports.useViewerFeed = (context,restore) => {
  const store = R.useMemo(() => e.feedFactory ? e.feedFactory(context,restore) : e.feed, [context.kind,context.spaceId,restore]);
  R.useEffect(()=>{if(e.feedFactory){void store.refresh();return store.cancel;}},[store]);
  return {store,snapshot:R.useSyncExternalStore(store.subscribe,store.getSnapshot),client:e.client,
    clearResume:()=>{e.clearedResume=(e.clearedResume||0)+1;}};
};
exports.useViewerClient = () => ({ client: e.client, auth: e.auth, generation: e.auth.getSnapshot().generation });

// Opt-in fake-server protocol for suites exercising the actual client/manager.
exports.nativeFetch = async (...args) => {
 const response=await e.fetch(...args);if(!e.serverAccess||!response.ok||!/json/.test(response.headers.get('content-type')||''))return response;
 const body=await response.json(),u=new URL(args[0]);
 const identity=e.auth.getSnapshot().viewer?{viewerId:e.auth.getSnapshot().viewer.id,remainingMs:60000}:undefined;
 const annotate=data=>{
 const access={version:1,...(identity?{identity}:{}),publicationViews:[]};
 if(data.context&&data.items){
  if(u.searchParams.has('publicationIds')){const ids=u.searchParams.get('publicationIds').split(',').map(Number);data.items=data.items.filter(i=>ids.includes(i.publicationId));data.unavailable=ids.filter(id=>!data.items.some(i=>i.publicationId===id));}
  if(data.context.kind==='space'){
   access.spaceView={spaceId:data.context.space.id,remainingMs:60000};
   access.publicationViews=data.items.map(i=>({publicationId:i.publicationId,spaceId:i.spaceId,uploadId:i.uploadId,productionUlid:i.productionUlid,creatorId:i.creator.id,remainingMs:60000}));
  }else access.publicView={remainingMs:60000,publicationIds:data.items.map(i=>i.publicationId)};
 }
 return access;
 };
 if(u.searchParams.get('include')==='entry'&&body.space&&e.makeEntry){
  if(e.denied||e.targetMissing)return new Response(JSON.stringify({error:e.denied?'forbidden':'launch_target_unavailable'}),{status:e.denied?403:404,headers:response.headers});
  body.entry=e.makeEntry(body.space,body.publicationId);body.entry.access=annotate(body.entry);
 }
 const access=annotate(body);
 body.access=access;return new Response(JSON.stringify(body),{status:response.status,headers:response.headers});
};
