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
   assert.ok(back);assert.equal(back.findByType('Image').props.accessible,false);assert.equal(flatten(back.findByType('Image').props.style).width,24);
   await Test.act(async()=>root.update(R.createElement(PlaybackSettings,{visible:true,onClose:()=>{},preferences:{},snapshot:{},captionPreferences:{},captions:{ready:true}})));
   assert.ok(root.root.findAllByType('Text').some(n=>n.props.children==='Playback settings'));
   assert.equal(root.root.findAllByType('Modal').length,0);
   const radio=root.root.findAllByType('Pressable').find(n=>n.props.accessibilityRole==='radio');
   assert.equal(flatten(radio.props.style).width,width/fontScale<280?'100%':undefined);
  }
  await Test.act(async()=>root.update(R.createElement(SpacesScreen,{selected:{kind:'global'},onSelect:()=>{},onSignIn:()=>{}})));
  assert.ok(root.root.findByType('ScrollView'));assert.ok(root.root.findAllByType('Pressable').some(n=>n.props.accessibilityLabel==='Account'));
 }finally{await Test.act(async()=>root?.unmount());}
});
test('a long rules-review queue remains inside a bounded scroll area and keeps each source action reachable',async()=>{
 const {FeedFooter,e}=await bundle("export {FeedFooter} from './src/feed/FeedScreen';");e.dimensions={width:320,height:568,fontScale:3.1};let selected=null,root;
 try{await Test.act(async()=>{root=Test.create(R.createElement(FeedFooter,{snapshot:{items:[{publicationId:1}],nextCursor:null,reviewRequired:Array.from({length:30},(_,i)=>({id:i+1,name:`Community ${i+1}`,type:'group'}))},store:{refresh:()=>{}},onReviewSource:s=>{selected=s.id;}}));});
 const scroll=root.root.findByType('ScrollView');assert.equal(flatten(scroll.props.style).flex,1);const last=scroll.findAllByType('Pressable').find(n=>n.props.accessibilityLabel==='Review rules for Community 30');assert.ok(last);await Test.act(async()=>last.props.onPress());assert.equal(selected,30);assert.ok(root.root.findAllByType('Text').every(n=>n.props.allowFontScaling!==false));
 }finally{await Test.act(async()=>root?.unmount());}
});
