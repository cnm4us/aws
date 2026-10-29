const esbuild = require('esbuild');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const React = require('react');
const Test = require('react-test-renderer');
global.IS_REACT_ACT_ENVIRONMENT = true;

async function bundle(entries, preview = false, realFeed = false, realAccess = false, nativeOverrides = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'viewer-ui-'));
  const outfile = path.join(directory, 'test.cjs');
  global.__viewerUi = { React, players: [], listeners: new Set(), state: 'active', requests: [], scrolls: [], ...nativeOverrides };
  await esbuild.build({ stdin: { contents: entries, resolveDir: path.resolve(__dirname, '../..'), loader: 'tsx' },
    outfile, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', loader: { '.png': 'file' },
    define: { __DEV__: 'false', 'process.env.EXPO_PUBLIC_VIEWER_BUILD_KIND': JSON.stringify(preview ? 'internal-preview' : 'release'),
      'process.env.EXPO_PUBLIC_VIEWER_DIAGNOSTICS': JSON.stringify(preview ? '1' : '0') },
    plugins: [{ name: 'controlled-native-ports', setup(build) {
      build.onResolve({filter:/^@react-native-async-storage\/async-storage$/},()=>({path:'storage',namespace:'controlled-storage'}));
      build.onLoad({filter:/.*/,namespace:'controlled-storage'},()=>({contents:'module.exports={getItem:async()=>null,setItem:async()=>{},removeItem:async()=>{}}',loader:'js'}));
      build.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: require.resolve(args.path), external: true }));
      build.onResolve({ filter: /^@react-navigation\/(native|native-stack)$/ }, () => ({path:'navigation',namespace:'controlled-nav'}));
      build.onLoad({filter:/.*/,namespace:'controlled-nav'},()=>({contents:fs.readFileSync(path.join(__dirname,'navigation.cjs'),'utf8'),loader:'js',resolveDir:path.resolve(__dirname,'../..')}));
      build.onResolve({ filter: /^(react-native|react-native-safe-area-context|expo-video|expo-modules-core)$|\/(useAuth|useViewerFeed|useSpaceAccess)$/ },
        args => (realFeed && /\/useViewerFeed$/.test(args.path) || realAccess && /\/useSpaceAccess$/.test(args.path)) ? undefined : ({ path: 'ports', namespace: 'controlled' }));
      build.onLoad({ filter: /.*/, namespace: 'controlled' }, () => ({ contents: fs.readFileSync(path.join(__dirname, 'native.cjs'), 'utf8'), loader: 'js' }));
    } }], logLevel: 'silent' });
  const result = require(outfile);
  fs.rmSync(directory, { recursive: true, force: true });
  return { ...result, e: global.__viewerUi };
}
const flatten = style => Array.isArray(style) ? Object.assign({}, ...style.map(flatten)) : style ?? {};
function visible(node){for(let n=node;n;n=n.parent){if(n.props?.accessibilityElementsHidden===true||n.props?.importantForAccessibility==='no-hide-descendants'||n.type==='Screen'&&n.props.focused===false)return false;}return true;}
module.exports = { bundle, React, Test, flatten, visible };
