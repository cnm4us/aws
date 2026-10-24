// Controlled native ports; actual product components, stores and coordinator are bundled.
const R = global.__viewerUi.React, e = global.__viewerUi;
for (const name of ['View','Text','Pressable','ScrollView','ActivityIndicator','Image','Modal','KeyboardAvoidingView','TextInput']) {
  exports[name] = ({ children, ...props }) => R.createElement(name, props, children);
}
exports.SafeAreaView = exports.View;
exports.Platform = { OS: 'ios' };
exports.Keyboard = { dismiss: () => { e.keyboardDismissed = true; } };
exports.useWindowDimensions = () => e.dimensions || { width: 375, height: 812, fontScale: 1 };
exports.StyleSheet = { create: value => value, absoluteFill: {}, absoluteFillObject: {} };
exports.Share = { share: async value => { e.shared = value; } };
exports.Alert = { alert: (...args) => { e.alert = args; } };
exports.FlatList = R.forwardRef((props, ref) => {
  R.useImperativeHandle(ref, () => ({ scrollToOffset: value => e.scrolls.push(value) }));
  const content = value => typeof value === 'function' ? R.createElement(value) : value;
  return R.createElement('FlatList', props, content(props.ListHeaderComponent),
    ...(props.data.length ? props.data.map((item, index) => R.createElement(R.Fragment, { key: props.keyExtractor?.(item,index) ?? item.publicationId ?? item.id }, props.renderItem({ item, index }))) : [content(props.ListEmptyComponent)]),content(props.ListFooterComponent));
});
exports.AppState = { get currentState() { return e.state; }, addEventListener: (_name, fn) => {
  e.listeners.add(fn); return { remove: () => e.listeners.delete(fn) };
} };
exports.VideoView = ({ player, ...props }) => {
  R.useLayoutEffect(() => { props.onFirstFrameRender?.(); }, [player, props.onFirstFrameRender]);
  return R.createElement('VideoView', props);
};
exports.createVideoPlayer = () => {
  const events = new Map();
  const player = { loop: true, muted: true, playing: false, status: 'idle', currentTime: 0, duration: 10, bufferedPosition: 6, timeUpdateEventInterval: 0,
    addListener: (event, fn) => { const set = events.get(event) || new Set(); events.set(event, set); set.add(fn); return { remove: () => set.delete(fn) }; },
    emit: (event, value) => { for (const fn of events.get(event) || []) fn(value); },
    replaceAsync: async () => { await Promise.resolve(); player.status = 'readyToPlay'; player.emit('statusChange', { status: player.status }); },
    play: () => { player.playing = true; player.emit('playingChange', { isPlaying: true }); },
    pause: () => { player.playing = false; player.emit('playingChange', { isPlaying: false }); },
    release: () => { player.released = true; player.playing = false; events.clear(); },
    count: () => [...events.values()].reduce((n, set) => n + set.size, 0) };
  e.players.push(player); return player;
};
exports.useAuth = () => ({ store: e.auth, snapshot: e.auth ? R.useSyncExternalStore(e.auth.subscribe, e.auth.getSnapshot) : e.snapshot, baseUrl: e.baseUrl || 'https://api.test' });
exports.useSpaceAccess = () => ({ authorized: true, checking: false, error: null, check: async () => true });
exports.useViewerFeed = (context,restore) => {
  const store = R.useMemo(() => e.feedFactory ? e.feedFactory(context,restore) : e.feed, [context.kind,context.spaceId,restore]);
  R.useEffect(()=>{if(e.feedFactory){void store.refresh();return store.cancel;}},[store]);
  return {store,snapshot:R.useSyncExternalStore(store.subscribe,store.getSnapshot),client:e.client,
    clearResume:()=>{e.clearedResume=(e.clearedResume||0)+1;}};
};
exports.useViewerClient = () => ({ client: e.client, auth: e.auth, generation: e.auth.getSnapshot().generation });

exports.nativeFetch = (...args) => e.fetch(...args);
