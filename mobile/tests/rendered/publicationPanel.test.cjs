const assert=require('node:assert/strict'),test=require('node:test');
const {bundle,React:R,Test,flatten}=require('./harness.cjs');

async function fixture(t,story=false){
 const {FeedCard,TextResources}=await bundle("export {FeedCard} from './src/feed/FeedCard';export {TextResources} from './src/content/resources';");
 const requests=[],expanded=[],profiles=[],interactions=[];let root;
 const resources=new TextResources({getJson:(path,signal)=>new Promise((resolve,reject)=>requests.push({path,signal,resolve,reject}))},{kind:'global'},()=>{});
 let props={item:{publicationId:1,publishedAt:'2026-10-26T10:15:00Z',creator:{id:2,displayName:'Creator name'},hasStory:story,
  storyPreview:'Hidden preview',description:'Upload description must not appear',playbackUrl:'https://media.test/1'},
  resources,height:600,headerHeight:100,active:true,onCreator:id=>profiles.push(id),onStoryExpanded:v=>expanded.push(v),onStoryInteracting:v=>interactions.push(v)};
 const render=async patch=>{props={...props,...patch};await Test.act(async()=>root?root.update(R.createElement(FeedCard,props)):root=Test.create(R.createElement(FeedCard,props)));};
 const texts=()=>root.root.findAllByType('Text').map(n=>n.props.children);
 const button=label=>root.root.findAllByType('Pressable').find(n=>n.props.accessibilityLabel===label);
 const press=async label=>{assert.ok(button(label),label);await Test.act(async()=>button(label).props.onPress());};
 const settle=async text=>Test.act(async()=>requests.at(-1).resolve({context:{kind:'global'},publicationId:props.item.publicationId,storyText:text}));
 t.after(async()=>{await Test.act(async()=>root?.unmount());resources.clear();});
 await render({});return {get root(){return root},get props(){return props},render,texts,button,press,settle,requests,expanded,profiles,interactions};
}

test('metadata-only card has one creator/date panel, profile action and no story request or toggle',async t=>{
 const f=await fixture(t);
 assert.equal(f.texts().filter(x=>x==='Creator name').length,1);
 assert.equal(f.texts().some(x=>typeof x==='string'&&/2026/.test(x)),true);
 assert.equal(f.texts().includes('Upload description must not appear'),false);assert.equal(f.texts().includes('Hidden preview'),false);
 assert.equal(f.button('Expand story'),undefined);assert.equal(f.requests.length,0);
 const creator=f.button("View Creator name's profile");assert.ok(flatten(creator.props.style).minHeight>=44);
 await f.press("View Creator name's profile");assert.deepEqual(f.profiles,[2]);
 const oldPress=creator.props.onPress;await f.render({active:false});await Test.act(async()=>oldPress());assert.deepEqual(f.profiles,[2]);
 await f.render({item:{...f.props.item,creator:{id:null,displayName:'Creator'},publishedAt:null,playbackUrl:null}});
 assert.equal(f.texts().includes('Publishing time unavailable'),true);
 assert.equal(f.texts().includes('This video is unavailable. Swipe to continue.'),true);
 assert.equal(f.root.root.findAllByType('Pressable').length,0);
});

test('story arrow expands upward inside bounded panel, keeps metadata and owns touch scrolling',async t=>{
 const f=await fixture(t,true);
 assert.equal(f.requests.length,0);assert.equal(f.texts().includes('Hidden preview'),false);
 let arrow=f.button('Expand story');assert.equal(arrow.props.accessibilityState.expanded,false);
 assert.equal(flatten(arrow.findByType('Image').props.style).transform[0].rotate,'180deg');assert.equal(arrow.findByType('Image').props.accessible,false);
 assert.equal(flatten(arrow.props.style).width,44);
 await f.press('Expand story');assert.equal(f.requests.length,1);assert.ok(f.texts().includes('Loading story'));
 await f.settle('A long story. '.repeat(100));assert.equal(f.texts().filter(x=>x==='Creator name').length,1);
 arrow=f.button('Collapse story');assert.equal(arrow.props.accessibilityState.expanded,true);
 assert.equal(flatten(arrow.findByType('Image').props.style).transform[0].rotate,'0deg');
 const panel=f.root.root.findAllByType('View').find(n=>n.props.testID==='publication-panel');assert.equal(flatten(panel.props.style).maxHeight,464);
 const body=f.root.root.findAllByType('ScrollView').find(n=>n.props.testID==='publication-story-body');assert.ok(flatten(body.props.style).maxHeight<=270);
 assert.equal(body.findByType('Text').props.selectable,true);
 let stopped=0;await Test.act(async()=>body.props.onTouchStart({stopPropagation(){stopped++}}));assert.equal(stopped,1);assert.equal(f.interactions.at(-1),true);
 await Test.act(async()=>body.props.onTouchCancel());assert.equal(f.interactions.at(-1),false);
 await f.press('Collapse story');assert.equal(f.expanded.at(-1),false);assert.ok(f.button('Expand story'));
});

test('confirmed empty story removes arrow; refreshed publication can discover a new story',async t=>{
 const f=await fixture(t,true);await f.press('Expand story');await f.settle('  \n ');
 assert.equal(f.button('Expand story'),undefined);assert.equal(f.button('Collapse story'),undefined);assert.equal(f.expanded.at(-1),false);
 await f.render({item:{...f.props.item}});assert.ok(f.button('Expand story'));assert.equal(f.requests.length,1);
 await f.press('Expand story');assert.equal(f.requests.length,2,'fresh positive metadata must bypass the previously empty cache');
 await f.settle('Newly added story');assert.ok(f.texts().includes('Newly added story'));
});

test('story failure stays retryable and old callbacks/results cannot reopen covered or replaced content',async t=>{
 const f=await fixture(t,true);const staleToggle=f.button('Expand story').props.onPress;
 await f.press('Expand story');await Test.act(async()=>f.requests.at(-1).reject(Error('offline')));
 assert.ok(f.button('Collapse story'));await f.press('Retry story');const pending=f.requests.at(-1);
 await f.render({active:false});assert.equal(pending.signal.aborted,true);
 await Test.act(async()=>{staleToggle();pending.resolve({context:{kind:'global'},publicationId:1,storyText:'late private text'});});
 await f.render({active:true});assert.ok(f.button('Expand story'));assert.equal(f.texts().includes('late private text'),false);
 await f.press('Expand story');const old=f.requests.at(-1);const callback=f.button('Collapse story').props.onPress;
 await f.render({item:{...f.props.item,publicationId:2}});assert.equal(old.signal.aborted,true);
 await Test.act(async()=>callback());assert.ok(f.button('Expand story'));assert.equal(f.expanded.at(-1),false);
});

test('short stage and very tall metadata keep the whole panel scrollable with collapse reachable',async t=>{
 const f=await fixture(t,true);await f.render({height:300,headerHeight:120});await f.press('Expand story');await f.settle('Story remains reachable');
 const metadata=f.root.root.findAllByType('View').find(n=>n.props.onLayout&&flatten(n.props.style).paddingRight===48);
 await Test.act(async()=>metadata.props.onLayout({nativeEvent:{layout:{height:300}}}));
 const panel=f.root.root.findAllByType('View').find(n=>n.props.testID==='publication-panel');assert.equal(flatten(panel.props.style).maxHeight,144);
 const scroll=panel.findByType('ScrollView');assert.equal(flatten(scroll.props.style).maxHeight,124);
 assert.ok(scroll.findAllByType('Text').some(n=>n.props.children==='Story remains reachable'));
 assert.ok(f.button('Collapse story'));assert.equal(flatten(f.button('Collapse story').props.style).position,'absolute');
});

test('compact metadata restores side inset and keeps name/date in one profile target',async t=>{const f=await fixture(t);const button=f.button("View Creator name's profile");assert.equal(button.findAllByType('Text').length,2);assert.ok(flatten(button.props.style).minHeight>=44);const panel=f.root.root.findAllByType('View').find(n=>n.props.testID==='publication-panel');const style=flatten(panel.props.style);assert.equal(style.paddingHorizontal,12);assert.equal(style.paddingTop,4);assert.equal(style.paddingBottom,6);assert.ok(button.props.accessibilityValue.text.includes('2026'));});
