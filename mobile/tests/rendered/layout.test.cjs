const assert=require('node:assert/strict');
const test=require('node:test');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');
test('actual large-text layouts preserve scalable action labels and reachable scroll containers',async()=>{
 const {FeedHeader,PlaybackSettings,SpacesScreen,Action,e}=await bundle(`export {FeedHeader} from './src/ui/FeedHeader';export {PlaybackSettings} from './src/preferences/PlaybackSettings';export {SpacesScreen} from './src/spaces/SpacesScreen';export {Action} from './src/ui/Message';`);
 e.snapshot={status:'anonymous',generation:1};e.auth={getSnapshot:()=>e.snapshot,subscribe:()=>()=>{}};
 let root;
 try{
  for(const width of [320,375])for(const fontScale of [1,1.5,3.1]){
   e.dimensions={width,height:812,fontScale};
   await Test.act(async()=>{const props={context:{kind:'space',spaceId:1,type:'group',name:'A very long space name '.repeat(6)},onSpaces:()=>{},onMenu:()=>{},onBackProfile:()=>{}};root?root.update(R.createElement(FeedHeader,props)):root=Test.create(R.createElement(FeedHeader,props));});
   const title=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel?.startsWith('Choose space'));
   assert.match(title.props.accessibilityLabel,/very long space/);assert.equal(title.props.onLongPress,undefined);
   assert.match(title.props.accessibilityLabel,/\. group$/);
   assert.equal(root.root.findAllByType('Text').some(n=>n.props.children==='group'),false);
   assert.equal(title.findAllByType('Image').length,2); // type icon and chooser chevron
   const name=title.findByType('Text');assert.notEqual(name.props.allowFontScaling,false);assert.equal(name.props.numberOfLines,2);
   const back=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Back to profile');
   assert.ok(back);assert.equal(back.findByType('Text').props.numberOfLines,undefined);assert.notEqual(back.findByType('Text').props.allowFontScaling,false);
   await Test.act(async()=>root.update(R.createElement(PlaybackSettings,{visible:true,onClose:()=>{},preferences:{},snapshot:{},captionPreferences:{},captions:{ready:true}})));
   assert.ok(root.root.findByType('ScrollView').findAllByType('Text').some(n=>n.props.children==='Playback settings'));
   const radio=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityRole==='radio');
   assert.equal(flatten(radio.props.style).width,width/fontScale<280?'100%':undefined);
  }
  await Test.act(async()=>root.update(R.createElement(SpacesScreen,{selected:{kind:'global'},onSelect:()=>{},onSignIn:()=>{}})));
  assert.ok(root.root.findByType('ScrollView'));assert.ok(root.root.findAllByType('Pressable').some(n=>n.props.accessibilityLabel==='Account'));
 }finally{await Test.act(async()=>root?.unmount());}
});
