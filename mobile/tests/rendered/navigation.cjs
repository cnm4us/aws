// Actual installed stack reducer; controlled screen host replaces native iOS surfaces only.
const R = global.__viewerUi.React, e = global.__viewerUi;
const { StackRouter, CommonActions, StackActions } = require('@react-navigation/routers');
const Focus = R.createContext(true);
exports.useIsFocused = () => R.useContext(Focus);
exports.DarkTheme = {};
exports.CommonActions=CommonActions;
exports.NavigationContainer = ({ children, onStateChange }) => { e.stateChanged = onStateChange; return children; };
const Screen = () => null, Group = () => null;
function Body({ screens,initialRouteName }) {
  const router = R.useMemo(() => StackRouter({ initialRouteName: initialRouteName || 'Feed' }), []);
  const options = { routeNames: screens.map(s => s.props.name), routeParamList: {}, routeGetIdList: {} };
  const [state, setState] = R.useState(() => router.getInitialState(options));
  const live = R.useRef(state); live.current = state;
  const dispatch = action => {
    const next = router.getStateForAction(live.current, action, options);
    if (next) { const hydrated=router.getRehydratedState(next,options); live.current = hydrated; setState(hydrated); }
  };
  const nav = route => ({
    getState:()=>live.current,
    dispatch,
    isFocused: () => live.current.routes[live.current.index]?.key === route.key,
    canGoBack: () => live.current.index > 0,
    navigate: (name, params) => dispatch({ ...CommonActions.navigate(name, params), source: route.key }),
    replace: name => dispatch({ ...StackActions.replace(name), source: route.key }),
    popTo: name => dispatch({ ...StackActions.popTo(name), source: route.key }),
    goBack: () => dispatch({ ...CommonActions.goBack(), source: route.key }),
  });
  e.navigationState = state; e.dispatch = dispatch;
  R.useLayoutEffect(() => { e.stateChanged?.(state); }, [state]);
  return state.routes.map((route, index) => {
    const screen = screens.find(s => s.props.name === route.name), navigation = nav(route);
    const resolved = typeof screen.props.options === 'function' ? screen.props.options({ route, navigation }) : screen.props.options;
    return R.createElement(Focus.Provider, { key: route.key, value: index === state.index },
      R.createElement('Screen', { name: route.name, focused: index === state.index, navigation, options: resolved },
        resolved?.headerRight?.(), screen.props.children({ route, navigation })));
  });
}
exports.createNativeStackNavigator = () => ({ Screen, Group, Navigator: ({ children,initialRouteName }) => {
  const group = R.Children.toArray(children)[0];
  const flatten=children=>R.Children.toArray(children).flatMap(child=>child.type===R.Fragment?flatten(child.props.children):[child]);
  return R.createElement(Body, { key: group.props.navigationKey, initialRouteName,screens: flatten(group.props.children) });
} });
